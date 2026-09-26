import { describe, expect, it } from "vitest";
import { MockConnector } from "../src/connectors/mock-connector.js";
import { LrclibClient } from "../src/lyrics/lrclib-client.js";
import { PlaybackSession } from "../src/session/playback-session.js";
import type { TrackMetadata } from "../src/domain/types.js";

describe("PlaybackSession Orchestrator & Full Lyrics Sheet", () => {
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

  it("pre-loads full lyrics sheet and highlights current line with blended homophones", async () => {
    const mockConnector = new MockConnector(track1);
    const mockFetch = async () =>
      new Response(JSON.stringify({ syncedLyrics: sampleLrc, duration: 270 }));

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    mockConnector.setState("playing");
    await session.tick();
    await new Promise((r) => setTimeout(r, 50));

    // 1. 驗證全篇歌譜已完整預載
    const fullSheet = session.getFullSheet();
    expect(fullSheet).toBeDefined();
    expect(fullSheet?.status).toBe("ready");
    expect(fullSheet?.lines.length).toBe(4);
    expect(fullSheet?.lines[1]?.originalText).toBe("보고 싶다");
    expect(fullSheet?.lines[1]?.pronunciation?.displayText).toContain("剖勾 喜打");

    // 2. 時間推移至 15000ms (15秒) -> 應該高亮第 1 行 (0-indexed: [00:10.00] "보고 싶다")
    mockConnector.seek(15000);
    const display = await session.tick();

    expect(display.currentLineIndex).toBe(1);
    expect(display.currentLine?.originalText).toBe("보고 싶다");
    expect(display.currentLine?.pronunciation?.displayText).toContain("剖勾 喜打");
    expect(display.isPlaying).toBe(true);
  });

  it("re-annotates full sheet dynamically when allowedSystems change", async () => {
    const mockConnector = new MockConnector(track1);
    const mockFetch = async () =>
      new Response(JSON.stringify({ syncedLyrics: sampleLrc, duration: 270 }));

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    mockConnector.setState("playing");
    mockConnector.seek(15000);
    await session.tick();
    await new Promise((r) => setTimeout(r, 50));

    // 1. 切換至純注音
    session.updateProfile({ allowedSystems: ["bopomofo"] });
    let sheet = session.getFullSheet();
    expect(sheet?.lines[1]?.pronunciation?.displayText).toContain("ㄅㄛ");

    // 2. 切換至中文 + 英文
    session.updateProfile({ allowedSystems: ["chinese", "latin"] });
    sheet = session.getFullSheet();
    expect(sheet?.lines[1]?.pronunciation?.displayText).toContain("剖勾 喜打");
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

    await session.tick();

    const track2: TrackMetadata = {
      trackKey: "spotify:track2",
      source: { connector: "mock" },
      title: "Dynamite",
      artists: ["BTS"],
      durationMs: 200000,
    };
    mockConnector.setTrack(track2);
    await session.tick();

    const resolveTrack1 = pendingResolvers[0]!;
    resolveTrack1(new Response(JSON.stringify({ syncedLyrics: sampleLrc })));
    await new Promise((r) => setTimeout(r, 50));

    expect(session.getCurrentTrack()?.title).toBe("Dynamite");
    expect(session.getFullSheet()?.lines.length).toBe(0);
  });
});
