import { createServer, type Server } from "node:http";
import type { FullLyricsSheet, PhoneticSystem, PlaybackCursor } from "../domain/types.js";
import type { PlaybackSession } from "../session/playback-session.js";
import type { BrowserMediaConnector } from "../connectors/browser-media-connector.js";

export class CompanionServer {
  private server?: Server;
  private sseClients = new Set<(data: string) => void>();

  constructor(private session: PlaybackSession, private port = 3838, private readonly browserMedia?: BrowserMediaConnector) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // 1. 監聽全曲歌譜變更 (低頻全量推播)
      this.session.subscribeSheet((sheet) => {
        this.broadcast("lyrics-sheet", {
          track: this.session.getCurrentTrack(),
          sheet,
        });
      });

      // 2. 監聽播放游標推進 (每秒輕量推播)
      this.session.subscribe((display) => {
        const cursor: PlaybackCursor = {
          trackKey: this.session.getCurrentTrack()?.trackKey,
          currentLineIndex: display.currentLineIndex,
          activeLineId: display.activeLineId,
          positionMs: display.positionMs,
          durationMs: display.durationMs,
          progressPercent: display.progressPercent,
          isPlaying: display.isPlaying,
        };
        this.broadcast("playback-update", {
          cursor,
        });
      });

      this.server = createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (url.pathname === "/api/media/browser" && req.method === "OPTIONS") {
        const origin = req.headers.origin;
        if (origin && !origin.startsWith("chrome-extension://")) {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin || "null",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      if (url.pathname === "/api/media/browser" && req.method === "POST") {
        const origin = req.headers.origin;
        if (!origin || !origin.startsWith("chrome-extension://")) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "browser reports require a Chrome extension origin" }));
          return;
        }
        let body = "";
        let size = 0;
        let rejected = false;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) rejected = true;
          else body += chunk.toString("utf8");
        });
        req.on("end", () => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (origin) headers["Access-Control-Allow-Origin"] = origin;
          if (rejected) {
            res.writeHead(413, headers);
            res.end(JSON.stringify({ error: "request body too large" }));
            return;
          }
          try {
            const result = this.browserMedia?.ingest(JSON.parse(body));
            if (!result?.ok) {
              res.writeHead(400, headers);
              res.end(JSON.stringify({ error: result?.reason || "browser media receiver unavailable" }));
              return;
            }
            res.writeHead(204, headers);
            res.end();
          } catch {
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: "invalid JSON" }));
          }
        });
        return;
      }
        if (req.method === "POST" && url.pathname === "/api/profile") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const data = JSON.parse(body || "{}");
              const updates: Record<string, unknown> = {};
              if (typeof data.targetLocale === "string" && ["zh-TW", "en", "ja", "ko"].includes(data.targetLocale)) {
                updates.targetLocale = data.targetLocale;
              }
              if (Array.isArray(data.passthroughLanguages)) {
                updates.passthroughLanguages = [...new Set(data.passthroughLanguages.filter((language: unknown): language is string =>
                  typeof language === "string" && ["zh", "en", "ja", "ko"].includes(language)
                ))];
              }
              if (Array.isArray(data.allowedSystems) && data.allowedSystems.length > 0) {
                const systems = data.allowedSystems.filter((s: string) =>
                  ["chinese", "bopomofo", "latin"].includes(s)
                ) as PhoneticSystem[];
                if (systems.length > 0) {
                  updates.allowedSystems = systems.slice(0, 3);
                }
              }
              this.session.updateProfile(updates);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, profile: this.session.getProfile() }));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        // SSE: 即時推播 (全曲歌譜 + 輕量游標分流)
        if (url.pathname === "/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });
          res.write("\n");

          const send = (data: string) => res.write(data);
          this.sseClients.add(send);

          // 初始連線時，先推送目前全篇歌譜
          const sheet = this.session.getFullSheet();
          if (sheet) {
            res.write(
              `event: lyrics-sheet\ndata: ${JSON.stringify({
                track: this.session.getCurrentTrack(),
                sheet,
              })}\n\n`
            );
          }

          // 再推送目前播放游標
          const display = this.session.computeDisplay();
          const cursor: PlaybackCursor = {
            trackKey: this.session.getCurrentTrack()?.trackKey,
            currentLineIndex: display.currentLineIndex,
            activeLineId: display.activeLineId,
            positionMs: display.positionMs,
            durationMs: display.durationMs,
            progressPercent: display.progressPercent,
            isPlaying: display.isPlaying,
          };
          res.write(
            `event: playback-update\ndata: ${JSON.stringify({
              cursor,
            })}\n\n`
          );

          req.on("close", () => {
            this.sseClients.delete(send);
          });
          return;
        }

        if (url.pathname.startsWith("/api/")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(this.renderHtml());
      });

      this.server.once("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        this.server?.removeListener("error", reject);
        const address = this.server?.address();
        resolve(typeof address === "object" && address ? address.port : this.port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private broadcast(event: string, payload: unknown) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client(data);
      } catch {
        // 忽略斷線 client
      }
    }
  }

  private renderHtml(): string {
    const currentProfile = this.session.getProfile();
    const allowed = currentProfile.allowedSystems;
    const preservedLanguages = new Set(
      [currentProfile.targetLocale, ...currentProfile.passthroughLanguages]
        .map((locale) => locale.toLowerCase().split(/[-_]/)[0] || "")
    );
    const selectedSystem = allowed[0] || "chinese";

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>Universal Sing-Along Companion - 全曲歌詞跟唱</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 760px;
      display: flex;
      flex-direction: column;
      height: 94vh;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 28px;
      padding: 24px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.5);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      position: relative;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .track-title { font-size: 1.4rem; font-weight: 800; color: #38bdf8; }
    .track-artist { font-size: 0.9rem; color: #94a3b8; margin-top: 2px; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }

    /* 語言與顯示偏好 */
    .language-selector,
    .system-selector {
      border: 0;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      background: rgba(15, 23, 42, 0.6);
      padding: 10px 16px;
      border-radius: 16px;
      margin-bottom: 16px;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    .language-selector legend,
    .system-selector legend {
      padding: 0;
      margin-bottom: 8px;
      font-weight: 700;
      color: #e2e8f0;
    }
    .language-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chk-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      color: #cbd5e1;
    }
    .chk-item input {
      accent-color: #38bdf8;
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    /* 全曲歌詞滾動區 */
    .lyrics-sheet-container {
      flex: 1;
      overflow-y: auto;
      padding: 40px 16px 120px 16px;
      scroll-behavior: smooth;
    }
    .lyrics-sheet-container::-webkit-scrollbar { width: 6px; }
    .lyrics-sheet-container::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }

    .lyric-row {
      text-align: center;
      padding: 18px 12px;
      margin: 8px 0;
      border-radius: 16px;
      transition: all 0.3s ease;
      opacity: 0.45;
    }
    .lyric-row.active {
      opacity: 1;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      transform: scale(1.03);
    }
    .original-text {
      font-size: 1.5rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 0.04em;
    }
    .lyric-row.active .original-text {
      font-size: 1.8rem;
      color: #ffffff;
      text-shadow: 0 0 20px rgba(56, 189, 248, 0.4);
    }
    .blended-homophone {
      font-size: 1.1rem;
      font-weight: 700;
      color: #facc15;
      margin-top: 6px;
      letter-spacing: 0.06em;
    }
    .lyric-row.active .blended-homophone {
      font-size: 1.3rem;
      color: #fde047;
      text-shadow: 0 0 16px rgba(250, 204, 21, 0.5);
    }

    /* 浮動快捷按鈕 */
    .btn-return-sync {
      position: absolute;
      bottom: 40px;
      right: 32px;
      background: #38bdf8;
      color: #0f172a;
      border: none;
      padding: 10px 18px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.85rem;
      box-shadow: 0 8px 24px rgba(56, 189, 248, 0.5);
      cursor: pointer;
      display: none;
      z-index: 10;
      transition: all 0.2s;
    }
    .btn-return-sync:hover { transform: scale(1.05); }

    .footer {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="header">
      <div>
        <h1 id="title" class="track-title">全曲歌詞預載中...</h1>
        <div id="artist" class="track-artist">Universal Sing-Along Companion</div>
      </div>
      <div id="badge" class="status-badge">
        <span class="status-dot"></span>
        <span id="badge-text">連線中</span>
      </div>
    </div>
    <fieldset class="language-selector" style="margin-bottom:12px; padding:12px; border-radius:12px; background:rgba(255,255,255,0.05);">
      <legend>保留原文語言（非歌詞翻譯，至少選一種）</legend>
      <div class="language-options">
        <label class="chk-item"><input class="preserved-language" name="preserved-language" type="checkbox" value="zh" ${preservedLanguages.has("zh") ? "checked" : ""} onchange="updateLanguages(event)"> 保留中文</label>
        <label class="chk-item"><input class="preserved-language" name="preserved-language" type="checkbox" value="en" ${preservedLanguages.has("en") ? "checked" : ""} onchange="updateLanguages(event)"> 保留英文</label>
        <label class="chk-item"><input class="preserved-language" name="preserved-language" type="checkbox" value="ja" ${preservedLanguages.has("ja") ? "checked" : ""} onchange="updateLanguages(event)"> 保留日文</label>
        <label class="chk-item"><input class="preserved-language" name="preserved-language" type="checkbox" value="ko" ${preservedLanguages.has("ko") ? "checked" : ""} onchange="updateLanguages(event)"> 保留韓文</label>
      </div>
    </fieldset>
    <fieldset class="system-selector" style="margin-bottom:12px;">
      <legend>空耳顯示方式</legend>
      <label class="chk-item">
        <input type="radio" name="phonetic-system" value="chinese" ${selectedSystem === "chinese" ? "checked" : ""} onchange="updateSystems()"> 🀄 中文漢字
      </label>
      <label class="chk-item">
        <input type="radio" name="phonetic-system" value="latin" ${selectedSystem === "latin" ? "checked" : ""} onchange="updateSystems()"> 🔤 英文字母
      </label>
      <label class="chk-item">
        <input type="radio" name="phonetic-system" value="bopomofo" ${selectedSystem === "bopomofo" ? "checked" : ""} onchange="updateSystems()"> ㄅ 台灣注音
      </label>
    </fieldset>
    <div style="background:rgba(56, 189, 248, 0.08); border:1px solid rgba(56, 189, 248, 0.2); padding:8px 16px; border-radius:12px; margin-bottom:14px; font-size:0.8rem; color:#7dd3fc; text-align:center;">
      ✨ 選取的原文語言會維持原樣不翻譯，未選取的語言照常轉寫。
    </div>
    <!-- 全篇歌詞滾動檢視區 (全曲一次預載) -->
    <div id="lyrics-sheet" class="lyrics-sheet-container">
      <div style="text-align:center; padding: 40px; color: #64748b;">
        正在預載全篇歌詞與空耳...
      </div>
    </div>
    <!-- 手動滾動時出現的快速回正提示 -->
    <button id="btn-return" class="btn-return-sync" onclick="returnToPlaying()">
      📍 回到目前段落
    </button>

    <div class="footer">
      <div>💡 提示：顯示方式可切換漢字、注音或英文字母；原文保留設定不會翻譯歌詞</div>
      <div id="time-info">00:00</div>
    </div>
  </main>

  <script>
    const titleEl = document.getElementById("title");
    const artistEl = document.getElementById("artist");
    const sheetEl = document.getElementById("lyrics-sheet");
    const badgeTextEl = document.getElementById("badge-text");
    const timeInfoEl = document.getElementById("time-info");
    const btnReturnEl = document.getElementById("btn-return");

    let currentSheet = null;
    let activeIndex = -1;
    let manualScrollLockTimer = null;
    let isUserScrolling = false;

    // 監聽使用者手動滾動 (4 秒防干擾保護)
    sheetEl.addEventListener("wheel", triggerManualScroll);
    sheetEl.addEventListener("touchstart", triggerManualScroll);

    function triggerManualScroll() {
      isUserScrolling = true;
      btnReturnEl.style.display = "block";

      if (manualScrollLockTimer) clearTimeout(manualScrollLockTimer);
      manualScrollLockTimer = setTimeout(() => {
        isUserScrolling = false;
        btnReturnEl.style.display = "none";
      }, 4000);
    }

    function returnToPlaying() {
      isUserScrolling = false;
      btnReturnEl.style.display = "none";
      scrollToActiveLine();
    }

    function scrollToActiveLine() {
      if (isUserScrolling) return;
      const activeEl = document.querySelector(".lyric-row.active");
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    async function updateLanguages(event) {
      const preservedLanguages = Array.from(document.querySelectorAll(".preserved-language:checked"))
        .map((input) => input.value);
      if (preservedLanguages.length === 0) {
        event.currentTarget.checked = true;
        return;
      }

      const [primaryLanguage, ...passthroughLanguages] = preservedLanguages;
      const targetLocale = primaryLanguage === "zh" ? "zh-TW" : primaryLanguage;
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLocale, passthroughLanguages })
      });
    }

    async function updateSystems() {
      const selected = document.querySelector('input[name="phonetic-system"]:checked')?.value || "chinese";
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedSystems: [selected] })
      });
    }

    const events = new EventSource("/events");

    // 1. 接收全篇歌譜清單 (換歌或偏好切換時整批推播)
    events.addEventListener("lyrics-sheet", (e) => {
      const data = JSON.parse(e.data);
      if (data.track) {
        titleEl.textContent = data.track.title;
        artistEl.textContent = data.track.artists.join(", ");
      }

      currentSheet = data.sheet;
      renderFullSheet(currentSheet);
    });

    // 2. 接收每秒輕量游標更新
    events.addEventListener("playback-update", (e) => {
      const data = JSON.parse(e.data);
      const cursor = data.cursor;

      badgeTextEl.textContent = cursor.isPlaying ? "播放中" : "暫停";
      const mins = Math.floor(cursor.positionMs / 60000);
      const secs = Math.floor((cursor.positionMs % 60000) / 1000);
      timeInfoEl.textContent = String(mins).padStart(2, '0') + ":" + String(secs).padStart(2, '0');

      if (cursor.currentLineIndex !== activeIndex) {
        updateActiveLine(cursor.currentLineIndex);
      }
    });

    function renderFullSheet(sheet) {
      if (!sheet || !sheet.lines || sheet.lines.length === 0) {
        sheetEl.innerHTML = '<div style="text-align:center; padding: 40px; color: #64748b;">暫無同步歌詞</div>';
        return;
      }

      sheetEl.innerHTML = "";
      sheet.lines.forEach((line, idx) => {
        const row = document.createElement("div");
        row.className = "lyric-row" + (idx === activeIndex ? " active" : "");
        row.id = "line-" + idx;

        const origDiv = document.createElement("div");
        origDiv.className = "original-text";
        origDiv.textContent = line.originalText;

        const pronDiv = document.createElement("div");
        pronDiv.className = "blended-homophone";
        pronDiv.textContent = line.pronunciation?.displayText || "";

        row.appendChild(origDiv);
        row.appendChild(pronDiv);
        sheetEl.appendChild(row);
      });

      scrollToActiveLine();
    }

    function updateActiveLine(newIndex) {
      if (activeIndex >= 0) {
        const prevActive = document.getElementById("line-" + activeIndex);
        if (prevActive) prevActive.classList.remove("active");
      }

      activeIndex = newIndex;
      if (activeIndex !== null && activeIndex >= 0) {
        const currentActive = document.getElementById("line-" + activeIndex);
        if (currentActive) {
          currentActive.classList.add("active");
          scrollToActiveLine();
        }
      }
    }
  </script>
</body>
</html>`;
  }
}
