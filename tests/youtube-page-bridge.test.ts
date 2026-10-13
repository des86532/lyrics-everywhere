import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(new URL("../browser-extension/youtube-page-bridge.js", import.meta.url), "utf8");

const card = (title: string, subtitle: string) => ({
  videoAttributeViewModel: { title, subtitle, secondarySubtitle: { content: "What a Wonderful Life" } },
});
const musicList = (...cards: unknown[]) => ({
  horizontalCardListRenderer: { footerButton: { buttonViewModel: { iconName: "MUSIC" } }, cards },
});
const pageDataFixture = (items: unknown[], videoId = "abcdefghijk") => ({
  currentVideoEndpoint: { watchEndpoint: { videoId } },
  engagementPanels: [
    { engagementPanelSectionListRenderer: { content: { structuredDescriptionContentRenderer: { items: [{ expandableVideoDescriptionBodyRenderer: {} }, ...items] } } } },
  ],
});

function setupBridge(options: {
  response?: unknown;
  ytInitialData?: unknown;
  url?: string;
}) {
  const messages: unknown[] = [];
  const player = { getPlayerResponse: () => options.response };
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const doc = {
    querySelector: (selector: string) => selector === "#movie_player" ? player : null,
    addEventListener: (event: string, handler: (event: unknown) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    removeEventListener: (event: string, handler: (event: unknown) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    },
  };
  const win: Record<string, unknown> = {
    postMessage: (message: unknown) => messages.push(message),
    ytInitialData: options.ytInitialData,
  };
  runInNewContext(bridgeSource, {
    document: doc,
    window: win,
    location: { href: options.url || "https://www.youtube.com/watch?v=abcdefghijk", origin: "https://www.youtube.com" },
    URL,
    setInterval: () => 0,
    clearInterval: () => 0,
  });
  return {
    messages,
    dispatch(event: string, detail: unknown) {
      listeners[event]?.forEach((handler) => handler({ detail }));
    },
    stop() {
      (win.__lyricsEverywhereYouTubeBridgeLifecycle as { stop: () => void })?.stop?.();
    },
  };
}

describe("YouTube chapter bridge", () => {
  it("reads chapter markers from the player response", () => {
    const { messages } = setupBridge({
      response: {
        videoDetails: { videoId: "abcdefghijk" },
        playerOverlays: { playerOverlayRenderer: { decoratedPlayerBarRenderer: { decoratedPlayerBarRenderer: { playerBar: {
          multiMarkersPlayerBarRenderer: { markersMap: [{ value: { chapters: [
            { chapterRenderer: { timeRangeStartMillis: 0, title: { simpleText: "BIGBANG - Haru Haru" } } },
            { chapterRenderer: { timeRangeStartMillis: 225000, title: { simpleText: "BIGBANG - Lies" } } },
          ] } }] },
        } } } } },
      },
    });

    expect(messages[0]).toEqual({
      type: "lyrics-everywhere-youtube-page-data",
      videoId: "abcdefghijk",
      chapters: [
        { startMs: 0, title: "BIGBANG - Haru Haru" },
        { startMs: 225000, title: "BIGBANG - Lies" },
      ],
    });
  });

  it("falls back to timestamped lines in the video description", () => {
    const { messages } = setupBridge({
      response: {
        videoDetails: { videoId: "abcdefghijk", shortDescription: "0:00 Haru Haru\n3:45 Lies\nNo chapter" },
      },
    });

    const msg = messages[0] as { chapters: unknown[] };
    expect(msg.chapters).toEqual([
      { startMs: 0, title: "Haru Haru" },
      { startMs: 225000, title: "Lies" },
    ]);
  });

  it("extracts music credits from window.ytInitialData", () => {
    const { messages } = setupBridge({
      response: { videoDetails: { videoId: "abcdefghijk" } },
      ytInitialData: pageDataFixture([musicList(card("Song A", "Artist A"))]),
    });

    const msg = messages[0] as { musicCredits?: unknown[] };
    expect(msg.musicCredits).toEqual([{ title: "Song A", artist: "Artist A" }]);
  });

  it("ignores card lists whose icon is not MUSIC", () => {
    const placeList = { horizontalCardListRenderer: { footerButton: { buttonViewModel: { iconName: "PLACE" } }, cards: [card("Song A", "Artist")] } };
    const { messages } = setupBridge({
      response: { videoDetails: { videoId: "abcdefghijk" } },
      ytInitialData: pageDataFixture([placeList]),
    });

    const msg = messages[0] as { musicCredits?: unknown[] };
    expect(msg.musicCredits).toEqual([]);
  });

  it("rejects page data that belongs to another video", () => {
    const { messages } = setupBridge({
      response: { videoDetails: { videoId: "abcdefghijk" } },
      ytInitialData: pageDataFixture([musicList(card("Song A", "Artist"))], "other_video_id"),
    });

    const msg = messages[0] as { musicCredits?: unknown[] };
    expect(msg.musicCredits).toBeUndefined();
  });

  it("updates music credits on yt-navigate-finish event", () => {
    const bridge = setupBridge({
      response: { videoDetails: { videoId: "abcdefghijk" } },
    });

    expect((bridge.messages[0] as { musicCredits?: unknown }).musicCredits).toBeUndefined();

    bridge.dispatch("yt-navigate-finish", {
      response: {
        response: pageDataFixture([musicList(card("Nav Song", "Nav Artist"))]),
      },
    });

    const lastMsg = bridge.messages[bridge.messages.length - 1] as { musicCredits?: unknown[] };
    expect(lastMsg.musicCredits).toEqual([{ title: "Nav Song", artist: "Nav Artist" }]);
  });
});
