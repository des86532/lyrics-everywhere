import { describe, expect, it } from "vitest";
import { AsrWindowQueue, type IndexedAudioWindow } from "../extension-ui/src/asr-window-queue.js";

const windowAt = (windowIndex: number): IndexedAudioWindow => ({
  generation: 3,
  windowIndex,
  startMs: windowIndex * 10000,
  samples: new Float32Array(1),
});

describe("ASR window queue", () => {
  it("preserves FIFO order and rejects the seventh outstanding window without dropping earlier windows", () => {
    const queue = new AsrWindowQueue<IndexedAudioWindow>(6);
    expect(queue.enqueue(windowAt(1), 3)).toBe(true);
    expect(queue.enqueue(windowAt(2), 3)).toBe(true);
    expect(queue.enqueue(windowAt(3), 3)).toBe(true);
    expect(queue.enqueue(windowAt(4), 3)).toBe(true);
    expect(queue.enqueue(windowAt(5), 3)).toBe(true);
    expect(queue.enqueue(windowAt(6), 3)).toBe(false);
    expect(Array.from({ length: 5 }, () => queue.dequeue()?.windowIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(queue.dequeue()).toBeUndefined();
  });

  it("clears stale queued generations after cancellation", () => {
    const queue = new AsrWindowQueue<IndexedAudioWindow>(6);
    queue.enqueue(windowAt(0), 3);
    queue.enqueue({ ...windowAt(0), generation: 4, windowIndex: 1 }, 4);
    queue.clear();
    expect(queue.size).toBe(0);
  });

  it("does not count a stale in-flight generation against the new generation capacity", () => {
    const queue = new AsrWindowQueue<IndexedAudioWindow>(2);
    expect(queue.enqueue({ ...windowAt(0), generation: 4 }, 3)).toBe(true);
    queue.clear();
    expect(queue.enqueue({ ...windowAt(0), generation: 4 }, 3)).toBe(true);
    expect(queue.enqueue({ ...windowAt(1), generation: 4 }, 3)).toBe(true);
    expect(queue.enqueue({ ...windowAt(2), generation: 4 }, 3)).toBe(false);
    expect(queue.enqueue({ ...windowAt(2), generation: 4 }, null)).toBe(false);
  });

  it("counts an in-flight window of the same generation", () => {
    const queue = new AsrWindowQueue<IndexedAudioWindow>(2);
    expect(queue.enqueue(windowAt(1), 3)).toBe(true);
    expect(queue.enqueue(windowAt(2), 3)).toBe(false);
  });
});
