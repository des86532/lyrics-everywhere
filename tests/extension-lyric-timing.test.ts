import { describe, expect, it } from "vitest";
import {
  formatLyricOffset,
  isValidLyricOffset,
  lyricPositionForVideo,
  MAX_LYRIC_OFFSET_MS,
  parseLyricOffset,
} from "../extension-ui/src/lyric-timing.js";

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
});
