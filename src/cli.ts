import { BrowserMediaConnector } from "./connectors/browser-media-connector.js";
import { CompositeMediaConnector, type MediaSourceMode } from "./connectors/composite-media-connector.js";
import { MockConnector } from "./connectors/mock-connector.js";
import type { MediaConnector } from "./connectors/media-connector.js";
import { SpotifyMacConnector } from "./connectors/spotify-macos.js";
import type { TrackMetadata } from "./domain/types.js";
import { LrclibClient } from "./lyrics/lrclib-client.js";
import { PlaybackSession } from "./session/playback-session.js";
import { CompanionServer } from "./ui/companion-server.js";

function parseSource(args: string[]): MediaSourceMode {
  const sourceIndex = args.indexOf("--source");
  const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "auto";
  if (source !== "auto" && source !== "spotify" && source !== "youtube") throw new Error("--source must be one of auto, spotify, youtube");
  return source;
}

function createDemoConnector(): MockConnector {
  const demoTrack: TrackMetadata = { trackKey: "demo:bts-spring-day", source: { connector: "mock" }, title: "봄날 (Spring Day)", artists: ["BTS (방탄소년단)"], album: "YOU NEVER WALK ALONE", durationMs: 274000 };
  const mock = new MockConnector(demoTrack);
  mock.setState("playing");
  return mock;
}

async function main() {
  const args = process.argv.slice(2);
  const isDemo = args.includes("--demo");
  const source = parseSource(args);
  console.log("=========================================");
  console.log("  Universal Sing-Along Companion (MVP)   ");
  console.log("  - 全曲歌詞預載 & 單行混成空耳跟唱引擎 -   ");
  console.log("=========================================");

  let connector: MediaConnector;
  let browserConnector: BrowserMediaConnector | undefined;
  if (isDemo) {
    console.log("模式: 示範模擬模式 (Demo Mode)");
    connector = createDemoConnector();
  } else {
    browserConnector = new BrowserMediaConnector();
    if (source === "spotify") {
      if (process.platform !== "darwin") throw new Error("Spotify source requires macOS");
      console.log("模式: macOS Spotify Desktop 串接模式");
      connector = new SpotifyMacConnector();
    } else if (source === "youtube") {
      console.log("模式: YouTube Browser Extension 串接模式");
      connector = browserConnector;
    } else if (process.platform === "darwin") {
      console.log("模式: Spotify + YouTube 自動來源模式");
      connector = new CompositeMediaConnector([new SpotifyMacConnector(), browserConnector]);
    } else {
      console.log("模式: YouTube Browser Extension 等待模式");
      connector = browserConnector;
    }
  }

  const session = new PlaybackSession(connector, new LrclibClient());
  const server = new CompanionServer(session, 3838, browserConnector);
  const port = await server.start();
  console.log("\n[UI] 全曲歌詞滾動視圖已啟動: http://localhost:" + port);
  console.log("[Info] 支援多拼音系統混成 (中文 + 英文/注音)");
  if (browserConnector) console.log("[Info] 請載入 browser-extension/ 到 Chrome 的 chrome://extensions");
  console.log("[Info] 正在同步播放狀態，每秒刷新一次 (按 Ctrl+C 結束)...\n");

  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    await server.stop();
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });

  const poll = async (): Promise<void> => {
    if (!running) return;
    try {
      const display = await session.tick();
      const track = session.getCurrentTrack();
      if (!track) {
        process.stdout.write("\r[等待中] 尚未偵測到播放中的曲目...               ");
      } else {
        const orig = display.currentLine?.originalText || "♪ 間奏中 ♪";
        const pron = display.currentLine?.pronunciation?.displayText || "";
        const timeStr = Math.floor(display.positionMs / 1000) + "s / " + Math.floor((display.durationMs || 0) / 1000) + "s";
        const state = display.isPlaying ? "▶" : "⏸";
        process.stdout.write("\r[" + state + "] " + track.artists[0] + " - " + track.title + " (" + timeStr + ") | " + orig + " [混成: " + pron + "]    ");
      }
    } catch (error) {
      console.error("\n[Error] Playback polling failed:", error);
    } finally {
      if (running) setTimeout(() => { void poll(); }, 1000);
    }
  };
  void poll();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
