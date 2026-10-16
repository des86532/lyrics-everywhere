export interface AudioWindow {
  startMs: number;
  samples: Float32Array<ArrayBuffer>;
  final?: boolean;
}

export const WINDOW_SECONDS = 12;
export const STEP_SECONDS = 10;

export class WindowBuffer {
  private readonly capacity: number;
  private readonly stepSamples: number;
  private readonly buffer: Float32Array;
  private totalSamples = 0;
  private nextWindowEnd: number;
  private emittedThroughSample = 0;

  constructor(private readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError("sampleRate must be positive");
    this.capacity = Math.round(sampleRate * WINDOW_SECONDS);
    this.stepSamples = Math.round(sampleRate * STEP_SECONDS);
    this.buffer = new Float32Array(this.capacity);
    this.nextWindowEnd = this.capacity;
  }

  append(samples: Float32Array): AudioWindow[] {
    const windows: AudioWindow[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const untilWindow = this.nextWindowEnd - this.totalSamples;
      const length = Math.min(samples.length - offset, untilWindow);
      this.write(samples.subarray(offset, offset + length));
      offset += length;
      if (this.totalSamples === this.nextWindowEnd) {
        const startSample = this.totalSamples - this.capacity;
        windows.push(this.createWindow(startSample));
        this.emittedThroughSample = this.totalSamples;
        this.nextWindowEnd += this.stepSamples;
      }
    }
    return windows;
  }

  flush(): AudioWindow[] {
    if (this.totalSamples === 0 || this.totalSamples <= this.emittedThroughSample) return [];
    const startSample = this.nextWindowEnd - this.capacity;
    this.emittedThroughSample = this.totalSamples;
    return [{ ...this.createWindow(startSample), final: true }];
  }

  clear(): void {
    this.buffer.fill(0);
    this.totalSamples = 0;
    this.emittedThroughSample = 0;
    this.nextWindowEnd = this.capacity;
  }

  private createWindow(startSample: number): AudioWindow {
    const result = new Float32Array(this.capacity);
    const availableStart = Math.max(startSample, 0);
    const availableEnd = Math.min(startSample + this.capacity, this.totalSamples);
    let sourceSample = availableStart;
    let destinationOffset = availableStart - startSample;
    while (sourceSample < availableEnd) {
      const sourceIndex = sourceSample % this.capacity;
      const length = Math.min(availableEnd - sourceSample, this.capacity - sourceIndex);
      result.set(this.buffer.subarray(sourceIndex, sourceIndex + length), destinationOffset);
      sourceSample += length;
      destinationOffset += length;
    }
    return { startMs: Math.round(startSample * 1000 / this.sampleRate), samples: result };
  }

  private write(samples: Float32Array): void {
    const start = this.totalSamples % this.capacity;
    const firstLength = Math.min(samples.length, this.capacity - start);
    this.buffer.set(samples.subarray(0, firstLength), start);
    if (firstLength < samples.length) this.buffer.set(samples.subarray(firstLength), 0);
    this.totalSamples += samples.length;
  }
}
