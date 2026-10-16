export const MAX_LYRIC_OFFSET_MS = 3_600_000;
export const MAX_LYRIC_TIMING_CORRECTIONS = 200;

export function isValidLyricOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value !== 0 &&
    Math.abs(value) <= MAX_LYRIC_OFFSET_MS;
}

export function parseLyricTimingCorrections(value: unknown): Record<string, number> {
  const valid: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return valid;
  for (const [key, offsetMs] of Object.entries(value)) {
    if (/^[A-Za-z0-9_-]{11}:[a-f0-9]{64}$/u.test(key) && isValidLyricOffset(offsetMs)) valid[key] = offsetMs;
  }
  return valid;
}

/** Applies one offset change (0 removes it) to the latest stored corrections, keeping only the newest 200, so concurrent side panels never overwrite each other's entries. */
export function updateLyricTimingCorrections(stored: unknown, key: string, offsetMs: number): Record<string, number> {
  const corrections = parseLyricTimingCorrections(stored);
  delete corrections[key];
  if (offsetMs !== 0) corrections[key] = offsetMs;
  const keys = Object.keys(corrections);
  for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_LYRIC_TIMING_CORRECTIONS))) delete corrections[oldest];
  return corrections;
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

/** Offset that makes the lyric line starting at lineStartMs play at videoMs. Null when beyond the limit. */
export function alignedLyricOffset(videoMs: number, lineStartMs: number): number | null {
  const offsetMs = Math.round(videoMs - lineStartMs);
  return Number.isFinite(offsetMs) && Math.abs(offsetMs) <= MAX_LYRIC_OFFSET_MS ? offsetMs : null;
}

export function nudgeLyricOffset(currentMs: number, deltaMs: number): number | null {
  const offsetMs = currentMs + deltaMs;
  return Math.abs(offsetMs) <= MAX_LYRIC_OFFSET_MS ? offsetMs : null;
}
