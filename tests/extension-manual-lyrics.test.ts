import { describe, expect, it } from "vitest";
import { extractLyricSnippet, formatDuration, manualLyricsPrompt, parseManualLyricsInput, parseManualSelections, rankCandidateRecords } from "../extension-ui/src/manual-lyrics.js";
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

describe("candidate lyrics version utilities", () => {
  it("extracts a clean two-line snippet without timestamp tags", () => {
    const synced = "[00:07.54] ごめんごめんねって\n[00:10.24] Baby もう言わないで\n[00:13.69] 情熱に染まる";
    expect(extractLyricSnippet(synced)).toBe("ごめんごめんねって / Baby もう言わないで");

    const wordSynced = "[00:01.00]<00:01.00>보고<00:01.50>싶다\n[00:03.00]너를";
    expect(extractLyricSnippet(wordSynced)).toBe("보고싶다 / 너를");

    expect(extractLyricSnippet("")).toBe("");
    expect(extractLyricSnippet(undefined)).toBe("");
  });

  it("formats seconds as m:ss", () => {
    expect(formatDuration(275.7)).toBe("4:36");
    expect(formatDuration(230)).toBe("3:50");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("--:--");
    expect(formatDuration(-5)).toBe("--:--");
  });

  it("ranks candidates placing active ID first and sorting remainder by duration closeness", () => {
    const records = [
      { id: 1, trackName: "Song (JP)", artistName: "Singer", duration: 276, syncedLyrics: "[00:01]JP" },
      { id: 2, trackName: "Song (KR)", artistName: "Singer", duration: 230, syncedLyrics: "[00:01]KR" },
      { id: 3, trackName: "Song (Live)", artistName: "Singer", duration: 300, syncedLyrics: "[00:01]Live" },
      { id: 4, trackName: "Untimed", artistName: "Singer", duration: 275 }, // no syncedLyrics
      { id: 1, trackName: "Song (JP Duplicate)", artistName: "Singer", duration: 276, syncedLyrics: "[00:01]JP" },
    ];

    // Target duration 275s (275000ms), activeId = 2
    const ranked = rankCandidateRecords(records, 2, 275000);
    expect(ranked.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(ranked).toHaveLength(3);
  });
});
