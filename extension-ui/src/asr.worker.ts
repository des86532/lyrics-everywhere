import { AsrWindowQueue } from "./asr-window-queue.js";
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import ortWasmModuleUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmBinaryUrl from "../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url";

env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL(ortWasmModuleUrl, self.location.href).href,
  wasm: new URL(ortWasmBinaryUrl, self.location.href).href,
};

type WorkerRequest =
  | { type: "init" }
  | { type: "cancel" }
  | { type: "transcribe"; generation: number; windowIndex: number; startMs: number; samples: Float32Array };
type WorkerResponse = {
  type: "progress" | "ready" | "result" | "error" | "overflow";
  generation?: number;
  windowIndex?: number;
  startMs?: number;
  progress?: number;
  chunks?: Array<{ timestamp: [number | null, number | null]; text: string }>;
  audioState?: "silent" | "audible";
  message?: string;
};

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let busy = false;
const queued = new AsrWindowQueue<Extract<WorkerRequest, { type: "transcribe" }>>(6);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    queued.clear();
    return;
  }
  if (request.type === "init") {
    void initialize();
    return;
  }
  if (!transcriber) {
    postMessage({ type: "error", generation: request.generation, windowIndex: request.windowIndex, startMs: request.startMs, message: "辨識模型尚未載入。" } satisfies WorkerResponse);
    return;
  }
  if (!queued.enqueue(request, Number(busy))) {
    postMessage({ type: "overflow", generation: request.generation, windowIndex: request.windowIndex, startMs: request.startMs, message: "ASR 窗口佇列已滿；為避免跳過字幕，本次首遍未完成。" } satisfies WorkerResponse);
    return;
  }
  void processNext();
};

async function initialize(): Promise<void> {
  if (transcriber) {
    postMessage({ type: "ready" } satisfies WorkerResponse);
    return;
  }
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) throw new Error("此瀏覽器沒有 WebGPU。請使用支援 WebGPU 的桌面 Chrome 或 Edge；不會改傳音訊到雲端。");
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("找不到可用的 WebGPU 顯示卡。請更新桌面 Chrome／Edge 與顯示卡驅動程式。");
    const createPipeline = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
    transcriber = await createPipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
      device: "webgpu",
      progress_callback: (event: { progress?: number; status?: string }) => {
        postMessage({ type: "progress", progress: event.progress, message: event.status } satisfies WorkerResponse);
      },
    }) as AutomaticSpeechRecognitionPipeline;
    postMessage({ type: "ready" } satisfies WorkerResponse);
  } catch (error) {
    transcriber = null;
    postMessage({ type: "error", message: error instanceof Error ? error.message : "辨識模型載入失敗。" } satisfies WorkerResponse);
  }
}

async function processNext(): Promise<void> {
  if (busy) return;
  const request = queued.dequeue();
  if (!request) return;
  busy = true;
  await transcribe(request);
  busy = false;
  if (queued.size > 0) void processNext();
}

async function transcribe(request: Extract<WorkerRequest, { type: "transcribe" }>): Promise<void> {
  try {
    let power = 0;
    for (let i = 0; i < request.samples.length; i += 1) power += request.samples[i]! * request.samples[i]!;
    const rms = Math.sqrt(power / request.samples.length);
    if (rms >= 0.002) {
      const rawOutput = await transcriber!(request.samples, { task: "transcribe", return_timestamps: true });
      const output = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
      const chunks = output && "chunks" in output && Array.isArray(output.chunks) ? output.chunks as Array<{ timestamp: [number | null, number | null]; text: string }> : [];
      postMessage({ type: "result", generation: request.generation, windowIndex: request.windowIndex, startMs: request.startMs, chunks, audioState: "audible" } satisfies WorkerResponse);
    } else {
      postMessage({ type: "result", generation: request.generation, windowIndex: request.windowIndex, startMs: request.startMs, chunks: [], audioState: "silent" } satisfies WorkerResponse);
    }
  } catch (error) {
    postMessage({ type: "error", generation: request.generation, windowIndex: request.windowIndex, startMs: request.startMs, message: error instanceof Error ? error.message : "音訊辨識失敗。" } satisfies WorkerResponse);
  }
}
