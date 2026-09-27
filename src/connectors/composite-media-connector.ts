import type { PlaybackSnapshot } from "../domain/types.js";
import type { MediaConnector } from "./media-connector.js";

export type MediaSourceMode = "auto" | "spotify" | "youtube";

type Candidate = { connector: MediaConnector; snapshot: PlaybackSnapshot };

export class CompositeMediaConnector implements MediaConnector {
  readonly name = "composite";
  private eventSeq = 0;
  private activeName?: string;
  private readonly priority: string[];

  constructor(private readonly connectors: MediaConnector[], private readonly mode: MediaSourceMode = "auto", priority = ["spotify-macos", "browser"]) {
    this.priority = priority;
  }

  async isAvailable(): Promise<boolean> { return (await this.snapshot()).state !== "unavailable"; }

  async snapshot(): Promise<PlaybackSnapshot> {
    const candidates = await Promise.all(this.connectors.map(async (connector): Promise<Candidate> => {
      try { return { connector, snapshot: await connector.snapshot() }; }
      catch { return { connector, snapshot: { eventSeq: 0, state: "unavailable", sampledAtMs: Date.now(), playbackRate: 0 } }; }
    }));
    const selected = this.select(candidates);
    this.eventSeq += 1;
    if (!selected) return { eventSeq: this.eventSeq, state: "unavailable", sampledAtMs: Date.now(), playbackRate: 0 };
    this.activeName = selected.connector.name;
    return { ...selected.snapshot, eventSeq: this.eventSeq };
  }

  private select(candidates: Candidate[]): Candidate | undefined {
    const usable = candidates.filter(({ snapshot }) => snapshot.state !== "unavailable" && snapshot.track).filter(({ connector }) => this.isAllowed(connector.name));
    if (usable.length === 0) return undefined;
    const active = usable.find(({ connector }) => connector.name === this.activeName);
    if (this.mode === "auto" && active?.snapshot.state === "playing") return active;
    const playing = usable.filter(({ snapshot }) => snapshot.state === "playing");
    if (playing.length > 0) {
      if (this.mode === "auto" && active && active.snapshot.state === "playing") return active;
      return this.byPriority(playing)[0];
    }
    if (active) return active;
    return this.byPriority(usable)[0];
  }

  private byPriority(candidates: Candidate[]): Candidate[] { return [...candidates].sort((a, b) => this.rank(a.connector.name) - this.rank(b.connector.name)); }
  private rank(name: string): number { const index = this.priority.indexOf(name); return index === -1 ? this.priority.length : index; }
  private isAllowed(name: string): boolean { return this.mode === "auto" || (this.mode === "spotify" ? name === "spotify-macos" : name === "browser"); }
}
