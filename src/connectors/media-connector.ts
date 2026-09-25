import type { PlaybackSnapshot } from "../domain/types.js";

export interface MediaConnector {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  snapshot(): Promise<PlaybackSnapshot>;
}
