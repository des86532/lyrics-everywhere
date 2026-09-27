const REPORT_URL = "http://127.0.0.1:3838/api/media/browser";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "playback-report" || !sender.tab || typeof sender.tab.id !== "number") return;
  const payload = { ...message.report, tabId: String(sender.tab.id) };
  void fetch(REPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // The companion may not be running yet. The next media event retries.
  });
});
