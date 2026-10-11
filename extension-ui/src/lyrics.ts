import type { SyncedLyrics } from "../../src/domain/types.js";
import { parseLrcWithHash } from "../../src/lyrics/lrc-core.js";
import { exactSyncedCandidatesForArtists, normalizeTrackName, titleMentionedCandidates, titleSearchQueries, trackTitleVariants } from "./playback.js";

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  duration?: number;
  syncedLyrics?: string;
}
export const LRCLIB_TIMEOUT_MS = 10_000;
export function lrclibFetcher(signal?: AbortSignal, timeoutMs = LRCLIB_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(input, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) throw new Error(`LRCLIB 回應逾時（${timeoutMs / 1000} 秒）。`);
      throw error;
    }
  };
}


export class LyricsHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "LRCLIB 查詢太頻繁，稍後再試。" : `LRCLIB 搜尋失敗（HTTP ${status}）。`);
  }
}

async function fetchLrclibSearch(params: URLSearchParams, fetcher: typeof fetch): Promise<LrclibRecord[]> {
  const response = await fetcher(`https://lrclib.net/api/search?${params.toString()}`, { method: "GET", mode: "cors", headers: { Accept: "application/json" } });
  if (!response.ok) throw new LyricsHttpError(response.status);
  const records: unknown = await response.json();
  if (!Array.isArray(records)) throw new Error("LRCLIB 回傳格式無法辨識。");
  return records.filter(isLrclibRecord).filter((record) => Boolean(record.syncedLyrics));
}

export function searchLyrics(trackName: string, artistName: string, fetcher: typeof fetch = fetch): Promise<LrclibRecord[]> {
  return fetchLrclibSearch(new URLSearchParams({ track_name: trackName.trim(), artist_name: artistName.trim() }), fetcher);
}

export function searchLyricsByKeyword(query: string, fetcher: typeof fetch = fetch): Promise<LrclibRecord[]> {
  return fetchLrclibSearch(new URLSearchParams({ q: query.trim() }), fetcher);
}

// Returns null when LRCLIB has no record with this id.
export async function fetchLrclibRecord(id: number, fetcher: typeof fetch = fetch): Promise<LrclibRecord | null> {
  const response = await fetcher(`https://lrclib.net/api/get/${id}`, { method: "GET", mode: "cors", headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new LyricsHttpError(response.status);
  const record: unknown = await response.json();
  if (!isLrclibRecord(record)) throw new Error("LRCLIB 回傳格式無法辨識。");
  return record;
}

export type LyricsSearchFailure = { artist: string; title: string; message: string };

// LRCLIB answers bursts of parallel searches with intermittent 503s; two lanes plus retries keep latency low.
const RETRY_DELAYS_MS = [500, 1200] as const;
const MAX_PARALLEL_SEARCHES = 2;

function isTransient(error: unknown): boolean {
  return error instanceof LyricsHttpError && (error.status === 429 || error.status >= 500);
}

// `results[i]` answers `queries[i]` (empty when it failed); only AbortError is rethrown.
async function runLrclibQueries<Q>(
  queries: Q[],
  search: (query: Q) => Promise<LrclibRecord[]>,
  failureOf: (query: Q, message: string) => LyricsSearchFailure,
  retryDelaysMs: readonly number[],
): Promise<{ results: LrclibRecord[][]; failures: LyricsSearchFailure[]; successfulQueries: number }> {
  const results = queries.map(() => [] as LrclibRecord[]);
  const failures: LyricsSearchFailure[] = [];
  let successfulQueries = 0;
  let nextQuery = 0;
  const runLane = async () => {
    while (nextQuery < queries.length) {
      const position = nextQuery++;
      for (let attempt = 0; ; attempt += 1) {
        try {
          results[position] = await search(queries[position]);
          successfulQueries += 1;
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          if (isTransient(error) && attempt < retryDelaysMs.length) {
            await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
            continue;
          }
          failures.push(failureOf(queries[position], error instanceof Error ? error.message : "LRCLIB 網路查詢失敗。"));
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_SEARCHES, queries.length) }, runLane));
  return { results, failures, successfulQueries };
}

export async function searchLyricsForArtists(
  title: string,
  artists: string[],
  fetcher: typeof fetch = fetch,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<{ recordsByArtist: LrclibRecord[][]; failures: LyricsSearchFailure[] }> {
  const titles = trackTitleVariants(title);
  const recordsByArtist = artists.map(() => [] as LrclibRecord[]);
  const queries = artists.flatMap((artist, index) => titles.map((queryTitle) => ({ artist, index, queryTitle })));
  const { results, failures, successfulQueries } = await runLrclibQueries(
    queries,
    ({ artist, queryTitle }) => searchLyrics(queryTitle, artist, fetcher),
    ({ artist, queryTitle }, message) => ({ artist, title: queryTitle, message }),
    retryDelaysMs,
  );
  if (!successfulQueries && failures.length) throw new Error(`所有歌詞查詢均失敗：${failures[0].message}`);
  queries.forEach(({ index }, position) => recordsByArtist[index].push(...results[position]));
  return { recordsByArtist, failures };
}

export function durationTolerance(durationMs: number): number {
  return Math.max(8_000, Math.min(20_000, durationMs * 0.06));
}

function withinDurationTolerance(records: LrclibRecord[], durationMs: number): LrclibRecord[] {
  const tolerance = durationTolerance(durationMs);
  return records.filter(
    (record) =>
      typeof record.duration === "number" &&
      Number.isFinite(record.duration) &&
      Math.abs(record.duration * 1000 - durationMs) <= tolerance,
  );
}

export async function searchLyricsForIdentity(
  identity: { titles: string[]; artists: string[] },
  durationMs: number,
  fetcher: typeof fetch = fetch,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<{ candidates: LrclibRecord[]; failures: LyricsSearchFailure[] }> {
  const seenTitles = new Set<string>();
  const candidatesById = new Map<number, LrclibRecord>();
  const failures: LyricsSearchFailure[] = [];
  let successfulQueries = 0;

  for (const title of identity.titles) {
    const normalized = normalizeTrackName(title);
    if (!normalized || seenTitles.has(normalized)) continue;
    seenTitles.add(normalized);

    try {
      const result = await searchLyricsForArtists(title, [identity.artists[0]], fetcher, retryDelaysMs);
      successfulQueries += 1;
      failures.push(...result.failures);
      const matched = exactSyncedCandidatesForArtists(result.recordsByArtist, title, identity.artists);
      for (const record of matched) candidatesById.set(record.id, record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "LRCLIB 網路查詢失敗。";
      failures.push({ artist: identity.artists[0], title, message });
    }
  }

  if (!successfulQueries && failures.length) {
    throw new Error(`所有歌詞查詢均失敗：${failures[0].message}`);
  }

  return { candidates: withinDurationTolerance([...candidatesById.values()], durationMs), failures };
}

export async function searchLyricsByVideoTitle(
  rawTitle: string,
  durationMs: number,
  fetcher: typeof fetch = fetch,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<{ candidates: LrclibRecord[]; failures: LyricsSearchFailure[] }> {
  const queries = titleSearchQueries(rawTitle);
  const recordsById = new Map<number, LrclibRecord>();
  const failures: LyricsSearchFailure[] = [];
  // The whole-title queries rarely hit; only spend the per-segment queries when they find nothing.
  for (const batch of [queries.slice(0, 2), queries.slice(2)]) {
    if (batch.length === 0) continue;
    const result = await runLrclibQueries(
      batch,
      (query) => searchLyricsByKeyword(query, fetcher),
      (query, message) => ({ artist: "影片標題", title: query, message }),
      retryDelaysMs,
    );
    failures.push(...result.failures);
    for (const record of result.results.flat()) recordsById.set(record.id, record);
    const candidates = withinDurationTolerance(titleMentionedCandidates([...recordsById.values()], rawTitle), durationMs);
    if (candidates.length > 0) return { candidates, failures };
  }
  return { candidates: [], failures };
}

export async function parseRecordLyrics(record: LrclibRecord, trackKey: string): Promise<SyncedLyrics> {
  const rawContent = record.syncedLyrics;
  if (!rawContent) throw new Error("這筆搜尋結果沒有同步歌詞。");
  if (!globalThis.crypto?.subtle) throw new Error("此瀏覽器環境無法計算歌詞校驗值。");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawContent));
  const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return parseLrcWithHash(rawContent, trackKey, "lrclib", contentHash);
}

type RankedLyrics = {
  record: LrclibRecord;
  lyrics: SyncedLyrics;
  durationDistance: number;
  artistRank: number;
};

function compareLyrics(left: RankedLyrics, right: RankedLyrics): number {
  return (left.durationDistance - right.durationDistance) ||
    (left.artistRank - right.artistRank) || (left.record.id - right.record.id);
}

// The caller must first restrict candidates to exact title and verified artist matches.
export async function selectAutomaticLyrics(
  records: LrclibRecord[],
  artists: string[],
  durationMs: number,
): Promise<{ record: LrclibRecord; lyrics: SyncedLyrics; recordCount: number; timelineCount: number } | null> {
  const artistNames = artists.map(normalizeTrackName);
  const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
  const timelines = new Map<string, RankedLyrics>();
  let recordCount = 0;
  for (const record of records) {
    const lyrics = await parseRecordLyrics(record, `lrclib-${record.id}`);
    if (lyrics.format === "plain" || lyrics.granularity === "none") continue;
    recordCount += 1;
    const artistIndex = artistNames.indexOf(normalizeTrackName(record.artistName));
    const candidate: RankedLyrics = {
      record,
      lyrics,
      durationDistance: hasDuration
        ? typeof record.duration === "number" && Number.isFinite(record.duration) && record.duration > 0
          ? Math.abs(record.duration * 1000 - durationMs) : Number.POSITIVE_INFINITY
        : 0,
      artistRank: artistIndex < 0 ? artistNames.length : artistIndex,
    };
    const timeline = JSON.stringify(lyrics.lines.map((line) => [
      line.startMs, line.endMs, line.text,
      line.tokens?.length ? line.tokens.map((token) => [token.startMs, token.endMs, token.text]) : null,
    ]));
    const previous = timelines.get(timeline);
    if (!previous || compareLyrics(candidate, previous) < 0) timelines.set(timeline, candidate);
  }
  let best: RankedLyrics | null = null;
  for (const candidate of timelines.values()) {
    if (!best || compareLyrics(candidate, best) < 0) best = candidate;
  }
  return best ? { record: best.record, lyrics: best.lyrics, recordCount, timelineCount: timelines.size } : null;
}

function isLrclibRecord(value: unknown): value is LrclibRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LrclibRecord>;
  return typeof record.id === "number" && typeof record.trackName === "string" && typeof record.artistName === "string";
}
