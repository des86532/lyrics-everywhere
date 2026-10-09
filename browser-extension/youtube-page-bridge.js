(() => {
  const lifecycleKey = "__lyricsEverywhereYouTubeBridgeLifecycle";
  try { window[lifecycleKey]?.stop?.(); } catch {}
  const lifecycle = { stop: null };
  window[lifecycleKey] = lifecycle;
  const MESSAGE_TYPE = "lyrics-everywhere-youtube-chapters";

  function playerResponse() {
    const player = document.querySelector("#movie_player");
    try {
      const response = player?.getPlayerResponse?.();
      if (response) return response;
    } catch {}
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    try {
      const raw = window.ytplayer?.config?.args?.player_response;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  }

  function responseChapters(response) {
    const markers = response?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
      ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap || [];
    const chapters = markers.flatMap((marker) => marker?.value?.chapters || []).map((entry) => {
      const chapter = entry?.chapterRenderer || entry;
      const title = chapter?.title?.simpleText || chapter?.title?.runs?.map((run) => run.text).join("");
      const startMs = Number(chapter?.timeRangeStartMillis ?? chapter?.timeRangeStartMs);
      return { startMs, title: typeof title === "string" ? title.trim() : "" };
    }).filter((chapter) => Number.isSafeInteger(chapter.startMs) && chapter.startMs >= 0 && chapter.title);
    if (chapters.length >= 2) return chapters;

    const description = response?.videoDetails?.shortDescription;
    if (typeof description !== "string") return chapters;
    const descriptionChapters = description.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^(\d+:\d{2}(?::\d{2})?)\s+(.+?)\s*$/);
      if (!match) return [];
      const parts = match[1].split(":").map(Number);
      const seconds = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
      return [{ startMs: seconds * 1000, title: match[2].trim() }];
    });
    return descriptionChapters.length >= 2 ? descriptionChapters : chapters;
  }

  function publishChapters() {
    const response = playerResponse();
    const videoId = response?.videoDetails?.videoId || new URL(location.href).searchParams.get("v");
    if (!videoId) return;
    window.postMessage({
      type: MESSAGE_TYPE,
      videoId,
      chapters: responseChapters(response),
    }, location.origin);
  }

  publishChapters();
  const intervalId = setInterval(publishChapters, 1000);
  lifecycle.stop = () => {
    try { clearInterval(intervalId); } catch {}
  };
})();
