import { describe, expect, it } from "vitest";
import { WindowBuffer } from "../extension-ui/src/window-buffer.js";

describe("WindowBuffer", () => {
  it("emits twelve-second windows with a two-second overlap", () => {
    const timeline = new WindowBuffer(48000);
    const first = timeline.append(new Float32Array(12 * 48000).fill(0.25));
    expect(first).toHaveLength(1);
    expect(first[0]?.startMs).toBe(0);
    expect(first[0]?.samples).toHaveLength(12 * 48000);
    expect(first[0]?.samples[0]).toBe(0.25);

    const second = timeline.append(new Float32Array(10 * 48000).fill(0.5));
    expect(second).toHaveLength(1);
    expect(second[0]?.startMs).toBe(10000);
    expect(second[0]?.samples).toHaveLength(12 * 48000);
    expect(second[0]?.samples[0]).toBe(0.25);
    expect(second[0]?.samples[2 * 48000]).toBe(0.5);
  });

  it("drops partial windows when cleared", () => {
    const timeline = new WindowBuffer(48000);
    timeline.append(new Float32Array(8 * 48000).fill(1));
    timeline.clear();
    expect(timeline.append(new Float32Array(4 * 48000))).toHaveLength(0);
    expect(timeline.append(new Float32Array(8 * 48000))).toHaveLength(1);
    expect(timeline.append(new Float32Array(10 * 48000))).toHaveLength(1);
  });

  it("pads the final twelve-second mix window and preserves its timeline boundary", () => {
    const timeline = new WindowBuffer(16000);
    const initial = timeline.append(new Float32Array(12 * 16000).fill(0.5));
    expect(initial).toHaveLength(1);
    expect(initial[0]?.startMs).toBe(0);
    const finalInput = timeline.append(new Float32Array(2 * 16000).fill(0.25));
    expect(finalInput).toHaveLength(0);
    const final = timeline.flush();
    expect(final).toHaveLength(1);
    expect(final[0]?.startMs).toBe(10000);
    expect(final[0]?.samples[0]).toBe(0.5);
    expect(final[0]?.samples[2 * 16000]).toBe(0.25);
    expect(final[0]?.samples[4 * 16000]).toBe(0);
    expect(timeline.flush()).toHaveLength(0);
  });
});
