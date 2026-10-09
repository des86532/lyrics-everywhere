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

  it("rejects empty or invalid chunks and accepts a fresh capture after clear", () => {
    const timeline = new TranscriptLines();
    expect(timeline.append(0, [chunk(0, 1, " "), chunk(2, 1, "invalid"), { timestamp: [null, 1], text: "missing" }])).toEqual([]);
    timeline.append(20000, [chunk(0, 2, "old session")]);
    timeline.clear();
    expect(timeline.append(0, [chunk(0, 1, "새 세션")])).toEqual([{ startMs: 0, endMs: 1000, text: "새 세션" }]);
  });
});
