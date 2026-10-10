import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const contentScript = readFileSync(new URL("../browser-extension/content-script.js", import.meta.url), "utf8");
it("re-entry keeps polling, media events and source requests on the new playback session", () => {
  const messageListeners: Array<(...args: unknown[]) => unknown> = [];
  const windowListeners: Array<(...args: unknown[]) => unknown> = [];
  const intervals = new Map<number, () => void>();
  const mediaListeners = new Map<string, Set<() => void>>();
  const reports: Array<{ report: Record<string, unknown> }> = [];
  let session = 0;
  let intervalId = 0;
  const media = {
    currentTime: 12, duration: 180, playbackRate: 1, paused: false, ended: false,
    addEventListener: (name: string, listener: () => void) => {
      const listeners = mediaListeners.get(name) ?? new Set();
      listeners.add(listener);
      mediaListeners.set(name, listeners);
    },
    removeEventListener: (name: string, listener: () => void) => mediaListeners.get(name)?.delete(listener),
  };
  const context = {
    crypto: { randomUUID: () => `session-${++session}` },
    window: {
      addEventListener: (_type: string, listener: (...args: unknown[]) => unknown) => windowListeners.push(listener),
      removeEventListener: (_type: string, listener: (...args: unknown[]) => unknown) => {
        const index = windowListeners.indexOf(listener);
        if (index >= 0) windowListeners.splice(index, 1);
      },
    },
    location: {
      href: "https://www.youtube.com/watch?v=abcdefghijk",
      hostname: "www.youtube.com", pathname: "/watch", origin: "https://www.youtube.com",
    },
    URL, Math, Number, Date,
    document: {
      title: "Live performance - YouTube",
      querySelector: (selector: string) => selector === "video, audio" ? media : null,
      querySelectorAll: () => [],
    },
    chrome: { runtime: {
      onMessage: {
        addListener: (listener: (...args: unknown[]) => unknown) => messageListeners.push(listener),
        removeListener: (listener: (...args: unknown[]) => unknown) => {
          const index = messageListeners.indexOf(listener);
          if (index >= 0) messageListeners.splice(index, 1);
        },
      },
      sendMessage: (message: { report: Record<string, unknown> }) => {
        reports.push(message);
        return Promise.resolve();
      },
    } },
    setInterval: (callback: () => void) => {
      const id = ++intervalId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => intervals.delete(id),
  };
  runInNewContext(contentScript, context);
  for (const tick of intervals.values()) tick();
  runInNewContext(contentScript, context);
  for (const tick of intervals.values()) tick();
  reports.length = 0;
  media.currentTime = 37;
  for (const tick of intervals.values()) tick();
  expect(reports.map(({ report }) => ({
    session: report.sessionId, position: report.positionMs, state: report.state,
  }))).toEqual([{ session: "session-2", position: 37000, state: "playing" }]);
  reports.length = 0;
  media.paused = true;
  for (const listener of mediaListeners.get("pause") ?? []) listener();
  expect(reports.map(({ report }) => ({
    session: report.sessionId, position: report.positionMs, state: report.state,
  }))).toEqual([{ session: "session-2", position: 37000, state: "paused" }]);
  reports.length = 0;
  for (const listener of messageListeners) listener({ type: "request-playback-report" }, {}, () => undefined);
  expect(reports.map(({ report }) => ({
    session: report.sessionId, position: report.positionMs, state: report.state,
  }))).toEqual([{ session: "session-2", position: 37000, state: "paused" }]);
});

function reportForVideoTitle(videoTitle: string, options: { metadataVideoId?: string; duration?: number } = {}): Record<string, unknown> | undefined {
  const reports: Array<{ report: Record<string, unknown> }> = [];
  let tick: (() => void) | undefined;
  const media = {
    currentTime: 12,
    duration: options.duration ?? 180,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const window = { addEventListener: () => undefined };
  const location = {
    href: "https://www.youtube.com/watch?v=abcdefghijk",
    hostname: "www.youtube.com",
    pathname: "/watch",
    origin: "https://www.youtube.com",
  };
  runInNewContext(contentScript, {
    crypto: { randomUUID: () => "session-1" },
    window,
    location,
    URL,
    Math,
    Number,
    Date,
    document: {
      title: `${videoTitle} - YouTube`,
      querySelector: (selector: string) => {
        if (selector === "video, audio") return media;
        if (selector === "h1.ytd-watch-metadata") return { textContent: videoTitle };
        if (selector === "ytd-watch-metadata ytd-channel-name a") return { textContent: "i-dle" };
        if (selector === "ytd-watch-metadata" && options.metadataVideoId) return { getAttribute: () => options.metadataVideoId };
        return null;
      },
      querySelectorAll: () => [],
    },
    chrome: { runtime: {
      sendMessage: (message: { report: Record<string, unknown> }) => reports.push(message),
      onMessage: { addListener: () => undefined },
    } },
    setInterval: (callback: () => void) => { tick = callback; return 1; },
  });
  tick?.();
  return reports[0]?.report;
}

describe("YouTube chapter playback reports", () => {
  it("reports the active chapter as a track with chapter-relative time", () => {
    const reports: Array<{ report: Record<string, unknown> }> = [];
    let tick: (() => void) | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    const media = {
      currentTime: 226.2,
      duration: 600,
      playbackRate: 1,
      paused: false,
      ended: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    const window = {
      addEventListener: (_name: string, listener: (event: unknown) => void) => { messageListener = listener; },
    };
    const location = {
      href: "https://www.youtube.com/watch?v=abcdefghijk",
      hostname: "www.youtube.com",
      pathname: "/watch",
      origin: "https://www.youtube.com",
    };
    runInNewContext(contentScript, {
      crypto: { randomUUID: () => "session-1" },
      window,
      location,
      URL,
      Math,
      Number,
      Date: { now: () => 1000 },
      document: {
        title: "Video title - YouTube",
        querySelector: (selector: string) => selector === "video, audio" ? media : null,
        querySelectorAll: () => [],
      },
      chrome: { runtime: {
        sendMessage: (message: { report: Record<string, unknown> }) => reports.push(message),
        onMessage: { addListener: () => undefined },
      } },
      setInterval: (callback: () => void) => { tick = callback; return 1; },
    });

    messageListener?.({
      source: window,
      origin: location.origin,
      data: {
        type: "lyrics-everywhere-youtube-chapters",
        videoId: "abcdefghijk",
        chapters: [
          { startMs: 0, title: "BIGBANG - Haru Haru" },
          { startMs: 225000, title: "BIGBANG - Lies" },
        ],
      },
    });
    tick?.();

    expect(reports[0]?.report).toMatchObject({
      mediaId: "abcdefghijk",
      mediaDurationMs: 600000,
      segmentStartMs: 225000,
      title: "Lies",
      artists: ["BIGBANG"],
      positionMs: 1200,
      durationMs: 375000,
      state: "playing",
    });
  });

  it("extracts an explicit performer and quoted song title from an official video title", () => {
    const report = reportForVideoTitle("소연 (SOYEON) '퇴사할게여 (Narr. 기안84)' Official Music Video");
    expect(report).toMatchObject({
      title: "퇴사할게여 (Narr. 기안84)",
      artists: ["SOYEON", "소연 (SOYEON)", "소연"],
      artistVerified: true,
    });
  });

  it("does not treat a generic upload channel as the song performer", () => {
    const report = reportForVideoTitle("Summer playlist mix - Official Music Video");
    expect(report).toMatchObject({
      title: "Summer playlist mix - Official Music Video",
      artists: ["i-dle"],
      artistVerified: false,
    });
  });

  it("extracts a dash-separated artist and song only when the title declares a music-video suffix", () => {
    const report = reportForVideoTitle("BIGBANG - BANG BANG BANG M/V");
    expect(report).toMatchObject({
      title: "BANG BANG BANG",
      artists: ["BIGBANG"],
      artistVerified: true,
    });
  });

  it("extracts bilingual artist and song names from a prefixed MV with nested featured-artist credits", () => {
    const report = reportForVideoTitle("[MV] Mad Clown(매드클라운) _ Lost Without You(우리집을 못 찾겠군요) (Feat. Bolbbalgan4(볼빨간사춘기))");
    expect(report).toMatchObject({
      title: "Lost Without You",
      artists: ["Mad Clown", "Mad Clown(매드클라운)", "매드클라운"],
      artistVerified: true,
    });
  });

  it("recognizes a prefixed music video without removing its recording version", () => {
    const report = reportForVideoTitle("[Official Music Video] Artist - Song (Live)");
    expect(report).toMatchObject({
      title: "Song (Live)",
      artists: ["Artist"],
      artistVerified: true,
    });
  });

  it("does not remove a version label after a featured-artist credit", () => {
    const report = reportForVideoTitle("[MV] Artist _ Song (feat. Guest) (Live)");
    expect(report).toMatchObject({
      title: "Song (feat. Guest) (Live)",
      artists: ["Artist"],
      artistVerified: true,
    });
  });

  it("does not verify an underscore-separated upload without an explicit music label", () => {
    expect(reportForVideoTitle("Artist _ Summer playlist")).toMatchObject({
      title: "Artist _ Summer playlist",
      artists: ["i-dle"],
      artistVerified: false,
    });
  });

  it("waits for YouTube SPA metadata and duration that belong to the current video", () => {
    expect(reportForVideoTitle("BIGBANG - LOSER M/V", { metadataVideoId: "previous000" })).toBeUndefined();
    expect(reportForVideoTitle("BIGBANG - LOSER M/V", { duration: Number.NaN })).toBeUndefined();
    expect(reportForVideoTitle("BIGBANG - LOSER M/V", { metadataVideoId: "abcdefghijk" })).toMatchObject({
      title: "LOSER", artists: ["BIGBANG"], durationMs: 180000,
    });
  });

  it("splits space-separated bilingual artist names and drops a separator before a quoted title", () => {
    expect(reportForVideoTitle("박재범 Jay Park - 'DRIVE (Feat. GRAY)' Official Music Video")).toMatchObject({
      title: "DRIVE", artists: ["Jay Park", "박재범 Jay Park", "박재범"],
    });
    expect(reportForVideoTitle("EXO 엑소 'Tempo' MV")).toMatchObject({ title: "Tempo", artists: ["EXO", "EXO 엑소", "엑소"] });
    expect(reportForVideoTitle("iKON - ‘사랑을 했다(LOVE SCENARIO)’ M/V")).toMatchObject({ artists: ["iKON"] });
  });

  it("accepts a featured credit or visualizer label after a quoted title but not teaser or live tails", () => {
    expect(reportForVideoTitle("Epik High (에픽하이) ‘Screen Time’ ft. Hoshi of SEVENTEEN Official MV")).toMatchObject({
      title: "Screen Time",
      artists: ["Epik High", "Epik High (에픽하이)", "에픽하이"],
      artistVerified: true,
    });
    expect(reportForVideoTitle("Epik High (에픽하이) 'Screen Time (B-Roll Version)' ft. Hoshi Visualizer")).toMatchObject({
      title: "Screen Time (B-Roll Version)",
      artists: ["Epik High", "Epik High (에픽하이)", "에픽하이"],
      artistVerified: true,
    });
    expect(reportForVideoTitle("Artist 'Song' Visualizer")).toMatchObject({ title: "Song", artists: ["Artist"], artistVerified: true });
    expect(reportForVideoTitle("Artist 'Song' Teaser")).toMatchObject({
      title: "Artist 'Song' Teaser", artists: ["i-dle"], artistVerified: false,
    });
    expect(reportForVideoTitle("Artist 'Song' ft. Guest Live Clip")).toMatchObject({ artists: ["i-dle"], artistVerified: false });
  });
});
