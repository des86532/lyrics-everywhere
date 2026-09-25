import type { PlaybackSnapshot, PlaybackState, TrackMetadata } from "../domain/types.js";
import type { MediaConnector } from "./media-connector.js";

export class MockConnector implements MediaConnector {
  readonly name = "mock";
  private eventSeq = 0;
  private track?: TrackMetadata;
  private state: PlaybackState = "stopped";
  private positionMs = 0;
  private lastSampledAt = Date.now();

  constructor(initialTrack?: TrackMetadata) {
    this.track = initialTrack;
  }

  setTrack(track: TrackMetadata) {
    this.track = track;
    this.positionMs = 0;
    this.lastSampledAt = Date.now();
  }

  setState(state: PlaybackState) {
    this.state = state;
    this.lastSampledAt = Date.now();
  }

  seek(positionMs: number) {
    this.positionMs = positionMs;
    this.lastSampledAt = Date.now();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async snapshot(): Promise<PlaybackSnapshot> {
    const now = Date.now();
    this.eventSeq++;

    if (this.state === "playing") {
      const elapsed = now - this.lastSampledAt;
      this.positionMs += elapsed;
      if (this.track?.durationMs && this.positionMs > this.track.durationMs) {
        this.positionMs = this.track.durationMs;
        this.state = "stopped";
      }
    }
    this.lastSampledAt = now;

    return {
      eventSeq: this.eventSeq,
      track: this.track,
      state: this.state,
      positionMs: this.positionMs,
      sampledAtMs: now,
      playbackRate: this.state === "playing" ? 1 : 0,
    };
  }
}
