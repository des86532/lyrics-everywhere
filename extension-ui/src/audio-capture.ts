import { WindowBuffer, type AudioWindow } from "./window-buffer.js";

export interface CaptureOptions {
  mode: "mix-first";
  onWindow(window: AudioWindow): void;
  onError(message: string): void;
  onEnded(): void;
  shouldBuffer?(): boolean;
  onProgress?(capturedMs: number): void;
}

export interface CapturePlatform {
  getMediaStreamId(targetTabId: number): Promise<string>;
  reserveTabCapture(targetTabId: number, mode: "mix-first"): Promise<void>;
  releaseTabCapture(targetTabId: number): Promise<void>;
  getUserMedia(streamId: string): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}

interface ChromePortListener<T> {
  addListener(callback: (message: T) => void): void;
  removeListener(callback: (message: T) => void): void;
}

interface ChromePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ChromePortListener<unknown>;
  onDisconnect: ChromePortListener<void>;
}

interface ChromeCaptureApi {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    connect?(info: { name: string }): ChromePort;
  };
  tabCapture?: { getMediaStreamId(options: { targetTabId: number }): Promise<string> };
}

function createExtensionPlatform(): CapturePlatform {
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeCaptureApi }).chrome;
  const tabCapture = chromeApi?.tabCapture;
  if (!chromeApi || !tabCapture || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("此功能需要支援 tabCapture 的桌面 Chrome 或 Edge 擴充功能側欄。");
  }
  let activePortState: { port: ChromePort; tabId: number; intervalId: number } | null = null;
  return {
    async reserveTabCapture(targetTabId, mode) {
      if (!chromeApi.runtime.connect) {
        throw new Error("擴充功能不支援 Port 連線。");
      }
      const port = chromeApi.runtime.connect({ name: "tab-capture" });
      const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const handleDisconnect = () => {
          port.onMessage.removeListener(handleMessage);
          port.onDisconnect.removeListener(handleDisconnect);
          resolve({ ok: false, error: "擴充功能背景程式已中斷，請重試。" });
        };
        const handleMessage = (msg: unknown) => {
          if (msg && typeof msg === "object" && "type" in msg && msg.type === "reserve-tab-capture-result") {
            port.onMessage.removeListener(handleMessage);
            port.onDisconnect.removeListener(handleDisconnect);
            const ok = "ok" in msg && msg.ok === true;
            const error = "error" in msg && typeof msg.error === "string" ? msg.error : undefined;
            resolve({ ok, error });
          }
        };
        port.onDisconnect.addListener(handleDisconnect);
        port.onMessage.addListener(handleMessage);
        port.postMessage({ type: "reserve-tab-capture", tabId: targetTabId, mode });
      });

      if (!response.ok) {
        try { port.disconnect(); } catch {}
        throw new Error(response.error ?? "無法鎖定 YouTube 分頁擷取。");
      }

      const intervalId = setInterval(() => {
        try { port.postMessage({ type: "keepalive" }); } catch {}
      }, 20_000) as unknown as number;
      const onPortDisconnect = () => {
        clearInterval(intervalId);
        if (activePortState?.port === port) {
          activePortState = null;
        }
      };
      port.onDisconnect.addListener(onPortDisconnect);
      activePortState = { port, tabId: targetTabId, intervalId };
    },
    async releaseTabCapture(targetTabId) {
      if (activePortState && activePortState.tabId === targetTabId) {
        clearInterval(activePortState.intervalId);
        try { activePortState.port.disconnect(); } catch {}
        activePortState = null;
      }
    },
    async getMediaStreamId(targetTabId) {
      try {
        return await tabCapture.getMediaStreamId({ targetTabId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not been invoked|activeTab/i.test(message)) {
          throw new Error(`尚未授權擷取分頁 ${targetTabId}。請切到指定 YouTube 分頁，點瀏覽器工具列的擴充功能圖示，再回側欄重試。瀏覽器回覆：${message}`);
        }
        throw error;
      }
    },
    getUserMedia: (streamId) => navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    } as unknown as MediaStreamConstraints),
    createAudioContext: () => new AudioContext(),
  };
}

export class AudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private buffer: WindowBuffer | null = null;
  private generation = 0;
  private stopped = true;
  private targetTabId: number | null = null;
  private captureReserved = false;
  private pendingResamples = 0;
  private resampleQueue: Promise<void> = Promise.resolve();
  private platform: CapturePlatform | null = null;
  private capturedSamples = 0;
  private lastProgressSecond = 0;

  constructor(private readonly options: CaptureOptions, platform?: CapturePlatform) {
    this.platform = platform ?? null;
  }

  async start(targetTabId: number): Promise<void> {
    let platform: CapturePlatform;
    try {
      platform = this.platform ?? createExtensionPlatform();
      this.platform = platform;
    } catch (error) {
      throw error instanceof Error ? error : new Error("無法載入分頁擷取 API。");
    }

    this.stopped = false;
    this.targetTabId = targetTabId;
    this.capturedSamples = 0;
    this.lastProgressSecond = 0;
    const generation = ++this.generation;
    try {
      await platform.reserveTabCapture(targetTabId, this.options.mode);
      this.captureReserved = true;
      if (generation !== this.generation || this.stopped) {
        await platform.releaseTabCapture(targetTabId);
        this.captureReserved = false;
        this.targetTabId = null;
        return;
      }
      const streamId = await platform.getMediaStreamId(targetTabId);
      if (generation !== this.generation || this.stopped) return;
      if (!streamId) throw new Error("Chrome 沒有提供指定分頁的音訊串流 ID。");
      const stream = await platform.getUserMedia(streamId);
      if (generation !== this.generation || this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error("指定分頁沒有可擷取的音訊軌。");
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => this.handleEnded(generation), { once: true }));
      const context = platform.createAudioContext();
      this.context = context;
      if (context.state === "suspended") await context.resume();
      await context.audioWorklet.addModule(new URL("./pcm-processor.js", import.meta.url));
      if (generation !== this.generation || this.stopped) return;
      this.buffer = new WindowBuffer(context.sampleRate);
      this.source = context.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(context, "pcm-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.mute = context.createGain();
      this.mute.gain.value = 0;
      this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (generation !== this.generation || this.stopped || !(event.data instanceof Float32Array) || this.options.shouldBuffer?.() === false) return;
        this.capturedSamples += event.data.length;
        const capturedMs = this.capturedSamples * 1000 / context.sampleRate;
        const elapsedSecond = Math.floor(capturedMs / 1000);
        if (elapsedSecond > this.lastProgressSecond) {
          this.lastProgressSecond = elapsedSecond;
          this.options.onProgress?.(capturedMs);
        }
        for (const window of this.buffer?.append(event.data) ?? []) {
          this.enqueueWindow(window, context.sampleRate, generation);
        }
      };
      this.source.connect(context.destination);
      this.source.connect(this.worklet);
      this.worklet.connect(this.mute);
      this.mute.connect(context.destination);
    } catch (error) {
      await this.stop();
      if (error instanceof DOMException && error.name === "NotAllowedError") throw new Error("分頁音訊擷取遭拒。請點擴充功能圖示重新授權該 YouTube 分頁。");
      if (error instanceof Error && /指定分頁|音訊串流 ID/.test(error.message)) throw error;
      if (error instanceof Error && error.name === "NotSupportedError") throw new Error("音訊處理無法啟動。請使用支援 tabCapture 與 AudioWorklet 的桌面 Chrome 或 Edge。");
      throw new Error(`無法擷取指定 YouTube 分頁：${error instanceof Error ? error.message : "未知錯誤"}`);
    }
  }

  async flush(): Promise<void> {
    if (this.stopped || !this.buffer) return;
    const generation = this.generation;
    for (const window of this.buffer.flush()) this.enqueueWindow(window, this.context?.sampleRate ?? 16000, generation);
    await this.resampleQueue;
  }

  async stop(): Promise<void> {
    if (this.stopped && !this.stream && !this.context && this.targetTabId === null) return;
    this.stopped = true;
    this.generation += 1;
    this.capturedSamples = 0;
    this.lastProgressSecond = 0;
    const releaseTabId = this.captureReserved ? this.targetTabId : null;
    this.captureReserved = false;
    this.targetTabId = null;
    this.buffer?.clear();
    this.buffer = null;
    this.worklet?.port.close();
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.mute?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const context = this.context;
    this.context = null;
    this.source = null;
    this.worklet = null;
    this.mute = null;
    try {
      if (context && context.state !== "closed") await context.close();
    } finally {
      if (releaseTabId !== null) await this.platform?.releaseTabCapture(releaseTabId);
    }
  }
  private enqueueWindow(window: AudioWindow, inputRate: number, generation: number): void {
    if (this.pendingResamples >= 6) {
      this.options.onError("音訊窗口佇列已滿，無法保證字幕完整；本次合輯需標記為未完成。");
      return;
    }
    this.pendingResamples += 1;
    this.resampleQueue = this.resampleQueue.then(async () => {
      await this.resampleAndEmit(window, inputRate, generation);
    }).finally(() => {
      this.pendingResamples -= 1;
    });
  }


  private handleEnded(generation: number): void {
    if (generation !== this.generation || this.stopped) return;
    void this.stop().then(() => this.options.onEnded());
  }

  private async resampleAndEmit(window: AudioWindow, inputRate: number, generation: number): Promise<void> {
    if (generation !== this.generation || this.stopped) return;
    try {
      const frameCount = Math.round(window.samples.length * 16000 / inputRate);
      const offline = new OfflineAudioContext(1, frameCount, 16000);
      const buffer = offline.createBuffer(1, window.samples.length, inputRate);
      buffer.copyToChannel(window.samples, 0);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      if (generation !== this.generation || this.stopped) return;
      this.options.onWindow({ startMs: window.startMs, samples: rendered.getChannelData(0).slice(), final: window.final });
    } catch {
      if (generation === this.generation) this.options.onError("音訊重取樣失敗。請停止後重新選擇分頁音訊。");
    }
  }
}
