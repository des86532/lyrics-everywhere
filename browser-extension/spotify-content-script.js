(() => {
  const lifecycleKey = "__lyricsEverywherePlaybackLifecycle";
  try { window[lifecycleKey]?.stop?.(); } catch {}
  const lifecycle = { stop: null };
  window[lifecycleKey] = lifecycle;
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
  let listening = false;

  function contextInvalidated(error) {
    return /extension context invalidated/i.test(error?.message || "");
  }

  function send(message) {
    let result;
    try {
      result = chrome.runtime.sendMessage(message);
    } catch (error) {
      if (contextInvalidated(error)) lifecycle.stop();
      throw error;
    }
    return Promise.resolve(result).then(
      (response) => {
        if (typeof response?.listening === "boolean") listening = response.listening;
        return response;
      },
      (error) => {
        if (contextInvalidated(error)) lifecycle.stop();
        throw error;
      }
    );
  }

  function reportInBackground() {
    if (!listening) return;
    try {
      Promise.resolve(report()).catch(() => {});
    } catch {}
  }

  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type === "playback-listening") {
      listening = message.listening === true;
      if (listening) reportInBackground();
      return;
    }
    if (message?.type !== "request-playback-report") return;
    Promise.resolve(report()).then(sendResponse, (error) => sendResponse({
      ok: false, error: `Spotify 頁面無法傳送播放報告：${error.message}`,
    }));
    return true;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  // A page loaded while a side panel is already open missed the broadcast; ask once.
  try {
    Promise.resolve(chrome.runtime.sendMessage({ type: "playback-listening-query" })).then((response) => {
      if (response?.listening === true) { listening = true; reportInBackground(); }
    }, () => {});
  } catch {}

  function text(node) { return node?.textContent?.trim() || ""; }
  function parseTime(value) {
    const parts = value.trim().split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
    const hasHours = parts.length === 3;
    const seconds = parts.pop();
    const minutes = parts.pop();
    const hours = parts.pop() || 0;
    if (seconds >= 60 || minutes >= 60 && hasHours) return null;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  // The now-playing widget links to the album/playlist context, not the track, and Spotify
  // keeps no <audio>/<video> element in the DOM. The track ID comes from the visible tracklist
  // row with the same title and artist; position and duration come from the progress slider.
  function trackIdFromTracklist(title, artists) {
    const ids = new Set();
    for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
      const link = row.querySelector('a[data-testid="internal-track-link"]');
      if (!link || text(link) !== title) continue;
      const rowArtists = [...row.querySelectorAll('a[href^="/artist/"]')].map(text);
      if (rowArtists.length > 0 && !rowArtists.some((name) => artists.includes(name))) continue;
      const id = link.getAttribute("href")?.match(/^\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
      if (id) ids.add(id);
    }
    return ids.size === 1 ? [...ids][0] : "";
  }

  const SAMPLE_GAP_MS = 1200;
  const MIN_SAMPLE_GAP_MS = 1000;
  const MAX_SAMPLE_AGE_MS = 3000;
  let lastSample = null;
  let trackIdCache = null;

  function readSnapshot() {
    const player = document.querySelector('[data-testid="now-playing-widget"]');
    if (!player) return null;

    const title = text(player.querySelector('[data-testid="context-item-info-title"]'));
    const artists = [...player.querySelectorAll('[data-testid="context-item-info-artist"]')]
      .map(text).filter(Boolean).slice(0, 8);
    if (!title || artists.length === 0) return null;

    // A virtualized list can scroll the playing row out of the DOM; keep the ID for the same song and context.
    const context = player.querySelector('[data-testid="context-item-link"]')?.getAttribute("href") || "";
    const cacheKey = [title, ...artists, context].join("\n");
    const mediaId = trackIdFromTracklist(title, artists) || (trackIdCache?.key === cacheKey ? trackIdCache.id : "");
    if (!TRACK_ID_PATTERN.test(mediaId)) return null;
    trackIdCache = { key: cacheKey, id: mediaId };

    const slider = document.querySelector('[data-testid="playback-progressbar"] input[type="range"]');
    const rawPosition = slider?.getAttribute("value");
    const rawDuration = slider?.getAttribute("max");
    if (rawPosition == null || rawDuration == null) return null;
    const positionMs = Math.round(Number(rawPosition));
    const durationMs = Math.round(Number(rawDuration));
    if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || positionMs < 0 || durationMs <= 0 || positionMs > durationMs) return null;

    const clockPositionMs = parseTime(text(document.querySelector('[data-testid="playback-position"]')));
    const clockDurationMs = parseTime(text(document.querySelector('[data-testid="playback-duration"]')));
    if (clockPositionMs === null || clockDurationMs === null) return null;
    if (Math.abs(durationMs - clockDurationMs) > 3000 || Math.abs(positionMs - clockPositionMs) > 3000) return null;

    return { mediaId, title, artists, positionMs, durationMs, at: Date.now() };
  }

  async function report() {
    let snapshot = readSnapshot();
    if (!snapshot) return;

    // Spotify exposes no paused flag, so state comes from whether the position advanced between samples.
    let base = lastSample?.mediaId === snapshot.mediaId && snapshot.at - lastSample.at <= MAX_SAMPLE_AGE_MS ? lastSample : null;
    if (!base) {
      lastSample = base = snapshot;
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_GAP_MS));
      snapshot = readSnapshot();
      if (!snapshot || snapshot.mediaId !== base.mediaId) return;
    }
    // The slider value updates about once a second, so a shorter gap would read a playing track as paused.
    let state = base.state;
    const elapsed = snapshot.at - base.at;
    if (elapsed >= MIN_SAMPLE_GAP_MS) {
      const moved = snapshot.positionMs - base.positionMs;
      state = moved >= 300 && moved <= elapsed + 1500 ? "playing" : "paused";
      lastSample = { ...snapshot, state };
    }
    if (!state) return;

    return send({ type: "playback-report", report: {
      version: 2,
      sessionId,
      appId: "spotify-web",
      pageUrl: `https://open.spotify.com/track/${snapshot.mediaId}`,
      mediaId: snapshot.mediaId,
      title: snapshot.title,
      artists: snapshot.artists,
      state,
      positionMs: snapshot.positionMs,
      durationMs: snapshot.durationMs,
      playbackRate: 1,
      capturedAtMs: Date.now()
    }});
  }

  const intervalId = setInterval(() => {
    reportInBackground();
  }, 1000);
  lifecycle.stop = () => {
    try { clearInterval(intervalId); } catch {}
    try { chrome.runtime.onMessage.removeListener?.(onRuntimeMessage); } catch {}
  };
})();
