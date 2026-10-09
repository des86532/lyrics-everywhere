import { describe, expect, it } from "vitest";
import { exactSyncedCandidates, exactSyncedCandidatesForArtists, mixReplayWindow, playbackPositionAt, playbackTrackPositionAt, specialVideoKind, type PlaybackReport } from "../extension-ui/src/playback.js";

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
