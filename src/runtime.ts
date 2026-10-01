import { BrowserMediaConnector } from "./connectors/browser-media-connector.js";
import { CompositeMediaConnector, type MediaSourceMode } from "./connectors/composite-media-connector.js";
import { MockConnector } from "./connectors/mock-connector.js";
import type { MediaConnector, } from "./connectors/media-connector.js";
import { SpotifyMacConnector } from "./connectors/spotify-macos.js";
import type { TrackMetadata } from "./domain/types.js";
import { LrclibClient } from "./lyrics/lrclib-client.js";
import { PlaybackSession } from "./session/playback-session.js";
import { CompanionServer } from "./ui/companion-server.js";

export interface CompanionRuntimeOptions { args?: string[]; }
export interface CompanionRuntime { port: number; stop(): Promise<void>; }

function parseSource(args: string[]): MediaSourceMode {
  const sourceIndex = args.indexOf("--source");
  const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "auto";
  if (source !== "auto" && source !== "spotify" && source !== "youtube") throw new Error("--source must be one of auto, spotify, youtube");
  return source;
}

function createDemoConnector(): MockConnector {
  const track: TrackMetadata = { trackKey: "demo:bts-spring-day", source: { connector: "mock" }, title: "봄날 (Spring Day)", artists: ["BTS (방탄소년단)"], album: "YOU NEVER WALK ALONE", durationMs: 274000 };
  const connector = new MockConnector(track);
  connector.setState("playing");
  return connector;
}

export async function startCompanion(options: CompanionRuntimeOptions = {}): Promise<CompanionRuntime> {
  const args = options.args ?? [];
  const demo = args.includes("--demo");
  const source = parseSource(args);
  let connector: MediaConnector;
  let browser: BrowserMediaConnector | undefined;

  if (demo) connector = createDemoConnector();
  else {
    browser = new BrowserMediaConnector();
    if (source === "spotify") {
      if (process.platform !== "darwin") throw new Error(process.platform === "win32" ? "Windows does not provide the macOS Spotify connector; use --source auto." : "Spotify source requires macOS");
      connector = new SpotifyMacConnector();
    } else if (source === "youtube") connector = browser;
    else if (process.platform === "darwin") connector = new CompositeMediaConnector([new SpotifyMacConnector(), browser]);
    else connector = browser;
  }

  const session = new PlaybackSession(connector, new LrclibClient());
  const server = new CompanionServer(session, 3838, browser);
  const port = await server.start();
  let running = true;
  let timer: NodeJS.Timeout | undefined;
  const poll = async (): Promise<void> => {
    if (!running) return;
    try {
      const display = await session.tick();
      const track = session.getCurrentTrack();
      if (!track) process.stdout.write("\r[等待中] 尚未偵測到播放中的曲目...               ");
      else {
        const original = display.currentLine?.originalText || "♪ 間奏中 ♪";
        const pronunciation = display.currentLine?.pronunciation?.displayText || "";
        const time = `${Math.floor(display.positionMs / 1000)}s / ${Math.floor((display.durationMs || 0) / 1000)}s`;
        process.stdout.write(`\r[${display.isPlaying ? "▶" : "⏸"}] ${track.artists[0]} - ${track.title} (${time}) | ${original} [混成: ${pronunciation}]    `);
      }
    } catch (error) { console.error("\n[Error] Playback polling failed:", error); }
    finally { if (running) timer = setTimeout(() => { void poll(); }, 1000); }
  };
  console.log(`[UI] 全曲歌詞滾動視圖已啟動: http://127.0.0.1:${port}`);
  if (browser) console.log("[Info] 請載入 browser-extension/ 到 Chrome 的 chrome://extensions");
  void poll();

  return {
    port,
    async stop() {
      if (!running) return;
      running = false;
      if (timer) clearTimeout(timer);
      await server.stop();
    },
  };
}
