(() => {
  const lifecycleKey = "__lyricsEverywherePlaybackLifecycle";
  try { window[lifecycleKey]?.stop?.(); } catch {}
  const lifecycle = { stop: null };
  window[lifecycleKey] = lifecycle;
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  let currentMedia;
  let currentUrl = location.href;
  let listeners = [];
  let youtubePageData = { videoId: "", chapters: [] };
  let listening = true;
  let lastSentAt = 0;
  function contextInvalidated(error) { return /extension context invalidated/i.test(error?.message || ""); }
  function send(message) {
    lastSentAt = Date.now();
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
  function reportInBackground(reason) {
    if (!listening && reason !== "event" && Date.now() - lastSentAt < 10000) return;
    try {
      Promise.resolve(report()).catch(() => {});
    } catch {}
  }
  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type === "playback-listening") {
      listening = message.listening === true;
      if (listening) reportInBackground("event");
      return;
    }
    if (message?.type !== "request-playback-report") return;
    bind();
    Promise.resolve(report()).then(sendResponse, (error) => sendResponse({
      ok: false, error: `頁面已讀取，但無法傳送播放報告：${error.message}`,
    }));
    return true;
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  const onWindowMessage = (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.type !== "lyrics-everywhere-youtube-page-data") return;
    if (!/^[A-Za-z0-9_-]{11}$/.test(data.videoId) || !Array.isArray(data.chapters)) return;
    const chapters = data.chapters.filter((chapter) =>
      Number.isSafeInteger(chapter?.startMs) && chapter.startMs >= 0 &&
      typeof chapter.title === "string" && chapter.title.trim() && chapter.title.length <= 500
    ).sort((left, right) => left.startMs - right.startMs);
    let musicCredits;
    if (Array.isArray(data.musicCredits) && data.musicCredits.length <= 10) {
      const valid = data.musicCredits.every((c) =>
        typeof c?.title === "string" && typeof c?.artist === "string" &&
        c.title.trim().length >= 1 && c.title.trim().length <= 120 &&
        c.artist.trim().length >= 1 && c.artist.trim().length <= 120
      );
      if (valid) {
        musicCredits = data.musicCredits.map((c) => ({ title: c.title.trim(), artist: c.artist.trim() }));
      }
    }
    youtubePageData = { videoId: data.videoId, chapters, musicCredits };
  };
  window.addEventListener("message", onWindowMessage);

  function videoId() {
    try { return new URL(location.href).searchParams.get("v") || ""; } catch { return ""; }
  }

  function currentChapter(id, positionMs) {
    if (youtubePageData.videoId !== id) return undefined;
    let current;
    for (const chapter of youtubePageData.chapters) {
      if (chapter.startMs > positionMs) break;
      current = chapter;
    }
    if (!current || youtubePageData.chapters.length < 2) return undefined;
    const next = youtubePageData.chapters.find((chapter) => chapter.startMs > current.startMs);
    return {
      ...current,
      durationMs: next ? next.startMs - current.startMs : undefined,
    };
  }
  function text(selector) { return document.querySelector(selector)?.textContent?.trim() || ""; }
  function content(selector) { return document.querySelector(selector)?.getAttribute("content")?.trim() || ""; }
  function appId() { return location.hostname === "music.youtube.com" ? "youtube-music" : "youtube"; }
  function title() {
    if (appId() === "youtube-music") return text("ytmusic-player-bar .title") || text("ytmusic-player-bar yt-formatted-string.title");
    return text("h1.ytd-watch-metadata") || content("meta[itemprop='name']") || document.title.replace(/ - YouTube$/, "").trim();
  }
  // Text after a closing quote that still describes the same song recording.
  function isSongTitleTail(tail) {
    if (/\b(?:teaser|trailer|preview|highlight|medley|behind|making|practice|reaction|live|cover|remix|acoustic|instrumental|karaoke)\b/i.test(tail)) return false;
    return /^[\[(]?\s*(?:ft|feat|featuring)\.?\s+\S/i.test(tail) ||
      /^[\[(]?\s*(?:official\s+)?visuali[sz]er\s*[\])]?$/i.test(tail);
  }
  function parseExplicitTrackTitle(value) {
    const withoutPrefix = value
      .replace(/^\s*[\[(]\s*(?:official\s+(?:(?:music\s+)?video|audio|mv)|lyric(?:s)?\s+video|performance\s+video|mv|m\/v)\s*[\])]\s*/i, "");
    const withoutSuffix = withoutPrefix
      .replace(/\s*[\[(]\s*(?:official\s+(?:(?:music\s+)?video|audio|mv)|lyric(?:s)?\s+video|performance\s+video|mv|m\/v)[^\])]*[\])]\s*$/i, "")
      .replace(/\s+(?:official\s+(?:(?:music\s+)?video|audio|mv)|lyric(?:s)?\s+video|performance\s+video|mv|m\/v)\s*$/i, "")
      .trim();
    const hasMusicLabel = withoutSuffix !== value.trim();
    const quotedParts = withoutSuffix.match(/^(.+?)\s+['"“‘](.+)['"”’](?:\s+([^'"“”‘’]+?))?\s*$/u);
    const quoted = quotedParts && (!quotedParts[3] || isSongTitleTail(quotedParts[3].trim())) ? quotedParts : undefined;
    const separated = !quoted && hasMusicLabel ? withoutSuffix.match(/^(.+?)\s+[-–—_]\s+(.+)$/u) : undefined;
    if (!quoted && !separated) return undefined;
    const artist = (quoted?.[1] ?? separated?.[1] ?? "").replace(/\s*[-–—_:]\s*$/u, "").trim();
    const parsedTitle = (quoted?.[2] ?? separated?.[2] ?? "").trim();
    // Remove a complete trailing credit, including bilingual guest names, not version labels.
    const withoutFeature = parsedTitle.replace(/\s*[(（]\s*feat(?:uring)?(?:\.\s*|\s+)[^()（）]*(?:[(（][^()（）]*[)）][^()（）]*)*[)）]\s*$/iu, "").trim();
    const translatedTitle = withoutFeature.match(/^([^()（）]+?)\s*[(（]([\p{Script=Hangul}\s\p{P}]+)[)）]$/u);
    const trackTitle = translatedTitle && /[A-Za-z]/.test(translatedTitle[1]) && !/\p{Script=Hangul}/u.test(translatedTitle[1])
      ? translatedTitle[1].trim()
      : withoutFeature;
    if (!artist || !trackTitle) return undefined;
    const parts = artist.match(/^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/u);
    const left = parts?.[1]?.trim();
    const alias = parts?.[2]?.trim();
    const spaced = parts ? undefined
      : artist.match(/^([\p{Script=Hangul}][\p{Script=Hangul}\s]*?)\s+([A-Za-z][A-Za-z0-9 .&'$-]*)$/u) ??
        artist.match(/^([A-Za-z][A-Za-z0-9 .&'$-]*?)\s+([\p{Script=Hangul}][\p{Script=Hangul}\s]*)$/u);
    const spacedLatin = spaced && (/[A-Za-z]/.test(spaced[1]) ? spaced[1] : spaced[2]).trim();
    const spacedHangul = spaced && (/[A-Za-z]/.test(spaced[1]) ? spaced[2] : spaced[1]).trim();
    const artists = parts && left && alias
      ? /[A-Za-z]/.test(alias) && !/[A-Za-z]/.test(left) ? [alias, artist, left]
        : /[A-Za-z]/.test(left) && !/[A-Za-z]/.test(alias) ? [left, artist, alias]
          : [left, alias, artist]
      : spacedLatin && spacedHangul ? [spacedLatin, artist, spacedHangul] : [artist];
    return { title: trackTitle, artists: [...new Set(artists.filter(Boolean))] };
  }
  function artists() {
    if (appId() === "youtube-music") {
      // The byline is "Artist • Album • Year"; artist links point to channel/, album links to browse/MPRE….
      const links = [...document.querySelectorAll("ytmusic-player-bar .byline a")]
        .map((node) => ({ name: node.textContent.trim(), href: node.href || node.getAttribute?.("href") || "" })).filter((link) => link.name);
      const channels = links.filter((link) => link.href.includes("channel/"));
      const values = (channels.length ? channels : links.filter((link) => !link.href.includes("browse/MPRE"))).map((link) => link.name);
      if (values.length) return values.slice(0, 8);
    }
    const channel = text("ytd-watch-metadata ytd-channel-name a") || content("meta[itemprop='author']");
    return channel ? [channel] : [];
  }
  function isAd() { return Boolean(document.querySelector(".ad-showing")); }
  // YouTube SPA navigation updates ?v= before the title, channel and real media duration.
  function youtubeMetadataReady(id) {
    if (location.hostname !== "www.youtube.com") return true;
    const metadataId = document.querySelector("ytd-watch-metadata")?.getAttribute?.("video-id");
    return (!metadataId || metadataId === id) && Number.isFinite(currentMedia.duration) && currentMedia.duration > 0;
  }
  function report() {
    if (location.hostname === "www.youtube.com" && location.pathname !== "/watch") {
      return { ok: false, error: "播放腳本已連線，但目前不是 YouTube /watch 播放頁。" };
    }
    if (!currentMedia) return { ok: false, error: "播放腳本已連線，但頁面找不到 video/audio 播放器。" };
    if (isAd()) return { ok: false, error: "目前正在播放 YouTube 廣告；等待正片後再取得曲名。" };
    const id = videoId();
    if (!youtubeMetadataReady(id)) return { ok: false, error: "YouTube 正在載入新影片資訊；完成後會自動更新。" };
    const chapter = location.hostname === "www.youtube.com"
      ? currentChapter(id, Math.max(0, Math.round(currentMedia.currentTime * 1000)))
      : undefined;
    const chapterParts = chapter?.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const videoTitle = title();
    const videoTitleTrack = !chapter && appId() === "youtube" ? parseExplicitTrackTitle(videoTitle) : undefined;
    const trackTitle = chapterParts ? chapterParts[2].trim() : chapter?.title || videoTitleTrack?.title || videoTitle;
    const trackArtists = chapterParts ? [chapterParts[1].trim()] : videoTitleTrack?.artists ?? artists();
    const artistVerified = appId() !== "youtube" || Boolean(chapterParts || videoTitleTrack);
    if (!id || !trackTitle) return { ok: false, error: "播放器已找到，但頁面尚未提供影片 ID 或標題。" };
    const state = currentMedia.ended ? "stopped" : currentMedia.paused ? "paused" : "playing";
    const absolutePositionMs = Math.max(0, Math.round(currentMedia.currentTime * 1000));
    const positionMs = chapter ? Math.max(0, absolutePositionMs - chapter.startMs) : absolutePositionMs;
    const mediaDurationMs = Number.isFinite(currentMedia.duration) ? Math.max(0, Math.round(currentMedia.duration * 1000)) : 0;
    const durationMs = chapter
      ? chapter.durationMs ?? (mediaDurationMs > 0 ? Math.max(0, mediaDurationMs - chapter.startMs) : 0)
      : mediaDurationMs;
    return send({ type: "playback-report", report: {
      version: 2, sessionId, appId: appId(), pageUrl: location.href, mediaId: id,
      ...(appId() === "youtube" ? { rawTitle: videoTitle.slice(0, 2000) } : {}),
      ...(appId() === "youtube" && !chapter && youtubePageData.videoId === id && youtubePageData.musicCredits
        ? { musicCredits: youtubePageData.musicCredits }
        : {}),
      ...(mediaDurationMs > 0 ? { mediaDurationMs } : {}),
      artistVerified,
      ...(chapter ? { segmentStartMs: chapter.startMs } : {}),
      title: trackTitle, artists: trackArtists, state,
      positionMs: Math.min(positionMs, durationMs || positionMs),
      durationMs,
      playbackRate: Number.isFinite(currentMedia.playbackRate) ? Math.max(0, currentMedia.playbackRate) : 1,
      capturedAtMs: Date.now()
    }});
  }
  function bind() {
    const media = document.querySelector("video, audio");
    if (!media || media === currentMedia) return;
    listeners.forEach(([name, handler]) => currentMedia?.removeEventListener(name, handler));
    currentMedia = media;
    listeners = ["play", "pause", "seeking", "ratechange", "durationchange", "loadedmetadata", "ended", "timeupdate"].map((name) => {
      const handler = () => reportInBackground(name === "timeupdate" ? "timeupdate" : "event");
      media.addEventListener(name, handler);
      return [name, handler];
    });
  }
  const intervalId = setInterval(() => {
    if (location.href !== currentUrl) {
      listeners.forEach(([name, handler]) => currentMedia?.removeEventListener(name, handler));
      currentUrl = location.href;
      currentMedia = undefined;
      listeners = [];
    }
    bind();
    reportInBackground("tick");
  }, 1000);
  lifecycle.stop = () => {
    try { clearInterval(intervalId); } catch {}
    try { chrome.runtime.onMessage.removeListener?.(onRuntimeMessage); } catch {}
    try { window.removeEventListener?.("message", onWindowMessage); } catch {}
    listeners.forEach(([name, handler]) => {
      try { currentMedia?.removeEventListener(name, handler); } catch {}
    });
  };
})();
