export type LyricTimingAnchor = { videoMs: number; lyricMs: number };
export type LyricTimingCorrection = { before: LyricTimingAnchor; after?: LyricTimingAnchor };

function isValidAnchor(value: unknown): value is LyricTimingAnchor {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Partial<LyricTimingAnchor>;
  return Number.isFinite(anchor.videoMs) && (anchor.videoMs ?? -1) >= 0 &&
    Number.isFinite(anchor.lyricMs) && (anchor.lyricMs ?? -1) >= 0;
}

export function isValidLyricTimingCorrection(value: unknown): value is LyricTimingCorrection {
  if (!value || typeof value !== "object") return false;
  const correction = value as Partial<LyricTimingCorrection>;
  if (!isValidAnchor(correction.before)) return false;
  if (correction.after === undefined) return true;
  return isValidAnchor(correction.after) &&
    correction.after.videoMs > correction.before.videoMs &&
    correction.after.lyricMs > correction.before.lyricMs &&
    correction.after.videoMs - correction.before.videoMs > correction.after.lyricMs - correction.before.lyricMs;
}

export function lyricPositionForVideo(
  videoMs: number,
  correction?: LyricTimingCorrection,
): { positionMs: number; inGap: boolean } {
  if (!Number.isFinite(videoMs) || videoMs < 0 || !isValidLyricTimingCorrection(correction)) {
    return { positionMs: Math.max(0, Number.isFinite(videoMs) ? videoMs : 0), inGap: false };
  }
  const { before, after } = correction;
  if (!after || videoMs < after.videoMs) {
    const mapped = Math.max(0, videoMs - before.videoMs + before.lyricMs);
    if (after && mapped >= after.lyricMs) return { positionMs: after.lyricMs - 1, inGap: true };
    return { positionMs: mapped, inGap: false };
  }
  return { positionMs: Math.max(0, videoMs - after.videoMs + after.lyricMs), inGap: false };
}
