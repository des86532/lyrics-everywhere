import { describe, expect, it } from "vitest";
import { MockConnector } from "../src/connectors/mock-connector.js";
import { LrclibClient } from "../src/lyrics/lrclib-client.js";
import { PlaybackSession } from "../src/session/playback-session.js";
import type { TrackMetadata } from "../src/domain/types.js";

describe("PlaybackSession Orchestrator", () => {
  const track1: TrackMetadata = {
    trackKey: "spotify:track1",
    source: { connector: "mock" },
    title: "Spring Day",
    artists: ["BTS"],
    durationMs: 270000,
  };

  const sampleLrc = `
[00:00.00]Intro
[00:10.00]보고 싶다
[00:20.00]이렇게 말하니까
[00:30.00]더 보고 싶다
  `;

  it("identifies current, previous, and next lines based on positionMs", async () => {
    const mockConnector = new MockConnector(track1);
    const mockFetch = async () =>
      new Response(JSON.stringify({ syncedLyrics: sampleLrc, duration: 270 }));

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    // 初始位置 0ms
    mockConnector.setState("playing");
    await session.tick();

    // 等待非同步 lyrics resolution 完成
    await new Promise((r) => setTimeout(r, 50));

    // 時間推移至 15000ms (15秒) -> 應該落在 [00:10.00] "보고 싶다"
    mockConnector.seek(15000);
    const display = await session.tick();

    expect(display.currentLine?.originalText).toBe("보고 싶다");
    expect(display.currentLine?.pronunciation?.displayText).toBeDefined();
    expect(display.previousLine?.originalText).toBe("Intro");
    expect(display.nextLine?.originalText).toBe("이렇게 말하니까");
    expect(display.isPlaying).toBe(true);
  });

  it("guards against stale lyric responses when switching tracks rapidly", async () => {
    const mockConnector = new MockConnector(track1);
    const pendingResolvers: ((value: Response) => void)[] = [];

    const mockFetch = () =>
      new Promise<Response>((resolve) => {
        pendingResolvers.push(resolve);
      });

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    // 觸發 track1 查詢 (pendingResolvers[0])
    await session.tick();

    // 快速切換到 track2 (pendingResolvers[1])
    const track2: TrackMetadata = {
      trackKey: "spotify:track2",
      source: { connector: "mock" },
      title: "Dynamite",
      artists: ["BTS"],
      durationMs: 200000,
    };
    mockConnector.setTrack(track2);
    await session.tick();

    // 此時 track1 (第一個請求) 的延遲回應才回來
    const resolveTrack1 = pendingResolvers[0]!;
    resolveTrack1(new Response(JSON.stringify({ syncedLyrics: sampleLrc })));
    await new Promise((r) => setTimeout(r, 50));

    // session 當前歌詞不應被 track1 的延遲回應覆蓋
    expect(session.getCurrentTrack()?.title).toBe("Dynamite");
    expect(session.getAnnotations().length).toBe(0); // track2 還沒回來，track1 被 guard 丟棄
  });
});
