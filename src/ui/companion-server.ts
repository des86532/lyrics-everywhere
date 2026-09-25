import { createServer, type Server } from "node:http";
import type { ActiveLyricDisplay, PlaybackSnapshot } from "../domain/types.js";
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
        });
      });

      this.server = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

        if (url.pathname === "/events") {
          // SSE Endpoint
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });
          res.write("\n");

          const send = (data: string) => res.write(data);
          this.sseClients.add(send);

          // 初始立即送出一次當前狀態
          const initialDisplay = this.session.computeDisplay();
          res.write(
            `event: lyric-update\ndata: ${JSON.stringify({
              track: this.session.getCurrentTrack(),
              display: initialDisplay,
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
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>Universal Sing-Along Companion</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: rgba(15, 23, 42, 0.88);
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
      max-width: 640px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .track-title { font-size: 1.25rem; font-weight: 700; color: #38bdf8; }
    .track-artist { font-size: 0.875rem; color: #94a3b8; margin-top: 4px; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
    .lyrics-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      text-align: center;
      min-height: 180px;
      justify-content: center;
    }
    .prev-line, .next-line {
      font-size: 0.95rem;
      color: #64748b;
      transition: all 0.2s ease;
    }
    .current-line {
      padding: 16px;
      border-radius: 16px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
    .original-text {
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 0.05em;
    }
    .bopomofo-text {
      font-size: 1.05rem;
      font-weight: 600;
      color: #facc15;
      margin-top: 8px;
      letter-spacing: 0.08em;
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

    <div class="lyrics-container">
      <div id="prev" class="prev-line"></div>
      <div class="current-line">
        <div id="current-orig" class="original-text">♪ 準備跟唱 ♪</div>
        <div id="current-bp" class="bopomofo-text">注音發音輔助就緒</div>
      </div>
      <div id="next" class="next-line"></div>
    </div>

    <div class="progress-bar-bg">
      <div id="progress" class="progress-bar-fill"></div>
    </div>
  </div>

  <script>
    const titleEl = document.getElementById("title");
    const artistEl = document.getElementById("artist");
    const prevEl = document.getElementById("prev");
    const currOrigEl = document.getElementById("current-orig");
    const currBpEl = document.getElementById("current-bp");
    const nextEl = document.getElementById("next");
    const progressEl = document.getElementById("progress");
    const badgeTextEl = document.getElementById("badge-text");

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
        currBpEl.textContent = disp.currentLine.pronunciation?.displayText || "";
      } else {
        currOrigEl.textContent = "♪ 間奏中 ♪";
        currBpEl.textContent = "";
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
