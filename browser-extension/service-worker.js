const REPORT_URL = "http://127.0.0.1:3838/api/media/browser";
const HEARTBEAT_URL = `${REPORT_URL}/heartbeat`;
const MEDIA_STATES = new Set(["no-video", "ready", "missing-metadata"]);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || !sender.tab || typeof sender.tab.id !== "number") return;
  if (message.type === "connector-heartbeat") {
    if (typeof message.appId !== "string" || typeof message.pageUrl !== "string" || !MEDIA_STATES.has(message.mediaState)) return;
    const payload = {
      appId: message.appId,
      pageUrl: message.pageUrl,
      tabId: String(sender.tab.id),
      mediaState: message.mediaState,
    };
    void fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // The companion may not be running yet. The next heartbeat retries.
    });
    return;
  }
  if (message.type !== "playback-report") return;
  const payload = { ...message.report, tabId: String(sender.tab.id) };
  void fetch(REPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // The companion may not be running yet. The next media event retries.
  });
});
