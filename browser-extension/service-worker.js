const PLAYBACK_TAB_URLS = [
  "https://www.youtube.com/watch*",
  "https://music.youtube.com/watch*",
  "https://open.spotify.com/*",
];
const recentReports = new Map();
let activeCapture = null; // { tabId, port }
const panelPorts = new Set();

function validPlaybackReport(report, senderUrl) {
  if (typeof senderUrl !== "string" || !report) return false;
  if (!report || report.version !== 2 || typeof report.sessionId !== "string" || !report.sessionId || report.sessionId.length > 128) return false;
  if (typeof report.pageUrl !== "string" || typeof report.mediaId !== "string" || typeof report.title !== "string" || !report.title.trim()) return false;
  if (!Array.isArray(report.artists) || report.artists.length > 8 || report.artists.some((artist) => typeof artist !== "string" || artist.length > 200)) return false;
  if (!["youtube", "youtube-music", "spotify-web"].includes(report.appId)) return false;
  let page;
  let senderPage;
  try {
    page = new URL(report.pageUrl);
    senderPage = new URL(senderUrl);
  } catch { return false; }
  // sender.url can retain the document's initial URL after YouTube SPA navigation.
  if (page.protocol !== "https:" || senderPage.origin !== page.origin) return false;
  if (report.appId === "spotify-web") {
    if (page.hostname !== "open.spotify.com" || !/^[A-Za-z0-9]{22}$/.test(report.mediaId) ||
        !new RegExp(`^/track/${report.mediaId}/?$`).test(page.pathname)) return false;
  } else {
    if (page.hostname !== (report.appId === "youtube-music" ? "music.youtube.com" : "www.youtube.com") ||
        !/^[A-Za-z0-9_-]{11}$/.test(report.mediaId) ||
        report.appId === "youtube" && page.pathname !== "/watch" ||
        page.searchParams.get("v") !== report.mediaId) return false;
  }
  if (!["playing", "paused", "stopped"].includes(report.state)) return false;
  if (!Number.isFinite(report.positionMs) || report.positionMs < 0 ||
      !Number.isFinite(report.durationMs) || report.durationMs < 0 ||
      report.durationMs > 0 && report.positionMs > report.durationMs ||
      !Number.isFinite(report.playbackRate) || report.playbackRate < 0 ||
      !Number.isFinite(report.capturedAtMs) || Math.abs(Date.now() - report.capturedAtMs) > 3000) return false;
  if (report.mediaDurationMs !== undefined && (!Number.isFinite(report.mediaDurationMs) || report.mediaDurationMs <= 0)) return false;
  if (report.artistVerified !== undefined && typeof report.artistVerified !== "boolean") return false;
  if (report.rawTitle !== undefined && (typeof report.rawTitle !== "string" || report.rawTitle.length > 2000)) return false;
  if (report.segmentStartMs !== undefined && (!Number.isFinite(report.segmentStartMs) || report.segmentStartMs < 0)) return false;
  if (report.musicCredits !== undefined) {
    if (!Array.isArray(report.musicCredits) || report.musicCredits.length > 10) return false;
    for (const credit of report.musicCredits) {
      if (!credit || typeof credit !== "object" ||
          typeof credit.title !== "string" || typeof credit.artist !== "string" ||
          credit.title.trim().length < 1 || credit.title.trim().length > 120 ||
          credit.artist.trim().length < 1 || credit.artist.trim().length > 120) return false;
    }
  }
  return true;
}

// The toolbar action grants activeTab; opening the side panel alone does not.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

function supportedPlaybackPage(url) {
  let page;
  try { page = new URL(url); } catch { return undefined; }
  if (page.protocol !== "https:") return undefined;
  if (page.hostname === "www.youtube.com" && page.pathname === "/watch" &&
      /^[A-Za-z0-9_-]{11}$/.test(page.searchParams.get("v") || "")) return "youtube";
  if (page.hostname === "music.youtube.com" && page.pathname === "/watch" &&
      /^[A-Za-z0-9_-]{11}$/.test(page.searchParams.get("v") || "")) return "youtube-music";
  if (page.hostname === "open.spotify.com") return "spotify-web";
  return undefined;
}

function isMissingReceiver(error) {
  return /receiving end does not exist|could not establish connection/i.test(error?.message || "");
}

async function requestFreshPlaybackReport(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "request-playback-report" });
  } catch (error) {
    if (!isMissingReceiver(error)) throw error;
  }

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch {
    throw new Error("無法讀取所選分頁；請確認分頁仍開啟，並允許擴充功能存取此網站。");
  }
  const appId = supportedPlaybackPage(tab?.url);
  if (!appId) {
    throw new Error("所選分頁不是可讀取的 HTTPS YouTube、YouTube Music 或 Spotify 播放頁；未注入播放腳本。");
  }
  try {
    if (appId === "youtube") {
      await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["content-script.js"] });
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["youtube-page-bridge.js"] });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "ISOLATED",
        files: [appId === "youtube-music" ? "content-script.js" : "spotify-content-script.js"],
      });
    }
  } catch {
    throw new Error("無法在此播放頁啟動擴充功能播放腳本；請在網站權限提示中允許讀取此網站後重試。");
  }
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "request-playback-report" });
  } catch {
    throw new Error("播放腳本已啟動但仍無法連線；請確認播放頁可讀取，或關閉分頁後重新開啟。");
  }
}

async function listPlaybackTabs() {
  const tabs = await chrome.tabs.query({ url: PLAYBACK_TAB_URLS });
  return tabs.flatMap((tab) => {
    const appId = supportedPlaybackPage(tab?.url);
    if (!appId || !Number.isSafeInteger(tab?.id)) return [];
    return [{
      tabId: tab.id,
      title: typeof tab.title === "string" && tab.title.trim() ? tab.title : `${appId} — ${tab.url}`,
      appId,
    }];
  });
}

function reserveCapture(tabId, mode) {
  if (!Number.isSafeInteger(tabId) || mode !== "mix-first") {
    return { ok: false, error: "不支援的擷取要求。" };
  }
  const report = recentReports.get(tabId);
  const absolutePositionMs = report ? (report.segmentStartMs ?? 0) + report.positionMs : Number.POSITIVE_INFINITY;
  const mediaDurationMs = report?.mediaDurationMs ?? report?.durationMs ?? 0;
  if (activeCapture !== null) {
    return { ok: false, error: "已有分頁正在擷取音訊；請先停止目前工作。" };
  }
  if (!report || report.appId !== "youtube" || mediaDurationMs <= 0 ||
    Date.now() - report.capturedAtMs > 3000) {
    return { ok: false, error: "請切回正在播放的 YouTube /watch 分頁，確認播放資訊正常，再重新授權。" };
  }
  if (mode === "mix-first" && (report.state !== "paused" ||
    absolutePositionMs > 2000 || report.playbackRate !== 1)) {
    return { ok: false, error: "請切回要建立字幕的 YouTube /watch 分頁，確認影片停在 0 秒、1×，再重新授權。" };
  }
  return { ok: true };
}

async function broadcastListening(listening) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: PLAYBACK_TAB_URLS });
  } catch {
    tabs = [];
  }
  for (const tab of tabs) {
    if (Number.isSafeInteger(tab?.id)) {
      chrome.tabs.sendMessage(tab.id, { type: "playback-listening", listening }).catch(() => {});
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) {
    try { port.disconnect(); } catch {}
    return;
  }
  if (port.name === "side-panel") {
    panelPorts.add(port);
    if (panelPorts.size === 1) {
      void broadcastListening(true);
    }
    port.onDisconnect.addListener(() => {
      panelPorts.delete(port);
      if (panelPorts.size === 0) {
        void broadcastListening(false);
      }
    });
  } else if (port.name === "tab-capture") {
    port.onMessage.addListener((message) => {
      if (message?.type === "reserve-tab-capture") {
        const r = reserveCapture(message.tabId, message.mode);
        if (r.ok) {
          activeCapture = { tabId: message.tabId, port };
        }
        port.postMessage({ type: "reserve-tab-capture-result", ...r });
      }
    });
    port.onDisconnect.addListener(() => {
      if (activeCapture?.port === port) {
        activeCapture = null;
      }
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  recentReports.delete(tabId);
  if (activeCapture?.tabId === tabId) {
    try { activeCapture.port.disconnect(); } catch {}
    activeCapture = null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "has-active-tab-capture" && sender.id === chrome.runtime.id) {
    sendResponse({ active: activeCapture !== null });
    return;
  }
  if (message?.type === "list-playback-tabs" && sender.id === chrome.runtime.id) {
    listPlaybackTabs().then(
      (tabs) => sendResponse({ ok: true, tabs }),
      (error) => sendResponse({ ok: false, error: `無法列出播放分頁：${error?.message || error}` }),
    );
    return true;
  }
  if (message?.type === "request-playback-report" && sender.id === chrome.runtime.id && Number.isSafeInteger(message.tabId)) {
    requestFreshPlaybackReport(message.tabId).then(
      (response) => sendResponse(response ?? {
        ok: false, error: "播放腳本已連線，但沒有回傳可用的播放資料；請確認目前是支援的播放頁。",
      }),
      (error) => sendResponse({ ok: false, error: `無法取得分頁 ${message.tabId} 的播放資料：${error.message}` }),
    );
    return true;
  }
  if (!message || message.type !== "playback-report" || !sender.tab || typeof sender.tab.id !== "number") return;
  if (!validPlaybackReport(message.report, sender.url)) {
    sendResponse?.({ ok: false, error: "播放腳本已回報，但來源網址、影片 ID 或播放時間未通過驗證。" });
    return;
  }
  recentReports.set(sender.tab.id, message.report);
  if (panelPorts.size > 0) {
    void chrome.runtime.sendMessage({ type: "playback-state", tabId: sender.tab.id, report: message.report }).catch(() => {});
  }
  sendResponse?.({ ok: true, tabId: sender.tab.id, report: message.report, listening: panelPorts.size > 0 });
});
