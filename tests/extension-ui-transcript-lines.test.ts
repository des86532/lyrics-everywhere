import { describe, expect, it } from "vitest";
import { TranscriptLines } from "../extension-ui/src/transcript-lines.js";

const chunk = (start: number, end: number, text: string) => ({ timestamp: [start, end] as [number, number], text });

describe("TranscriptLines", () => {
  it("converts window-relative timestamps and suppresses overlap duplicates", () => {
    const timeline = new TranscriptLines();
    expect(timeline.append(0, [chunk(8, 10, "사랑해"), chunk(10, 11, "너를")])).toEqual([
      { startMs: 8000, endMs: 10000, text: "사랑해" },
      { startMs: 10000, endMs: 11000, text: "너를" },
    ]);
    expect(timeline.append(10000, [chunk(0, 1, "너를"), chunk(1, 2, "다시 만나")])).toEqual([
      { startMs: 11000, endMs: 12000, text: "다시 만나" },
    ]);
  });

  it("drops hallucinated chunks beyond the window so later windows still commit", () => {
    const timeline = new TranscriptLines();
    const options = { windowMs: 12000, commitBeforeMs: 10000 };
    expect(timeline.append(0, [chunk(1, 3, "진짜"), chunk(25, 29, "환각")], options)).toEqual([{ startMs: 1000, endMs: 3000, text: "진짜" }]);
    expect(timeline.append(10000, [chunk(2, 4, "다음 줄")], options)).toEqual([{ startMs: 12000, endMs: 14000, text: "다음 줄" }]);
  });

  it("defers chunks starting after commitBeforeMs to the next window", () => {
    const timeline = new TranscriptLines();
    const options = { windowMs: 12000, commitBeforeMs: 10000 };
    expect(timeline.append(0, [chunk(8, 9, "앞"), chunk(10.5, 11.5, "잘린 줄")], options)).toEqual([{ startMs: 8000, endMs: 9000, text: "앞" }]);
    expect(timeline.append(10000, [chunk(0.5, 3, "잘린 줄 전체")], options)).toEqual([{ startMs: 10500, endMs: 13000, text: "잘린 줄 전체" }]);
  });

  it("commits everything within the window for the final window and clamps ends", () => {
    const timeline = new TranscriptLines();
    expect(timeline.append(0, [chunk(10.5, 15, "끝"), chunk(12, 13, "밖")], { windowMs: 12000 })).toEqual([{ startMs: 10500, endMs: 12000, text: "끝" }]);
  });

  it("rejects empty or invalid chunks and accepts a fresh capture after clear", () => {
    const timeline = new TranscriptLines();
    expect(timeline.append(0, [chunk(0, 1, " "), chunk(2, 1, "invalid"), { timestamp: [null, 1], text: "missing" }])).toEqual([]);
    timeline.append(20000, [chunk(0, 2, "old session")]);
    timeline.clear();
    expect(timeline.append(0, [chunk(0, 1, "새 세션")])).toEqual([{ startMs: 0, endMs: 1000, text: "새 세션" }]);
  });
});
