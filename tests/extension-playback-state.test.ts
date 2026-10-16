import { describe, expect, it } from "vitest";
import { parseLrcWithHash } from "../src/lyrics/lrc-core.js";
import { exactSyncedCandidates, exactSyncedCandidatesForArtists, lyricFocusAt, mixReplayWindow, playbackPositionAt, playbackTrackPositionAt, specialVideoKind, titleLookupKeyword, titleMentionedCandidates, titleSearchQueries, type PlaybackReport } from "../extension-ui/src/playback.js";

const report = (values: Partial<PlaybackReport> = {}): PlaybackReport => ({
  version: 2,
  sessionId: "session-1",
  appId: "youtube",
  pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  mediaId: "abcdefghijk",
  title: "Song",
  artists: ["Singer"],
  state: "playing",
  positionMs: 1000,
  durationMs: 10000,
  playbackRate: 1,
  capturedAtMs: 1000,
  ...values,
});

describe("extension playback state", () => {
  it("uses playing rate, freezes pause, clamps stale reports, and restores chapter absolute position", () => {
    expect(playbackPositionAt(report({ segmentStartMs: 200000 }), 2000)).toBe(202000);
    expect(playbackPositionAt(report({ state: "paused", segmentStartMs: 200000 }), 5000)).toBe(201000);
    expect(playbackPositionAt(report({ segmentStartMs: 200000 }), 9000)).toBe(204000);
    expect(playbackPositionAt(report({ positionMs: 9500, durationMs: 10000 }), 4000)).toBe(10000);
    expect(playbackTrackPositionAt(report({ segmentStartMs: 200000 }), 2000)).toBe(2000);
  });

  it("returns only synchronized exact title-and-artist candidates without trusting upload channels", () => {
    const candidates = [
      { id: 1, trackName: "Song!", artistName: "Singer", duration: 10, instrumental: false, syncedLyrics: "[00:01]line" },
      { id: 2, trackName: "Song", artistName: "Singer", duration: 10, instrumental: false, syncedLyrics: "[00:02]line" },
      { id: 3, trackName: "Song", artistName: "Channel", duration: 10, instrumental: false, syncedLyrics: "[00:03]line" },
      { id: 4, trackName: "Song", artistName: "Singer", duration: 10, instrumental: false, plainLyrics: "line" },
    ];
    expect(exactSyncedCandidates(candidates, "Ｓｏｎｇ", "Singer").map(({ id }) => id)).toEqual([1, 2]);
    expect(exactSyncedCandidates(candidates, "Song", "Channel").map(({ id }) => id)).toEqual([3]);
    expect(exactSyncedCandidates(candidates, "Song", "Uploader")).toEqual([]);
  });

  it("matches parsed artist aliases but deduplicates the same LRCLIB version across searches", () => {
    const record = { id: 9, trackName: "Quit", artistName: "Soyeon", duration: 180, instrumental: false, syncedLyrics: "[00:01]line" };
    const otherVersion = { ...record, id: 10, albumName: "Live" };
    expect(exactSyncedCandidatesForArtists(
      [[record], [record, otherVersion]],
      "Quit",
      ["SOYEON", "Soyeon"],
    ).map(({ id }) => id)).toEqual([9, 10]);
  });

  it("matches credit formatting and bilingual names without accepting another performer or recording version", () => {
    const candidates = [
      { id: 1, trackName: "And July (Feat. DEAN, DJ Friz)", artistName: "Heize (헤이즈)", syncedLyrics: "[00:01]original" },
      { id: 2, trackName: "And July [ft. DEAN & DJ Friz]", artistName: "Heize", syncedLyrics: "[00:01]original" },
      { id: 3, trackName: "And July (合作演出：DEAN和DJ Friz)", artistName: "Heize", syncedLyrics: "[00:01]original" },
      { id: 4, trackName: "And July (Live)", artistName: "Heize", syncedLyrics: "[00:01]live" },
      { id: 5, trackName: "And July (Cover)", artistName: "Heize", syncedLyrics: "[00:01]cover" },
      { id: 6, trackName: "And July (Remix)", artistName: "Heize", syncedLyrics: "[00:01]remix" },
      { id: 7, trackName: "And July", artistName: "Different Singer", syncedLyrics: "[00:01]other" },
    ];
    expect(exactSyncedCandidates(candidates, "And July", "Heize").map(({ id }) => id)).toEqual([1, 2, 3]);
    const collab = [{ id: 8, trackName: "Eight", artistName: "IU, SUGA", syncedLyrics: "[00:01]line" }] as typeof candidates;
    expect(exactSyncedCandidatesForArtists([collab], "Eight", ["IU", "SUGA"]).map(({ id }) => id)).toEqual([8]);
    expect(exactSyncedCandidates(collab, "Eight", "SUGA").map(({ id }) => id)).toEqual([8]);
    expect(exactSyncedCandidates(collab, "Eight", "Other")).toEqual([]);
    expect(exactSyncedCandidates(candidates, "And July feat. DEAN & DJ Friz (Live)", "Heize").map(({ id }) => id)).toEqual([4]);
  });

  it("uses visible translated song names in either order but keeps all recording labels", () => {
    const candidates = [
      { id: 1, trackName: "Lies", artistName: "BIGBANG", syncedLyrics: "[00:01]original" },
      { id: 2, trackName: "Lies (Live)", artistName: "BIGBANG", syncedLyrics: "[00:01]live" },
      { id: 3, trackName: "거짓말 (Acoustic)", artistName: "BIGBANG", syncedLyrics: "[00:01]acoustic" },
    ];
    expect(exactSyncedCandidates(candidates, "거짓말 (Lies)", "BIGBANG").map(({ id }) => id)).toEqual([1]);
    expect(exactSyncedCandidates(candidates, "Lies (거짓말) (Live)", "BIGBANG").map(({ id }) => id)).toEqual([2]);
    expect(exactSyncedCandidates(candidates, "거짓말 (Live)", "BIGBANG").map(({ id }) => id)).toEqual([]);
    expect(exactSyncedCandidates(candidates, "Lies (Part 2)", "BIGBANG")).toEqual([]);
  });

  it("accepts any verified artist alias even when returned by a different alias query", () => {
    const record = { id: 9, trackName: "Quit", artistName: "소연", syncedLyrics: "[00:01]line" };
    expect(exactSyncedCandidatesForArtists([[record], []], "Quit", ["Soyeon", "소연"])).toEqual([record]);
  });

  it("preserves square-bracket versions and unknown qualifiers when stripping inline credits", () => {
    const records = [
      { id: 1, trackName: "Song", artistName: "Singer", syncedLyrics: "[00:01]original" },
      { id: 2, trackName: "Song (Live)", artistName: "Singer", syncedLyrics: "[00:01]live" },
      { id: 3, trackName: "Song (feat.Guest)", artistName: "Singer", syncedLyrics: "[00:01]original" },
    ];
    expect(exactSyncedCandidates(records, "Song feat.Guest [Live]", "Singer").map(({ id }) => id)).toEqual([2]);
    expect(exactSyncedCandidates(records, "Song", "Singer").map(({ id }) => id)).toEqual([1, 3]);
    expect(exactSyncedCandidates(records, "Song feat. Guest (Part 2)", "Singer")).toEqual([]);
    const bilingualLive = [{ ...records[1], trackName: "Lies (Live)", artistName: "BIGBANG" }];
    expect(exactSyncedCandidates(bilingualLive, "거짓말 [Lies] [Live]", "BIGBANG")).toEqual(bilingualLive);
    expect(exactSyncedCandidates(records, "Song feat. Guest - Live", "Singer").map(({ id }) => id)).toEqual([2]);
    expect(exactSyncedCandidates(records, "Song feat. Guest Live", "Singer")).toEqual([]);
  });
  it("shows five neighboring lyrics after seeks and fills the window at both track boundaries", () => {
    const lines = Array.from({ length: 8 }, (_, index) => ({
      startMs: index * 1000,
      endMs: index * 1000 + 900,
      text: String(index + 1),
    }));
    expect(mixReplayWindow(lines, 0)).toEqual({ focusIndex: 0, lines: lines.slice(0, 5) });
    expect(mixReplayWindow(lines, 1500)).toEqual({ focusIndex: 1, lines: lines.slice(0, 5) });
    expect(mixReplayWindow(lines, 4500)).toEqual({ focusIndex: 4, lines: lines.slice(2, 7) });
    expect(mixReplayWindow(lines, 8500)).toEqual({ focusIndex: 7, lines: lines.slice(3, 8) });
    expect(mixReplayWindow(lines.slice(0, 4), 4500)).toEqual({ focusIndex: 3, lines: lines.slice(0, 4) });
    expect(mixReplayWindow([], 0)).toEqual({ focusIndex: -1, lines: [] });
  });

  it("does not count empty timing cues toward the five visible lyrics", () => {
    const lines = ["one", "", "two", "three", " ", "four", "five", "six", ""].map((text, index) => ({
      startMs: index * 1000,
      endMs: index * 1000 + 900,
      text,
    }));
    expect(mixReplayWindow(lines, 4500)).toEqual({ focusIndex: 4, lines: [lines[2], lines[3], lines[5], lines[6], lines[7]] });
    expect(mixReplayWindow(lines, 8500)).toEqual({ focusIndex: 8, lines: [lines[2], lines[3], lines[5], lines[6], lines[7]] });
    expect(mixReplayWindow(lines.slice(0, 3), 2500)).toEqual({ focusIndex: 2, lines: [lines[0], lines[2]] });
  });

  it("flags multi-song clips and non-song videos without catching ordinary music videos", () => {
    expect(specialVideoKind("Loco, Jay Park & Gray - You don't know (니가모르게) & Thinking about you (자꾸생각나) 1theK Special Clip")).toBe("multi-song");
    expect(specialVideoKind("BIGBANG 메들리 (LIVE)")).toBe("multi-song");
    expect(specialVideoKind("로꼬 LOCO - 감아 Hold Me Tight : Making Video [AOMG]")).toBe("non-song");
    expect(specialVideoKind("[MV] Loco(로꼬), GRAY _ Late Night")).toBeNull();
    expect(specialVideoKind("BIGBANG - 우리 사랑하지 말아요(LET'S NOT FALL IN LOVE) M/V")).toBeNull();
    expect(specialVideoKind("TAEYEON 태연 'I (feat. Verbal Jint)' MV")).toBeNull();
  });
});

describe("lyric focus with interludes", () => {
  const lines = [
    { text: "", startMs: 0, endMs: 5000 },
    { text: "A", startMs: 5000, endMs: 8000 },
    { text: "", startMs: 8000, endMs: 20000 },
    { text: "B", startMs: 20000, endMs: 24000 },
  ];

  it("focuses the first of lines sharing a timestamp", () => {
    const bilingual = parseLrcWithHash(["[00:05.00]안녕", "[00:05.00]Hello", "[00:09.00]다음"].join(String.fromCharCode(10)), "same-ts", "lrclib", "f".repeat(64)).lines;
    expect(lyricFocusAt(bilingual, 6000)).toEqual({ activeIndex: 0, state: "active", gap: null });
  });

  it("counts down the prelude to the first text line", () => {
    expect(lyricFocusAt(lines, 1000)).toEqual({ activeIndex: 1, state: "next", gap: { prelude: true, remainingMs: 4000 } });
  });

  it("highlights the sung line", () => {
    expect(lyricFocusAt(lines, 6000)).toEqual({ activeIndex: 1, state: "active", gap: null });
  });

  it("counts down an interlude to the next text line", () => {
    expect(lyricFocusAt(lines, 10000)).toEqual({ activeIndex: 3, state: "next", gap: { prelude: false, remainingMs: 10000 } });
  });

  it("keeps the last text line after the song ends", () => {
    expect(lyricFocusAt(lines, 30000)).toEqual({ activeIndex: 3, state: "past", gap: null });
  });

  it("returns null when no line has text", () => {
    expect(lyricFocusAt([{ text: " ", startMs: 0, endMs: 5000 }], 100)).toBeNull();
  });

  it("has no countdown for a gap between text lines without a blank line", () => {
    const tight = [{ text: "A", startMs: 0, endMs: 1000 }, { text: "B", startMs: 3000, endMs: 4000 }];
    expect(lyricFocusAt(tight, 2000)).toEqual({ activeIndex: 1, state: "next", gap: null });
  });
});

describe("video title keyword matching", () => {
  const CAPPER = "純享：Capper《無人區玫瑰》粉色系rapper帶來浪漫可愛心動 | 少年說唱企劃 EP12 | iQiyi精选";
  const rec = (id: number, trackName: string, artistName: string, duration?: number) => ({ id, trackName, artistName, duration, syncedLyrics: "[00:01]x" });
  const ids = (records: { id: number }[]) => records.map((record) => record.id);

  it("builds noise-free search segments in both Chinese scripts", () => {
    const queries = titleSearchQueries(CAPPER);
    expect(queries[0]).toContain("Capper");
    expect(queries).toContain("无人区玫瑰");
    expect(queries.indexOf("無人區玫瑰")).toBeLessThan(queries.indexOf("Capper"));
    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.join("\n")).not.toMatch(/純享|EP12/u);
  });

  it("does not guess recordings for live or cover videos", () => {
    expect(titleSearchQueries("Capper《無人區玫瑰》Live版")).toEqual([]);
    expect(titleMentionedCandidates([rec(1, "无人区玫瑰", "Capper")], "Capper《無人區玫瑰》Live版")).toEqual([]);
  });

  it("requires the title to name both the song and a credited artist", () => {
    const records = [
      rec(38664232, "无人区玫瑰", "Capper, Apex, LEGGO", 216),
      rec(2, "无人区玫瑰", "一颗狼星", 222),
      rec(3, "无人区玫瑰 No man's land of Rose", "capper"),
    ];
    expect(ids(titleMentionedCandidates(records, CAPPER))).toEqual([38664232]);
  });

  it("prefers the longest mentioned title and rejects records whose artist field is the song title", () => {
    expect(ids(titleMentionedCandidates([rec(1, "Love", "Taylor Swift"), rec(2, "Love Story", "Taylor Swift")], "Taylor Swift - Love Story"))).toEqual([2]);
    expect(ids(titleMentionedCandidates([rec(1, "Love wins all", "Love wins all"), rec(2, "Love wins all", "IU (아이유)")], "IU 'Love wins all' 2024"))).toEqual([2]);
  });

  it("matches whole Latin words only and refuses titles naming two different songs", () => {
    expect(titleMentionedCandidates([rec(1, "Song", "Rap")], "Rapper Song Story")).toEqual([]);
    expect(titleMentionedCandidates([rec(1, "甲乙", "Singer A"), rec(2, "丙丁", "Singer A")], "Singer A《甲乙》與《丙丁》")).toEqual([]);
  });

  it("picks one keyword for the LRCLIB search page, even for live videos", () => {
    expect(titleLookupKeyword(CAPPER)).toBe("无人区玫瑰");
    expect(titleLookupKeyword("Taylor Swift - Love Story")).toBe("Taylor Swift Love Story");
    expect(titleLookupKeyword("Capper《無人區玫瑰》Live版")).toBe("无人区玫瑰");
  });
});
