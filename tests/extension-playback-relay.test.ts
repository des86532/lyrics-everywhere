import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../browser-extension/service-worker.js", import.meta.url), "utf8");

type RelayMessage = { type: string; tabId?: number; report?: Record<string, unknown> };
type RelaySender = { id?: string; url?: string; tab?: { id?: number } };
type RelayListener = (message: RelayMessage, sender: RelaySender, sendResponse?: (response: unknown) => void) => boolean | void;

describe("extension playback relay", () => {

  it("accepts same-origin SPA playback changes without trusting a different origin", () => {
    const listeners: RelayListener[] = [];
    const runtimeMessages: RelayMessage[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          sendMessage: (message: RelayMessage) => { runtimeMessages.push(message); return Promise.resolve(); },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: { sendMessage: () => Promise.resolve() },
      },
    });
    const initialUrl = "https://www.youtube.com/watch?v=abcdefghijk&index=6&themeRefresh=1";
    const report = {
      version: 2, sessionId: "spa", appId: "youtube",
      pageUrl: "https://www.youtube.com/watch?v=wDkjWSt3HOM&index=7",
      mediaId: "wDkjWSt3HOM", title: "Missing You", artists: ["BTOB"],
      state: "playing", positionMs: 1200, durationMs: 294401, playbackRate: 1,
      capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: initialUrl, tab: { id: 7 } });
    listeners[0]?.({ type: "playback-report", report }, { url: "https://evil.example/watch", tab: { id: 8 } });
    listeners[0]?.({ type: "playback-report", report }, { url: initialUrl.replace("https:", "http:"), tab: { id: 9 } });
    listeners[0]?.({ type: "playback-report", report: { ...report, mediaId: "abcdefghijk" } }, { url: initialUrl, tab: { id: 10 } });
    expect(runtimeMessages).toEqual([{ type: "playback-state", tabId: 7, report }]);
  });

  it("lists only supported HTTPS playback tabs without requesting reports or injecting scripts", async () => {
    const listeners: RelayListener[] = [];
    const queried: unknown[] = [];
    let reportRequests = 0;
    let injections = 0;
    const openTabs = [
      { id: 1, title: "YouTube song", url: "https://www.youtube.com/watch?v=abcdefghijk" },
      { id: 2, title: "Music song", url: "https://music.youtube.com/watch?v=abcdefghijk&list=PL123" },
      { id: 3, title: "Spotify song", url: "https://open.spotify.com/track/abcdefghijklmnopqrstuv" },
      { id: 4, title: "Wrong protocol", url: "http://www.youtube.com/watch?v=abcdefghijk" },
      { id: 5, title: "Wrong host", url: "https://evil.example/watch?v=abcdefghijk" },
      { id: 6, title: "Wrong path", url: "https://www.youtube.com/shorts/abcdefghijk" },
      { id: 7, title: "Bad video id", url: "https://music.youtube.com/watch?v=short" },
      { id: 8, title: "Wrong Spotify host", url: "https://open.spotify.com.evil.example/track/abcdefghijklmnopqrstuv" },
      { id: Number.MAX_SAFE_INTEGER + 1, title: "Unsafe id", url: "https://www.youtube.com/watch?v=abcdefghijk" },
      { id: 10, url: "https://open.spotify.com/" },
    ];
    runInNewContext(serviceWorker, {
      URL, Date, Number,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          query: async (query: unknown) => { queried.push(query); return openTabs; },
          sendMessage: async () => { reportRequests += 1; },
        },
        scripting: { executeScript: async () => { injections += 1; } },
      },
    });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const keepOpen = listeners[0]?.({ type: "list-playback-tabs" }, { id: "extension-id" }, resolve);
    expect(keepOpen).toBe(true);
    expect(await promise).toEqual({
      ok: true,
      tabs: [
        { tabId: 1, title: "YouTube song", appId: "youtube" },
        { tabId: 2, title: "Music song", appId: "youtube-music" },
        { tabId: 3, title: "Spotify song", appId: "spotify-web" },
        { tabId: 10, title: "spotify-web — https://open.spotify.com/", appId: "spotify-web" },
      ],
    });
    expect(queried).toHaveLength(1);
    expect(reportRequests).toBe(0);
    expect(injections).toBe(0);
  });

  it("returns a source-list failure when the browser tab query rejects", async () => {
    const listeners: RelayListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date, Number,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: { query: async () => { throw new Error("tabs unavailable"); } },
      },
    });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    listeners[0]?.({ type: "list-playback-tabs" }, { id: "extension-id" }, resolve);
    expect(await promise).toEqual({ ok: false, error: "無法列出播放分頁：tabs unavailable" });
  });

  it("recovers a missing playback script and reads a validated title before the first poll", async () => {
    const workerListeners: RelayListener[] = [];
    const pageListeners: RelayListener[] = [];
    const pageUrl = "https://www.youtube.com/watch?v=abcdefghijk";
    const media = {
      currentTime: 12, duration: 180, playbackRate: 1, paused: false, ended: false,
      addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    const pageContext = {
      URL, Date, Math, Number,
      crypto: { randomUUID: () => "page-session" },
      location: { href: pageUrl, hostname: "www.youtube.com", pathname: "/watch", origin: "https://www.youtube.com" },
      window: { addEventListener: () => undefined, postMessage: () => undefined },
      document: {
        title: "Live performance - YouTube",
        querySelector: (selector: string) => selector === "video, audio" ? media : null,
        querySelectorAll: () => [],
      },
      setInterval: () => 1,
      chrome: { runtime: {
        onMessage: { addListener: (listener: RelayListener) => pageListeners.push(listener) },
        sendMessage: (message: RelayMessage) => new Promise((resolve) => {
          workerListeners[0]?.(message, { id: "extension-id", url: pageUrl, tab: { id: 7 } }, resolve);
        }),
      } },
    };
    const mainContext = {
      URL, Date, location: pageContext.location, window: pageContext.window,
      document: pageContext.document, setInterval: pageContext.setInterval,
    };
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => workerListeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          get: async () => ({ url: pageUrl }),
          sendMessage: (_tabId: number, message: RelayMessage) => new Promise((resolve, reject) => {
            const listener = pageListeners[0];
            if (!listener) return reject(new Error("Receiving end does not exist."));
            const keepOpen = listener(message, { id: "extension-id" }, resolve);
            if (keepOpen !== true) resolve(undefined);
          }),
        },
        scripting: {
          executeScript: async ({ files, world }: { files: string[]; world: string }) => {
            for (const file of files) {
              const script = readFileSync(new URL(`../browser-extension/${file}`, import.meta.url), "utf8");
              runInNewContext(script, world === "MAIN" ? mainContext : pageContext);
            }
          },
        },
      },
    });
    const response = await new Promise((resolve) => {
      const keepOpen = workerListeners[0]?.({ type: "request-playback-report", tabId: 7 }, { id: "extension-id" }, resolve);
      if (keepOpen !== true) resolve(undefined);
    });
    expect(response).toMatchObject({
      ok: true, tabId: 7,
      report: {
        version: 2, sessionId: "page-session", appId: "youtube", mediaId: "abcdefghijk",
        pageUrl, title: "Live performance", artists: [], artistVerified: false,
        state: "playing", positionMs: 12000, durationMs: 180000,
      },
    });
  });


  it("never injects a playback script into an unsupported origin", async () => {
    const listeners: RelayListener[] = [];
    let injectionCount = 0;
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          get: async () => ({ url: "https://unrelated.example/watch?v=abcdefghijk" }),
          sendMessage: async () => { throw new Error("Receiving end does not exist."); },
        },
        scripting: { executeScript: async () => { injectionCount += 1; } },
      },
    });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    listeners[0]?.({ type: "request-playback-report", tabId: 8 }, { id: "extension-id" }, resolve);
    const response = await promise;
    expect(response).toMatchObject({ ok: false });
    expect(injectionCount).toBe(0);
  });

  it("keeps a denied bootstrap as an actionable error", async () => {
    const listeners: RelayListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          get: async () => ({ url: "https://open.spotify.com/" }),
          sendMessage: async () => { throw new Error("Receiving end does not exist."); },
        },
        scripting: { executeScript: async () => { throw new Error("Cannot access contents of the page."); } },
      },
    });
    const { promise, resolve } = Promise.withResolvers<unknown>();
    listeners[0]?.({ type: "request-playback-report", tabId: 9 }, { id: "extension-id" }, resolve);
    const response = await promise;
    expect(response).toMatchObject({ ok: false });
  });

  it("rejects reports with invalid source identity or out-of-range progress", () => {
    const listeners: RelayListener[] = [];
    let relayed = 0;
    const context = {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          sendMessage: () => { relayed += 1; return Promise.resolve(); },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined }, tabs: { sendMessage: () => Promise.resolve() },
      },
      fetch: () => { relayed += 1; return Promise.resolve(); },
    };
    runInNewContext(serviceWorker, context);
    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Video", artists: ["Channel"], state: "playing", positionMs: 11000,
      durationMs: 10000, playbackRate: 1, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 7 } });
    listeners[0]?.({ type: "playback-report", report: { ...report, pageUrl: "https://evil.example/watch?v=abcdefghijk", positionMs: 1 } }, { url: report.pageUrl, tab: { id: 7 } });
    expect(relayed).toBe(0);
  });

  it("allows only a paused 1x YouTube watch tab at the start and releases the global capture lock", () => {
    const listeners: RelayListener[] = [];
    const context = {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined }, tabs: { sendMessage: () => Promise.resolve() },
      },
    };
    runInNewContext(serviceWorker, context);
    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Mix", artists: ["Channel"], state: "paused", positionMs: 0,
      durationMs: 60000, playbackRate: 1, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });
    const responses: unknown[] = [];
    const respond = (response: unknown) => responses.push(response);
    listeners[0]?.({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" }, { id: "extension-id" }, respond);
    listeners[0]?.({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" }, { id: "extension-id" }, respond);
    expect(responses).toEqual([{ ok: true }, expect.objectContaining({ ok: false })]);
    listeners[0]?.({ type: "release-tab-capture", tabId: 5 }, { id: "extension-id" }, respond);
    const chapterAtVideoStart = { ...report, segmentStartMs: 30000, mediaDurationMs: 60000 };
    listeners[0]?.({ type: "playback-report", report: chapterAtVideoStart }, { url: report.pageUrl, tab: { id: 5 } });
    listeners[0]?.({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" }, { id: "extension-id" }, respond);
    expect(responses.at(-1)).toMatchObject({ ok: false });
  });

  it("rejects audio-guess reservations and enforces the mix-first start gate", () => {
    const listeners: RelayListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: { sendMessage: () => Promise.resolve() },
      },
    });
    const report = {
      version: 2, sessionId: "live", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Song", artists: ["Singer"], state: "playing",
      positionMs: 27000, durationMs: 60000, playbackRate: 1.25, capturedAtMs: Date.now(),
    };
    const responses: unknown[] = [];
    const respond = (response: unknown) => responses.push(response);
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });
    listeners[0]?.({ type: "reserve-tab-capture", tabId: 5, mode: "audio-guess" }, { id: "extension-id" }, respond);
    listeners[0]?.({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" }, { id: "extension-id" }, respond);
    expect(responses).toEqual([expect.objectContaining({ ok: false })]);
  });
});
