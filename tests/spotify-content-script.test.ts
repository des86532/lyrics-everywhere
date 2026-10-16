import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const spotifyContentScript = readFileSync(
  new URL("../browser-extension/spotify-content-script.js", import.meta.url),
  "utf8"
);

const STARS = "5vMmRDWrRsogNA6xm916nq";
const STARS_INSTRUMENTAL = "1bnvd1Upl9mIEPuIjQGmPM";
const ALBUM_HREF = "/album/0Kjrj9VlwLkuAWb1FugHoi";

type Row = { title: string; id: string; artists: string[] };
type Options = {
  positionMs?: number;
  durationMs?: number;
  position?: string;
  duration?: string;
  playing?: boolean;
  rows?: Row[];
  title?: string;
  artist?: string;
};

const formatClock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

const runScript = async (
  href: string,
  options: Options = {},
  listening = true,
  queryReply: { listening: boolean } | undefined = undefined
) => {
  const sent: Array<{ type: string }> = [];
  const reports: Array<{ report: Record<string, unknown> }> = [];
  let tick: (() => void) | undefined;

  // setTimeout advances this fake clock instead of waiting, and the position moves only while playing.
  const state = {
    now: 1000,
    positionMs: options.positionMs ?? 30000,
    durationMs: options.durationMs ?? 180000,
    playing: options.playing ?? true,
    rows: options.rows ?? [
      { title: "Stars", id: STARS, artists: ["Rothy"] },
      { title: "Stars - Instrumental", id: STARS_INSTRUMENTAL, artists: ["Rothy"] },
    ],
    contextHref: ALBUM_HREF,
  };
  const advance = (ms: number) => {
    state.now += ms;
    if (state.playing) state.positionMs += ms;
  };

  const titleElement = { textContent: options.title ?? "Stars" };
  const artistElement = { textContent: options.artist ?? "Rothy" };
  const positionElement = { get textContent() { return options.position ?? formatClock(state.positionMs); } };
  const durationElement = { get textContent() { return options.duration ?? formatClock(state.durationMs); } };
  const slider = {
    getAttribute: (name: string) => (name === "value" ? String(state.positionMs) : name === "max" ? String(state.durationMs) : null),
  };

  const player = {
    querySelector: (selector: string) => {
      if (selector === '[data-testid="context-item-info-title"]') return titleElement;
      if (selector === '[data-testid="context-item-link"]') return { getAttribute: () => state.contextHref };
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
    Promise,
    Set,
    Date: { now: () => state.now },
    setTimeout: (callback: () => void, ms: number) => { advance(ms); callback(); return 0; },
    location: { href },
    window: { addEventListener: () => undefined, removeEventListener: () => undefined },
    document: {
      querySelector: (selector: string) => {
        if (selector === '[data-testid="now-playing-widget"]') return player;
        if (selector === '[data-testid="playback-progressbar"] input[type="range"]') return slider;
        if (selector === '[data-testid="playback-position"]') return positionElement;
        if (selector === '[data-testid="playback-duration"]') return durationElement;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '[data-testid="tracklist-row"]') {
          return state.rows.map((row) => ({
            querySelector: (rowSelector: string) => rowSelector === 'a[data-testid="internal-track-link"]'
              ? { textContent: row.title, getAttribute: () => `/track/${row.id}` }
              : null,
            querySelectorAll: (rowSelector: string) => rowSelector === 'a[href^="/artist/"]'
              ? row.artists.map((name) => ({ textContent: name }))
              : [],
          }));
        }
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

  await flush();
  tick?.();
  await flush();
  return Object.assign(reports, {
    sent,
    state,
    titleElement,
    artistElement,
    tick: async (ms = 1000) => { advance(ms); tick?.(); await flush(); },
  });
};

describe("Spotify content script", () => {
  it("reports the track from the tracklist row matching the now-playing title and artist", async () => {
    const reports = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    expect(reports.at(-1)?.report).toMatchObject({
      appId: "spotify-web",
      mediaId: STARS,
      pageUrl: `https://open.spotify.com/track/${STARS}`,
      title: "Stars",
      artists: ["Rothy"],
      durationMs: 180000,
      playbackRate: 1,
    });
  });

  it("reports playing when the position advances and paused when it does not", async () => {
    const playing = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    expect(playing.at(-1)?.report.state).toBe("playing");
    const paused = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi", { playing: false });
    expect(paused.at(-1)?.report.state).toBe("paused");
  });

  it("flips from playing to paused when the position stops advancing", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    expect(run.at(-1)?.report.state).toBe("playing");
    run.state.playing = false;
    await run.tick();
    expect(run.at(-1)?.report.state).toBe("paused");
  });

  it("keeps the previous state when samples are less than a second apart", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    run.state.playing = false;
    await run.tick(400);
    expect(run.at(-1)?.report.state).toBe("playing");
    await run.tick(1000);
    expect(run.at(-1)?.report.state).toBe("paused");
  });

  it("reports the slider position with millisecond precision", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi", { positionMs: 30457, playing: false });
    expect(run.at(-1)?.report.positionMs).toBe(30457);
  });

  it("skips reports when the clock text and slider position disagree by more than 3 seconds", async () => {
    expect(await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi", { positionMs: 40000, position: "0:30", playing: false })).toHaveLength(0);
  });

  it("accepts minutes of 60 or more without hours but rejects them with hours", async () => {
    const url = "https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi";
    const long = { positionMs: 4335000, durationMs: 4800000, playing: false };
    expect((await runScript(url, { ...long, position: "72:15", duration: "80:00" })).at(-1)?.report).toMatchObject({ positionMs: 4335000, durationMs: 4800000 });
    expect(await runScript(url, { ...long, durationMs: 7200000, position: "1:72:15", duration: "2:00:00" })).toHaveLength(0);
  });

  it("sends nothing while no side panel is listening", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi", {}, false);
    await run.tick();
    expect(run.sent.filter(({ type }) => type === "playback-report")).toHaveLength(0);
  });

  it("starts reporting after the service worker says a panel is listening", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi", {}, false, { listening: true });
    expect(run.sent.map(({ type }) => type)[0]).toBe("playback-listening-query");
    expect(run.length).toBeGreaterThan(0);
  });

  it("picks the row whose title and artist both match when titles repeat across artists", async () => {
    const run = await runScript("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", {
      rows: [
        { title: "Stars", id: "0000000000000000000001", artists: ["Someone Else"] },
        { title: "Stars", id: STARS, artists: ["Rothy"] },
      ],
    });
    expect(run.at(-1)?.report.mediaId).toBe(STARS);
  });

  it("follows the now-playing widget when the page URL does not change", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    expect(run.at(-1)?.report.mediaId).toBe(STARS);
    run.titleElement.textContent = "Stars - Instrumental";
    await run.tick();
    await run.tick();
    expect(run.at(-1)?.report).toMatchObject({
      mediaId: STARS_INSTRUMENTAL,
      title: "Stars - Instrumental",
      pageUrl: `https://open.spotify.com/track/${STARS_INSTRUMENTAL}`,
    });
  });

  it("keeps the track ID after the playing row scrolls out of the list", async () => {
    const run = await runScript("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    run.state.rows = [];
    await run.tick();
    expect(run.at(-1)?.report.mediaId).toBe(STARS);
  });

  it("does not reuse the previous track ID for a different song that is not listed", async () => {
    const run = await runScript("https://open.spotify.com/album/0Kjrj9VlwLkuAWb1FugHoi");
    const before = run.length;
    run.state.rows = [];
    run.titleElement.textContent = "Another Song";
    await run.tick();
    await run.tick();
    expect(run).toHaveLength(before);
  });

  it("sends no report when no tracklist row matches the now-playing song", async () => {
    expect(await runScript("https://open.spotify.com/", { rows: [] })).toHaveLength(0);
  });

  it("sends no report when two different tracks match the same title and artist", async () => {
    expect(await runScript("https://open.spotify.com/artist/0jUn8CXobOt0IixyR72una", {
      rows: [
        { title: "Stars", id: STARS, artists: ["Rothy"] },
        { title: "Stars", id: "0000000000000000000002", artists: ["Rothy"] },
      ],
    })).toHaveLength(0);
  });
});
