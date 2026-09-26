import { createServer, type Server } from "node:http";
import type { ActiveLyricDisplay, PronunciationNotation } from "../domain/types.js";
import type { PlaybackSession } from "../session/playback-session.js";

export class CompanionServer {
  private server?: Server;
  private sseClients = new Set<(data: string) => void>();

  constructor(private session: PlaybackSession, private port = 3838) {}

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.session.subscribe((display) => {
        this.broadcast("lyric-update", {
          track: this.session.getCurrentTrack(),
          display,
          notation: this.session.getProfile().notation,
        });
      });

      this.server = createServer(async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

        // API: 更新發音偏好
        if (req.method === "POST" && url.pathname === "/api/profile") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const data = JSON.parse(body || "{}");
              if (data.notation) {
                this.session.updateProfile({ notation: data.notation as PronunciationNotation });
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, profile: this.session.getProfile() }));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        // SSE: 即時推播
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

          const initialDisplay = this.session.computeDisplay();
          res.write(
            `event: lyric-update\ndata: ${JSON.stringify({
              track: this.session.getCurrentTrack(),
              display: initialDisplay,
              notation: this.session.getProfile().notation,
            })}\n\n`
          );

          req.on("close", () => {
            this.sseClients.delete(send);
          });
          return;
        }

        // 預設首頁：提供極致流暢的 Sing-Along Overlay 介面
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(this.renderHtml());
      });

      this.server.listen(this.port, () => {
        resolve(this.port);
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
    const currentNotation = this.session.getProfile().notation;
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>Universal Sing-Along Companion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 24px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .card {
      width: 100%;
      max-width: 680px;
      background: rgba(30, 41, 59, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .track-title { font-size: 1.35rem; font-weight: 800; color: #38bdf8; }
    .track-artist { font-size: 0.9rem; color: #94a3b8; margin-top: 4px; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 14px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }

    /* 模式控制列 */
    .controls {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      background: rgba(15, 23, 42, 0.6);
      padding: 6px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .btn-mode {
      flex: 1;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: #94a3b8;
      border-radius: 10px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-mode:hover { color: #f8fafc; background: rgba(255, 255, 255, 0.05); }
    .btn-mode.active {
      background: #38bdf8;
      color: #0f172a;
      font-weight: 700;
      box-shadow: 0 2px 8px rgba(56, 189, 248, 0.4);
    }

    .lyrics-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      text-align: center;
      min-height: 200px;
      justify-content: center;
    }
    .prev-line, .next-line {
      font-size: 1rem;
      color: #64748b;
      transition: all 0.2s ease;
    }
    .current-line {
      padding: 20px;
      border-radius: 20px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .original-text {
      font-size: 1.8rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 0.04em;
    }
    .phonetic-primary {
      font-size: 1.25rem;
      font-weight: 700;
      color: #facc15;
      margin-top: 10px;
      letter-spacing: 0.06em;
    }
    .phonetic-secondary {
      font-size: 0.95rem;
      font-weight: 600;
      color: #38bdf8;
      margin-top: 6px;
      letter-spacing: 0.05em;
    }

    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      margin-top: 24px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: #38bdf8;
      width: 0%;
      transition: width 0.3s ease;
    }
    .disclaimer {
      margin-top: 16px;
      text-align: center;
      font-size: 0.75rem;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div id="title" class="track-title">等待播放來源...</div>
        <div id="artist" class="track-artist">Universal Sing-Along Companion</div>
      </div>
      <div id="badge" class="status-badge">
        <span class="status-dot"></span>
        <span id="badge-text">連線中</span>
      </div>
    </div>

    <!-- 模式切換按鈕列 -->
    <div class="controls">
      <button class="btn-mode ${currentNotation === "chinese_homophone" ? "active" : ""}" onclick="switchMode('chinese_homophone')">🀄 中文空耳</button>
      <button class="btn-mode ${currentNotation === "bopomofo" ? "active" : ""}" onclick="switchMode('bopomofo')">ㄅ 純注音</button>
      <button class="btn-mode ${currentNotation === "hybrid" ? "active" : ""}" onclick="switchMode('hybrid')">🀄+ㄅ 雙排</button>
    </div>

    <div class="lyrics-container">
      <div id="prev" class="prev-line"></div>
      <div class="current-line">
        <div id="current-orig" class="original-text">♪ 準備跟唱 ♪</div>
        <div id="current-pron" class="phonetic-primary">發音輔助就緒</div>
        <div id="current-sub-pron" class="phonetic-secondary" style="display:none;"></div>
      </div>
      <div id="next" class="next-line"></div>
    </div>

    <div class="progress-bar-bg">
      <div id="progress" class="progress-bar-fill"></div>
    </div>

    <div class="disclaimer">
      💡 提示：中文字諧音為跟唱發音輔助（空耳），非歌詞直譯
    </div>
  </div>

  <script>
    const titleEl = document.getElementById("title");
    const artistEl = document.getElementById("artist");
    const prevEl = document.getElementById("prev");
    const currOrigEl = document.getElementById("current-orig");
    const currPronEl = document.getElementById("current-pron");
    const currSubPronEl = document.getElementById("current-sub-pron");
    const nextEl = document.getElementById("next");
    const progressEl = document.getElementById("progress");
    const badgeTextEl = document.getElementById("badge-text");

    async function switchMode(notation) {
      document.querySelectorAll(".btn-mode").forEach(btn => btn.classList.remove("active"));
      event.target.classList.add("active");
      await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notation })
      });
    }

    const events = new EventSource("/events");
    events.addEventListener("lyric-update", (e) => {
      const data = JSON.parse(e.data);
      if (data.track) {
        titleEl.textContent = data.track.title;
        artistEl.textContent = data.track.artists.join(", ");
        badgeTextEl.textContent = data.display.isPlaying ? "播放中" : "暫停";
      }

      const disp = data.display;
      if (disp.currentLine) {
        currOrigEl.textContent = disp.currentLine.originalText;
        const pron = disp.currentLine.pronunciation;
        if (pron) {
          currPronEl.textContent = pron.displayText || "";
          if (pron.secondaryDisplayText) {
            currSubPronEl.textContent = pron.secondaryDisplayText;
            currSubPronEl.style.display = "block";
          } else {
            currSubPronEl.style.display = "none";
          }
        } else {
          currPronEl.textContent = "";
          currSubPronEl.style.display = "none";
        }
      } else {
        currOrigEl.textContent = "♪ 間奏中 ♪";
        currPronEl.textContent = "";
        currSubPronEl.style.display = "none";
      }

      prevEl.textContent = disp.previousLine?.originalText || "";
      nextEl.textContent = disp.nextLine?.originalText || "";
      progressEl.style.width = (disp.progressPercent || 0) + "%";
    });
  </script>
</body>
</html>`;
  }
}
