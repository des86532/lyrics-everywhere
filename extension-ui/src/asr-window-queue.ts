export interface IndexedAudioWindow {
  generation: number;
  windowIndex: number;
  startMs: number;
  samples: Float32Array;
}

export class AsrWindowQueue<T extends IndexedAudioWindow> {
  private readonly windows: T[] = [];

  constructor(private readonly maxOutstanding: number) {
    if (!Number.isSafeInteger(maxOutstanding) || maxOutstanding < 1) throw new RangeError("maxOutstanding must be positive");
  }

  enqueue(window: T, activeCount: number): boolean {
    if (activeCount + this.windows.length >= this.maxOutstanding) return false;
    this.windows.push(window);
    return true;
  }

  dequeue(): T | undefined {
    return this.windows.shift();
  }

  clear(): void {
    this.windows.length = 0;
  }

  get size(): number {
    return this.windows.length;
  }
}
