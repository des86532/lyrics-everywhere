export interface TimestampedChunk {
  timestamp: [number | null, number | null];
  text: string;
}

export interface TranscriptLine {
  startMs: number;
  endMs: number;
  text: string;
}

export class TranscriptLines {
  private committedEndMs = -1;

  append(startMs: number, chunks: TimestampedChunk[], { windowMs, commitBeforeMs }: { windowMs?: number; commitBeforeMs?: number } = {}): TranscriptLine[] {
    const lines: TranscriptLine[] = [];
    for (const chunk of chunks) {
      const [relativeStart, rawRelativeEnd] = chunk.timestamp;
      const text = chunk.text.trim();
      if (!text || relativeStart === null || rawRelativeEnd === null || !Number.isFinite(relativeStart) || !Number.isFinite(rawRelativeEnd) || rawRelativeEnd <= relativeStart) continue;
      if (windowMs !== undefined && relativeStart * 1000 >= windowMs) continue;
      if (commitBeforeMs !== undefined && relativeStart * 1000 >= commitBeforeMs) continue;
      const relativeEnd = windowMs === undefined ? rawRelativeEnd : Math.min(rawRelativeEnd, windowMs / 1000);
      const absoluteStart = Math.round(startMs + relativeStart * 1000);
      const absoluteEnd = Math.round(startMs + relativeEnd * 1000);
      if (absoluteStart < this.committedEndMs || absoluteEnd <= this.committedEndMs) continue;
      lines.push({ startMs: absoluteStart, endMs: absoluteEnd, text });
      this.committedEndMs = Math.max(this.committedEndMs, absoluteEnd);
    }
    return lines;
  }

  clear(): void {
    this.committedEndMs = -1;
  }
}
