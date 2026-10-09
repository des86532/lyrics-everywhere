import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(new URL("../browser-extension/youtube-page-bridge.js", import.meta.url), "utf8");

function publishedChapters(response: unknown) {
  const messages: unknown[] = [];
  const player = { getPlayerResponse: () => response };
  const window = { postMessage: (message: unknown) => messages.push(message) };
  runInNewContext(bridgeSource, {
    document: { querySelector: (selector: string) => selector === "#movie_player" ? player : null },
    window,
    location: { href: "https://www.youtube.com/watch?v=abcdefghijk", origin: "https://www.youtube.com" },
    URL,
    setInterval: () => 0,
  });
  return messages[0] as { videoId: string; chapters: Array<{ startMs: number; title: string }> };
}

describe("YouTube chapter bridge", () => {
  it("reads chapter markers from the player response", () => {
    const result = publishedChapters({
      videoDetails: { videoId: "abcdefghijk" },
      playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: { playerBar: {
        multiMarkersPlayerBarRenderer: { markersMap: [{ value: { chapters: [
          { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "BIGBANG - Haru Haru" } } },
          { chapterRenderer: { timeRangeStartMillis: 225000, title: { simpleText: "BIGBANG - Lies" } } },
        ] } }] },
      } } } } },
    });

    expect(result).toEqual({
      type: "lyrics-everywhere-youtube-chapters",
      videoId: "abcdefghijk",
      chapters: [
        { startMs: 0, title: "BIGBANG - Haru Haru" },
        { startMs: 225000, title: "BIGBANG - Lies" },
      ],
    });
  });

  it("falls back to timestamped lines in the video description", () => {
    const result = publishedChapters({
      videoDetails: { videoId: "abcdefghijk", shortDescription: "0:00 Haru Haru\n3:45 Lies\nNo chapter" },
    });

    expect(result.chapters).toEqual([
      { startMs: 0, title: "Haru Haru" },
      { startMs: 225000, title: "Lies" },
    ]);
  });
});
