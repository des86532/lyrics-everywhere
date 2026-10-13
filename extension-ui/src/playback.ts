import { toSimplifiedChinese } from "./chinese-script.js";
import type { LrclibRecord } from "./lyrics.js";

import type { TranscriptLine } from "./transcript-lines.js";
export type PlaybackReport = {
  version: 2;
  sessionId: string;
  appId: "youtube" | "youtube-music" | "spotify-web";
  pageUrl: string;
  mediaId: string;
  mediaDurationMs?: number;
  segmentStartMs?: number;
  title: string;
  rawTitle?: string;
  artists: string[];
  artistVerified?: boolean;
  state: "playing" | "paused" | "stopped";
  positionMs: number;
  durationMs: number;
  playbackRate: number;
  capturedAtMs: number;
  musicCredits?: { title: string; artist: string }[];
};

export function playbackPositionAt(report: PlaybackReport, now: number): number {
  const elapsed = report.state === "playing"
    ? Math.max(0, Math.min(3000, now - report.capturedAtMs)) * report.playbackRate
    : 0;
  const localPosition = Math.min(report.durationMs || Number.MAX_SAFE_INTEGER, report.positionMs + elapsed);
  return (report.segmentStartMs ?? 0) + localPosition;
}
export function playbackTrackPositionAt(report: PlaybackReport, now: number): number {
  const elapsed = report.state === "playing"
    ? Math.max(0, Math.min(3000, now - report.capturedAtMs)) * report.playbackRate
    : 0;
  return Math.min(report.durationMs || Number.MAX_SAFE_INTEGER, report.positionMs + elapsed);
}

export const LYRICS_WINDOW_SIZE = 5;

export function lyricWindowStart(lines: ReadonlyArray<{ text: string }>, focusIndex: number): number {
  let start = Math.max(0, Math.min(focusIndex, lines.length - 1));
  let preceding = 0;
  while (start > 0 && preceding < 2) {
    start -= 1;
    if (/\S/u.test(lines[start].text)) preceding += 1;
  }
  let available = 0;
  for (let index = start; index < lines.length && available < LYRICS_WINDOW_SIZE; index += 1) {
    if (/\S/u.test(lines[index].text)) available += 1;
  }
  while (start > 0 && available < LYRICS_WINDOW_SIZE) {
    start -= 1;
    if (/\S/u.test(lines[start].text)) available += 1;
  }
  return start;
}

export type LyricFocus = {
  activeIndex: number;
  state: "active" | "next" | "past";
  gap: { prelude: boolean; remainingMs: number } | null;
};

/** Picks the line to highlight. Blank timed lines (prelude/interlude) never take focus; they yield a countdown to the next text line instead. */
export function lyricFocusAt(
  lines: ReadonlyArray<{ text: string; startMs?: number; endMs?: number }>,
  positionMs: number,
): LyricFocus | null {
  const isText = (line: { text: string; startMs?: number }) => /\S/u.test(line.text) && line.startMs !== undefined;
  const firstText = lines.findIndex(isText);
  if (firstText < 0) return null;
  const matching = lines.findIndex((line) => line.startMs !== undefined && line.endMs !== undefined && positionMs >= line.startMs && positionMs < line.endMs);
  if (matching >= 0 && isText(lines[matching])) return { activeIndex: matching, state: "active", gap: null };
  const nextText = lines.findIndex((line) => isText(line) && line.startMs! > positionMs);
  if (nextText < 0) return { activeIndex: lines.map(isText).lastIndexOf(true), state: "past", gap: null };
  const prelude = nextText === firstText;
  if (matching >= 0 || prelude) {
    return { activeIndex: nextText, state: "next", gap: { prelude, remainingMs: lines[nextText].startMs! - positionMs } };
  }
  return { activeIndex: nextText, state: "next", gap: null };
}

export function mixReplayWindow(lines: TranscriptLine[], positionMs: number): { focusIndex: number; lines: TranscriptLine[] } {
  if (lines.length === 0) return { focusIndex: -1, lines: [] };
  const activeIndex = lines.findIndex((line) => positionMs >= line.startMs && positionMs < line.endMs);
  const nextIndex = lines.findIndex((line) => line.startMs > positionMs);
  const focusIndex = activeIndex >= 0 ? activeIndex : nextIndex >= 0 ? nextIndex : lines.length - 1;
  const visible: TranscriptLine[] = [];
  for (let index = lyricWindowStart(lines, focusIndex); index < lines.length && visible.length < LYRICS_WINDOW_SIZE; index += 1) {
    if (/\S/u.test(lines[index].text)) visible.push(lines[index]);
  }
  return { focusIndex, lines: visible };
}

export type SpecialVideoKind = "multi-song" | "non-song";

const MULTI_SONG_VIDEO = /\b(?:special\s+clip|medley|mash-?up|megamix|compilation)\b|메들리|스페셜\s*클립|組曲|串燒|メドレー/iu;
const NON_SONG_VIDEO = /\b(?:making\s+(?:video|film|of)|behind\s+the\s+scenes?|teaser|trailer|interview|reaction)\b|메이킹|비하인드|티저|인터뷰|幕後花絮|預告/iu;

// Videos that cannot align with one recording's synced lyrics; matching them risks showing the wrong song.
export function specialVideoKind(title: string): SpecialVideoKind | null {
  if (MULTI_SONG_VIDEO.test(title)) return "multi-song";
  if (NON_SONG_VIDEO.test(title)) return "non-song";
  return null;
}

export function normalizeTrackName(value: string): string {
  return toSimplifiedChinese(value.normalize("NFKC")).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

const VERSION_LABEL = /\b(?:live|cover|remix|acoustic|instrumental|karaoke|remaster(?:ed)?|demo|radio\s+edit|sped[\s-]*up|slowed|nightcore)\b|現場|现场|翻唱|伴奏|不插電|라이브|カバー/iu;

function bilingualNameVariants(value: string): string[] {
  const match = value.match(/^([^()[\]]+?)\s*(?:\(([^()]+)\)|\[([^\]]+)\])(.*)$/u);
  if (!match) return [value];
  const alias = match[2] ?? match[3];
  if (VERSION_LABEL.test(alias)) return [value];
  const tail = match[4].trim();
  if (tail && !/^(?:(?:\([^()]+\)|\[[^\]]+\])\s*)+$/u.test(tail)) return [value];
  if (tail && !tail.match(/\([^()]+\)|\[[^\]]+\]/gu)?.every((part) => VERSION_LABEL.test(part))) return [value];
  const left = match[1].trim();
  const right = alias.trim();
  const latin = (name: string) => /[A-Za-z]/u.test(name) && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name);
  const eastAsian = (name: string) => /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) && !/[A-Za-z]/u.test(name);
  const suffix = tail ? ` ${tail}` : "";
  if (latin(left) && eastAsian(right)) return [`${left}${suffix}`, `${right}${suffix}`];
  if (eastAsian(left) && latin(right)) return [`${right}${suffix}`, `${left}${suffix}`];
  return [value];
}

export function trackTitleVariants(value: string): string[] {
  let title = value.normalize("NFKC").trim()
    .replace(/\s*\((?:feat(?:uring)?(?:\.\s*|\s+)|ft(?:\.\s*|\s+)|(?:con|mit)\s+|合作演出\s*[:：]\s*)[^()]*(?:\([^()]*\)[^()]*)*\)/giu, "")
    .replace(/\s*\[(?:feat(?:uring)?(?:\.\s*|\s+)|ft(?:\.\s*|\s+))[^\]]+\]/giu, "")
    .trim();
  // Keep explicit recording labels when removing an unbracketed featured credit.
  const suffix = title.match(/((?:\s*(?:\([^()]+\)|\[[^\]]+\]))+)\s*$/u);
  let versionTail = suffix && suffix[1].match(/\([^()]+\)|\[[^\]]+\]/gu)?.every((part) => VERSION_LABEL.test(part)) ? suffix[1] : "";
  let core = versionTail ? title.slice(0, -versionTail.length) : title;
  const dashVersion = core.match(/\s+[-–—]\s+[^()[\]]+$/u);
  if (dashVersion && VERSION_LABEL.test(dashVersion[0])) {
    versionTail = dashVersion[0] + versionTail;
    core = core.slice(0, -dashVersion[0].length);
  }
  const credit = core.match(/\s+(?:feat(?:uring)?(?:\.\s*|\s+)|ft(?:\.\s*|\s+))([^()[\]]+)$/iu);
  title = (credit && !VERSION_LABEL.test(credit[1]) ? core.slice(0, credit.index).trim() : core) + versionTail;
  return [...new Set(bilingualNameVariants(title.trim()).filter((name) => normalizeTrackName(name)))];
}

// Generic upload/program noise; removed only from search queries, never from the text used for verification.
const TITLE_NOISE = /\b(?:official\s+(?:music\s+)?(?:video|audio|mv|lyric\s+video|visuali[sz]er)|music\s+video|lyrics?\s+video|lyrics?|m\/v|mv|4k|8k|hd|hq|uhd|1080p|720p|full\s+ver(?:sion|\.)?|ep\.?\s*\d+)\b|中字|中文字幕|繁中字幕|動態歌詞|动态歌词|歌詞版|歌词版|歌詞|歌词|純享版|纯享版|純享|纯享|完整版|高音質|高音质|官方版|首播|第[0-9一二三四五六七八九十百]+[期集]/giu;
// Quote and book-title marks conventionally wrap a song title.
const TITLE_QUOTED = /《([^《》]+)》|「([^「」]+)」|『([^『』]+)』|“([^“”]+)”|"([^"]+)"|(?:^|\s)['‘]([^'‘’]+)['’](?=\s|$)/gu;
const TITLE_SEPARATOR = /[|｜《》「」『』【】〈〉\[\]()（）"“”:：]|(?:^|\s)['‘]|['’](?=\s|$)|\s(?:[-–—_~～/／x×]|feat(?:uring)?\.?|ft\.)\s/giu;
const MAX_TITLE_QUERIES = 6;

// De-noised quoted fragments and deduplicated segments of an NFKC-normalized title.
function titleQueryParts(title: string): { quoted: string[]; segments: string[] } {
  const cleaned = title.replace(TITLE_NOISE, " ");
  const quoted = [...cleaned.matchAll(TITLE_QUOTED)]
    .map((match) => (match.slice(1).find((group) => group !== undefined) ?? "").replace(/\s+/gu, " ").trim());
  const seen = new Set<string>();
  const segments = cleaned.split(TITLE_SEPARATOR)
    .map((segment) => segment.replace(/\s+/gu, " ").trim())
    .filter((segment) => {
      const key = normalizeTrackName(segment);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { quoted, segments };
}

// One keyword for LRCLIB's AND search page: the quoted song title when present, else the de-noised title.
export function titleLookupKeyword(rawTitle: string): string {
  const title = rawTitle.normalize("NFKC");
  const { quoted, segments } = titleQueryParts(title);
  const keyword = quoted.find((segment) => normalizeTrackName(segment)) ?? segments.join(" ");
  return toSimplifiedChinese(keyword || title.trim());
}

export function titleSearchQueries(rawTitle: string): string[] {
  const title = rawTitle.normalize("NFKC");
  if (VERSION_LABEL.test(title)) return [];
  const { quoted, segments } = titleQueryParts(title);
  const candidates = [segments.join(" "), ...quoted, ...segments];
  const queries = new Set<string>();
  for (const candidate of candidates) {
    if (!normalizeTrackName(candidate)) continue;
    const query = candidate.slice(0, 200);
    queries.add(query);
    const simplified = toSimplifiedChinese(query);
    if (simplified !== query) queries.add(simplified);
  }
  return [...queries].slice(0, MAX_TITLE_QUERIES);
}

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// Lowercased Simplified words separated by single spaces, splitting Latin↔CJK boundaries ("Capper無人區" → "capper 无人区").
function searchableWords(value: string): string {
  return toSimplifiedChinese(value.normalize("NFKC")).toLocaleLowerCase()
    .replace(/(?<=\p{Script=Latin})(?=[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}])|(?<=[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}])(?=\p{Script=Latin})/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Returns the compact key of `name` when `words` (from searchableWords) mentions it, else "".
function mentionedKey(words: string, name: string): string {
  const needle = searchableWords(name);
  const compact = needle.replaceAll(" ", "");
  if (compact.length < 2) return "";
  if (CJK_SCRIPT.test(needle)) return words.replaceAll(" ", "").includes(compact) ? compact : "";
  return ` ${words} `.includes(` ${needle} `) ? compact : "";
}

// LRCLIB lists collaborations as "A, B, C", "A、B" or "A & B"; any credited artist may be named in the title.
function creditedArtistNames(value: string): string[] {
  const name = value.normalize("NFKC").trim();
  const parts = name.split(/\s*(?:[,、&])\s*/u).filter(Boolean);
  return [...new Set([name, ...(parts.length > 1 ? parts : [])])].flatMap(bilingualNameVariants);
}

// Accept a record only when the video title itself names both its song and one credited artist; never trust upload channels.
export function titleMentionedCandidates(records: LrclibRecord[], rawTitle: string): LrclibRecord[] {
  if (VERSION_LABEL.test(rawTitle.normalize("NFKC"))) return [];
  const words = searchableWords(rawTitle);
  const matches: { record: LrclibRecord; titleKey: string }[] = [];
  for (const record of records) {
    if (!record.syncedLyrics || VERSION_LABEL.test(record.trackName)) continue;
    const titleKey = trackTitleVariants(record.trackName)
      .map((name) => mentionedKey(words, name))
      .reduce((longest, key) => (key.length > longest.length ? key : longest), "");
    if (!titleKey) continue;
    const artistKeys = creditedArtistNames(record.artistName).map((name) => mentionedKey(words, name)).filter(Boolean);
    if (artistKeys.length === 0 || artistKeys.includes(titleKey)) continue;
    matches.push({ record, titleKey });
  }
  const longest = matches.filter(({ titleKey }) => !matches.some((other) => other.titleKey !== titleKey && other.titleKey.includes(titleKey)));
  if (new Set(longest.map(({ titleKey }) => titleKey)).size > 1) return [];
  return [...new Map(longest.map(({ record }) => [record.id, record])).values()];
}

function lyricsMatcher(title: string, artists: string[]): (record: LrclibRecord) => boolean {
  const expectedTitles = trackTitleVariants(title).map(normalizeTrackName);
  const expectedArtists = artists.flatMap((artist) => bilingualNameVariants(artist.normalize("NFKC").trim()).map(normalizeTrackName));
  return (record) => Boolean(record.syncedLyrics) &&
    trackTitleVariants(record.trackName).some((name) => expectedTitles.includes(normalizeTrackName(name))) &&
    bilingualNameVariants(record.artistName.normalize("NFKC").trim()).some((name) => expectedArtists.includes(normalizeTrackName(name)));
}

export function exactSyncedCandidates(records: LrclibRecord[], title: string, artist: string): LrclibRecord[] {
  return records.filter(lyricsMatcher(title, [artist]));
}

export function exactSyncedCandidatesForArtists(
  recordsByArtist: LrclibRecord[][],
  title: string,
  artists: string[],
): LrclibRecord[] {
  const candidatesById = new Map<number, LrclibRecord>();
  const matches = lyricsMatcher(title, artists);
  for (const records of recordsByArtist) {
    for (const record of records) if (matches(record)) candidatesById.set(record.id, record);
  }
  return [...candidatesById.values()];
}
