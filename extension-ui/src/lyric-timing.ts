export const MAX_LYRIC_OFFSET_MS = 3_600_000;

export function isValidLyricOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value !== 0 &&
    Math.abs(value) <= MAX_LYRIC_OFFSET_MS;
}

/** Parses "5", "-2.5" or "+1:05.3" into milliseconds. Returns null when malformed or out of range. */
export function parseLyricOffset(input: string): number | null {
  const match = /^([+-])?(?:(\d+):)?(\d+(?:\.\d{1,3})?)$/u.exec(input.trim().replaceAll("：", ":"));
  if (!match) return null;
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const seconds = Number(match[3]);
  if (match[2] !== undefined && seconds >= 60) return null;
  const magnitude = Math.round((minutes * 60 + seconds) * 1000);
  if (!Number.isSafeInteger(magnitude) || magnitude > MAX_LYRIC_OFFSET_MS) return null;
  return match[1] === "-" && magnitude !== 0 ? -magnitude : magnitude;
}

export function formatLyricOffset(offsetMs: number): string {
  const sign = offsetMs > 0 ? "+" : offsetMs < 0 ? "-" : "";
  const abs = Math.abs(offsetMs);
  const minutes = Math.floor(abs / 60000);
  const rest = abs % 60000;
  const secText = String(rest / 1000);
  return minutes > 0 ? `${sign}${minutes}:${rest < 10000 ? "0" : ""}${secText}` : `${sign}${secText}`;
}

export function lyricPositionForVideo(videoMs: number, offsetMs?: number): number {
  const video = Number.isFinite(videoMs) && videoMs >= 0 ? videoMs : 0;
  return Math.max(0, video - (isValidLyricOffset(offsetMs) ? offsetMs : 0));
}
