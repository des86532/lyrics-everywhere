import { describe, expect, it } from "vitest";
import { isValidLyricTimingCorrection, lyricPositionForVideo, type LyricTimingCorrection } from "../extension-ui/src/lyric-timing.js";

describe("per-video lyric timing correction", () => {
  it("maps the intro offset and holds lyrics through the MV gap", () => {
    const intro: LyricTimingCorrection = { before: { videoMs: 10000, lyricMs: 6000 } };
    expect(lyricPositionForVideo(6000)).toEqual({ positionMs: 6000, inGap: false });
    expect(lyricPositionForVideo(13000, intro)).toEqual({ positionMs: 9000, inGap: false });

    const correction: LyricTimingCorrection = {
      before: intro.before,
      after: { videoMs: 70000, lyricMs: 30000 },
    };
    expect(lyricPositionForVideo(33999, correction)).toEqual({ positionMs: 29999, inGap: false });
    expect(lyricPositionForVideo(34000, correction)).toEqual({ positionMs: 29999, inGap: true });
    expect(lyricPositionForVideo(69999, correction)).toEqual({ positionMs: 29999, inGap: true });
    expect(lyricPositionForVideo(70000, correction)).toEqual({ positionMs: 30000, inGap: false });
    expect(lyricPositionForVideo(73000, correction)).toEqual({ positionMs: 33000, inGap: false });
    expect(lyricPositionForVideo(13000, correction)).toEqual(lyricPositionForVideo(13000, intro));
  });

  it("rejects invalid anchors and second points that do not encode a real gap", () => {
    const before = { videoMs: 10000, lyricMs: 6000 };
    expect(isValidLyricTimingCorrection({ before })).toBe(true);
    expect(isValidLyricTimingCorrection({ before, after: { videoMs: 9000, lyricMs: 30000 } })).toBe(false);
    expect(isValidLyricTimingCorrection({ before, after: { videoMs: 70000, lyricMs: 5000 } })).toBe(false);
    expect(isValidLyricTimingCorrection({ before, after: { videoMs: 34000, lyricMs: 30000 } })).toBe(false);
    expect(isValidLyricTimingCorrection({ before: { videoMs: -1, lyricMs: 0 } })).toBe(false);
    expect(isValidLyricTimingCorrection({ before: { videoMs: Number.NaN, lyricMs: 0 } })).toBe(false);
    expect(isValidLyricTimingCorrection({ before: { videoMs: 0, lyricMs: Number.POSITIVE_INFINITY } })).toBe(false);
  });

  it("ignores malformed corrections without changing normal playback", () => {
    expect(lyricPositionForVideo(6000, { before: { videoMs: -10, lyricMs: 900 } } as LyricTimingCorrection))
      .toEqual({ positionMs: 6000, inGap: false });
    expect(lyricPositionForVideo(6000, { before: { videoMs: 10, lyricMs: 0 }, after: { videoMs: 5, lyricMs: 100 } } as LyricTimingCorrection))
      .toEqual({ positionMs: 6000, inGap: false });
  });
});
