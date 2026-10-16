import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const spotifyContentScript = readFileSync(
  new URL("../browser-extension/spotify-content-script.js", import.meta.url),
  "utf8"
);

const runScript = (href: string, clock: { currentTime?: number; position?: string; duration?: string; mediaDuration?: number } = {}, listening = true, queryReply: { listening: boolean } | undefined = undefined) => {
    const sent: Array<{ type: string }> = [];
    const reports: Array<{ report: Record<string, unknown> }> = [];
    let tick: (() => void) | undefined;

    const media = {
      duration: clock.mediaDuration ?? 180,
      currentTime: clock.currentTime ?? 30,
      paused: false,
    };

    const trackLink = {
      href: "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
      textContent: "Super Shy",
    };

    const titleElement = { textContent: "Super Shy" };
    const artistElement = { textContent: "NewJeans" };
    const positionElement = { textContent: clock.position ?? "0:30" };
    const durationElement = { textContent: clock.duration ?? "3:00" };
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
      location: { href },
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
          sendMessage: (message: { type: string; report: Record<string, unknown> }) => {
            sent.push(message);
            if (message.type === "playback-report") reports.push(message);
            return Promise.resolve(message.type === "playback-listening-query" ? queryReply : undefined);
          },
          onMessage: { addListener: (listener: (message: unknown) => void) => { if (listening) listener({ type: "playback-listening", listening: true }); } },
        },
      },
      setInterval: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => undefined,
    });

    tick?.();
    return Object.assign(reports, { sent, tick });
};

describe("Spotify content script", () => {
  it("extracts playback report with non-English UI locale based on media.paused state", () => {
    const reports = runScript("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl");
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

  it("reports the media element position with millisecond precision", () => {
    const reports = runScript("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl", { currentTime: 30.4567 });
    expect(reports[0]?.report.positionMs).toBe(30457);
  });

  it("skips reports when the clock text and media position disagree by more than 3 seconds", () => {
    expect(runScript("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl", { currentTime: 40 })).toHaveLength(0);
  });

  it("accepts minutes of 60 or more without hours but rejects them with hours", () => {
    const url = "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl";
    expect(runScript(url, { currentTime: 4335, mediaDuration: 4800, position: "72:15", duration: "80:00" })[0]?.report).toMatchObject({ positionMs: 4335000, durationMs: 4800000 });
    expect(runScript(url, { currentTime: 4335, mediaDuration: 7200, position: "1:72:15", duration: "2:00:00" })).toHaveLength(0);
  });

  it("sends nothing while no side panel is listening", () => {
    const run = runScript("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl", {}, false);
    run.tick?.();
    expect(run.sent.filter(({ type }) => type === "playback-report")).toHaveLength(0);
  });

  it("starts reporting after the service worker says a panel is listening", async () => {
    const run = runScript("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl", {}, false, { listening: true });
    expect(run.sent.map(({ type }) => type)).toEqual(["playback-listening-query"]);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(run).toHaveLength(1);
  });

  it("reports the canonical track page URL when playing from a playlist page", () => {
    const reports = runScript("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    expect(reports[0]?.report.pageUrl).toBe("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl");
  });
});
