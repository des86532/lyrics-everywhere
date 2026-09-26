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

  it("identifies current, previous, and next lines with Chinese homophones by default", async () => {
    const mockConnector = new MockConnector(track1);
    const mockFetch = async () =>
      new Response(JSON.stringify({ syncedLyrics: sampleLrc, duration: 270 }));

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    mockConnector.setState("playing");
    await session.tick();
    await new Promise((r) => setTimeout(r, 50));

    mockConnector.seek(15000);
    const display = await session.tick();

    expect(display.currentLine?.originalText).toBe("보고 싶다");
    expect(display.currentLine?.pronunciation?.displayText).toContain("剖勾 喜打");
    expect(display.previousLine?.originalText).toBe("Intro");
    expect(display.nextLine?.originalText).toBe("이렇게 말하니까");
    expect(display.isPlaying).toBe(true);
  });

  it("supports dynamic switching between Chinese homophone, Bopomofo, and Hybrid modes", async () => {
    const mockConnector = new MockConnector(track1);
    const mockFetch = async () =>
      new Response(JSON.stringify({ syncedLyrics: sampleLrc, duration: 270 }));

    const lyricsClient = new LrclibClient(mockFetch as unknown as typeof fetch);
    const session = new PlaybackSession(mockConnector, lyricsClient);

    mockConnector.setState("playing");
    mockConnector.seek(15000);
    await session.tick();
    await new Promise((r) => setTimeout(r, 50));

    // 1. 預設是 chinese_homophone
    let display = session.computeDisplay();
    expect(display.currentLine?.pronunciation?.displayText).toContain("剖勾 喜打");

    // 2. 切換至純注音
    session.updateProfile({ notation: "bopomofo" });
    display = session.computeDisplay();
    expect(display.currentLine?.pronunciation?.displayText).toContain("ㄅㄛ");

    // 3. 切換至 hybrid 雙排模式
    session.updateProfile({ notation: "hybrid" });
    display = session.computeDisplay();
    expect(display.currentLine?.pronunciation?.displayText).toContain("剖勾 喜打");
    expect(display.currentLine?.pronunciation?.secondaryDisplayText).toContain("ㄅㄛ");
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
    expect(session.getAnnotations().length).toBe(0);
  });
});
