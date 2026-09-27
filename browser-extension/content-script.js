(() => {
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  let currentVideo;
  let currentUrl = location.href;
  let listeners = [];

  function videoId() {
    try { return new URL(location.href).searchParams.get("v") || ""; } catch { return ""; }
  }
  function text(selector) { return document.querySelector(selector)?.textContent?.trim() || ""; }
  function content(selector) { return document.querySelector(selector)?.getAttribute("content")?.trim() || ""; }
  function appId() { return location.hostname === "music.youtube.com" ? "youtube-music" : "youtube"; }
  function title() {
    if (appId() === "youtube-music") return text("ytmusic-player-bar .title") || text("ytmusic-player-bar yt-formatted-string.title");
    return text("h1.ytd-watch-metadata") || content("meta[itemprop='name']") || document.title.replace(/ - YouTube$/, "").trim();
  }
  function artists() {
    if (appId() === "youtube-music") {
      const values = [...document.querySelectorAll("ytmusic-player-bar .byline a")].map((node) => node.textContent.trim()).filter(Boolean);
      if (values.length) return values.slice(0, 8);
    }
    const channel = text("ytd-watch-metadata ytd-channel-name a") || content("meta[itemprop='author']");
    return channel ? [channel] : [];
  }
  function isAd() { return Boolean(document.querySelector(".ad-showing, .video-ads.ytp-ad-module")); }
  function report() {
    if (!currentVideo || isAd()) return;
    const id = videoId();
    const trackTitle = title();
    const trackArtists = artists();
    if (!id || !trackTitle || !trackArtists.length) return;
    const state = currentVideo.ended ? "stopped" : currentVideo.paused ? "paused" : "playing";
    chrome.runtime.sendMessage({ type: "playback-report", report: {
      version: 1, sessionId, appId: appId(), pageUrl: location.href, videoId: id,
      title: trackTitle, artists: trackArtists, state,
      positionMs: Math.max(0, Math.round(currentVideo.currentTime * 1000)),
      durationMs: Number.isFinite(currentVideo.duration) ? Math.max(0, Math.round(currentVideo.duration * 1000)) : 0,
      playbackRate: Number.isFinite(currentVideo.playbackRate) ? Math.max(0, currentVideo.playbackRate) : 1,
      capturedAtMs: Date.now()
    }});
  }
  function bind() {
    const video = document.querySelector("video");
    if (!video || video === currentVideo) return;
    listeners.forEach(([name, handler]) => currentVideo?.removeEventListener(name, handler));
    currentVideo = video;
    listeners = ["play", "pause", "seeking", "ratechange", "durationchange", "loadedmetadata", "ended", "timeupdate"].map((name) => {
      const handler = report;
      video.addEventListener(name, handler);
      return [name, handler];
    });
    report();
  }
  setInterval(() => {
    if (location.href !== currentUrl) {
      listeners.forEach(([name, handler]) => currentVideo?.removeEventListener(name, handler));
      currentUrl = location.href;
      currentVideo = undefined;
      listeners = [];
    }
    bind();
    report();
  }, 1000);
})();
