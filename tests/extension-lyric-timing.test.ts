import { describe, expect, it } from "vitest";
import {
  alignedLyricOffset,
  formatLyricOffset,
  isValidLyricOffset,
  lyricPositionForVideo,
  MAX_LYRIC_OFFSET_MS,
  MAX_LYRIC_TIMING_CORRECTIONS,
  nudgeLyricOffset,
  parseLyricOffset,
  parseLyricTimingCorrections,
  updateLyricTimingCorrections,
} from "../extension-ui/src/lyric-timing.js";

describe("stored lyric timing corrections", () => {
  const keyA = `abcdefghijk:${"a".repeat(64)}`;
  const keyB = `ztrjnlK2cik:${"b".repeat(64)}`;

  it("keeps only valid entries", () => {
    expect(parseLyricTimingCorrections({ [keyA]: 1500, bad: 1, [keyB]: 0 })).toEqual({ [keyA]: 1500 });
    expect(parseLyricTimingCorrections([1])).toEqual({});
    expect(parseLyricTimingCorrections(null)).toEqual({});
  });

  it("applies one change onto the latest stored value without dropping other panels' entries", () => {
    expect(updateLyricTimingCorrections({ [keyA]: 1500 }, keyB, -2000)).toEqual({ [keyA]: 1500, [keyB]: -2000 });
    expect(updateLyricTimingCorrections({ [keyA]: 1500, [keyB]: 1 }, keyA, 0)).toEqual({ [keyB]: 1 });
    expect(updateLyricTimingCorrections(undefined, keyA, 500)).toEqual({ [keyA]: 500 });
  });

  it("moves a re-set key to most recent and evicts the oldest beyond the cap", () => {
    expect(Object.keys(updateLyricTimingCorrections({ [keyA]: 1, [keyB]: 2 }, keyA, 3))).toEqual([keyB, keyA]);
    const full: Record<string, number> = {};
    for (let i = 0; i < MAX_LYRIC_TIMING_CORRECTIONS; i++) full[`${String(i).padStart(11, "0")}:${"c".repeat(64)}`] = 1;
    const oldest = Object.keys(full)[0]!;
    const next = updateLyricTimingCorrections(full, keyA, 5);
    expect(Object.keys(next)).toHaveLength(MAX_LYRIC_TIMING_CORRECTIONS);
    expect(next[oldest]).toBeUndefined();
    expect(Object.keys(next).at(-1)).toBe(keyA);
  });
});

describe("per-video lyric timing offset", () => {
  describe("lyricPositionForVideo", () => {
    it("subtracts the offset from video time and clamps at zero", () => {
      expect(lyricPositionForVideo(13000, 5000)).toBe(8000);
      expect(lyricPositionForVideo(13000, -3000)).toBe(16000);
      expect(lyricPositionForVideo(2000, 5000)).toBe(0);
      expect(lyricPositionForVideo(6000)).toBe(6000);
    });

    it("ignores malformed offsets", () => {
      expect(lyricPositionForVideo(6000, Number.NaN)).toBe(6000);
      expect(lyricPositionForVideo(6000, 1.5)).toBe(6000);
      expect(lyricPositionForVideo(6000, MAX_LYRIC_OFFSET_MS + 1)).toBe(6000);
    });

    it("treats invalid video time as zero", () => {
      expect(lyricPositionForVideo(Number.NaN, 5000)).toBe(0);
      expect(lyricPositionForVideo(-1, -2000)).toBe(2000);
    });
  });

  describe("parseLyricOffset", () => {
    it("parses seconds and m:ss with optional sign", () => {
      expect(parseLyricOffset("5")).toBe(5000);
      expect(parseLyricOffset("5.5")).toBe(5500);
      expect(parseLyricOffset("-2.5")).toBe(-2500);
      expect(parseLyricOffset("+1:05.3")).toBe(65300);
      expect(parseLyricOffset("1：05")).toBe(65000);
      expect(parseLyricOffset(" 0:00 ")).toBe(0);
      expect(parseLyricOffset("-0:00")).toBe(0);
      expect(Object.is(parseLyricOffset("-0"), 0)).toBe(true);
      expect(parseLyricOffset("60:00")).toBe(3600000);
    });

    it("rejects malformed or out-of-range input", () => {
      for (const input of ["1:60", "", "abc", "1:2:3", "5.1234", "60:00.001"]) {
        expect(parseLyricOffset(input)).toBeNull();
      }
    });
  });

  describe("formatLyricOffset", () => {
    it("formats with sign and minutes", () => {
      expect(formatLyricOffset(65300)).toBe("+1:05.3");
      expect(formatLyricOffset(-2500)).toBe("-2.5");
      expect(formatLyricOffset(5000)).toBe("+5");
      expect(formatLyricOffset(60000)).toBe("+1:00");
    });

    it("round-trips through parseLyricOffset", () => {
      for (const value of [1, -999, 59999, 60000, -3600000]) {
        expect(parseLyricOffset(formatLyricOffset(value))).toBe(value);
      }
    });
  });

  describe("isValidLyricOffset", () => {
    it("accepts only non-zero integer milliseconds within the limit", () => {
      for (const value of [0, 1.5, "5", { before: { videoMs: 1, lyricMs: 0 } }, 3600001]) {
        expect(isValidLyricOffset(value)).toBe(false);
      }
      expect(isValidLyricOffset(-3600000)).toBe(true);
    });
  });

  describe("calibration helpers", () => {
    it("aligns a line to the video position with the same sign as lyricPositionForVideo", () => {
      expect(alignedLyricOffset(30000, 6770)).toBe(23230);
      expect(alignedLyricOffset(1000, 5000)).toBe(-4000);
      const offset = alignedLyricOffset(30000, 6770)!;
      expect(lyricPositionForVideo(30000, offset)).toBe(6770);
      expect(alignedLyricOffset(4_000_000, 0)).toBeNull();
    });

    it("nudges the offset and refuses to pass the limit", () => {
      expect(nudgeLyricOffset(2400, -500)).toBe(1900);
      expect(nudgeLyricOffset(500, -500)).toBe(0);
      expect(nudgeLyricOffset(3_600_000, 500)).toBeNull();
    });
  });
});
