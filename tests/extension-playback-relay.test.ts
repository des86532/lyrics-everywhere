import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../browser-extension/service-worker.js", import.meta.url), "utf8");

type RelayMessage = { type: string; tabId?: number; report?: Record<string, unknown> };
type RelaySender = { id?: string; url?: string; tab?: { id?: number } };
type RelayListener = (message: RelayMessage, sender: RelaySender, sendResponse?: (response: unknown) => void) => boolean | void;
type ConnectListener = (port: unknown) => void;
type TabRemoveListener = (tabId: number) => void;

function fakePort(name: string, id = "extension-id") {
  const messageListeners: ((msg: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const postedMessages: unknown[] = [];
  return {
    name,
    sender: { id },
    postMessage: (msg: unknown) => postedMessages.push(msg),
    disconnect: () => {
      disconnectListeners.forEach((l) => l());
    },
    onMessage: {
      addListener: (l: (msg: unknown) => void) => messageListeners.push(l),
      removeListener: (l: (msg: unknown) => void) => {
        const idx = messageListeners.indexOf(l);
        if (idx >= 0) messageListeners.splice(idx, 1);
      },
    },
    onDisconnect: {
      addListener: (l: () => void) => disconnectListeners.push(l),
      removeListener: (l: () => void) => {
        const idx = disconnectListeners.indexOf(l);
        if (idx >= 0) disconnectListeners.splice(idx, 1);
      },
    },
    sendToSW: (msg: unknown) => {
      messageListeners.forEach((l) => l(msg));
    },
    postedMessages,
  };
}

describe("extension playback relay", () => {
  it("accepts same-origin SPA playback changes without trusting a different origin", () => {
    const listeners: RelayListener[] = [];
    const connectListeners: ConnectListener[] = [];
    const runtimeMessages: RelayMessage[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: (message: RelayMessage) => { runtimeMessages.push(message); return Promise.resolve(); },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          query: async () => [],
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: () => undefined },
        },
      },
    });

    const panelPort = fakePort("side-panel");
    connectListeners[0]?.(panelPort);

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
          onConnect: { addListener: () => undefined },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          query: async (query: unknown) => { queried.push(query); return openTabs; },
          sendMessage: async () => { reportRequests += 1; },
          onRemoved: { addListener: () => undefined },
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
          onConnect: { addListener: () => undefined },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          query: async () => { throw new Error("tabs unavailable"); },
          onRemoved: { addListener: () => undefined },
        },
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
          onConnect: { addListener: () => undefined },
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
          onRemoved: { addListener: () => undefined },
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
          onConnect: { addListener: () => undefined },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          get: async () => ({ url: "https://unrelated.example/watch?v=abcdefghijk" }),
          sendMessage: async () => { throw new Error("Receiving end does not exist."); },
          onRemoved: { addListener: () => undefined },
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
          onConnect: { addListener: () => undefined },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          get: async () => ({ url: "https://open.spotify.com/" }),
          sendMessage: async () => { throw new Error("Receiving end does not exist."); },
          onRemoved: { addListener: () => undefined },
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
          onConnect: { addListener: () => undefined },
          sendMessage: () => { relayed += 1; return Promise.resolve(); },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: () => undefined },
        },
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
    const connectListeners: ConnectListener[] = [];
    const context = {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: () => undefined },
        },
      },
    };
    runInNewContext(serviceWorker, context);
    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Mix", artists: ["Channel"], state: "paused", positionMs: 0,
      durationMs: 60000, playbackRate: 1, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });

    const port1 = fakePort("tab-capture");
    connectListeners[0]?.(port1);

    port1.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    const port2 = fakePort("tab-capture");
    connectListeners[0]?.(port2);
    port2.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });

    expect(port1.postedMessages).toEqual([{ type: "reserve-tab-capture-result", ok: true }]);
    expect(port2.postedMessages).toEqual([expect.objectContaining({ type: "reserve-tab-capture-result", ok: false })]);

    port1.disconnect();

    const chapterAtVideoStart = { ...report, segmentStartMs: 30000, mediaDurationMs: 60000 };
    listeners[0]?.({ type: "playback-report", report: chapterAtVideoStart }, { url: report.pageUrl, tab: { id: 5 } });
    const port3 = fakePort("tab-capture");
    connectListeners[0]?.(port3);
    port3.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    expect(port3.postedMessages.at(-1)).toMatchObject({ type: "reserve-tab-capture-result", ok: false });
  });

  it("rejects audio-guess reservations and enforces the mix-first start gate", () => {
    const listeners: RelayListener[] = [];
    const connectListeners: ConnectListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: () => undefined },
        },
      },
    });
    const report = {
      version: 2, sessionId: "live", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Song", artists: ["Singer"], state: "playing",
      positionMs: 27000, durationMs: 60000, playbackRate: 1.25, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });

    const port1 = fakePort("tab-capture");
    connectListeners[0]?.(port1);
    port1.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "audio-guess" });
    port1.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    expect(port1.postedMessages).toEqual([
      expect.objectContaining({ type: "reserve-tab-capture-result", ok: false }),
      expect.objectContaining({ type: "reserve-tab-capture-result", ok: false }),
    ]);
  });

  it("releases the capture lock when the owning port disconnects", () => {
    const listeners: RelayListener[] = [];
    const connectListeners: ConnectListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: () => undefined },
        },
      },
    });
    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Mix", artists: ["Channel"], state: "paused", positionMs: 0,
      durationMs: 60000, playbackRate: 1, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });

    const port1 = fakePort("tab-capture");
    connectListeners[0]?.(port1);
    port1.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    expect(port1.postedMessages).toEqual([{ type: "reserve-tab-capture-result", ok: true }]);

    port1.disconnect();

    const port2 = fakePort("tab-capture");
    connectListeners[0]?.(port2);
    port2.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    expect(port2.postedMessages).toEqual([{ type: "reserve-tab-capture-result", ok: true }]);
  });

  it("releases the capture lock when the locked tab is removed", () => {
    const listeners: RelayListener[] = [];
    const connectListeners: ConnectListener[] = [];
    const tabRemoveListeners: TabRemoveListener[] = [];
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: () => Promise.resolve(),
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          sendMessage: () => Promise.resolve(),
          onRemoved: { addListener: (listener: TabRemoveListener) => tabRemoveListeners.push(listener) },
        },
      },
    });
    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Mix", artists: ["Channel"], state: "paused", positionMs: 0,
      durationMs: 60000, playbackRate: 1, capturedAtMs: Date.now(),
    };
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } });

    const port1 = fakePort("tab-capture");
    connectListeners[0]?.(port1);
    port1.sendToSW({ type: "reserve-tab-capture", tabId: 5, mode: "mix-first" });
    expect(port1.postedMessages).toEqual([{ type: "reserve-tab-capture-result", ok: true }]);

    // Tab removed
    tabRemoveListeners[0]?.(5);

    // Another report and reserve now succeeds
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 6 } });
    const port2 = fakePort("tab-capture");
    connectListeners[0]?.(port2);
    port2.sendToSW({ type: "reserve-tab-capture", tabId: 6, mode: "mix-first" });
    expect(port2.postedMessages).toEqual([{ type: "reserve-tab-capture-result", ok: true }]);
  });

  it("suppresses relay when no side panel is connected and notifies playback tabs when side panel connects", async () => {
    const listeners: RelayListener[] = [];
    const connectListeners: ConnectListener[] = [];
    const runtimeMessages: RelayMessage[] = [];
    const sentTabMessages: Array<{ tabId: number; message: unknown }> = [];
    let onTabMessage: ((msg: { tabId: number; message: unknown }) => void) | undefined;
    const nextTabMessage = () => {
      const { promise, resolve } = Promise.withResolvers<{ tabId: number; message: unknown }>();
      onTabMessage = resolve;
      return promise;
    };
    runInNewContext(serviceWorker, {
      URL, Date,
      chrome: {
        runtime: {
          id: "extension-id",
          onMessage: { addListener: (listener: RelayListener) => listeners.push(listener) },
          onConnect: { addListener: (listener: ConnectListener) => connectListeners.push(listener) },
          sendMessage: (message: RelayMessage) => { runtimeMessages.push(message); return Promise.resolve(); },
        },
        action: { onClicked: { addListener: () => undefined } },
        sidePanel: { setPanelBehavior: () => undefined },
        tabs: {
          query: async () => [{ id: 5, url: "https://www.youtube.com/watch?v=abcdefghijk" }],
          sendMessage: (tabId: number, message: unknown) => {
            sentTabMessages.push({ tabId, message });
            onTabMessage?.({ tabId, message });
            return Promise.resolve();
          },
          onRemoved: { addListener: () => undefined },
        },
      },
    });

    const report = {
      version: 2, sessionId: "s1", appId: "youtube", pageUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      mediaId: "abcdefghijk", title: "Song", artists: ["Artist"], state: "playing", positionMs: 1000,
      durationMs: 60000, playbackRate: 1, capturedAtMs: Date.now(),
    };

    // No side panel port: report should NOT relay playback-state and response has listening: false
    let reportResponse: { listening?: boolean } | undefined;
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } }, (res: unknown) => {
      reportResponse = res as { listening?: boolean };
    });
    expect(runtimeMessages).toHaveLength(0);
    expect(reportResponse?.listening).toBe(false);

    // Connect side panel
    const sidePanelPort = fakePort("side-panel");
    const listeningBroadcast = nextTabMessage();
    connectListeners[0]?.(sidePanelPort);
    await listeningBroadcast;
    expect(sentTabMessages).toContainEqual({
      tabId: 5,
      message: { type: "playback-listening", listening: true },
    });

    // Now send report again: should relay and response has listening: true
    listeners[0]?.({ type: "playback-report", report }, { url: report.pageUrl, tab: { id: 5 } }, (res: unknown) => {
      reportResponse = res as { listening?: boolean };
    });
    expect(runtimeMessages).toHaveLength(1);
    expect(reportResponse?.listening).toBe(true);

    // Disconnect side panel: should broadcast listening: false
    const unlisteningBroadcast = nextTabMessage();
    sidePanelPort.disconnect();
    await unlisteningBroadcast;
    expect(sentTabMessages).toContainEqual({
      tabId: 5,
      message: { type: "playback-listening", listening: false },
    });
  });
});
