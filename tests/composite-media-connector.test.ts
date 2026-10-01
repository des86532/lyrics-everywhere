import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot } from "../src/domain/types.js";
import { CompositeMediaConnector } from "../src/connectors/composite-media-connector.js";
import type { MediaConnector } from "../src/connectors/media-connector.js";

function fixedConnector(name: string, snapshot: PlaybackSnapshot): MediaConnector {
  return { name, isAvailable: async () => snapshot.state !== "unavailable", snapshot: async () => snapshot };
}
function track(key: string) { return { trackKey: key, source: { connector: key.startsWith("spotify") ? "spotify-macos" as const : "browser" as const }, title: key, artists: ["artist"] }; }

describe("CompositeMediaConnector", () => {
  it("keeps a playing active source sticky and switches from paused to newly playing", async () => {
    let spotify: PlaybackSnapshot = { eventSeq: 1, state: "playing", track: track("spotify:one"), positionMs: 1, sampledAtMs: 1, playbackRate: 1 };
    let youtube: PlaybackSnapshot = { eventSeq: 1, state: "paused", track: track("youtube:two"), positionMs: 1, sampledAtMs: 1, playbackRate: 0 };
    const spotifyConnector = { name: "spotify-macos", isAvailable: async () => true, snapshot: async () => spotify };
    const youtubeConnector = { name: "browser", isAvailable: async () => true, snapshot: async () => youtube };
    const composite = new CompositeMediaConnector([spotifyConnector, youtubeConnector]);
    await expect(composite.snapshot()).resolves.toMatchObject({ track: { trackKey: "spotify:one" } });
    spotify = { ...spotify, state: "paused", playbackRate: 0 };
    youtube = { ...youtube, state: "playing", playbackRate: 1 };
    await expect(composite.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:two" }, state: "playing" });
  });

  it("isolates a failed connector and supports forced YouTube mode", async () => {
    const failed: MediaConnector = { name: "spotify-macos", isAvailable: async () => false, snapshot: async () => { throw new Error("offline"); } };
    const youtube = fixedConnector("browser", { eventSeq: 2, state: "playing", track: track("youtube:two"), positionMs: 2, sampledAtMs: 2, playbackRate: 1 });
    const composite = new CompositeMediaConnector([failed, youtube], "youtube");
    await expect(composite.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:two" }, eventSeq: 1 });
  });

  it("prefers Chrome over SMTC when both are already playing in Windows auto mode", async () => {
    const browser = fixedConnector("browser", { eventSeq: 1, state: "playing", track: { ...track("youtube:one"), source: { connector: "browser" } }, positionMs: 4, sampledAtMs: 1, playbackRate: 1 });
    const smtc = fixedConnector("windows-smtc", { eventSeq: 1, state: "playing", track: { ...track("windows:two"), source: { connector: "windows-smtc" } }, positionMs: 9, sampledAtMs: 1, playbackRate: 1 });
    const composite = new CompositeMediaConnector([smtc, browser], "auto", ["browser", "windows-smtc"]);
    await expect(composite.snapshot()).resolves.toMatchObject({ track: { trackKey: "youtube:one" }, state: "playing" });
  });
});
