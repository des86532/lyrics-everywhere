import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const spotifyContentScript = readFileSync(
  new URL("../browser-extension/spotify-content-script.js", import.meta.url),
  "utf8"
);

describe("Spotify content script", () => {
  it("extracts playback report with non-English UI locale based on media.paused state", () => {
    const reports: Array<{ report: Record<string, unknown> }> = [];
    let tick: (() => void) | undefined;

    const media = {
      duration: 180,
      currentTime: 30,
      paused: false,
    };

    const trackLink = {
      href: "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
      textContent: "Super Shy",
    };

    const titleElement = { textContent: "Super Shy" };
    const artistElement = { textContent: "NewJeans" };
    const positionElement = { textContent: "0:30" };
    const durationElement = { textContent: "3:00" };
    const controlButton = {
      getAttribute: (attr: string) => (attr === "aria-label" ? "일시정지" : null),
    };

    const player = {
      querySelector: (selector: string) => {
        if (selector === 'a[href*="/track/"]') return trackLink;
        if (selector === '[data-testid="context-item-info-title"]') return titleElement;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '[data-testid="context-item-info-artist"]') return [artistElement];
        return [];
      },
    };

    runInNewContext(spotifyContentScript, {
      crypto: { randomUUID: () => "spotify-session" },
      URL,
      Math,
      Number,
      Date: { now: () => 1000 },
      location: { href: "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl" },
      window: { addEventListener: () => undefined, removeEventListener: () => undefined },
      document: {
        querySelector: (selector: string) => {
          if (selector === '[data-testid="now-playing-widget"]') return player;
          if (selector === '[data-testid="control-button-playpause"]') return controlButton;
          if (selector === '[data-testid="playback-position"]') return positionElement;
          if (selector === '[data-testid="playback-duration"]') return durationElement;
          return null;
        },
        querySelectorAll: (selector: string) => {
          if (selector === "audio, video") return [media];
          return [];
        },
      },
      chrome: {
        runtime: {
          sendMessage: (message: { report: Record<string, unknown> }) => {
            reports.push(message);
            return Promise.resolve();
          },
          onMessage: { addListener: () => undefined },
        },
      },
      setInterval: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => undefined,
    });

    tick?.();

    expect(reports[0]?.report).toMatchObject({
      appId: "spotify-web",
      mediaId: "11dFghVXANMlKmJXsNCbNl",
      title: "Super Shy",
      artists: ["NewJeans"],
      state: "playing",
      positionMs: 30000,
      durationMs: 180000,
      playbackRate: 1,
    });
  });
});
