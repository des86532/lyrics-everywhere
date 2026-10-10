import "./style.css";
import { AudioCapture } from "./audio-capture.js";
import { KoreanTranscriber } from "../../src/pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../../src/pronunciation/japanese-transcriber.js";
import { TranscriberRegistry } from "../../src/pronunciation/transcriber-registry.js";
import type { PhoneticSystem } from "../../src/domain/types.js";
import { TranscriptLines, type TranscriptLine, type TimestampedChunk } from "./transcript-lines.js";
import type { SyncedLyrics } from "../../src/domain/types.js";
import { searchLyricsForArtists, searchLyricsForIdentity, selectAutomaticLyrics, type LrclibRecord } from "./lyrics.js";
import { fetchYouTubeMusicCredit, type YouTubeMusicCredit } from "./youtube-music-credit.js";
import { exactSyncedCandidatesForArtists, lyricWindowStart, LYRICS_WINDOW_SIZE, mixReplayWindow, playbackPositionAt, playbackTrackPositionAt, specialVideoKind, type PlaybackReport, type SpecialVideoKind } from "./playback.js";
import { isValidLyricTimingCorrection, lyricPositionForVideo, type LyricTimingCorrection } from "./lyric-timing.js";
import { MixCache, type CompleteMix } from "./mix-cache.js";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  readDisplayPreferences,
  saveDisplayPreferences,
  type DisplayPreferences,
  type DisplayPreferencesStorage,
  type PreservedLanguage,
} from "./preferences.js";
import { GEMINI_API_KEY_STORAGE_KEY, readGeminiApiKey, saveGeminiApiKey } from "./gemini-settings.js";
import { identifySong, type SongIdentity } from "./song-resolver.js";
import { needsJapaneseReadings } from "../../src/pronunciation/japanese-readings.js";

type WorkerMessage = {
  type: "progress" | "ready" | "result" | "error" | "overflow";
  generation?: number;
  windowIndex?: number;
  startMs?: number;
  progress?: number;
  chunks?: TimestampedChunk[];
  message?: string;
  audioState?: "silent" | "audible";
};
type ExtensionMessage = { type: string; tabId?: number; report?: unknown };
type ExtensionApi = {
  runtime: {
    id: string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: { addListener(listener: (message: ExtensionMessage) => void): void };
  };
  tabs: {
    query(query: { active: true; lastFocusedWindow: true }): Promise<Array<{ id?: number }>>;
    onActivated: { addListener(listener: (activeInfo: { tabId: number }) => void): void };
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  storage?: {
    local?: DisplayPreferencesStorage & { setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void> };
    onChanged?: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void };
  };
};
type DisplayLine = TranscriptLine & { pronunciation: string };

function isPlaybackReport(value: unknown): value is PlaybackReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<PlaybackReport>;
  return report.version === 2 && typeof report.sessionId === "string" &&
    ["youtube", "youtube-music", "spotify-web"].includes(report.appId ?? "") &&
    typeof report.pageUrl === "string" && typeof report.mediaId === "string" &&
    typeof report.title === "string" && Array.isArray(report.artists) &&
    ["playing", "paused", "stopped"].includes(report.state ?? "") &&
    Number.isFinite(report.positionMs) && (report.positionMs ?? -1) >= 0 &&
    Number.isFinite(report.durationMs) && (report.durationMs ?? -1) >= 0 &&
    (report.mediaDurationMs === undefined || Number.isFinite(report.mediaDurationMs) && report.mediaDurationMs > 0) &&
    (report.artistVerified === undefined || typeof report.artistVerified === "boolean") &&
    (report.rawTitle === undefined || typeof report.rawTitle === "string" && report.rawTitle.length <= 2000) &&
    Number.isFinite(report.playbackRate) && (report.playbackRate ?? -1) >= 0 &&
    Number.isFinite(report.capturedAtMs) && Math.abs(Date.now() - (report.capturedAtMs ?? 0)) <= 3000;
}

const chromeApi = (globalThis as typeof globalThis & { chrome?: ExtensionApi }).chrome;

const element = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing page element: ${id}`);
  return node as T;
};
const loadButton = element<HTMLButtonElement>("load-model");
const stopButton = element<HTMLButtonElement>("stop-capture");
const statusText = element<HTMLParagraphElement>("status");
const playbackSourceText = element<HTMLParagraphElement>("playback-source");
const statusLight = element<HTMLSpanElement>("status-light");
const progress = element<HTMLProgressElement>("model-progress");
const transcriptElement = element<HTMLDivElement>("transcript");
const modeBadge = element<HTMLSpanElement>("mode-badge");
const systemSelect = element<HTMLSelectElement>("phonetic-system");
const originalToggle = element<HTMLInputElement>("show-original");
const selectedLyricsElement = element<HTMLDivElement>("selected-lyrics");
const preferencesFieldset = element<HTMLFieldSetElement>("preserved-languages");
const preferenceInputs = Array.from(preferencesFieldset.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
const preferencesStatus = element<HTMLParagraphElement>("preferences-status");
const lyricsStatus = element<HTMLParagraphElement>("lyrics-status");
const japaneseReadingStatus = element<HTMLParagraphElement>("japanese-reading-status");
const lyricsQueryStatus = element<HTMLParagraphElement>("lyrics-query-status");
const lyricTimingEditor = element<HTMLDetailsElement>("lyric-timing-editor");
const lyricTimingLine = element<HTMLSelectElement>("lyric-timing-line");
const lyricTimingBeforeButton = element<HTMLButtonElement>("lyric-timing-before");
const lyricTimingAfterButton = element<HTMLButtonElement>("lyric-timing-after");
const lyricTimingClearButton = element<HTMLButtonElement>("lyric-timing-clear");
const lyricTimingFeedback = element<HTMLParagraphElement>("lyric-timing-feedback");
const lyricTimingGapStatus = element<HTMLParagraphElement>("lyric-timing-gap-status");
const singleModeButton = element<HTMLButtonElement>("single-mode");
const mixFirstButton = element<HTMLButtonElement>("mix-first-mode");
const mixReplayButton = element<HTMLButtonElement>("mix-replay-mode");
const aiMatchRejectButton = element<HTMLButtonElement>("ai-match-reject");
const titleElement = element<HTMLHeadingElement>("transcript-title");
const sourceSelect = element<HTMLSelectElement>("source-tab");
const sourceRefreshButton = element<HTMLButtonElement>("refresh-source-tabs");
const sourceSelectionStatus = element<HTMLParagraphElement>("source-selection-status");
const sourceModeText = element<HTMLSpanElement>("source-mode");
const captionHelp = element<HTMLParagraphElement>("caption-help");
const captionProgress = element<HTMLParagraphElement>("caption-progress");
const geminiKeyInput = element<HTMLInputElement>("gemini-key");
const saveGeminiKeyButton = element<HTMLButtonElement>("save-gemini-key");
const removeGeminiKeyButton = element<HTMLButtonElement>("remove-gemini-key");
const geminiKeyStatus = element<HTMLParagraphElement>("gemini-key-status");
const geminiMode = element<HTMLSpanElement>("gemini-mode");
const aiLookupStatus = element<HTMLParagraphElement>("ai-lookup-status");
let geminiApiKey = "";
let geminiKeyReadGeneration = 0;
let geminiKeySaving = false;
let geminiSettingsReady = false;
let singleLookupController: AbortController | null = null;
let resolvedTrack: { title: string; artists: string[]; source: "youtube-credit" | "ai" } | null = null;
const songResolutionCache = new Map<string, SongIdentity | null>();
const youtubeCreditCache = new Map<string, YouTubeMusicCredit | null>();
const AI_REJECTED_STORAGE_KEY = "aiRejectedVideoIds";
let aiRejectedVideoIds: string[] = [];
type PlaybackTab = { tabId: number; title: string; appId: PlaybackReport["appId"] };
let selectedSourceTabId: number | null = null;
let sourceListGeneration = 0;
let captionActionsRequested = false;
let captionStarting = false;
let captureConnected = false;
let mixCapturedMs = 0;
let captionFailure: string | null = null;
let lyricsLookupError = "";
let specialVideo: SpecialVideoKind | null = null;
const SPECIAL_VIDEO_COPY: Record<SpecialVideoKind, { badge: string; heading: string; detail: string }> = {
  "multi-song": {
    badge: "特別剪輯",
    heading: "這是多首歌的特別剪輯",
    detail: "組曲、特別剪輯或混音沒有能對齊整支影片的單一歌詞，因此不自動查詢，避免顯示錯的歌。需要跟唱時可改用「建立字幕」在本機辨識。",
  },
  "non-song": {
    badge: "非完整歌曲",
    heading: "這支影片不是完整歌曲",
    detail: "幕後花絮、預告或訪談沒有對應的同步歌詞，因此不查詢。播放正式 MV 或音源時會自動比對。",
  },
};
let lastEmptyAudioState: "silent" | "audible" | null = null;

function updateSourceControls(): void {
  const busy = captionStarting || singalongMode === "mix-first" || singalongMode === "mix-replay";
  sourceSelect.disabled = busy;
  sourceRefreshButton.disabled = busy;
  const label = busy ? "字幕工作已鎖定來源" : selectedSourceTabId === null ? "跟隨目前分頁"
    : sourceSelect.selectedOptions[0]?.disabled ? "指定來源不可用" : `已鎖定分頁 ${selectedSourceTabId}`;
  if (sourceModeText.textContent !== label) sourceModeText.textContent = label;
}

async function refreshSourceTabs(): Promise<void> {
  if (!chromeApi) return;
  const requestGeneration = ++sourceListGeneration;
  sourceRefreshButton.disabled = true;
  try {
    const response = await chromeApi.runtime.sendMessage({ type: "list-playback-tabs" }) as {
      ok?: boolean; tabs?: PlaybackTab[]; error?: string;
    } | undefined;
    if (requestGeneration !== sourceListGeneration) return;
    if (!response?.ok || !Array.isArray(response.tabs)) throw new Error(response?.error ?? "無法取得播放分頁列表。");
    sourceSelect.replaceChildren(new Option("跟隨目前作用中的分頁", "auto"));
    for (const tab of response.tabs) sourceSelect.add(new Option(`${tab.title} · 分頁 ${tab.tabId}`, String(tab.tabId)));
    const sourceMissing = selectedSourceTabId !== null && !response.tabs.some((tab) => tab.tabId === selectedSourceTabId);
    if (sourceMissing) {
      const missing = new Option(`指定分頁 ${selectedSourceTabId} 已關閉或不再是播放頁`, String(selectedSourceTabId));
      missing.disabled = true;
      sourceSelect.add(missing);
    }
    sourceSelect.value = selectedSourceTabId === null ? "auto" : String(selectedSourceTabId);
    sourceSelectionStatus.textContent = selectedSourceTabId === null
      ? "選擇一個分頁即可固定歌詞來源；切換其他分頁不會換歌詞。"
      : sourceMissing ? "指定分頁已關閉或離開支援網站；不會自動換到其他分頁，請另選來源。"
        : "已指定播放分頁；該分頁內換歌仍會重新匹配。要換來源請重新選擇。";
  } catch (error) {
    if (requestGeneration !== sourceListGeneration) return;
    sourceSelectionStatus.textContent = error instanceof Error ? error.message : "無法列出播放分頁。";
  } finally {
    if (requestGeneration === sourceListGeneration) updateSourceControls();
  }
}

async function resolveSourceTabId(): Promise<number> {
  if (!chromeApi) throw new Error("請從擴充功能側欄操作。");
  if (selectedSourceTabId !== null) return selectedSourceTabId;
  const tabId = (await chromeApi.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (typeof tabId !== "number" || !Number.isSafeInteger(tabId)) throw new Error("無法識別目前播放分頁。");
  return tabId;
}

function mixPreparationProblem(report: PlaybackReport | null): string | null {
  if (!isEligibleYoutubeReport(report) || !report) return "請選擇有效的 YouTube 影片。";
  if (Date.now() - report.capturedAtMs > 3000) return "等待指定分頁的最新播放資訊。";
  if ((report.mediaDurationMs ?? report.durationMs) <= 0) return "等待播放器提供影片長度。";
  if (playbackPositionAt(report, report.capturedAtMs) > 2000 || report.state !== "paused" || report.playbackRate !== 1) {
    return `目前 ${formatTime(playbackPositionAt(report, report.capturedAtMs))}、${report.state === "paused" ? "已暫停" : report.state === "playing" ? "播放中" : "已停止"}、${report.playbackRate}×；請先停在 0 秒、暫停、1×。`;
  }
  return null;
}

function updateCaptionControls(): void {
  const allowed = captionActionsRequested && !lyricsLookupPending && isEligibleYoutubeReport(playbackReport) &&
    singalongMode === "single" && selectedLyrics === null;
  const problem = allowed && modelReady ? mixPreparationProblem(playbackReport) : null;
  loadButton.hidden = !allowed || modelReady;
  mixFirstButton.hidden = !allowed;
  mixFirstButton.disabled = !modelReady || captionStarting || problem !== null;
  mixReplayButton.hidden = !allowed;
  mixReplayButton.disabled = captionStarting;
  captionHelp.hidden = !allowed;
  if (allowed) {
    const help = !modelReady
      ? "1. 載入模型　2. 把指定影片停在 0 秒、暫停、1×　3. 建立字幕　4. 看到「音訊已連接」後播放。首段需收滿 12 秒，再等本機辨識。"
      : problem ?? "影片已準備好。按「建立字幕」連接音訊，看到「音訊已連接」後再播放；首段需 12 秒音訊加本機辨識時間。";
    if (captionHelp.textContent !== help) captionHelp.textContent = help;
  }
  if (!allowed) progress.hidden = true;
  updateSourceControls();
}

function updateCaptionProgress(): void {
  const working = singalongMode === "mix-first";
  captionProgress.hidden = !working && captionFailure === null;
  let text = captionFailure ? `字幕狀態：${captionFailure}` : "";
  if (working) {
    text = !captureConnected ? "正在連接音訊；尚未開始收音，請先保持暫停。"
      : !mixFirstAnchor ? "音訊已連接，等待從 0 秒播放指定影片；目前尚未收音。"
        : `已收到 ${Math.floor(mixCapturedMs / 1000)} 秒音訊 · 已辨識 ${mixWindowResults}/${mixWindowCount} 段 · ${mixRecognizedLines} 行字幕`;
    if (mixFirstAnchor && mixWindowCount === 0) text += "；首段需收滿 12 秒。";
    if (mixFinalizing) text += "；影片已結束，等待剩餘辨識與儲存。";
    if (lastEmptyAudioState) text += lastEmptyAudioState === "silent"
      ? "；最近一段音量過低或靜音，請確認播放器音量。"
      : "；最近一段有聲音，但沒有新增可用字幕。";
    if (mixFirstAnchor && mixCapturedMs === 0 && Date.now() - mixFirstAnchor.capturedAtMs > 3000) {
      text = "影片正在播放，但尚未收到音訊樣本；請確認指定分頁有聲音。";
    }
  }
  if (text !== captionProgress.textContent) {
    captionProgress.textContent = text;
    if (working && visibleLines.length === 0) renderLines();
  }
}

function isEligibleYoutubeReport(report: PlaybackReport | null): boolean {
  if (!report || report.appId !== "youtube") return false;
  try {
    const page = new URL(report.pageUrl);
    return page.hostname === "www.youtube.com" && page.pathname === "/watch" &&
      page.searchParams.get("v") === report.mediaId;
  } catch {
    return false;
  }
}

function setCaptionActionsVisible(visible: boolean): void {
  captionActionsRequested = visible;
  updateCaptionControls();
}


const registry = new TranscriberRegistry().register(new KoreanTranscriber()).register(new JapaneseTranscriber());
type JapaneseReadingWorkerMessage =
  | { type: "ready" }
  | { type: "result"; id: number; text: string; readingText: string; unresolved: boolean }
  | { type: "error"; id?: number; text?: string; error: string };
type JapaneseReadingRequest = { text: string; generation: number };
let japaneseReadingWorker: Worker | null = null;
const japaneseReadingCache = new Map<string, { readingText: string; unresolved: boolean }>();
const pendingJapaneseReadings = new Map<string, number>();
const japaneseReadingRequests = new Map<number, JapaneseReadingRequest>();
let nextJapaneseReadingId = 0;
let japaneseReadingGeneration = 0;
let japaneseDictionaryReady = false;
let japaneseDictionaryFailed = false;
let japaneseHasUnresolvedReadings = false;
let worker: Worker | null = null;
let modelReady = false;
let capture: AudioCapture | null = null;
let generation = 0;
let transcriptLines = new TranscriptLines();
let visibleLines: DisplayLine[] = [];
let lyricsMode = false;
let selectedLyrics: SyncedLyrics | null = null;
let lyricsLookupPending = false;
let lockedTabId: number | null = null;
let playbackReport: PlaybackReport | null = null;
let singalongMode: "idle" | "single" | "mix-first" | "mix-replay" = "idle";
let displayPreferences: DisplayPreferences = {
  phoneticSystem: DEFAULT_DISPLAY_PREFERENCES.phoneticSystem,
  preservedLanguages: [...DEFAULT_DISPLAY_PREFERENCES.preservedLanguages],
};
let preferenceWriteQueue: Promise<void> = Promise.resolve();
const LYRIC_TIMING_STORAGE_KEY = "lyricTimingCorrections";
const YOUTUBE_MEDIA_ID = /^[A-Za-z0-9_-]{11}$/u;
const CONTENT_HASH = /^[a-f0-9]{64}$/u;
let lyricTimingCorrections: Record<string, LyricTimingCorrection> = {};
let lyricTimingWriteQueue: Promise<void> = Promise.resolve();
function latestPlaybackReport(): PlaybackReport | null {
  return playbackReport;
}
let lyricsTicker: number | undefined;
let mixCache: MixCache | null = null;
let mixCacheError: string | null = null;
let activeMixVideoId: string | null = null;
let activeMixDurationMs = 0;
let mixFirstAnchor: { positionMs: number; capturedAtMs: number } | null = null;
let mixWindowCount = 0;
let mixWindowResults = 0;
let mixPersistedWindows = 0;
let activeMixSessionId: string | null = null;
let mixRecognizedLines = 0;
let activeReplay: CompleteMix | null = null;
let replayFocusIndex = -1;
let mixNextWindowIndex = 0;
let mixPersistenceQueue: Promise<void> = Promise.resolve();
let mixDrainResolver: (() => void) | null = null;
let mixFinalizing = false;
const mixCacheInitialization = (async () => {
  try {
    const cache = new MixCache();
    const captureState = await chromeApi?.runtime.sendMessage({ type: "has-active-tab-capture" }).catch(() => undefined);
    const active = captureState && typeof captureState === "object" && "active" in captureState && captureState.active === true;
    await cache.initialize(!active);
    mixCache = cache;
  } catch (error) {
    mixCacheError = error instanceof Error ? error.message : "無法開啟 IndexedDB 字幕快取。";
  }
})();

async function requireMixCache(): Promise<MixCache> {
  await mixCacheInitialization;
  if (!mixCache) throw new Error(`IndexedDB 字幕快取無法使用：${mixCacheError ?? "未知錯誤"}`);
  return mixCache;
}

function setStatus(message: string, kind: "idle" | "busy" | "listening" | "error" = "idle"): void {
  statusText.textContent = message;
  statusLight.dataset.state = kind;
}

function createWorker(): Worker {
  const instance = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  instance.onmessage = (event: MessageEvent<WorkerMessage>) => handleWorkerMessage(event.data);
  instance.onerror = () => {
    instance.terminate();
    if (worker === instance) worker = null;
    modelReady = false;
    loadButton.disabled = false;
    updateCaptionControls();
    if (singalongMode === "mix-first") void failMix("辨識模型 Worker 失效；請重新載入模型後重試。");
    setStatus("辨識模型 Worker 失效。請重新載入模型。", "error");
  };
  return instance;
}

function notifyMixDrain(): void {
  if (mixPersistedWindows === mixWindowCount && mixDrainResolver) {
    mixDrainResolver();
    mixDrainResolver = null;
  }
}

function waitForMixDrain(): Promise<void> {
  if (mixPersistedWindows === mixWindowCount) return Promise.resolve();
  return new Promise<void>((resolve) => { mixDrainResolver = resolve; });
}

async function failMix(message: string, sessionGeneration = generation): Promise<void> {
  if (singalongMode !== "mix-first" || sessionGeneration !== generation || !activeMixVideoId) return;
  const videoId = activeMixVideoId;
  captionFailure = message;
  singalongMode = "idle";
  activeMixVideoId = null;
  mixDrainResolver?.();
  mixDrainResolver = null;
  try {
    await mixCache?.markIncomplete(videoId);
  } catch (error) {
    message += ` 草稿未能儲存：${error instanceof Error ? error.message : "IndexedDB 寫入失敗"}。`;
  }
  if (sessionGeneration !== generation) return;
  await stopCapture(false);
  if (generation !== sessionGeneration + 1) return;
  await startSingleDetection();
  if (captionFailure !== null) {
    captionFailure = message;
    setStatus(message, "error");
    updateCaptionProgress();
  }
}

async function finishMix(): Promise<void> {
  if (singalongMode !== "mix-first" || mixFinalizing || !activeMixVideoId) return;
  if (!mixFirstAnchor) {
    await failMix("影片尚未從 0 秒開始播放；本次合輯字幕未完成。");
    return;
  }
  const sessionGeneration = generation;
  const videoId = activeMixVideoId;
  mixFinalizing = true;
  updateCaptionProgress();
  try {
    await capture?.flush();
    await waitForMixDrain();
    await mixPersistenceQueue;
    if (sessionGeneration !== generation || activeMixVideoId !== videoId || mixWindowResults !== mixWindowCount ||
        mixPersistedWindows !== mixWindowCount || mixRecognizedLines === 0) {
      throw new Error("有字幕窗口未完成，或沒有辨識到有效人聲字幕。");
    }
    const cache = await requireMixCache();
    const complete = await cache.complete(videoId, mixWindowCount);
    if (sessionGeneration !== generation || activeMixVideoId !== videoId) return;
    const completedTabId = lockedTabId;
    const completedReport = playbackReport;
    singalongMode = "idle";
    activeMixVideoId = null;
    await stopCapture(false);
    if (generation !== sessionGeneration + 1 || completedTabId === null || !completedReport) return;
    singalongMode = "mix-replay";
    lockedTabId = completedTabId;
    playbackReport = completedReport;
    activeReplay = complete;
    replayFocusIndex = -1;
    stopButton.disabled = false;
    displayPlaybackSource(completedReport);
    startLyricsClock();
    renderMixReplay(completedReport);
    updateSourceControls();
    setStatus(`字幕已完成：${complete.lines.length} 行已儲存。字幕保留在畫面，可從頭重播並跟唱。`, "listening");
  } catch (error) {
    mixFinalizing = false;
    await failMix(`合輯字幕未完成：${error instanceof Error ? error.message : "辨識或 IndexedDB 錯誤"}`);
  }
}

function handleMixResult(message: WorkerMessage): void {
  if (message.generation !== generation || message.windowIndex !== mixWindowResults || !activeMixVideoId || !mixFirstAnchor) {
    void failMix("ASR 窗口順序中斷；本次合輯字幕未完成。", message.generation);
    return;
  }
  const videoId = activeMixVideoId;
  const startMs = mixFirstAnchor.positionMs + (message.startMs ?? 0);
  lastEmptyAudioState = null;
  const lines = transcriptLines.append(startMs, message.chunks ?? [])
    .filter((line) => line.startMs < activeMixDurationMs && line.endMs > line.startMs)
    .map((line) => ({ ...line, endMs: Math.min(line.endMs, activeMixDurationMs) }));
  mixRecognizedLines += lines.length;
  if (lines.length === 0) lastEmptyAudioState = message.audioState ?? "audible";
  for (const line of lines) {
    const pronunciation = transcribeText(line.text);
    visibleLines.push({ ...line, pronunciation });
  }
  visibleLines = visibleLines.slice(-7);
  mixWindowResults += 1;
  renderLines();
  updateCaptionProgress();
  const resultGeneration = generation;
  mixPersistenceQueue = mixPersistenceQueue.then(async () => {
    const cache = await requireMixCache();
    await cache.appendWindow(videoId, lines);
    if (generation !== resultGeneration || activeMixVideoId !== videoId) return;
    mixPersistedWindows += 1;
    notifyMixDrain();
  }).catch((error: unknown) => {
    void failMix(`字幕文字未能寫入 IndexedDB：${error instanceof Error ? error.message : "儲存錯誤"}。`, resultGeneration);
  });
}

function handleWorkerMessage(message: WorkerMessage): void {
  if (message.type === "progress") {
    if (!lyricsLookupPending && isEligibleYoutubeReport(playbackReport) && singalongMode === "single" && selectedLyrics === null) {
      progress.hidden = false;
      if (message.message === "done") {
        progress.value = 100;
        setStatus("模型檔已下載，正在初始化 GPU 推論引擎…", "busy");
      } else {
        const percent = Math.max(0, Math.min(100, Math.round(message.progress ?? 0)));
        progress.value = percent;
        setStatus(`模型下載或初始化中 ${percent}%${message.message ? ` · ${message.message}` : ""}`, "busy");
      }
    }
  } else if (message.type === "ready") {
    modelReady = true;
    setCaptionActionsVisible(true);
    loadButton.disabled = false;
    progress.hidden = true;
    if (!lyricsLookupPending && isEligibleYoutubeReport(playbackReport) && singalongMode === "single" && selectedLyrics === null) {
      setStatus("模型已就緒。依準備提示建立音訊連線，看到「已連接」後再播放。", "idle");
    }
  } else if (message.type === "error" || message.type === "overflow") {
    if (message.generation !== undefined) {
      if (message.generation !== generation) return;
      void failMix(message.message || "音訊辨識失敗。");
      return;
    }
    modelReady = false;
    setCaptionActionsVisible(true);
    loadButton.disabled = false;
    progress.hidden = true;
    if (isEligibleYoutubeReport(playbackReport) && singalongMode === "single" && selectedLyrics === null) {
      setStatus(message.message || "模型載入失敗。請重試。", "error");
    }
  } else if (message.type === "result") {
    if (message.generation !== generation || singalongMode !== "mix-first") return;
    handleMixResult(message);
  }
}

function selectedSystem(): PhoneticSystem {
  return displayPreferences.phoneticSystem;
}

function transcribeText(text: string): string {
  const languages = displayPreferences.preservedLanguages;
  let readingText = text;
  let passthroughLanguages = languages.slice(1);
  if (needsJapaneseReadings(text)) {
    if (languages.includes("ja")) {
      updateJapaneseReadingStatus();
    } else {
      const cached = japaneseReadingCache.get(text);
      if (cached) {
        readingText = cached.readingText;
        japaneseHasUnresolvedReadings ||= cached.unresolved;
      } else {
        requestJapaneseReadings(text);
        passthroughLanguages = [...passthroughLanguages, "ja"];
      }
      updateJapaneseReadingStatus();
    }
  }
  return registry.transcribe({
    text: readingText,
    sourceLanguage: "auto",
    allowedSystems: [selectedSystem()],
    targetLocale: languages[0] ?? "",
    passthroughLanguages,
    style: "singable",
  }).displayText;
}
function updateJapaneseReadingStatus(): void {
  const message = displayPreferences.preservedLanguages.includes("ja")
    ? ""
    : japaneseDictionaryFailed
      ? "日文讀音資料無法載入；目前保留日文原文，重新開啟側欄後重試。"
      : japaneseHasUnresolvedReadings
        ? "部分日文漢字沒有讀音，已保留原文。"
        : japaneseReadingRequests.size > 0 && !japaneseDictionaryReady
          ? "正在載入本機日文字典…"
          : "";
  japaneseReadingStatus.textContent = message;
  japaneseReadingStatus.hidden = !message;
}

function failJapaneseDictionary(): void {
  japaneseDictionaryFailed = true;
  japaneseReadingRequests.clear();
  pendingJapaneseReadings.clear();
  updateJapaneseReadingStatus();
}

function receiveJapaneseReadingMessage(message: JapaneseReadingWorkerMessage): void {
  if (message.type === "ready") {
    japaneseDictionaryReady = true;
    updateJapaneseReadingStatus();
    return;
  }
  if (message.type === "error") {
    if (message.id !== undefined) {
      const request = japaneseReadingRequests.get(message.id);
      if (!request || request.generation !== japaneseReadingGeneration || request.text !== message.text) return;
    }
    failJapaneseDictionary();
    return;
  }
  const request = japaneseReadingRequests.get(message.id);
  if (!request || request.generation !== japaneseReadingGeneration || request.text !== message.text) return;
  japaneseReadingRequests.delete(message.id);
  if (pendingJapaneseReadings.get(message.text) === message.id) pendingJapaneseReadings.delete(message.text);
  japaneseReadingCache.set(message.text, {
    readingText: message.readingText,
    unresolved: message.unresolved,
  });
  japaneseHasUnresolvedReadings ||= message.unresolved;
  updateJapaneseReadingStatus();
  renderCurrentLyrics();
}

function requestJapaneseReadings(text: string): void {
  if (displayPreferences.preservedLanguages.includes("ja") ||
      japaneseDictionaryFailed || japaneseReadingCache.has(text) || pendingJapaneseReadings.has(text)) return;
  try {
    if (!japaneseReadingWorker) {
      japaneseReadingWorker = new Worker(new URL("./japanese-reading.worker.ts", import.meta.url), {
        type: "module",
        name: "japanese-reading",
      });
      japaneseReadingWorker.addEventListener("message", (event: MessageEvent<JapaneseReadingWorkerMessage>) => {
        receiveJapaneseReadingMessage(event.data);
      });
      japaneseReadingWorker.addEventListener("error", () => failJapaneseDictionary());
    }
    const id = ++nextJapaneseReadingId;
    japaneseReadingRequests.set(id, { text, generation: japaneseReadingGeneration });
    pendingJapaneseReadings.set(text, id);
    updateJapaneseReadingStatus();
    japaneseReadingWorker.postMessage({
      id,
      text,
      dicPath: new URL("./kuromoji-dict/", document.baseURI).href,
    });
  } catch {
    failJapaneseDictionary();
  }
}

function clearJapaneseReadingCache(): void {
  japaneseReadingGeneration += 1;
  japaneseReadingCache.clear();
  pendingJapaneseReadings.clear();
  japaneseReadingRequests.clear();
  japaneseHasUnresolvedReadings = false;
  updateJapaneseReadingStatus();
}

function renderPreferenceControls(): void {
  systemSelect.value = displayPreferences.phoneticSystem;
  const preserved = new Set(displayPreferences.preservedLanguages);
  for (const input of preferenceInputs) input.checked = preserved.has(input.value as PreservedLanguage);
}

function renderGeminiKeyControls(): void {
  geminiKeyInput.disabled = geminiKeySaving || !geminiSettingsReady;
  saveGeminiKeyButton.disabled = geminiKeySaving || !geminiSettingsReady;
  removeGeminiKeyButton.disabled = geminiKeySaving || !geminiSettingsReady || !geminiApiKey;
  geminiKeyInput.placeholder = geminiApiKey ? "已儲存；輸入新 key 可取代" : "未設定：使用基本流程";
  geminiMode.textContent = geminiApiKey ? "使用自己的額度" : "基本流程";
}

function setAiLookupStatus(message: string): void {
  aiLookupStatus.textContent = message;
  aiLookupStatus.hidden = !message;
}

function applyGeminiApiKey(key: string): void {
  const changed = geminiApiKey !== key;
  geminiApiKey = key;
  renderGeminiKeyControls();
  if (!changed) return;
  songResolutionCache.clear();
  const report = playbackReport;
  if (singalongMode === "single" && report) {
    clearSelectedTrack("AI 解析設定已變更；正在重新比對目前曲目。");
    displayPlaybackSource(report);
    void lookupSingleLyrics(report, singleOperationGeneration);
  }
}

async function initializeGeminiKey(): Promise<void> {
  const generation = ++geminiKeyReadGeneration;
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    await storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    const key = await readGeminiApiKey(storage);
    if (generation !== geminiKeyReadGeneration) return;
    applyGeminiApiKey(key);
    geminiKeyStatus.textContent = geminiApiKey ? "AI 解析已啟用；僅使用你自己的 Gemini 額度。" : "";
  } catch {
    if (generation === geminiKeyReadGeneration) geminiKeyStatus.textContent = "無法讀取本機 key；本次使用基本流程。";
  } finally {
    geminiSettingsReady = true;
    renderGeminiKeyControls();
  }
}

async function saveGeminiKey(key: string): Promise<void> {
  if (geminiKeySaving) return;
  geminiKeySaving = true;
  renderGeminiKeyControls();
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    await storage.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    await saveGeminiApiKey(storage, key);
    ++geminiKeyReadGeneration;
    geminiKeyInput.value = "";
    applyGeminiApiKey(key.trim());
    geminiKeyStatus.textContent = key.trim()
      ? "Key 已儲存在本機；AI 解析僅使用你自己的額度。"
      : "Key 已移除；現在使用基本流程，不呼叫 Gemini。";
  } catch {
    geminiKeyStatus.textContent = "Key 未能儲存；請確認輸入格式與本機儲存權限，設定尚未變更。";
  } finally {
    geminiKeySaving = false;
    renderGeminiKeyControls();
  }
}

saveGeminiKeyButton.addEventListener("click", () => {
  if (!geminiKeyInput.value.trim()) {
    geminiKeyStatus.textContent = "請先輸入 key；要停用 AI 請按「移除金鑰」。";
    return;
  }
  void saveGeminiKey(geminiKeyInput.value);
});
removeGeminiKeyButton.addEventListener("click", () => void saveGeminiKey(""));
chromeApi?.storage?.onChanged?.addListener((changes, areaName) => {
  const storage = chromeApi.storage?.local;
  if (areaName !== "local" || !(GEMINI_API_KEY_STORAGE_KEY in changes) || !storage) return;
  const readGeneration = ++geminiKeyReadGeneration;
  void readGeminiApiKey(storage).then((key) => {
    if (readGeneration !== geminiKeyReadGeneration) return;
    applyGeminiApiKey(key);
    geminiKeyStatus.textContent = key ? "本機 key 已更新；AI 解析使用你自己的額度。" : "Key 已移除；現在使用基本流程。";
  }).catch(() => {
    if (readGeneration !== geminiKeyReadGeneration) return;
    applyGeminiApiKey("");
    geminiKeyStatus.textContent = "無法讀取更新後的 key；本次已停用 AI，使用基本流程。";
  });
});

async function initializeDisplayPreferences(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    displayPreferences = await readDisplayPreferences(storage);
  } catch {
    preferencesStatus.textContent = "偏好無法儲存";
  } finally {
    renderPreferenceControls();
    systemSelect.disabled = false;
    preferencesFieldset.disabled = false;
  }
}

function saveCurrentDisplayPreferences(): void {
  displayPreferences = {
    phoneticSystem: systemSelect.value === "bopomofo" || systemSelect.value === "latin" ? systemSelect.value : "chinese",
    preservedLanguages: preferenceInputs
      .filter((input) => input.checked)
      .map((input) => input.value as PreservedLanguage),
  };
  updateJapaneseReadingStatus();
  renderCurrentLyrics();
  const current = displayPreferences;
  const storage = chromeApi?.storage?.local;
  if (!storage) {
    preferencesStatus.textContent = "偏好無法儲存";
    return;
  }
  preferenceWriteQueue = preferenceWriteQueue
    .then(() => saveDisplayPreferences(storage, current))
    .then(() => {
      if (displayPreferences === current) preferencesStatus.textContent = "";
    })
    .catch(() => {
      preferencesStatus.textContent = "偏好無法儲存";
    });
}

function renderCurrentLyrics(): void {
  visibleLines = visibleLines.map((line) => ({ ...line, pronunciation: transcribeText(line.text) }));
  if (singalongMode === "mix-replay" && activeReplay && playbackReport) {
    replayFocusIndex = -1;
    renderMixReplay();
  } else {
    renderLines();
  }
}

function renderLines(): void {
  transcriptElement.hidden = selectedLyrics !== null;
  selectedLyricsElement.hidden = selectedLyrics === null;
  renderSelectedLyrics();
  if (selectedLyrics) return;
  if (visibleLines.length === 0) {
    transcriptElement.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty-state";
    const special = singalongMode === "single" && specialVideo ? SPECIAL_VIDEO_COPY[specialVideo] : null;
    if (special) empty.classList.add("is-notice");
    empty.append(document.createTextNode(special ? special.heading : singalongMode === "mix-first"
      ? !captureConnected ? "正在連接分頁音訊" : !mixFirstAnchor ? "請播放指定影片" : "正在建立字幕"
      : singalongMode === "single" ? lyricsLookupError ? "歌詞查詢失敗" : lyricsLookupPending ? "正在比對同步歌詞" : "尚無可顯示的同步歌詞" : "等待辨識到歌聲"));
    const hint = document.createElement("span");
    hint.textContent = special ? special.detail : singalongMode === "mix-first"
      ? !mixFirstAnchor ? "看到「音訊已連接」後，再從 0 秒開始播放。" : captionProgress.textContent ?? "首段需收滿 12 秒音訊，再進行本機辨識。"
      : singalongMode === "single" ? lyricsLookupError || (lyricsLookupPending ? "正在查詢歌曲名稱與歌手別名，請稍候。"
        : isEligibleYoutubeReport(playbackReport) && captionActionsRequested
          ? "目前未取得可用同步歌詞；也可手動建立本機字幕。" : "目前未取得曲名與可信歌手相符的同步歌詞。")
        : "字幕尚未開始。";
    empty.append(document.createElement("br"), hint);
    transcriptElement.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const line of visibleLines) {
    const article = document.createElement("article");
    article.className = "lyric-line";
    const pronunciation = document.createElement("p");
    pronunciation.className = "lyric-pronunciation";
    pronunciation.textContent = line.pronunciation;
    if (originalToggle.checked && line.text !== line.pronunciation) {
      const original = document.createElement("p");
      original.className = "lyric-original";
      original.textContent = line.text;
      const time = document.createElement("time");
      time.className = "lyric-time";
      time.textContent = formatTime(line.startMs);
      original.append(time);
      article.append(original);
    } else if (originalToggle.checked) {
      const time = document.createElement("time");
      time.className = "lyric-time";
      time.textContent = formatTime(line.startMs);
      pronunciation.append(time);
    }
    article.append(pronunciation);
    fragment.append(article);
  }
  transcriptElement.replaceChildren(fragment);
  transcriptElement.scrollTop = transcriptElement.scrollHeight;
}
function renderMixReplay(report: PlaybackReport | null = playbackReport): void {
  if (!activeReplay || !report || singalongMode !== "mix-replay") return;
  const positionMs = playbackPositionAt(report, Date.now());
  const window = mixReplayWindow(activeReplay.lines, positionMs);
  const focusIndex = window.focusIndex;
  modeBadge.textContent = "字幕 · 音訊推測";
  lyricsStatus.textContent = `快取字幕跟隨影片進度：${formatTime(positionMs)}。`;
  if (focusIndex === replayFocusIndex) return;
  replayFocusIndex = focusIndex;
  visibleLines = window.lines.map((line) => ({
    ...line,
    pronunciation: transcribeText(line.text),
  }));
  renderLines();
}

function selectedTimingKey(): string | null {
  const report = playbackReport;
  const hash = selectedLyrics?.contentHash;
  if (!report || !selectedLyrics || report.appId !== "youtube" || report.segmentStartMs !== undefined ||
      !YOUTUBE_MEDIA_ID.test(report.mediaId) || !hash || !CONTENT_HASH.test(hash)) return null;
  return `${report.mediaId}:${hash}`;
}

function setLyricTimingFeedback(message: string): void {
  lyricTimingFeedback.textContent = message;
}

function updateLyricTimingControls(): void {
  const shown = Boolean(selectedLyrics && lyricsMode && singalongMode === "single" &&
    playbackReport?.appId === "youtube" && playbackReport.segmentStartMs === undefined);
  lyricTimingEditor.hidden = !shown;
  if (!shown) {
    lyricTimingGapStatus.hidden = true;
    return;
  }
  const report = playbackReport;
  const validReport = Boolean(report && YOUTUBE_MEDIA_ID.test(report.mediaId) &&
    report.appId === "youtube" && report.segmentStartMs === undefined &&
    report.state !== "stopped" && Date.now() - report.capturedAtMs <= 3000);
  const lineIndex = Number(lyricTimingLine.value);
  const line = Number.isInteger(lineIndex) ? selectedLyrics?.lines[lineIndex] : undefined;
  const validLine = Boolean(line && line.startMs !== undefined && Number.isFinite(line.startMs) &&
    line.startMs >= 0 && /\S/u.test(line.text));
  const key = selectedTimingKey();
  const correction = key ? lyricTimingCorrections[key] : undefined;
  const ready = validReport && validLine && key !== null;
  lyricTimingBeforeButton.disabled = !ready;
  lyricTimingAfterButton.disabled = !ready || !correction;
  lyricTimingClearButton.disabled = !key || !correction;
  if (!validReport) setLyricTimingFeedback("需要同一支 YouTube 影片在 3 秒內的有效播放資訊，才可記錄時間。");
  else if (!validLine) setLyricTimingFeedback("請選擇一行具有起始時間的歌詞。");
  else if (!key) setLyricTimingFeedback("影片或歌詞版本識別資料無效，不能保存校時。");
  else if (!lyricTimingFeedback.textContent) setLyricTimingFeedback(correction ? "已載入這支影片與此歌詞版本的校時。" : "");
}

function populateLyricTimingLines(): void {
  const selectedValue = lyricTimingLine.value;
  lyricTimingLine.replaceChildren();
  selectedLyrics?.lines.forEach((line, index) => {
    if (line.startMs === undefined || !Number.isFinite(line.startMs) || line.startMs < 0 || !/\S/u.test(line.text)) return;
    const option = new Option(`${formatTime(line.startMs)} · ${line.text}`, String(index));
    lyricTimingLine.add(option);
  });
  if (Array.from(lyricTimingLine.options).some((option) => option.value === selectedValue)) {
    lyricTimingLine.value = selectedValue;
  }
  lyricTimingLine.disabled = lyricTimingLine.options.length === 0;
  updateLyricTimingControls();
}

async function initializeLyricTimingCorrections(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    const stored = (await storage.get(LYRIC_TIMING_STORAGE_KEY))[LYRIC_TIMING_STORAGE_KEY];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      lyricTimingCorrections = {};
      return;
    }
    const valid: Record<string, LyricTimingCorrection> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (/^[A-Za-z0-9_-]{11}:[a-f0-9]{64}$/u.test(key) && isValidLyricTimingCorrection(value)) valid[key] = value;
    }
    lyricTimingCorrections = valid;
  } catch {
    lyricTimingCorrections = {};
    setLyricTimingFeedback("無法讀取校時資料；本次操作仍可使用，但不會載入已保存校正。");
  }
}

function persistLyricTimingCorrections(): void {
  lyricTimingWriteQueue = lyricTimingWriteQueue.then(async () => {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    const snapshot = { ...lyricTimingCorrections };
    await storage.set({ [LYRIC_TIMING_STORAGE_KEY]: snapshot });
    setLyricTimingFeedback("校時已保存於此瀏覽器。");
  }).catch(() => {
    setLyricTimingFeedback("校時已在本頁套用，但本機儲存失敗，重新開啟後不會保留。");
  });
}

async function initializeAiRejections(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    const stored = (await storage.get(AI_REJECTED_STORAGE_KEY))[AI_REJECTED_STORAGE_KEY];
    if (!Array.isArray(stored)) {
      aiRejectedVideoIds = [];
      return;
    }
    aiRejectedVideoIds = stored
      .filter((item): item is string => typeof item === "string" && /^[A-Za-z0-9_-]{11}$/u.test(item))
      .slice(-200);
  } catch {
    aiRejectedVideoIds = [];
  }
}

function persistAiRejections(): void {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    void Promise.resolve(storage.set({ [AI_REJECTED_STORAGE_KEY]: aiRejectedVideoIds })).catch(() => {
      setAiLookupStatus("已在本頁停用，但本機儲存失敗，重新開啟後不會保留。");
    });
  } catch {
    setAiLookupStatus("已在本頁停用，但本機儲存失敗，重新開啟後不會保留。");
  }
}

function timingAnchorFromSelection(): { videoMs: number; lyricMs: number } | null {
  const report = playbackReport;
  const index = Number(lyricTimingLine.value);
  const line = Number.isInteger(index) ? selectedLyrics?.lines[index] : undefined;
  if (!report || report.appId !== "youtube" || report.segmentStartMs !== undefined ||
      report.state === "stopped" || Date.now() - report.capturedAtMs > 3000 ||
      !YOUTUBE_MEDIA_ID.test(report.mediaId) || !line ||
      line.startMs === undefined || !Number.isFinite(line.startMs) || line.startMs < 0 || !/\S/u.test(line.text)) return null;
  return { videoMs: playbackTrackPositionAt(report, Date.now()), lyricMs: line.startMs };
}

function recordLyricTimingBefore(): void {
  const key = selectedTimingKey();
  const anchor = timingAnchorFromSelection();
  if (!key || !anchor) {
    setLyricTimingFeedback("沒有同一支影片的有效播放資訊或有效歌詞行；未記錄。");
    updateLyricTimingControls();
    return;
  }
  const existing = lyricTimingCorrections[key];
  const candidate: LyricTimingCorrection = { before: anchor, ...(existing?.after ? { after: existing.after } : {}) };
  let message = `已記錄空白前對齊：影片 ${formatTime(anchor.videoMs)}，歌詞 ${formatTime(anchor.lyricMs)}。`;
  if (!isValidLyricTimingCorrection(candidate)) {
    lyricTimingCorrections[key] = { before: anchor };
    message += " 原空白後錨點已失效，請重新記錄。";
  } else {
    lyricTimingCorrections[key] = candidate;
  }
  setLyricTimingFeedback(message);
  updateLyricTimingControls();
  renderSelectedLyrics();
  persistLyricTimingCorrections();
}

function recordLyricTimingAfter(): void {
  const key = selectedTimingKey();
  const anchor = timingAnchorFromSelection();
  const existing = key ? lyricTimingCorrections[key] : undefined;
  if (!key || !anchor || !existing) {
    setLyricTimingFeedback("請先記錄空白前對齊，並確認播放資訊與所選歌詞有效。");
    updateLyricTimingControls();
    return;
  }
  const candidate: LyricTimingCorrection = { before: existing.before, after: anchor };
  if (!isValidLyricTimingCorrection(candidate)) {
    setLyricTimingFeedback("空白後錨點順序不正確或沒有形成空白增量；原校時保持不變。");
    return;
  }
  lyricTimingCorrections[key] = candidate;
  setLyricTimingFeedback(`已記錄空白後對齊：影片 ${formatTime(anchor.videoMs)}，歌詞 ${formatTime(anchor.lyricMs)}。`);
  updateLyricTimingControls();
  renderSelectedLyrics();
  persistLyricTimingCorrections();
}

function clearLyricTimingCorrection(): void {
  const key = selectedTimingKey();
  if (!key) return;
  delete lyricTimingCorrections[key];
  setLyricTimingFeedback("已清除這支影片的校時；其他影片與歌詞版本未變更。");
  updateLyricTimingControls();
  renderSelectedLyrics();
  persistLyricTimingCorrections();
}

type LyricLineState = "past" | "active" | "next" | "upcoming" | "plain";

function appendSelectedLyric(text: string, state: LyricLineState = "plain"): void {
  const pronunciation = transcribeText(text);
  const line = document.createElement("div");
  line.className = `selected-line is-${state}`;
  if (state === "active") line.setAttribute("aria-current", "true");
  if (originalToggle.checked && text !== pronunciation) {
    const original = document.createElement("p");
    original.className = "selected-lyric-original";
    original.textContent = text;
    line.append(original);
  }
  const sung = document.createElement("p");
  sung.className = "selected-lyric";
  const ink = document.createElement("span");
  ink.className = "selected-lyric-ink";
  ink.textContent = pronunciation;
  sung.append(ink);
  line.append(sung);
  selectedLyricsElement.append(line);
}

function renderSelectedLyrics(): void {
  selectedLyricsElement.replaceChildren();
  if (!selectedLyrics) {
    lyricTimingGapStatus.hidden = true;
    updateLyricTimingControls();
    return;
  }
  if (!playbackReport || Date.now() - playbackReport.capturedAtMs > 3000) {
    lyricTimingGapStatus.hidden = true;
    for (const lyric of selectedLyrics.lines) appendSelectedLyric(lyric.text);
    updateLyricTimingControls();
    return;
  }
  const videoPosition = trackLyricsPositionAt(playbackReport, Date.now());
  const correctionKey = selectedTimingKey();
  const mapped = lyricPositionForVideo(videoPosition, correctionKey ? lyricTimingCorrections[correctionKey] : undefined);
  const position = mapped.positionMs;
  lyricTimingGapStatus.hidden = !mapped.inGap;
  const matchingIndex = mapped.inGap ? -1 : selectedLyrics.lines.findIndex((line) => line.startMs !== undefined && line.endMs !== undefined && position >= line.startMs && position < line.endMs);
  const nextIndex = mapped.inGap ? -1 : selectedLyrics.lines.findIndex((line) => line.startMs !== undefined && line.startMs > position);
  const activeIndex = matchingIndex >= 0 ? matchingIndex : nextIndex >= 0 ? nextIndex : selectedLyrics.lines.length - 1;
  const focusState: LyricLineState = mapped.inGap ? "upcoming" : matchingIndex >= 0 ? "active" : nextIndex >= 0 ? "next" : "past";
  const beforeIndex = mapped.inGap
    ? selectedLyrics.lines.reduce((last, line, index) => line.startMs !== undefined && line.startMs <= (correctionKey ? lyricTimingCorrections[correctionKey]?.before.lyricMs ?? 0 : 0) ? index : last, 0)
    : activeIndex;
  const firstIndex = lyricWindowStart(selectedLyrics.lines, beforeIndex);
  let displayed = 0;
  for (let index = firstIndex; index < selectedLyrics.lines.length && displayed < LYRICS_WINDOW_SIZE; index += 1) {
    const lyric = selectedLyrics.lines[index];
    if (!/\S/u.test(lyric.text)) continue;
    appendSelectedLyric(lyric.text, mapped.inGap ? (index <= beforeIndex ? "past" : "upcoming")
      : index === activeIndex ? focusState : index < activeIndex ? "past" : "upcoming");
    displayed += 1;
  }
  updateLyricTimingControls();
}
lyricTimingLine.addEventListener("change", updateLyricTimingControls);
lyricTimingBeforeButton.addEventListener("click", recordLyricTimingBefore);
lyricTimingAfterButton.addEventListener("click", recordLyricTimingAfter);
lyricTimingClearButton.addEventListener("click", clearLyricTimingCorrection);


function startLyricsClock(): void {
  if (lyricsTicker !== undefined) window.clearInterval(lyricsTicker);
  lyricsTicker = window.setInterval(() => {
    if (lyricsMode) {
      renderSelectedLyrics();
      if (playbackReport && Date.now() - playbackReport.capturedAtMs > 3000) {
        lyricsStatus.textContent = "播放來源失聯；歌詞位置已凍結，重新收到播放資訊後恢復。";
      }
    }
    if (singalongMode === "mix-first" && mixFirstAnchor && playbackReport && Date.now() - playbackReport.capturedAtMs > 3000) {
      void failMix("播放來源超過 3 秒沒有回報；本次字幕標記為未完成。");
    }
    if (singalongMode === "mix-replay" && activeReplay && playbackReport) {
      if (Date.now() - playbackReport.capturedAtMs > 3000) {
        lyricsStatus.textContent = "播放來源失聯；合輯字幕位置已凍結。";
      } else {
        renderMixReplay();
      }
    }
    updateCaptionControls();
    updateCaptionProgress();
  }, 250);
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function trackLyricsPositionAt(report: PlaybackReport, now: number): number {
  return report.segmentStartMs === undefined
    ? playbackPositionAt(report, now)
    : playbackTrackPositionAt(report, now);
}

function clearSelectedTrack(message: string): void {
  ++singleOperationGeneration;
  singleLookupController?.abort();
  singleLookupController = null;
  clearJapaneseReadingCache();
  resolvedTrack = null;
  aiMatchRejectButton.hidden = true;
  setAiLookupStatus("");
  lyricsLookupError = "";
  specialVideo = null;
  lyricsQueryStatus.textContent = "";
  lyricsQueryStatus.hidden = true;
  visibleLines = [];
  transcriptLines.clear();
  selectedLyrics = null;
  lyricsMode = false;
  lyricsLookupPending = false;
  lyricTimingLine.replaceChildren();
  lyricTimingLine.disabled = true;
  setLyricTimingFeedback("");
  lyricTimingGapStatus.hidden = true;
  selectedLyricsElement.replaceChildren();
  modeBadge.textContent = "等待播放來源";
  lyricsStatus.textContent = message;
  playbackSourceText.textContent = "尚未取得播放來源。";
  setCaptionActionsVisible(false);
  renderLines();
}


function processMixPlaybackReport(report: PlaybackReport): void {
  if (singalongMode !== "mix-first" || !activeMixVideoId) return;
  const sessionGeneration = generation;
  if (!captureConnected && report.state === "playing") {
    void failMix("音訊尚未連接就開始播放；請先停回 0 秒，等「音訊已連接」後再播放。", sessionGeneration);
    return;
  }
  const mediaDurationMs = report.mediaDurationMs ?? report.durationMs;
  if (report.mediaId !== activeMixVideoId || report.sessionId !== activeMixSessionId ||
      Math.abs(mediaDurationMs - activeMixDurationMs) > 2000) {
    void failMix("來源分頁、影片識別碼或片長已變更；本次字幕標記為未完成。", sessionGeneration);
    return;
  }
  if (report.state === "stopped") {
    void finishMix();
    return;
  }
  if (report.playbackRate !== 1) {
    void failMix("合輯首遍播放速度改變；字幕時間軸不完整。", sessionGeneration);
    return;
  }
  const absolutePosition = playbackPositionAt(report, report.capturedAtMs);
  if (!mixFirstAnchor) {
    if (report.state !== "playing") return;
    if (absolutePosition > 2000) {
      void failMix("首遍開始位置超過 2 秒；字幕時間軸不完整。", sessionGeneration);
      return;
    }
    const anchorTimeMs = Date.now();
    mixFirstAnchor = { positionMs: playbackPositionAt(report, anchorTimeMs), capturedAtMs: anchorTimeMs };
    setStatus("已錨定首個播放音訊樣本。保持 1×、不中斷播放直到影片結束。", "listening");
    return;
  }
  if (report.state !== "playing") {
    void failMix("合輯首遍播放中斷或暫停；字幕標記為未完成。", sessionGeneration);
    return;
  }
  const expectedPosition = mixFirstAnchor.positionMs + Math.max(0, report.capturedAtMs - mixFirstAnchor.capturedAtMs);
  if (Math.abs(absolutePosition - expectedPosition) > 1500) {
    void failMix("播放進度發生 seek 或漂移超過 1.5 秒；字幕標記為未完成。", sessionGeneration);
  }
}

function receivePlaybackMessage(message: ExtensionMessage): void {
  if (message.type !== "playback-state" || message.tabId !== lockedTabId || !isPlaybackReport(message.report)) return;
  const next = message.report;
  const firstReport = playbackReport === null;
  if (playbackReport && playbackReport.sessionId === next.sessionId && next.capturedAtMs <= playbackReport.capturedAtMs) return;
  if (singalongMode === "mix-replay" && activeReplay) {
    const mediaDurationMs = next.mediaDurationMs ?? next.durationMs;
    if (next.mediaId !== activeReplay.videoId || mediaDurationMs !== activeReplay.durationMs) {
      void stopCapture(false);
      setStatus("目前影片或片長已改變；已停止顯示舊影片的字幕。", "error");
      return;
    }
  }
  const trackChanged = singalongMode !== "mix-replay" && playbackReport && (
    playbackReport.sessionId !== next.sessionId ||
    playbackReport.mediaId !== next.mediaId ||
    singalongMode === "single" && (playbackReport.title !== next.title ||
      playbackReport.rawTitle !== next.rawTitle ||
      playbackReport.durationMs !== next.durationMs ||
      playbackReport.segmentStartMs !== next.segmentStartMs ||
      playbackReport.artistVerified !== next.artistVerified ||
      playbackReport.artists.join("\0") !== next.artists.join("\0"))
  );
  if (trackChanged) {
    clearSelectedTrack("播放來源、曲目或影片已切換；舊歌詞已清除。");
  }
  playbackReport = next;
  updateLyricTimingControls();
  displayPlaybackSource(next);
  if (singalongMode === "single" && !lyricsMode) modeBadge.textContent = specialVideo ? SPECIAL_VIDEO_COPY[specialVideo].badge : "已取得播放來源";
  if (singalongMode === "mix-first") processMixPlaybackReport(next);
  if (singalongMode === "mix-replay") renderMixReplay(next);
  if ((firstReport || trackChanged) && singalongMode === "single") void lookupSingleLyrics(next, singleOperationGeneration);
  if (lyricsMode) renderSelectedLyrics();
  updateCaptionControls();
}

if (chromeApi) {
  chromeApi.runtime.onMessage.addListener(receivePlaybackMessage);
  chromeApi.tabs.onActivated.addListener(({ tabId }) => {
    void refreshSourceTabs();
    if (selectedSourceTabId !== null || captionStarting || singalongMode !== "single" || tabId === lockedTabId) return;
    void startSingleDetection();
  });
  chromeApi.tabs.onRemoved.addListener((tabId) => {
    void refreshSourceTabs();
    if (tabId !== lockedTabId && tabId !== selectedSourceTabId) return;
    const followingActiveTab = selectedSourceTabId === null && singalongMode === "single";
    const closeGeneration = generation;
    void (async () => {
      await stopCapture(false);
      if (generation !== closeGeneration + 1) return;
      if (followingActiveTab) {
        await startSingleDetection();
        return;
      }
      captionFailure = "指定來源分頁已關閉；請重新選擇播放分頁。";
      modeBadge.textContent = "來源分頁已關閉";
      setStatus(captionFailure, "error");
      updateCaptionProgress();
    })();
  });
}

function displayPlaybackSource(report: PlaybackReport): void {
  const source = report.appId === "youtube" ? "YouTube" : report.appId === "youtube-music" ? "YouTube Music" : "Spotify Web";
  const state = report.state === "playing" ? "播放中" : report.state === "paused" ? "已暫停" : "已停止";
  const track = singalongMode === "single" && resolvedTrack ? resolvedTrack : report;
  titleElement.textContent = track.title || "正在尋找歌詞";
  playbackSourceText.textContent = `${source} · ${track.title} · ${track.artists.join("、") || "尚無歌手資料"} · ${state}`;
}

let singleOperationGeneration = 0;
async function requestPlaybackReport(tabId: number): Promise<PlaybackReport> {
  if (!chromeApi) throw new Error("只能從擴充功能側欄讀取播放來源。");
  let response: unknown;
  try {
    response = await chromeApi.runtime.sendMessage({ type: "request-playback-report", tabId });
  } catch (error) {
    throw new Error(`無法連到擴充功能 service worker：${error instanceof Error ? error.message : String(error)}`);
  }
  const reply = response as { ok?: boolean; tabId?: number; report?: unknown; error?: string } | null | undefined;
  if (!reply || reply.ok !== true) {
    throw new Error(typeof reply?.error === "string" ? reply.error : "擴充功能沒有回覆來源請求；請在擴充功能管理頁重新載入後，重新開啟側欄。");
  }
  if (reply.tabId !== tabId || !isPlaybackReport(reply.report)) throw new Error("收到的播放報告不是所選分頁的有效資料。");
  return reply.report;
}

async function lockSourceYouTubeTab(): Promise<{ tabId: number; report: PlaybackReport }> {
  const tabId = await resolveSourceTabId();
  lockedTabId = tabId;
  playbackReport = null;
  const report = await requestPlaybackReport(tabId);
  if (lockedTabId !== tabId) throw new Error("播放來源鎖定已取消。");
  receivePlaybackMessage({ type: "playback-state", tabId, report });
  const page = new URL(report.pageUrl);
  if (report.appId !== "youtube" || page.hostname !== "www.youtube.com" || page.pathname !== "/watch" || page.searchParams.get("v") !== report.mediaId) {
    throw new Error("音訊擷取只支援有有效播放報告的 YouTube /watch 影片。");
  }
  selectedSourceTabId = tabId;
  sourceSelect.value = String(tabId);
  void refreshSourceTabs();
  return { tabId, report };
}

async function lookupSingleLyrics(report: PlaybackReport, operationGeneration: number): Promise<void> {
  singleLookupController?.abort();
  const controller = new AbortController();
  singleLookupController = controller;
  const requestKey = geminiApiKey;
  const isCurrent = () => !controller.signal.aborted && operationGeneration === singleOperationGeneration &&
    singalongMode === "single" && playbackReport !== null && requestKey === geminiApiKey;
  lyricsLookupPending = true;
  setCaptionActionsVisible(false);
  lyricsStatus.textContent = "正在比對曲名、歌手與片長，自動選擇同步歌詞…";
  setAiLookupStatus("");
  lyricsLookupError = "";
  lyricsQueryStatus.textContent = "";
  lyricsQueryStatus.hidden = true;
  specialVideo = report.appId === "youtube" && report.segmentStartMs === undefined
    ? specialVideoKind(report.rawTitle ?? report.title)
    : null;
  if (specialVideo) {
    const copy = SPECIAL_VIDEO_COPY[specialVideo];
    lyricsLookupPending = false;
    modeBadge.textContent = copy.badge;
    lyricsStatus.textContent = copy.detail;
    setCaptionActionsVisible(true);
    renderLines();
    setStatus(`${copy.heading}；未查詢同步歌詞。`, "idle");
    return;
  }
  let trackTitle = report.title;
  let candidateArtists = report.artists.slice(0, 3);
  let trackDurationMs = report.durationMs;
  let artistIsVerified = report.appId !== "youtube" || report.artistVerified === true || report.segmentStartMs !== undefined;
  renderLines();
  aiMatchRejectButton.hidden = true;
  try {
    const lyricsFetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
    let selection: { record: LrclibRecord; lyrics: SyncedLyrics; recordCount: number; timelineCount: number } | null = null;
    let exactCandidatesCount = 0;
    let failuresCount = 0;

    if (candidateArtists.length && artistIsVerified) {
      const { recordsByArtist: resultsByArtist, failures } = await searchLyricsForArtists(trackTitle, candidateArtists, lyricsFetcher);
      if (!isCurrent()) return;
      if (failures.length) {
        lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
        lyricsQueryStatus.hidden = false;
        failuresCount = failures.length;
      }
      const exact = exactSyncedCandidatesForArtists(resultsByArtist, trackTitle, candidateArtists);
      exactCandidatesCount = exact.length;
      selection = await selectAutomaticLyrics(exact, candidateArtists, trackDurationMs);
      if (!isCurrent()) return;
    }

    if (!selection && report.appId === "youtube" && report.segmentStartMs === undefined && report.durationMs > 0) {
      let credit: YouTubeMusicCredit | null = null;
      if (youtubeCreditCache.has(report.mediaId)) {
        credit = youtubeCreditCache.get(report.mediaId) ?? null;
      } else {
        try {
          credit = await fetchYouTubeMusicCredit(report.mediaId, lyricsFetcher);
          if (!isCurrent()) return;
          if (youtubeCreditCache.size >= 50) youtubeCreditCache.delete(youtubeCreditCache.keys().next().value!);
          youtubeCreditCache.set(report.mediaId, credit);
        } catch {
          if (!isCurrent()) return;
        }
      }
      if (credit) {
        const { candidates, failures } = await searchLyricsForIdentity({ titles: [credit.title], artists: [credit.artist] }, report.durationMs, lyricsFetcher);
        if (!isCurrent()) return;
        if (failures.length) {
          lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
          lyricsQueryStatus.hidden = false;
          failuresCount = failures.length;
        }
        exactCandidatesCount = candidates.length;
        selection = await selectAutomaticLyrics(candidates, [credit.artist], report.durationMs);
        if (!isCurrent()) return;
        if (selection) {
          resolvedTrack = { title: selection.record.trackName, artists: [selection.record.artistName], source: "youtube-credit" };
          displayPlaybackSource(report);
        }
      }
    }

    const canAttemptAi =
      !selection &&
      Boolean(requestKey) &&
      report.appId === "youtube" &&
      report.segmentStartMs === undefined &&
      report.durationMs > 0;

    if (canAttemptAi) {
      if (aiRejectedVideoIds.includes(report.mediaId)) {
        aiMatchRejectButton.textContent = "恢復 AI 比對";
        aiMatchRejectButton.hidden = false;
        setAiLookupStatus("你已停用這支影片的 AI 比對。");
      } else {
        const rawTitle = report.rawTitle ?? report.title;
        const channel = report.artistVerified ? "" : (report.artists[0] ?? "");
        const cacheKey = JSON.stringify([report.mediaId, rawTitle, report.durationMs]);
        let identity: SongIdentity | null = null;
        let identityError = false;
        try {
          if (songResolutionCache.has(cacheKey)) {
            identity = songResolutionCache.get(cacheKey) ?? null;
          } else {
            setAiLookupStatus("LRCLIB 沒有同名歌詞；正在用你自己的 Gemini 額度（含 Google 搜尋）查詢正式曲名…");
            identity = await identifySong({ rawTitle, channel, durationMs: report.durationMs }, requestKey, { signal: controller.signal });
            if (!isCurrent()) return;
            if (songResolutionCache.size >= 50) songResolutionCache.delete(songResolutionCache.keys().next().value!);
            songResolutionCache.set(cacheKey, identity);
          }
        } catch (error) {
          if (!isCurrent()) return;
          identityError = true;
          const message = error instanceof Error ? error.message : "AI 曲目解析失敗。";
          setAiLookupStatus(`${message} 未套用 AI 結果。`);
        }
        if (!isCurrent()) return;

        if (identity) {
          const { candidates, failures } = await searchLyricsForIdentity(identity, report.durationMs, lyricsFetcher);
          if (!isCurrent()) return;
          if (failures.length) {
            lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
            lyricsQueryStatus.hidden = false;
            failuresCount = failures.length;
          }
          exactCandidatesCount = candidates.length;
          const aiSelection = await selectAutomaticLyrics(candidates, identity.artists, report.durationMs);
          if (!isCurrent()) return;
          if (aiSelection) {
            selection = aiSelection;
            resolvedTrack = { title: selection.record.trackName, artists: [selection.record.artistName], source: "ai" };
            displayPlaybackSource(report);
            setAiLookupStatus(`AI 經 Google 搜尋將這支影片對應為「${selection.record.trackName}」— ${selection.record.artistName}（LRCLIB ${selection.record.id}）；若不是這首，請按「不是這首」。`);
          } else {
            setAiLookupStatus(`AI 查到正式曲名「${identity.titles.join("／")}」，但 LRCLIB 沒有片長相符的同步歌詞。`);
          }
        } else if (!identityError) {
          setAiLookupStatus("AI 未能確認這支影片對應的單一正式曲目；未套用歌詞。");
        }
      }
    }

    if (!selection) {
      selectedLyrics = null;
      lyricsMode = false;
      populateLyricTimingLines();
      lyricsLookupPending = false;
      setCaptionActionsVisible(true);
      renderLines();

      if (!candidateArtists.length) {
        lyricsStatus.textContent = "播放資訊沒有歌手，無法安全比對同步歌詞。";
        setStatus("已取得曲名，但沒有可驗證的歌手資訊。", "idle");
        return;
      }
      if (!artistIsVerified) {
        lyricsStatus.textContent = "YouTube 沒有可驗證的歌手資料；不會猜測或顯示不確定的歌詞。";
        setStatus("缺少可驗證的歌手資訊，未套用歌詞。", "idle");
        return;
      }
      lyricsStatus.textContent = exactCandidatesCount > 0
        ? "相符資料沒有有效時間戳；未顯示不同步的歌詞。"
        : "沒有找到曲名與歌手相符的同步歌詞。";
      setStatus(failuresCount ? "部分查詢失敗；目前未取得可用同步歌詞，可按「重新偵測」再查。" : `已查詢「${trackTitle}」；目前未取得相符同步歌詞。`, failuresCount ? "error" : "idle");
      return;
    }

    lyricsLookupPending = false;
    setCaptionActionsVisible(false);
    selectedLyrics = selection.lyrics;
    populateLyricTimingLines();
    lyricsMode = true;
    stopButton.disabled = false;
    const automaticVersion = selection.recordCount > 1;
    modeBadge.textContent = `${resolvedTrack?.source === "ai" ? "AI 曲名 · " : resolvedTrack?.source === "youtube-credit" ? "YouTube 曲目資訊 · " : ""}${automaticVersion ? "自動選版同步歌詞" : "單曲同步歌詞"}`;
    if (resolvedTrack?.source === "ai") {
      aiMatchRejectButton.textContent = "不是這首";
      aiMatchRejectButton.hidden = false;
    }
    lyricsStatus.textContent = automaticVersion
      ? `已從 ${selection.recordCount} 筆相符資料、${selection.timelineCount} 種時間軸自動選版（LRCLIB ${selection.record.id}）；優先比對片長，再比對歌手。MV 片頭可能造成時間差。`
      : `已匹配同步歌詞（LRCLIB ${selection.record.id}）；位置跟隨播放分頁。`;
    startLyricsClock();
    renderLines();
    setStatus("歌詞隨播放進度同步。", "listening");
  } catch (error) {
    if (!isCurrent()) return;
    lyricsLookupPending = false;
    lyricsLookupError = error instanceof Error ? error.message : "無法自動取得同步歌詞。";
    lyricsStatus.textContent = lyricsLookupError;
    setStatus(`同步歌詞查詢失敗：${lyricsLookupError}`, "error");
    setCaptionActionsVisible(true);
    renderLines();
  } finally {
    if (singleLookupController === controller) singleLookupController = null;
  }
}

async function startSingleDetection(): Promise<void> {
  await stopCapture(false);
  const operationGeneration = ++singleOperationGeneration;
  ++generation;
  singalongMode = "single";
  selectedLyrics = null;
  lyricsMode = false;
  lockedTabId = null;
  playbackReport = null;
  setLyricTimingFeedback("");
  lyricTimingGapStatus.hidden = true;
  populateLyricTimingLines();
  setCaptionActionsVisible(false);
  titleElement.textContent = "正在尋找歌詞";
  renderLines();
  selectedLyricsElement.replaceChildren();
  modeBadge.textContent = "讀取播放來源";
  playbackSourceText.textContent = "正在讀取目前分頁的播放器、曲名與播放狀態…";
  lyricsStatus.textContent = "先取得播放來源，再比對同步歌詞。";
  setStatus("正在取得目前播放分頁的曲名與進度…", "busy");
  try {
    if (!chromeApi) throw new Error("請從擴充功能側欄操作，而不是開啟一般網頁。");
    const tabId = await resolveSourceTabId();
    if (operationGeneration !== singleOperationGeneration) return;
    if (typeof tabId !== "number" || !Number.isSafeInteger(tabId)) throw new Error("無法識別目前分頁；請切回播放頁後開啟側欄。");
    lockedTabId = tabId;
    startLyricsClock();
    stopButton.disabled = false;
    const report = await requestPlaybackReport(tabId);
    if (operationGeneration !== singleOperationGeneration) return;
    receivePlaybackMessage({ type: "playback-state", tabId, report });
  } catch (error) {
    if (operationGeneration !== singleOperationGeneration) return;
    const message = error instanceof Error ? error.message : "無法取得播放來源。";
    clearSelectedTrack(message);
    playbackSourceText.textContent = `來源診斷：${message}`;
    modeBadge.textContent = "來源讀取失敗";
    titleElement.textContent = "無法讀取播放來源";
    setStatus(message, "error");
    playbackReport = null;
    stopButton.disabled = false;
  }
}

singleModeButton.addEventListener("click", () => {
  captionFailure = null;
  updateCaptionProgress();
  void startSingleDetection();
});
sourceRefreshButton.addEventListener("click", () => void refreshSourceTabs());
sourceSelect.addEventListener("change", () => {
  const value = sourceSelect.value;
  const selected = value === "auto" ? null : Number(value);
  if (selected !== null && !Number.isSafeInteger(selected)) return;
  selectedSourceTabId = selected;
  void refreshSourceTabs();
  captionFailure = null;
  updateCaptionProgress();
  updateSourceControls();
  void startSingleDetection();
});

loadButton.addEventListener("click", () => {
  loadButton.hidden = false;
  loadButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  if (worker) worker.terminate();
  worker = createWorker();
  worker.postMessage({ type: "init" });
  setStatus("正在確認 WebGPU 並準備多語辨識模型…", "busy");
});

async function startMixFirst(): Promise<void> {
  if (captionStarting || singalongMode !== "single" || selectedLyrics !== null) return;
  if (!modelReady) {
    setStatus("請先載入本機 Whisper 模型。", "error");
    return;
  }
  const sourceOperation = singleOperationGeneration;
  const expectedMediaId = playbackReport?.mediaId;
  let sessionGeneration = generation;
  let started = false;
  captionStarting = true;
  captionFailure = null;
  updateCaptionControls();
  updateCaptionProgress();
  try {
    const tabId = await resolveSourceTabId();
    const report = await requestPlaybackReport(tabId);
    if (sourceOperation !== singleOperationGeneration || singalongMode !== "single" || !captionStarting) return;
    if (lockedTabId !== tabId || report.mediaId !== expectedMediaId || selectedLyrics !== null || lyricsLookupPending) {
      throw new Error("播放來源或曲目正在變更，請等待重新偵測完成再建立字幕。");
    }
    const problem = mixPreparationProblem(report);
    if (problem) throw new Error(problem);
    selectedSourceTabId = tabId;
    sourceSelect.value = String(tabId);
    void refreshSourceTabs();
    await stopCapture(false);
    singalongMode = "mix-first";
    captionStarting = true;
    started = true;
    sessionGeneration = ++generation;
    lockedTabId = tabId;
    playbackReport = report;
    displayPlaybackSource(report);
    stopButton.disabled = false;
    setCaptionActionsVisible(false);
    mixFirstAnchor = null;
    captureConnected = false;
    mixCapturedMs = 0;
    lastEmptyAudioState = null;
    activeMixVideoId = null;
    activeMixSessionId = null;
    mixWindowCount = 0;
    mixWindowResults = 0;
    mixPersistedWindows = 0;
    mixRecognizedLines = 0;
    mixNextWindowIndex = 0;
    mixPersistenceQueue = Promise.resolve();
    mixDrainResolver = null;
    mixFinalizing = false;
    transcriptLines = new TranscriptLines();
    visibleLines = [];
    selectedLyrics = null;
    lyricsMode = false;
    modeBadge.textContent = "建立字幕 · 音訊推測";
    setStatus("正在連接指定分頁的音訊；請先保持暫停。", "busy");
    updateCaptionProgress();
    renderLines();
    const cache = await requireMixCache();
    if (sessionGeneration !== generation || singalongMode !== "mix-first") return;
    activeMixVideoId = report.mediaId;
    activeMixDurationMs = report.mediaDurationMs ?? report.durationMs;
    activeMixSessionId = report.sessionId;
    await cache.begin(report.mediaId, activeMixDurationMs);
    if (sessionGeneration !== generation || singalongMode !== "mix-first") {
      await cache.markIncomplete(report.mediaId);
      return;
    }
    if (!modelReady) throw new Error("本機模型已失效；請重新載入模型後重試。");
    startLyricsClock();
    const session = new AudioCapture({
      mode: "mix-first",
      shouldBuffer: () => captureConnected && mixFirstAnchor !== null && !mixFinalizing,
      onProgress(capturedMs) {
        if (capture !== session || generation !== sessionGeneration) return;
        mixCapturedMs = capturedMs;
        updateCaptionProgress();
      },
      onWindow(window) {
        if (capture !== session || generation !== sessionGeneration || !worker) return;
        if (mixWindowCount - mixWindowResults >= 6) {
          void failMix("ASR 窗口佇列已滿；為避免跳過字幕，本次首遍未完成。", sessionGeneration);
          return;
        }
        mixWindowCount += 1;
        const windowIndex = mixNextWindowIndex++;
        worker.postMessage({
          type: "transcribe",
          generation: sessionGeneration,
          windowIndex,
          startMs: window.startMs,
          samples: window.samples,
        }, [window.samples.buffer]);
        updateCaptionProgress();
        setStatus(`字幕辨識中：已送出 ${mixWindowCount} 段，完成 ${mixWindowResults} 段。`, "busy");
      },
      onError(message) {
        if (capture === session && generation === sessionGeneration) void failMix(message, sessionGeneration);
      },
      onEnded() {
        if (capture === session && generation === sessionGeneration) {
          void failMix("分頁音軌意外結束；本次合輯字幕未完成。", sessionGeneration);
        }
      },
    });
    capture = session;
    await session.start(tabId);
    if (capture === session && generation === sessionGeneration) {
      captureConnected = true;
      updateCaptionProgress();
      setStatus("音訊已連接。現在請從指定影片 0 秒按播放；保持 1×，不中斷播至結束。", "listening");
    }
  } catch (error) {
    if (sessionGeneration !== generation) return;
    const message = error instanceof Error ? error.message : "無法擷取指定 YouTube 分頁。";
    if (started) {
      await stopCapture(false);
      if (generation !== sessionGeneration + 1) return;
      captionFailure = message;
      await startSingleDetection();
    } else {
      captionFailure = message;
    }
    if (captionFailure !== null) {
      setStatus(message, "error");
      updateCaptionProgress();
    }
  } finally {
    if (generation === sessionGeneration) {
      captionStarting = false;
      updateCaptionControls();
    }
  }
}

mixFirstButton.addEventListener("click", () => void startMixFirst());
async function startMixReplay(): Promise<void> {
  await stopCapture(false);
  singalongMode = "mix-replay";
  stopButton.disabled = false;
  setCaptionActionsVisible(false);
  const replayGeneration = generation;
  activeReplay = null;
  replayFocusIndex = -1;
  modeBadge.textContent = "載入合輯字幕";
  setStatus("正在比對目前 YouTube 影片與本機完整字幕快取…", "busy");
  try {
    const { report } = await lockSourceYouTubeTab();
    if (replayGeneration !== generation || singalongMode !== "mix-replay") return;
    const cache = await requireMixCache();
    const complete = await cache.getComplete(report.mediaId);
    const mediaDurationMs = report.mediaDurationMs ?? report.durationMs;
    if (!complete) throw new Error("目前影片沒有完整首遍字幕快取；未完成草稿不能用於二刷。");
    if (complete.durationMs !== mediaDurationMs) throw new Error("快取片長與目前 YouTube 影片不符；不會用錯誤時間軸顯示字幕。");
    if (replayGeneration !== generation || singalongMode !== "mix-replay") return;
    activeReplay = complete;
    stopButton.disabled = false;
    startLyricsClock();
    renderMixReplay(report);
    setStatus(`已載入 ${complete.lines.length} 行本機字幕；播放、暫停與 seek 均依影片時間同步。`, "listening");
  } catch (error) {
    if (replayGeneration !== generation || singalongMode !== "mix-replay") return;
    const message = error instanceof Error ? error.message : "無法載入合輯字幕快取。";
    await stopCapture(false);
    if (generation !== replayGeneration + 1) return;
    captionFailure = message;
    await startSingleDetection();
    if (captionFailure !== null) {
      setStatus(message, "error");
      updateCaptionProgress();
    }
  }
}

mixReplayButton.addEventListener("click", () => void startMixReplay());

async function stopCapture(inform = true): Promise<void> {
  if (inform) captionFailure = null;
  const incompleteMixVideoId = singalongMode === "mix-first" ? activeMixVideoId : null;
  generation += 1;
  captureConnected = false;
  captionStarting = false;
  singalongMode = "idle";
  activeMixVideoId = null;
  activeMixSessionId = null;
  mixFirstAnchor = null;
  worker?.postMessage({ type: "cancel" });
  const active = capture;
  capture = null;
  await active?.stop();
  let persistenceError: string | null = null;
  if (incompleteMixVideoId) {
    try {
      await mixCache?.markIncomplete(incompleteMixVideoId);
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : "IndexedDB 寫入失敗";
    }
  }
  mixDrainResolver?.();
  mixDrainResolver = null;
  activeMixVideoId = null;
  activeMixSessionId = null;
  mixFirstAnchor = null;
  activeReplay = null;
  replayFocusIndex = -1;
  lockedTabId = null;
  singalongMode = "idle";
  clearSelectedTrack("跟唱或字幕擷取已停止；舊歌詞與待處理工作已清除。");
  stopButton.disabled = true;
  if (lyricsTicker !== undefined) {
    window.clearInterval(lyricsTicker);
    lyricsTicker = undefined;
  }
  updateCaptionControls();
  updateCaptionProgress();
  if (inform) setStatus(persistenceError
    ? `已停止，但字幕草稿未能儲存：${persistenceError}`
    : incompleteMixVideoId ? "已停止；合輯草稿標記為未完成，不能用於二刷。"
    : "已停止。播放來源鎖定、音訊緩衝與待處理結果已清除。", persistenceError ? "error" : "idle");
}

stopButton.addEventListener("click", () => void stopCapture());
systemSelect.addEventListener("change", saveCurrentDisplayPreferences);
preferencesFieldset.addEventListener("change", saveCurrentDisplayPreferences);
originalToggle.addEventListener("change", () => {
  if (singalongMode === "mix-replay") {
    replayFocusIndex = -1;
    renderMixReplay();
  } else {
    renderLines();
  }
});
aiMatchRejectButton.addEventListener("click", () => {
  const mediaId = playbackReport?.mediaId;
  if (!mediaId) return;
  if (aiMatchRejectButton.textContent === "恢復 AI 比對") {
    aiRejectedVideoIds = aiRejectedVideoIds.filter((id) => id !== mediaId);
    persistAiRejections();
    void startSingleDetection();
  } else {
    if (!aiRejectedVideoIds.includes(mediaId)) {
      aiRejectedVideoIds.push(mediaId);
      if (aiRejectedVideoIds.length > 200) aiRejectedVideoIds.shift();
    }
    persistAiRejections();
    void startSingleDetection();
  }
});
void Promise.all([initializeDisplayPreferences(), initializeGeminiKey(), initializeLyricTimingCorrections(), initializeAiRejections()]).then(() => {
  void refreshSourceTabs();
  return startSingleDetection();
});
window.addEventListener("pagehide", () => { void stopCapture(false); });
