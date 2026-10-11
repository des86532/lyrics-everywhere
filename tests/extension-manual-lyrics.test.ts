import { describe, expect, it } from "vitest";
import { manualLyricsPrompt, parseManualLyricsInput, parseManualSelections } from "../extension-ui/src/manual-lyrics.js";

describe("manual lyrics input", () => {
  it("accepts LRCLIB links and bare ids", () => {
    const expected = { kind: "lrclib-id", id: 38664232 };
    expect(parseManualLyricsInput("https://lrclib.net/tracks/38664232")).toEqual(expected);
    expect(parseManualLyricsInput("lrclib.net/api/get/38664232")).toEqual(expected);
    expect(parseManualLyricsInput(" 38664232 ")).toEqual(expected);
  });

  it("parses the two-line AI reply, stripping markdown and quotes", () => {
    expect(parseManualLyricsInput("**歌名**：「无人区玫瑰」\n歌手: Capper, Apex")).toEqual({ kind: "identity", title: "无人区玫瑰", artist: "Capper, Apex" });
  });

  it("recognises an undetermined AI reply and rejects unusable text", () => {
    expect(parseManualLyricsInput("無法確定")).toEqual({ kind: "undetermined" });
    expect(parseManualLyricsInput("隨便一段話")).toBeNull();
    expect(parseManualLyricsInput("")).toBeNull();
    expect(parseManualLyricsInput("https://lrclib.net/tracks/0")).toBeNull();
  });
});

describe("manual lyrics prompt", () => {
  it("fills in video facts and ends with the fixed two-line answer format", () => {
    const prompt = manualLyricsPrompt({ rawTitle: "X", channel: "", durationMs: 226_000, pageUrl: "https://www.youtube.com/watch?v=ztrjnlK2cik" });
    expect(prompt).toContain("影片長度：3:46");
    expect(prompt).toContain("播放頁顯示的歌手／頻道：無");
    expect(prompt.endsWith("歌名：<歌名>\n歌手：<主唱歌手，多位以逗號分隔>")).toBe(true);
  });
});

describe("manual selection storage", () => {
  it("keeps valid pairs, letting the latest entry per video win", () => {
    const parsed = parseManualSelections([["ztrjnlK2cik", 1], ["bad", 2], ["ztrjnlK2cik", 3], ["abcdefghijk", -1]]);
    expect(parsed).toEqual(new Map([["ztrjnlK2cik", 3]]));
    expect(parseManualSelections("nope")).toEqual(new Map());
  });

  it("keeps only the newest 200 selections", () => {
    const id = (index: number) => `v${String(index).padStart(10, "0")}`;
    const parsed = parseManualSelections(Array.from({ length: 201 }, (_, index) => [id(index), index + 1]));
    expect(parsed.size).toBe(200);
    expect(parsed.has(id(0))).toBe(false);
    expect(parsed.get(id(200))).toBe(201);
  });
});
