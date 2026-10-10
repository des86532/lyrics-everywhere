import type { SyncedLyrics } from "../../src/domain/types.js";
import { parseLrcWithHash } from "../../src/lyrics/lrc-core.js";
import { exactSyncedCandidatesForArtists, normalizeTrackName, trackTitleVariants } from "./playback.js";

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  duration?: number;
  syncedLyrics?: string;
}

export class LyricsHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "LRCLIB 查詢太頻繁，稍後再試。" : `LRCLIB 搜尋失敗（HTTP ${status}）。`);
  }
}

export async function searchLyrics(trackName: string, artistName: string, fetcher: typeof fetch = fetch): Promise<LrclibRecord[]> {
  const params = new URLSearchParams({ track_name: trackName.trim(), artist_name: artistName.trim() });
  const response = await fetcher(`https://lrclib.net/api/search?${params.toString()}`, { method: "GET", mode: "cors", headers: { Accept: "application/json" } });
  if (!response.ok) throw new LyricsHttpError(response.status);
  const records: unknown = await response.json();
  if (!Array.isArray(records)) throw new Error("LRCLIB 回傳格式無法辨識。");
  return records.filter(isLrclibRecord).filter((record) => Boolean(record.syncedLyrics));
}

export type LyricsSearchFailure = { artist: string; title: string; message: string };

// LRCLIB answers bursts of parallel searches with intermittent 503s; two lanes plus retries keep latency low.
const RETRY_DELAYS_MS = [500, 1200] as const;
const MAX_PARALLEL_SEARCHES = 2;

function isTransient(error: unknown): boolean {
  return error instanceof LyricsHttpError && (error.status === 429 || error.status >= 500);
}

export async function searchLyricsForArtists(
  title: string,
  artists: string[],
  fetcher: typeof fetch = fetch,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<{ recordsByArtist: LrclibRecord[][]; failures: LyricsSearchFailure[] }> {
  const titles = trackTitleVariants(title);
  const recordsByArtist = artists.map(() => [] as LrclibRecord[]);
  const failures: LyricsSearchFailure[] = [];
  let successfulQueries = 0;
  const queries = artists.flatMap((artist, index) => titles.map((queryTitle) => ({ artist, index, queryTitle })));
  let nextQuery = 0;
  const runLane = async () => {
    while (nextQuery < queries.length) {
      const { artist, index, queryTitle } = queries[nextQuery++];
      for (let attempt = 0; ; attempt += 1) {
        try {
          recordsByArtist[index].push(...await searchLyrics(queryTitle, artist, fetcher));
          successfulQueries += 1;
          break;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          if (isTransient(error) && attempt < retryDelaysMs.length) {
            await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
            continue;
          }
          failures.push({ artist, title: queryTitle, message: error instanceof Error ? error.message : "LRCLIB 網路查詢失敗。" });
          break;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_SEARCHES, queries.length) }, runLane));
  if (!successfulQueries && failures.length) throw new Error(`所有歌詞查詢均失敗：${failures[0].message}`);
  return { recordsByArtist, failures };
}

export function durationTolerance(durationMs: number): number {
  return Math.max(8_000, Math.min(20_000, durationMs * 0.06));
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

  const tolerance = durationTolerance(durationMs);
  const candidates = [...candidatesById.values()].filter(
    (record) =>
      typeof record.duration === "number" &&
      Number.isFinite(record.duration) &&
      Math.abs(record.duration * 1000 - durationMs) <= tolerance,
  );

  return { candidates, failures };
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
