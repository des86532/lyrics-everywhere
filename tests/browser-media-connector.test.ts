import { describe, expect, it } from "vitest";
import { BrowserMediaConnector, validateBrowserPlaybackReport, type BrowserPlaybackReport } from "../src/connectors/browser-media-connector.js";

const baseReport: BrowserPlaybackReport = {
  version: 1,
  tabId: "tab-1",
  sessionId: "session-1",
  appId: "youtube",
  pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  videoId: "abcdefghijk",
  title: "Test Song",
  artists: ["Test Artist"],
  state: "playing",
  positionMs: 1200,
  durationMs: 180000,
  playbackRate: 1,
  capturedAtMs: 1000,
};

describe("BrowserMediaConnector", () => {
  it("normalizes valid YouTube reports into playback snapshots", async () => {
    const connector = new BrowserMediaConnector({ now: () => 1000 });
    expect(connector.ingest(baseReport)).toMatchObject({ ok: true });
    await expect(connector.snapshot()).resolves.toMatchObject({ state: "playing", track: { trackKey: "youtube:abcdefghijk", source: { connector: "browser", appId: "youtube" } }, positionMs: 1200 });
  });

  it("rejects invalid reports without replacing the last valid report", async () => {
    const connector = new BrowserMediaConnector({ now: () => 1000 });
    connector.ingest(baseReport);
    const invalid = { ...baseReport, videoId: "bad", title: "" };
    expect(validateBrowserPlaybackReport(invalid).ok).toBe(false);
    expect(connector.ingest(invalid).ok).toBe(false);
    await expect(connector.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:abcdefghijk" } });
  });

  it("expires stale tabs and chooses a newly playing tab", async () => {
    let now = 1000;
    const connector = new BrowserMediaConnector({ now: () => now, staleAfterMs: 5000 });
    connector.ingest(baseReport, now);
    await expect(connector.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:abcdefghijk" }, state: "playing" });
    connector.ingest({ ...baseReport, state: "paused", playbackRate: 0, capturedAtMs: 1500 }, 1500);
    connector.ingest({ ...baseReport, tabId: "tab-2", sessionId: "session-2", state: "paused", capturedAtMs: 1000 }, 1000);
    await expect(connector.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:abcdefghijk" }, state: "paused" });
    connector.ingest({ ...baseReport, tabId: "tab-2", sessionId: "session-2", videoId: "lmnopqrst12", pageUrl: "https://music.youtube.com/watch?v=lmnopqrst12", appId: "youtube-music", capturedAtMs: 2000 }, 2000);
    await expect(connector.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:lmnopqrst12" } });
    now = 8001;
    await expect(connector.snapshot()).resolves.toMatchObject({ state: "unavailable" });
  });

  it("removes a disconnected tab", async () => {
    const connector = new BrowserMediaConnector({ now: () => 1000 });
    connector.ingest(baseReport);
    connector.disconnect("tab-1", "session-1");
    await expect(connector.snapshot()).resolves.toMatchObject({ state: "unavailable" });
  });
});
