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
  console.log(`\n[UI] 即時懸浮跟唱視圖已啟動: http://localhost:${port}`);
  console.log("[Info] 正在同步播放狀態，每秒刷新一次 (按 Ctrl+C 結束)...\n");

  // 每秒輪詢一次並在終端顯示即時行
  setInterval(async () => {
    const display = await session.tick();
    const track = session.getCurrentTrack();

    if (!track) {
      process.stdout.write("\r[等待中] 尚未偵測到播放中的曲目...               ");
      return;
    }

    const orig = display.currentLine?.originalText || "♪ 間奏中 ♪";
    const bp = display.currentLine?.pronunciation?.displayText || "";
    const timeStr = `${Math.floor(display.positionMs / 1000)}s / ${Math.floor((display.durationMs || 0) / 1000)}s`;

    process.stdout.write(
      `\r[${display.isPlaying ? "▶" : "⏸"}] ${track.artists[0]} - ${track.title} (${timeStr}) | ${orig} [注音: ${bp}]    `
    );
  }, 1000);
}

main().catch(console.error);
