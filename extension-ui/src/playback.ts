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
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
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
