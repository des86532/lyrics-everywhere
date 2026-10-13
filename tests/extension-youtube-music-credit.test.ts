import { describe, expect, it } from "vitest";
import { selectYouTubeMusicCredit } from "../extension-ui/src/youtube-music-credit.js";

describe("selectYouTubeMusicCredit", () => {
  it("returns the single credit from the list", () => {
    expect(selectYouTubeMusicCredit([{ title: "I’m gonna TOESA (Narr. KIAN84)", artist: "SOYEON" }]))
      .toEqual({ title: "I’m gonna TOESA (Narr. KIAN84)", artist: "SOYEON" });
  });

  it("returns null when the list holds two different songs", () => {
    expect(selectYouTubeMusicCredit([
      { title: "Song A", artist: "Artist" },
      { title: "Song B", artist: "Artist" },
    ])).toBeNull();
  });

  it("collapses repeated credits of the same song", () => {
    expect(selectYouTubeMusicCredit([
      { title: "Song A", artist: "Artist" },
      { title: "song a", artist: "ARTIST" },
    ])).toEqual({ title: "Song A", artist: "Artist" });
  });

  it("does not merge distinct symbol-only titles into one credit", () => {
    expect(selectYouTubeMusicCredit([
      { title: "★", artist: "SOYEON" },
      { title: "☆", artist: "SOYEON" },
    ])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(selectYouTubeMusicCredit([])).toBeNull();
  });
});
