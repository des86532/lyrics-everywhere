import { MockConnector } from "./connectors/mock-connector.js";
import { SpotifyMacConnector } from "./connectors/spotify-macos.js";
import type { TrackMetadata } from "./domain/types.js";
import { LrclibClient } from "./lyrics/lrclib-client.js";
import { PlaybackSession } from "./session/playback-session.js";
import { CompanionServer } from "./ui/companion-server.js";

async function main() {
  const args = process.argv.slice(2);
  const isDemo = args.includes("--demo");

  console.log("=========================================");
  console.log("  Universal Sing-Along Companion (MVP)   ");
  console.log("  - 全曲歌詞預載 & 單行混成空耳跟唱引擎 -   ");
  console.log("=========================================");

  let connector;
  if (isDemo || process.platform !== "darwin") {
    console.log("模式: 示範模擬模式 (Demo Mode)");
    const demoTrack: TrackMetadata = {
      trackKey: "demo:bts-spring-day",
      source: { connector: "mock" },
      title: "봄날 (Spring Day)",
      artists: ["BTS (방탄소년단)"],
      album: "YOU NEVER WALK ALONE",
      durationMs: 274000,
    };
    const mock = new MockConnector(demoTrack);
    mock.setState("playing");
    connector = mock;
  } else {
    console.log("模式: macOS Spotify Desktop 串接模式");
    connector = new SpotifyMacConnector();
  }

  const lyricsClient = new LrclibClient();
  const session = new PlaybackSession(connector, lyricsClient);
  const server = new CompanionServer(session, 3838);

  const port = await server.start();
  console.log(`\n[UI] 全曲歌詞滾動視圖已啟動: http://localhost:${port}`);
  console.log("[Info] 支援多拼音系統混成 (中文 + 英文/注音)");
  console.log("[Info] 正在同步播放狀態，每秒刷新一次 (按 Ctrl+C 結束)...\n");

  setInterval(async () => {
    const display = await session.tick();
    const track = session.getCurrentTrack();

    if (!track) {
      process.stdout.write("\r[等待中] 尚未偵測到播放中的曲目...               ");
      return;
    }

    const orig = display.currentLine?.originalText || "♪ 間奏中 ♪";
    const pron = display.currentLine?.pronunciation?.displayText || "";
    const timeStr = `${Math.floor(display.positionMs / 1000)}s / ${Math.floor((display.durationMs || 0) / 1000)}s`;

    process.stdout.write(
      `\r[${display.isPlaying ? "▶" : "⏸"}] ${track.artists[0]} - ${track.title} (${timeStr}) | ${orig} [混成: ${pron}]    `
    );
  }, 1000);
}

main().catch(console.error);
