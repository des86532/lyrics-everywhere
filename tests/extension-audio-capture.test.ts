import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCapture, type CapturePlatform } from "../extension-ui/src/audio-capture.js";

class FakeWorkletNode {
  static instance: FakeWorkletNode | null = null;
  readonly port = { onmessage: null, close: vi.fn() };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  constructor(readonly context: unknown, readonly name: string) {
    FakeWorkletNode.instance = this;
  }
}

function setup(options: { shouldBuffer?: () => boolean } = {}) {
  const audioTrack = { stop: vi.fn(), addEventListener: vi.fn() };
  const videoTrack = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack, videoTrack],
  } as unknown as MediaStream;
  const destination = {};
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    state: "running",
    sampleRate: 48000,
    destination,
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioContext;
  let reservedTabId: number | null = null;
  const platform: CapturePlatform = {
    getMediaStreamId: vi.fn(async (tabId) => {
      if (reservedTabId !== tabId) throw new Error("Source is not reserved");
      return `tab-stream-${tabId}`;
    }),
    reserveTabCapture: vi.fn(async (tabId) => {
      if (reservedTabId !== null) throw new Error("Another capture is active");
      reservedTabId = tabId;
    }),
    releaseTabCapture: vi.fn(async (tabId) => {
      if (reservedTabId !== tabId) throw new Error("Cannot release another source");
      reservedTabId = null;
    }),
    getUserMedia: vi.fn(async (streamId) => {
      if (streamId !== `tab-stream-${reservedTabId}`) throw new Error("Wrong source stream");
      return stream;
    }),
    createAudioContext: vi.fn(() => context),
  };
  const progress = vi.fn();
  const capture = new AudioCapture({ mode: "mix-first", onWindow: vi.fn(), onError: vi.fn(), onEnded: vi.fn(), shouldBuffer: options.shouldBuffer, onProgress: progress }, platform);
  return { capture, platform, progress, reservedTabId: () => reservedTabId };
}

afterEach(() => vi.unstubAllGlobals());

function sendSamples(samples: number): void {
  FakeWorkletNode.instance?.port.onmessage?.({ data: new Float32Array(samples) } as MessageEvent<Float32Array>);
}

describe("extension tab audio capture progress", () => {
  it("counts only PCM frames allowed by the playback gate at the source sample rate", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    let shouldBuffer = false;
    const state = setup({ shouldBuffer: () => shouldBuffer });
    await state.capture.start(42);

    sendSamples(48_000);
    expect(state.progress).not.toHaveBeenCalled();
    shouldBuffer = true;
    sendSamples(24_000);
    expect(state.progress).not.toHaveBeenCalled();
    sendSamples(24_000);
    expect(state.progress).toHaveBeenCalledOnce();
    expect(state.progress).toHaveBeenCalledWith(1000);

    await state.capture.stop();
  });

  it("resets received sample progress for each capture session", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const state = setup();
    await state.capture.start(42);
    sendSamples(48_000);
    expect(state.progress).toHaveBeenLastCalledWith(1000);

    await state.capture.stop();
    await state.capture.start(42);
    sendSamples(24_000);
    expect(state.progress).toHaveBeenCalledOnce();
    sendSamples(24_000);
    expect(state.progress).toHaveBeenCalledTimes(2);
    expect(state.progress).toHaveBeenLastCalledWith(1000);
    await state.capture.stop();
  });

  it("ignores worklet callbacks after stop", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const state = setup();
    await state.capture.start(42);
    const onmessage = FakeWorkletNode.instance?.port.onmessage;
    await state.capture.stop();

    onmessage?.({ data: new Float32Array(48_000) } as MessageEvent<Float32Array>);
    expect(state.progress).not.toHaveBeenCalled();
  });
});

describe("extension tab audio capture", () => {
  it("releases the source on stop so another source can receive audio", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const state = setup();
    await state.capture.start(42);
    expect(state.reservedTabId()).toBe(42);
    await state.capture.stop();
    expect(state.reservedTabId()).toBeNull();
    await state.capture.start(77);
    sendSamples(48_000);
    expect(state.reservedTabId()).toBe(77);
    expect(state.progress).toHaveBeenLastCalledWith(1000);
    await state.capture.stop();
  });

  it("leaves the existing source reserved when another capture is denied", async () => {
    const state = setup();
    await state.platform.reserveTabCapture(88, "mix-first");
    await expect(state.capture.start(9)).rejects.toThrow("Another capture is active");
    expect(state.reservedTabId()).toBe(88);
  });

  it("releases the source after media permission is rejected so retry can capture", async () => {
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    const state = setup();
    vi.mocked(state.platform.getUserMedia).mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await expect(state.capture.start(12)).rejects.toThrow("分頁音訊擷取遭拒");
    expect(state.reservedTabId()).toBeNull();
    await state.capture.start(12);
    sendSamples(48_000);
    expect(state.progress).toHaveBeenLastCalledWith(1000);
    await state.capture.stop();
  });
});
