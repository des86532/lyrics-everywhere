(() => {
  const lifecycleKey = "__lyricsEverywherePlaybackLifecycle";
  try { window[lifecycleKey]?.stop?.(); } catch {}
  const lifecycle = { stop: null };
  window[lifecycleKey] = lifecycle;
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type !== "request-playback-report") return;
    Promise.resolve(report()).then(sendResponse, (error) => sendResponse({
      ok: false, error: `Spotify 頁面無法傳送播放報告：${error.message}`,
    }));
    return true;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  function text(node) { return node?.textContent?.trim() || ""; }
  function parseTime(value) {
    const parts = value.trim().split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
    const seconds = parts.pop();
    const minutes = parts.pop();
    const hours = parts.pop() || 0;
    if (seconds >= 60 || minutes >= 60 && parts.length > 0) return null;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  function report() {
    const player = document.querySelector('[data-testid="now-playing-widget"]');
    if (!player) return;

    const trackLink = player.querySelector('a[href*="/track/"]');
    if (!trackLink) return;
    let trackUrl;
    try { trackUrl = new URL(trackLink.href); } catch { return; }
    const trackId = trackUrl.pathname.match(/\/track\/([A-Za-z0-9]{22})(?:\/|$)/)?.[1] || "";
    if (trackUrl.hostname !== "open.spotify.com" || !TRACK_ID_PATTERN.test(trackId)) return;

    const title = text(player.querySelector('[data-testid="context-item-info-title"]')) || text(trackLink);
    const artists = [...player.querySelectorAll('[data-testid="context-item-info-artist"]')]
      .map(text).filter(Boolean).slice(0, 8);
    if (!title || artists.length === 0) return;

    const controls = document.querySelector('[data-testid="control-button-playpause"]');
    const controlLabel = controls?.getAttribute("aria-label")?.trim();
    if (!controls || (controlLabel !== "Pause" && controlLabel !== "Play")) return;
    const state = controlLabel === "Pause" ? "playing" : "paused";

    const media = [...document.querySelectorAll("audio, video")]
      .find((element) => Number.isFinite(element.duration) && element.duration > 0);
    if (!media || media.paused !== (state === "paused")) return;

    const positionMs = parseTime(text(document.querySelector('[data-testid="playback-position"]')));
    const durationMs = parseTime(text(document.querySelector('[data-testid="playback-duration"]')));
    if (positionMs === null || durationMs === null || durationMs <= 0 || positionMs > durationMs) return;
    if (Math.abs(media.duration * 1000 - durationMs) > 3000 || Math.abs(media.currentTime * 1000 - positionMs) > 3000) return;

    return chrome.runtime.sendMessage({ type: "playback-report", report: {
      version: 2,
      sessionId,
      appId: "spotify-web",
      pageUrl: location.href,
      mediaId: trackId,
      title,
      artists,
      state,
      positionMs,
      durationMs,
      playbackRate: 1,
      capturedAtMs: Date.now()
    }});
  }

  const intervalId = setInterval(report, 1000);
  lifecycle.stop = () => {
    try { clearInterval(intervalId); } catch {}
    try { chrome.runtime.onMessage.removeListener?.(onRuntimeMessage); } catch {}
  };
})();
