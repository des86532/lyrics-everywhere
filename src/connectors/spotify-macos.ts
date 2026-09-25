import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PlaybackSnapshot, PlaybackState, TrackMetadata } from "../domain/types.js";
import type { MediaConnector } from "./media-connector.js";

const execFileAsync = promisify(execFile);

export class SpotifyMacConnector implements MediaConnector {
  readonly name = "spotify-macos";
  private eventSeq = 0;

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false;
    try {
      const script = `
        tell application "System Events"
          return (count (every process whose name is "Spotify")) > 0
        end tell
      `;
      const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 1500 });
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async snapshot(): Promise<PlaybackSnapshot> {
    const sampledAtMs = Date.now();
    this.eventSeq++;

    if (process.platform !== "darwin") {
      return {
        eventSeq: this.eventSeq,
        state: "unavailable",
        sampledAtMs,
        playbackRate: 0,
      };
    }

    try {
      const script = `
        tell application "System Events"
          set isRunning to (count (every process whose name is "Spotify")) > 0
        end tell
        if isRunning then
          tell application "Spotify"
            set pState to player state as string
            set cTrack to name of current track
            set cArtist to artist of current track
            set cAlbum to album of current track
            set cDuration to duration of current track
            set cPosition to player position
            set cId to id of current track
            return pState & "|||" & cTrack & "|||" & cArtist & "|||" & cAlbum & "|||" & cDuration & "|||" & cPosition & "|||" & cId
          end tell
        else
          return "stopped"
        end if
      `;

      const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 2000 });
      const raw = stdout.trim();

      if (!raw || raw === "stopped") {
        return {
          eventSeq: this.eventSeq,
          state: "stopped",
          sampledAtMs,
          playbackRate: 0,
        };
      }

      const parts = raw.split("|||");
      if (parts.length < 7) {
        return {
          eventSeq: this.eventSeq,
          state: "unavailable",
          sampledAtMs,
          playbackRate: 0,
        };
      }

      const [pState, title, artist, album, durationMsStr, positionSecStr, sourceTrackId] = parts;
      const stateMap: Record<string, PlaybackState> = {
        playing: "playing",
        paused: "paused",
        stopped: "stopped",
      };
      const state: PlaybackState = stateMap[pState?.toLowerCase() || ""] || "stopped";
      const positionMs = Math.round((Number.parseFloat(positionSecStr || "0") || 0) * 1000);
      const durationMs = Number.parseInt(durationMsStr || "0", 10) || 0;

      const track: TrackMetadata = {
        trackKey: `spotify:${(sourceTrackId || "").replace("spotify:track:", "") || `${artist}-${title}`}`,
        source: {
          connector: "spotify-macos",
          sourceTrackId,
        },
        title: title || "Unknown Title",
        artists: artist ? [artist] : ["Unknown Artist"],
        album: album || undefined,
        durationMs,
      };

      return {
        eventSeq: this.eventSeq,
        track,
        state,
        positionMs,
        sampledAtMs,
        playbackRate: state === "playing" ? 1 : 0,
      };
    } catch {
      return {
        eventSeq: this.eventSeq,
        state: "unavailable",
        sampledAtMs,
        playbackRate: 0,
      };
    }
  }
}
