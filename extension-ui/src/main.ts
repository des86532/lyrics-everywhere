import "./style.css";
import { AudioCapture } from "./audio-capture.js";
import { KoreanTranscriber } from "../../src/pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../../src/pronunciation/japanese-transcriber.js";
import { TranscriberRegistry } from "../../src/pronunciation/transcriber-registry.js";
import type { PhoneticSystem } from "../../src/domain/types.js";
import { STEP_SECONDS, WINDOW_SECONDS } from "./window-buffer.js";
import { TranscriptLines, type TranscriptLine, type TimestampedChunk } from "./transcript-lines.js";
import type { SyncedLyrics } from "../../src/domain/types.js";
import { durationTolerance, fetchLrclibRecord, lrclibFetcher, parseRecordLyrics, searchLyricsByVideoTitle, searchLyricsForArtists, searchLyricsForIdentity, selectAutomaticLyrics, type LrclibRecord } from "./lyrics.js";
import { selectYouTubeMusicCredit, type YouTubeMusicCredit } from "./youtube-music-credit.js";
import { exactSyncedCandidatesForArtists, lyricFocusAt, lyricWindowStart, LYRICS_WINDOW_SIZE, mixReplayWindow, playbackPositionAt, playbackTrackPositionAt, specialVideoKind, titleLookupKeyword, type LyricFocus, type PlaybackReport, type SpecialVideoKind } from "./playback.js";
import { MANUAL_LYRICS_STORAGE_KEY, MAX_MANUAL_SELECTIONS, manualLyricsPrompt, parseManualLyricsInput, parseManualSelections, parseRejectedVideoIds, updateManualSelections, updateRejectedVideoIds, extractLyricSnippet, formatDuration, rankCandidateRecords } from "./manual-lyrics.js";
import { alignedLyricOffset, formatLyricOffset, lyricPositionForVideo, nudgeLyricOffset, parseLyricOffset, parseLyricTimingCorrections, updateLyricTimingCorrections } from "./lyric-timing.js";
import { MixCache, type CompleteMix } from "./mix-cache.js";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  readDisplayPreferences,
  saveDisplayPreferences,
  type DisplayPreferences,
  type DisplayPreferencesStorage,
  type PreservedLanguage,
} from "./preferences.js";
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
    connect?(info: { name: string }): { onDisconnect: { addListener(listener: () => void): void } };
  };
  tabs: {
    query(query: { active: true; lastFocusedWindow: true }): Promise<Array<{ id?: number }>>;
    onActivated: { addListener(listener: (activeInfo: { tabId: number }) => void): void };
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  storage?: {
    local?: DisplayPreferencesStorage & { remove?(keys: string): Promise<void> };
    onChanged?: { addListener(listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
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
    (report.musicCredits === undefined || Array.isArray(report.musicCredits) && report.musicCredits.length <= 10 &&
      report.musicCredits.every((c) =>
        c && typeof c === "object" &&
        "title" in c && typeof c.title === "string" &&
        "artist" in c && typeof c.artist === "string" &&
        c.title.trim().length >= 1 && c.title.trim().length <= 120 &&
        c.artist.trim().length >= 1 && c.artist.trim().length <= 120
      )) &&
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
const lyricTimingOffsetInput = element<HTMLInputElement>("lyric-timing-offset");
const lyricTimingApplyButton = element<HTMLButtonElement>("lyric-timing-apply");
const lyricTimingClearButton = element<HTMLButtonElement>("lyric-timing-clear");
const lyricTimingFeedback = element<HTMLParagraphElement>("lyric-timing-feedback");
const lyricCalibrationBar = element<HTMLDivElement>("lyric-calibration-bar");
const calibrationToggleButton = element<HTMLButtonElement>("calibration-toggle");
const calibrationEarlierButton = element<HTMLButtonElement>("calibration-earlier");
const calibrationLaterButton = element<HTMLButtonElement>("calibration-later");
const calibrationRevertButton = element<HTMLButtonElement>("calibration-revert");
const calibrationStatus = element<HTMLParagraphElement>("calibration-status");
const singleModeButton = element<HTMLButtonElement>("single-mode");
const mixFirstButton = element<HTMLButtonElement>("mix-first-mode");
const mixReplayButton = element<HTMLButtonElement>("mix-replay-mode");
const aiMatchRejectButton = element<HTMLButtonElement>("ai-match-reject");
const titleElement = element<HTMLHeadingElement>("transcript-title");
const sourceSelect = element<HTMLSelectElement>("source-tab");
const sourceRefreshButton = element<HTMLButtonElement>("refresh-source-tabs");
const pinSourceButton = element<HTMLButtonElement>("pin-source");
const candidateVersionsBtn = element<HTMLButtonElement>("candidate-versions-btn");
const candidateVersionsCount = element<HTMLSpanElement>("candidate-versions-count");
const openSettingsButton = element<HTMLButtonElement>("open-settings");
const closeSettingsButton = element<HTMLButtonElement>("close-settings");
const settingsDialog = element<HTMLDialogElement>("settings-dialog");
const candidateVersionsSection = element<HTMLDivElement>("candidate-versions-section");
const candidateVersionsList = element<HTMLDivElement>("candidate-versions-list");
const manualLyricsDetails = element<HTMLDetailsElement>("manual-lyrics");
const sourceSelectionStatus = element<HTMLParagraphElement>("source-selection-status");
const sourceModeText = element<HTMLSpanElement>("source-mode");
const captionHelp = element<HTMLParagraphElement>("caption-help");
const captionProgress = element<HTMLParagraphElement>("caption-progress");
const manualLyricsMode = element<HTMLSpanElement>("manual-lyrics-mode");
const openLrclibSearchLink = element<HTMLAnchorElement>("open-lrclib-search");
const copyAiPromptButton = element<HTMLButtonElement>("copy-ai-prompt");
const manualLyricsInput = element<HTMLTextAreaElement>("manual-lyrics-input");
const applyManualLyricsButton = element<HTMLButtonElement>("apply-manual-lyrics");
const clearManualLyricsButton = element<HTMLButtonElement>("clear-manual-lyrics");
const manualLyricsStatus = element<HTMLParagraphElement>("manual-lyrics-status");
const aiLookupStatus = element<HTMLParagraphElement>("ai-lookup-status");
let manualSelections = new Map<string, number>();
const manualRecordCache = new Map<number, LrclibRecord>();
let manualApplying = false;
let manualSearchTitle: string | null = null;
let singleLookupController: AbortController | null = null;
let resolvedTrack: { title: string; artists: string[]; source: "youtube-credit" | "title-match" | "manual" } | null = null;
const AI_REJECTED_STORAGE_KEY = "aiRejectedVideoIds";
let aiRejectedVideoIds: string[] = [];
let availableCandidates: LrclibRecord[] = [];
let availableCandidatesMediaId: string | null = null;
let currentLyricsRecordId: number | undefined;
const CALIBRATION_STEP_MS = 500;
let calibrating = false;
let calibrationRevert: { key: string; offsetMs: number | undefined } | null = null;
let calibrationMessage = "";
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
  const label = busy ? "字幕工作已鎖定來源" : selectedSourceTabId === null ? "自動跟隨播放頁"
    : sourceSelect.selectedOptions[0]?.disabled ? "指定來源不可用" : `已鎖定分頁 ${selectedSourceTabId}`;
  if (sourceModeText.textContent !== label) sourceModeText.textContent = label;
  const pinned = selectedSourceTabId !== null;
  pinSourceButton.disabled = busy || (!pinned && (lockedTabId === null || playbackReport === null || singalongMode !== "single"));
  pinSourceButton.setAttribute("aria-pressed", String(pinned));
  const pinText = pinned ? "解除固定" : "固定此分頁";
  if (pinSourceButton.textContent !== pinText) pinSourceButton.textContent = pinText;
  pinSourceButton.title = pinned ? `目前固定分頁 ${selectedSourceTabId}；按下改回自動跟隨播放頁` : "固定目前歌詞來源分頁；切換其他分頁不會換歌詞";
}

async function refreshSourceTabs(): Promise<PlaybackTab[] | null> {
  if (!chromeApi) return null;
  const requestGeneration = ++sourceListGeneration;
  sourceRefreshButton.disabled = true;
  try {
    const response = await chromeApi.runtime.sendMessage({ type: "list-playback-tabs" }) as {
      ok?: boolean; tabs?: PlaybackTab[]; error?: string;
    } | undefined;
    if (requestGeneration !== sourceListGeneration) return null;
    if (!response?.ok || !Array.isArray(response.tabs)) throw new Error(response?.error ?? "無法取得播放分頁列表。");
    sourceSelect.replaceChildren(new Option("自動：跟隨最近切到的播放頁", "auto"));
    for (const tab of response.tabs) sourceSelect.add(new Option(`${tab.title} · 分頁 ${tab.tabId}`, String(tab.tabId)));
    const sourceMissing = selectedSourceTabId !== null && !response.tabs.some((tab) => tab.tabId === selectedSourceTabId);
    if (sourceMissing) {
      const missing = new Option(`指定分頁 ${selectedSourceTabId} 已關閉或不再是播放頁`, String(selectedSourceTabId));
      missing.disabled = true;
      sourceSelect.add(missing);
    }
    sourceSelect.value = selectedSourceTabId === null ? "auto" : String(selectedSourceTabId);
    sourceSelectionStatus.textContent = selectedSourceTabId === null
      ? "自動模式：切到 YouTube、YouTube Music 或 Spotify 播放頁才會換歌詞；切到其他網頁會保留目前歌詞。按上方「固定此分頁」可完全鎖定。"
      : sourceMissing ? "指定分頁已關閉或離開支援網站；不會自動換到其他分頁，請另選來源。"
        : "已指定播放分頁；該分頁內換歌仍會重新匹配。要換來源請重新選擇。";
    return response.tabs;
  } catch (error) {
    if (requestGeneration !== sourceListGeneration) return null;
    sourceSelectionStatus.textContent = error instanceof Error ? error.message : "無法列出播放分頁。";
    return null;
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
  renderManualLyricsControls();
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
let lyricTimingOffsets: Record<string, number> = {};
let lyricTimingInputKey: string | null = null;
let storageWriteQueue: Promise<void> = Promise.resolve();
let storageWritesPending = 0;
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
let mixFinalWindowIndex = -1;
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
  const lines = transcriptLines.append(startMs, message.chunks ?? [], {
    windowMs: WINDOW_SECONDS * 1000,
    commitBeforeMs: message.windowIndex === mixFinalWindowIndex ? undefined : STEP_SECONDS * 1000,
  })
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

function setAiLookupStatus(message: string): void {
  aiLookupStatus.textContent = message;
  aiLookupStatus.hidden = !message;
}

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
    phoneticSystem: systemSelect.value === "latin" ? "latin" : "chinese",
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
  delete selectedLyricsElement.dataset.calibrationHash; // pronunciation/display settings may have changed
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
  const key = selectedTimingKey();
  lyricCalibrationBar.hidden = !shown || !key;
  if (lyricCalibrationBar.hidden && calibrating) exitCalibration(false);
  if (!shown) return;
  const offsetMs = key ? lyricTimingOffsets[key] : undefined;
  if (key !== lyricTimingInputKey) { // prefill only when video/lyrics change; never clobber typing on clock ticks
    lyricTimingInputKey = key;
    lyricTimingOffsetInput.value = offsetMs !== undefined ? formatLyricOffset(offsetMs) : "";
  }
  lyricTimingOffsetInput.disabled = !key;
  lyricTimingApplyButton.disabled = !key;
  lyricTimingClearButton.disabled = !key || offsetMs === undefined;
  if (!key) setLyricTimingFeedback("影片或歌詞版本識別資料無效，不能保存校時。");
  else if (!lyricTimingFeedback.textContent && offsetMs !== undefined) setLyricTimingFeedback(`已載入這支影片與此歌詞版本的校時：${formatLyricOffset(offsetMs)}。`);
}

async function initializeLyricTimingCorrections(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    lyricTimingOffsets = parseLyricTimingCorrections((await storage.get(LYRIC_TIMING_STORAGE_KEY))[LYRIC_TIMING_STORAGE_KEY]);
  } catch {
    lyricTimingOffsets = {};
    setLyricTimingFeedback("無法讀取校時資料；本次操作仍可使用，但不會載入已保存校正。");
  }
}

// Read-latest, apply one change, write: serialized in this panel and (via Web Locks) across side panels.
function updateStored<T>(key: string, change: (stored: unknown) => T, serialize: (value: T) => unknown, apply: (value: T) => void): Promise<void> {
  storageWritesPending += 1;
  const run = storageWriteQueue.then(async () => {
    const write = async () => {
      const storage = chromeApi?.storage?.local;
      if (!storage) throw new Error("storage.local unavailable");
      const next = change((await storage.get(key))[key]);
      await storage.set({ [key]: serialize(next) });
      if (storageWritesPending === 1) apply(next);
    };
    if (navigator.locks) await navigator.locks.request("lyrics-everywhere-storage", write);
    else await write();
  });
  storageWriteQueue = run.catch(() => {}).finally(() => { storageWritesPending -= 1; });
  return run;
}

function refreshLyricTimingViews(): void {
  updateLyricTimingControls();
  renderSelectedLyrics();
  renderCalibrationControls();
}

function persistLyricTimingCorrection(key: string, offsetMs: number): void {
  void updateStored(LYRIC_TIMING_STORAGE_KEY, (stored) => updateLyricTimingCorrections(stored, key, offsetMs), (value) => value, (value) => {
    lyricTimingOffsets = value;
    refreshLyricTimingViews();
  }).then(() => {
    setLyricTimingFeedback("校時已保存於此瀏覽器。");
  }, () => {
    setLyricTimingFeedback("校時已在本頁套用，但本機儲存失敗，重新開啟後不會保留。");
  });
}

async function initializeAiRejections(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    aiRejectedVideoIds = parseRejectedVideoIds((await storage.get(AI_REJECTED_STORAGE_KEY))[AI_REJECTED_STORAGE_KEY]);
  } catch {
    aiRejectedVideoIds = [];
  }
}

function persistAiRejection(videoId: string, rejected: boolean): void {
  void updateStored(AI_REJECTED_STORAGE_KEY, (stored) => updateRejectedVideoIds(stored, videoId, rejected), (value) => value, (value) => { aiRejectedVideoIds = value; }).catch(() => {
    setAiLookupStatus("已在本頁停用，但本機儲存失敗，重新開啟後不會保留。");
  });
}

function manualTarget(): PlaybackReport | null {
  const report = playbackReport;
  return singalongMode === "single" && report !== null && isEligibleYoutubeReport(report) &&
    report.segmentStartMs === undefined && report.durationMs > 0 ? report : null;
}

function renderManualLyricsControls(): void {
  const report = manualTarget();
  const rawTitle = report ? report.rawTitle ?? report.title : null;
  if (rawTitle !== manualSearchTitle) {
    openLrclibSearchLink.href = rawTitle ? `https://lrclib.net/search/${encodeURIComponent(titleLookupKeyword(rawTitle))}` : "https://lrclib.net/";
    manualSearchTitle = rawTitle;
  }
  copyAiPromptButton.disabled = !report;
  manualLyricsInput.disabled = applyManualLyricsButton.disabled = !report || manualApplying;
  const chosen = report ? manualSelections.get(report.mediaId) : undefined;
  clearManualLyricsButton.hidden = chosen === undefined;
  clearManualLyricsButton.disabled = manualApplying;
  const mode = chosen === undefined ? "自動比對" : `已指定 LRCLIB ${chosen}`;
  if (manualLyricsMode.textContent !== mode) manualLyricsMode.textContent = mode;
  renderCandidateVersions();
}

function renderCandidateVersions(): void {
  const report = manualTarget();
  if (!report || availableCandidatesMediaId !== report.mediaId || availableCandidates.length === 0) {
    candidateVersionsBtn.hidden = true;
    candidateVersionsSection.hidden = true;
    candidateVersionsList.replaceChildren();
    return;
  }

  const chosen = report ? manualSelections.get(report.mediaId) : undefined;
  const activeId = chosen ?? currentLyricsRecordId;
  const ranked = rankCandidateRecords(availableCandidates, activeId, report.durationMs);

  if (ranked.length <= 1 && activeId !== undefined) {
    candidateVersionsBtn.hidden = true;
  } else {
    candidateVersionsBtn.hidden = false;
    candidateVersionsCount.textContent = String(ranked.length);
  }

  candidateVersionsSection.hidden = ranked.length === 0;
  candidateVersionsList.replaceChildren();

  for (const record of ranked) {
    const isCurrent = record.id === activeId;
    const item = document.createElement("div");
    item.className = `candidate-version-item ${isCurrent ? "is-active" : ""}`;

    const info = document.createElement("div");
    info.className = "candidate-version-info";

    const titleEl = document.createElement("div");
    titleEl.className = "candidate-version-title";
    titleEl.textContent = `${record.trackName} — ${record.artistName}`;

    const metaEl = document.createElement("div");
    metaEl.className = "candidate-version-meta";
    metaEl.textContent = `片長 ${formatDuration(record.duration)}${record.albumName ? ` · ${record.albumName}` : ""}`;

    const snippetEl = document.createElement("div");
    snippetEl.className = "candidate-version-snippet";
    const snippet = extractLyricSnippet(record.syncedLyrics);
    snippetEl.textContent = snippet ? `“${snippet}”` : "（無預覽）";

    info.appendChild(titleEl);
    info.appendChild(metaEl);
    info.appendChild(snippetEl);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `button candidate-version-btn ${isCurrent ? "button-primary" : "button-secondary"}`;
    btn.textContent = isCurrent ? "使用中" : "切換";
    btn.disabled = isCurrent || manualApplying;

    if (!isCurrent) {
      btn.addEventListener("click", () => {
        void selectCandidateRecord(record);
      });
    }

    item.appendChild(info);
    item.appendChild(btn);
    candidateVersionsList.appendChild(item);
  }
}

async function selectCandidateRecord(record: LrclibRecord): Promise<void> {
  const report = manualTarget();
  if (!report || manualApplying) return;
  manualApplying = true;
  renderManualLyricsControls();
  manualLyricsStatus.textContent = `已切換為 LRCLIB ${record.id}「${record.trackName}」— ${record.artistName}。`;
  try {
    manualSelections.delete(report.mediaId);
    manualSelections.set(report.mediaId, record.id);
    if (manualSelections.size > MAX_MANUAL_SELECTIONS) manualSelections.delete(manualSelections.keys().next().value!);
    cacheManualRecord(record);
    persistManualSelection(report.mediaId, record.id);
    manualLyricsInput.value = "";
    currentLyricsRecordId = record.id;
    renderManualLyricsControls();
    await startSingleDetection();
  } catch (error) {
    manualLyricsStatus.textContent = `切換版本失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
  } finally {
    manualApplying = false;
    renderManualLyricsControls();
  }
}

async function initializeManualSelections(): Promise<void> {
  try {
    const storage = chromeApi?.storage?.local;
    if (!storage) throw new Error("storage.local unavailable");
    manualSelections = parseManualSelections((await storage.get(MANUAL_LYRICS_STORAGE_KEY))[MANUAL_LYRICS_STORAGE_KEY]);
    // Drop the API key stored by earlier versions that called Gemini.
    void Promise.resolve(storage.remove?.("geminiApiKey")).catch(() => {});
  } catch {
    manualSelections = new Map();
  }
}

function persistManualSelection(videoId: string, lrclibId: number | null): void {
  void updateStored(MANUAL_LYRICS_STORAGE_KEY, (stored) => updateManualSelections(stored, videoId, lrclibId), (value) => [...value], (value) => {
    manualSelections = value;
    renderManualLyricsControls();
  }).catch(() => { manualLyricsStatus.textContent = "已在本頁套用，但本機儲存失敗，重新開啟後不會保留。"; });
}

chromeApi?.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || storageWritesPending > 0) return;
  if (LYRIC_TIMING_STORAGE_KEY in changes) {
    lyricTimingOffsets = parseLyricTimingCorrections(changes[LYRIC_TIMING_STORAGE_KEY]!.newValue);
    refreshLyricTimingViews();
  }
  if (AI_REJECTED_STORAGE_KEY in changes) aiRejectedVideoIds = parseRejectedVideoIds(changes[AI_REJECTED_STORAGE_KEY]!.newValue);
  if (MANUAL_LYRICS_STORAGE_KEY in changes) {
    manualSelections = parseManualSelections(changes[MANUAL_LYRICS_STORAGE_KEY]!.newValue);
    renderManualLyricsControls();
  }
});

function cacheManualRecord(record: LrclibRecord): void {
  manualRecordCache.delete(record.id);
  manualRecordCache.set(record.id, record);
  if (manualRecordCache.size > 20) manualRecordCache.delete(manualRecordCache.keys().next().value!);
}

async function applyManualLyrics(): Promise<void> {
  const report = manualTarget();
  if (!report || manualApplying) return;
  const parsed = parseManualLyricsInput(manualLyricsInput.value);
  if (!parsed) {
    manualLyricsStatus.textContent = "看不懂這段內容；請貼上 LRCLIB 歌曲連結（https://lrclib.net/tracks/數字），或「歌名：…」「歌手：…」兩行。";
    return;
  }
  if (parsed.kind === "undetermined") {
    manualLyricsStatus.textContent = "AI 無法確定這支影片的曲目；可改按「到 LRCLIB 搜尋」自行挑選。";
    return;
  }
  manualApplying = true;
  renderManualLyricsControls();
  manualLyricsStatus.textContent = "正在向 LRCLIB 查詢…";
  try {
    let record: LrclibRecord;
    if (parsed.kind === "lrclib-id") {
      const found = manualRecordCache.get(parsed.id) ?? await fetchLrclibRecord(parsed.id, lrclibFetcher());
      if (!found) {
        manualLyricsStatus.textContent = `LRCLIB 沒有編號 ${parsed.id} 的歌曲。`;
        return;
      }
      if (!found.syncedLyrics) {
        manualLyricsStatus.textContent = `LRCLIB ${parsed.id}「${found.trackName}」沒有同步歌詞，無法跟唱。`;
        return;
      }
      record = found;
    } else {
      const { candidates, failures } = await searchLyricsByVideoTitle(`${parsed.artist} - ${parsed.title}`, report.durationMs, lrclibFetcher());
      const selection = await selectAutomaticLyrics(candidates, [parsed.artist], report.durationMs);
      if (!selection) {
        manualLyricsStatus.textContent = `LRCLIB 沒有片長相符的「${parsed.title}」— ${parsed.artist} 同步歌詞；可按「到 LRCLIB 搜尋」自行挑選版本後貼上連結。${failures.length > 0 ? "（部分查詢失敗，可稍後再試）" : ""}`;
        return;
      }
      record = selection.record;
    }
    if (playbackReport?.mediaId !== report.mediaId) {
      manualLyricsStatus.textContent = "影片已切換，未套用。";
      return;
    }
    manualSelections.delete(report.mediaId);
    manualSelections.set(report.mediaId, record.id);
    if (manualSelections.size > MAX_MANUAL_SELECTIONS) manualSelections.delete(manualSelections.keys().next().value!);
    cacheManualRecord(record);
    manualLyricsInput.value = "";
    manualLyricsStatus.textContent = `已指定 LRCLIB ${record.id}「${record.trackName}」— ${record.artistName}。`;
    persistManualSelection(report.mediaId, record.id);
    void startSingleDetection();
  } catch (error) {
    manualLyricsStatus.textContent = `LRCLIB 查詢失敗：${error instanceof Error ? error.message : "未知錯誤"}`;
  } finally {
    manualApplying = false;
    renderManualLyricsControls();
  }
}

/** Single write path for the lyric offset: keeps the settings input, persistence and calibration bar in sync. */
function setLyricOffset(key: string, offsetMs: number): void {
  if (offsetMs === 0) delete lyricTimingOffsets[key];
  else lyricTimingOffsets[key] = offsetMs;
  lyricTimingOffsetInput.value = offsetMs === 0 ? "" : formatLyricOffset(offsetMs);
  lyricTimingInputKey = key;
  updateLyricTimingControls();
  renderSelectedLyrics();
  persistLyricTimingCorrection(key, offsetMs);
  renderCalibrationControls();
}

function applyLyricTimingOffset(): void {
  const key = selectedTimingKey();
  if (!key) {
    setLyricTimingFeedback("影片或歌詞版本識別資料無效，不能保存校時。");
    updateLyricTimingControls();
    return;
  }
  const offsetMs = parseLyricOffset(lyricTimingOffsetInput.value);
  if (offsetMs === null) {
    setLyricTimingFeedback("請輸入秒數或 m:ss，例如 5、-2.5、1:05.3（上限 60 分鐘）；原校時保持不變。");
    return;
  }
  setLyricTimingFeedback(offsetMs === 0 ? "偏移為 0，已清除這支影片的校時。" : `已套用：所有歌詞時間 ${formatLyricOffset(offsetMs)}。`);
  setLyricOffset(key, offsetMs);
}

function clearLyricTimingCorrection(): void {
  const key = selectedTimingKey();
  if (!key) return;
  setLyricTimingFeedback("已清除這支影片的校時；其他影片與歌詞版本未變更。");
  setLyricOffset(key, 0);
}

type LyricLineState = "past" | "active" | "next" | "upcoming" | "plain";

function appendSelectedLyric(text: string, state: LyricLineState = "plain"): HTMLDivElement {
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
  return line;
}

function appendInterludeMarker(gap: NonNullable<LyricFocus["gap"]>): void {
  const seconds = Math.max(1, Math.ceil(gap.remainingMs / 1000));
  const marker = document.createElement("div");
  marker.className = "selected-line is-interlude";
  marker.setAttribute("aria-current", "true");
  const text = document.createElement("p");
  text.className = "selected-lyric-interlude";
  text.textContent = gap.prelude ? `♪ 前奏 · ${seconds} 秒後開始` : `♪ 間奏 · ${seconds} 秒後`;
  marker.append(text);
  selectedLyricsElement.append(marker);
}

/** Calibration view lists every timed line once and only toggles highlight classes per tick, so scroll position and clicks survive the clock. */
function renderCalibrationLyrics(lyrics: SyncedLyrics, focus: LyricFocus | null): void {
  const hash = lyrics.contentHash ?? "";
  let rebuilt = false;
  if (selectedLyricsElement.dataset.calibrationHash !== hash) {
    rebuilt = true;
    selectedLyricsElement.replaceChildren();
    lyrics.lines.forEach((lyric, index) => {
      if (!/\S/u.test(lyric.text) || lyric.startMs === undefined) return;
      const row = appendSelectedLyric(lyric.text);
      const label = formatTime(lyric.startMs);
      const time = document.createElement("time");
      time.className = "lyric-time";
      time.textContent = label;
      row.prepend(time);
      row.dataset.lineIndex = String(index);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `${label} ${lyric.text}：設為現在開始唱`);
    });
    selectedLyricsElement.dataset.calibrationHash = hash;
  }
  for (const row of selectedLyricsElement.querySelectorAll<HTMLElement>("[data-line-index]")) {
    row.classList.remove("is-active", "is-next");
    row.removeAttribute("aria-current");
  }
  const focused = focus ? selectedLyricsElement.querySelector<HTMLElement>(`[data-line-index="${focus.activeIndex}"]`) : null;
  if (focus && focused) {
    focused.classList.add(focus.state === "active" ? "is-active" : "is-next");
    if (focus.state === "active") focused.setAttribute("aria-current", "true");
  }
  if (rebuilt) focused?.scrollIntoView({ block: "center" });
}

function renderSelectedLyrics(): void {
  if (calibrating && (!selectedLyrics || calibrationRevert?.key !== selectedTimingKey())) exitCalibration(false);
  const report = playbackReport;
  const fresh = report !== null && Date.now() - report.capturedAtMs <= 3000;
  const correctionKey = selectedTimingKey();
  const focus = selectedLyrics && report && fresh
    ? lyricFocusAt(selectedLyrics.lines, lyricPositionForVideo(trackLyricsPositionAt(report, Date.now()), correctionKey ? lyricTimingOffsets[correctionKey] : undefined))
    : null;
  if (calibrating && selectedLyrics) {
    renderCalibrationLyrics(selectedLyrics, focus);
    updateLyricTimingControls();
    return;
  }
  delete selectedLyricsElement.dataset.calibrationHash;
  selectedLyricsElement.replaceChildren();
  if (!selectedLyrics) {
    updateLyricTimingControls();
    return;
  }
  if (!fresh) {
    for (const lyric of selectedLyrics.lines) appendSelectedLyric(lyric.text);
    updateLyricTimingControls();
    return;
  }
  if (!focus) {
    updateLyricTimingControls();
    return;
  }
  const firstIndex = lyricWindowStart(selectedLyrics.lines, focus.activeIndex);
  let displayed = 0;
  for (let index = firstIndex; index < selectedLyrics.lines.length && displayed < LYRICS_WINDOW_SIZE; index += 1) {
    const lyric = selectedLyrics.lines[index];
    if (!/\S/u.test(lyric.text)) continue;
    if (index === focus.activeIndex && focus.gap) appendInterludeMarker(focus.gap);
    appendSelectedLyric(lyric.text, index === focus.activeIndex ? focus.state : index < focus.activeIndex ? "past" : "upcoming");
    displayed += 1;
  }
  updateLyricTimingControls();
}

function renderCalibrationControls(): void {
  calibrationToggleButton.textContent = calibrating ? "完成校時" : "校時";
  calibrationToggleButton.setAttribute("aria-pressed", String(calibrating));
  calibrationEarlierButton.hidden = !calibrating;
  calibrationLaterButton.hidden = !calibrating;
  calibrationRevertButton.hidden = !calibrating;
  calibrationStatus.hidden = !calibrating;
  selectedLyricsElement.classList.toggle("is-calibrating", calibrating);
  if (!calibrating) return;
  const current = lyricTimingOffsets[selectedTimingKey() ?? ""];
  const offsetText = current === undefined ? "0" : formatLyricOffset(current);
  calibrationStatus.textContent = `${calibrationMessage || "點一下正在開始唱的那句歌詞即可對齊。"}目前偏移：${offsetText}`;
}

function enterCalibration(): void {
  const key = selectedTimingKey();
  if (!key) return;
  calibrating = true;
  calibrationRevert = { key, offsetMs: lyricTimingOffsets[key] };
  calibrationMessage = "";
  delete selectedLyricsElement.dataset.calibrationHash;
  renderCalibrationControls();
  renderSelectedLyrics();
}

function exitCalibration(render = true): void {
  calibrating = false;
  calibrationRevert = null;
  calibrationMessage = "";
  delete selectedLyricsElement.dataset.calibrationHash;
  renderCalibrationControls();
  if (render && lyricsMode) renderSelectedLyrics();
}

function nudgeCalibration(deltaMs: number): void {
  const key = selectedTimingKey();
  if (!key) return;
  const next = nudgeLyricOffset(lyricTimingOffsets[key] ?? 0, deltaMs);
  if (next === null) {
    calibrationMessage = "已達偏移上限（60 分鐘）。";
    renderCalibrationControls();
    return;
  }
  calibrationMessage = "";
  setLyricTimingFeedback("");
  setLyricOffset(key, next);
}

function revertCalibration(): void {
  const key = selectedTimingKey();
  if (!calibrationRevert || calibrationRevert.key !== key || !key) return;
  calibrationMessage = "已還原為進入校時前的偏移。";
  setLyricTimingFeedback("");
  setLyricOffset(key, calibrationRevert.offsetMs ?? 0);
}

function alignCalibrationLine(index: number): void {
  const key = selectedTimingKey();
  const line = selectedLyrics?.lines[index];
  if (!key || line?.startMs === undefined) return;
  if (!playbackReport || Date.now() - playbackReport.capturedAtMs > 3000) {
    calibrationMessage = "播放來源失聯，無法對齊；請確認影片正在播放。";
    renderCalibrationControls();
    return;
  }
  const offsetMs = alignedLyricOffset(trackLyricsPositionAt(playbackReport, Date.now()), line.startMs);
  if (offsetMs === null) {
    calibrationMessage = "偏移超過 60 分鐘上限，未套用。";
    renderCalibrationControls();
    return;
  }
  calibrationMessage = `已把「${line.text}」對齊到現在。`;
  setLyricTimingFeedback("");
  setLyricOffset(key, offsetMs);
}

function alignFromEvent(event: Event): void {
  if (!calibrating || !(event.target instanceof Element)) return;
  const row = event.target.closest<HTMLElement>("[data-line-index]");
  if (!row) return;
  event.preventDefault();
  alignCalibrationLine(Number(row.dataset.lineIndex));
}
lyricTimingApplyButton.addEventListener("click", applyLyricTimingOffset);
lyricTimingOffsetInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  applyLyricTimingOffset();
});
lyricTimingClearButton.addEventListener("click", clearLyricTimingCorrection);
calibrationToggleButton.addEventListener("click", () => {
  if (calibrating) exitCalibration();
  else enterCalibration();
});
calibrationEarlierButton.addEventListener("click", () => nudgeCalibration(-CALIBRATION_STEP_MS));
calibrationLaterButton.addEventListener("click", () => nudgeCalibration(CALIBRATION_STEP_MS));
calibrationRevertButton.addEventListener("click", revertCalibration);
selectedLyricsElement.addEventListener("click", (event) => alignFromEvent(event));
selectedLyricsElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") alignFromEvent(event);
});


function startLyricsClock(): void {
  if (lyricsTicker !== undefined) window.clearInterval(lyricsTicker);
  lyricsTicker = window.setInterval(() => {
    if (lyricsMode) {
      renderSelectedLyrics();
      if (playbackReport && Date.now() - playbackReport.capturedAtMs > 3000) {
        lyricsStatus.textContent = "播放來源失聯；歌詞位置已凍結，重新收到播放資訊後恢復。";
      }
    }
    if (singalongMode === "mix-first" && mixFirstAnchor && !mixFinalizing && playbackReport && Date.now() - playbackReport.capturedAtMs > 3000) {
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
  exitCalibration(false);
  lyricsLookupPending = false;
  lyricTimingOffsetInput.value = "";
  lyricTimingInputKey = null;
  setLyricTimingFeedback("");
  selectedLyricsElement.replaceChildren();
  modeBadge.textContent = "等待播放來源";
  lyricsStatus.textContent = message;
  playbackSourceText.textContent = "尚未取得播放來源。";
  currentLyricsRecordId = undefined;
  renderCandidateVersions();
  setCaptionActionsVisible(false);
  renderLines();
}


function processMixPlaybackReport(report: PlaybackReport): void {
  if (singalongMode !== "mix-first" || !activeMixVideoId || mixFinalizing) return;
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
  const creditsArrived = singalongMode === "single" && !firstReport && !trackChanged && playbackReport?.musicCredits === undefined && next.musicCredits !== undefined && !lyricsMode;
  playbackReport = next;
  updateLyricTimingControls();
  displayPlaybackSource(next);
  if (singalongMode === "single" && !lyricsMode) modeBadge.textContent = specialVideo ? SPECIAL_VIDEO_COPY[specialVideo].badge : "已取得播放來源";
  if (singalongMode === "mix-first") processMixPlaybackReport(next);
  if (singalongMode === "mix-replay") renderMixReplay(next);
  if ((firstReport || trackChanged || creditsArrived) && singalongMode === "single") void lookupSingleLyrics(next, singleOperationGeneration);
  if (lyricsMode) renderSelectedLyrics();
  updateCaptionControls();
}

if (chromeApi) {
  chromeApi.runtime.onMessage.addListener(receivePlaybackMessage);
  function connectPanelPort(): void {
    const port = chromeApi?.runtime.connect?.({ name: "side-panel" });
    port?.onDisconnect.addListener(() => {
      setTimeout(connectPanelPort, 1000);
    });
  }
  connectPanelPort();
  chromeApi.tabs.onActivated.addListener(({ tabId }) => {
    void (async () => {
      const tabs = await refreshSourceTabs();
      if (selectedSourceTabId !== null || captionStarting || singalongMode !== "single" || tabId === lockedTabId) return;
      // Auto mode follows playback pages only; ordinary pages keep the current lyrics.
      if (!tabs?.some((tab) => tab.tabId === tabId)) return;
      await startSingleDetection();
    })();
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
  const isCurrent = () => !controller.signal.aborted && operationGeneration === singleOperationGeneration &&
    singalongMode === "single" && playbackReport !== null;
  lyricsLookupPending = true;
  setCaptionActionsVisible(false);
  lyricsStatus.textContent = "正在比對曲名、歌手與片長，自動選擇同步歌詞…";
  setAiLookupStatus("");
  lyricsLookupError = "";
  lyricsQueryStatus.textContent = "";
  lyricsQueryStatus.hidden = true;
  const manualId = report.appId === "youtube" && report.segmentStartMs === undefined && report.durationMs > 0
    ? manualSelections.get(report.mediaId)
    : undefined;
  specialVideo = manualId === undefined && report.appId === "youtube" && report.segmentStartMs === undefined
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
  if (availableCandidatesMediaId !== report.mediaId) {
    availableCandidates = [];
    availableCandidatesMediaId = report.mediaId;
  }
  currentLyricsRecordId = undefined;
  renderCandidateVersions();
  try {
    const lyricsFetcher = lrclibFetcher(controller.signal);
    let selection: { record: LrclibRecord; lyrics: SyncedLyrics; recordCount: number; timelineCount: number } | null = null;
    let exactCandidatesCount = 0;
    let failuresCount = 0;

    if (manualId !== undefined) {
      try {
        const record = manualRecordCache.get(manualId) ?? await fetchLrclibRecord(manualId, lyricsFetcher);
        if (!isCurrent()) return;
        if (!record?.syncedLyrics) throw new Error("LRCLIB 已找不到這筆同步歌詞。");
        const lyrics = await parseRecordLyrics(record, `lrclib-${record.id}`);
        if (!isCurrent()) return;
        if (lyrics.format === "plain" || lyrics.granularity === "none") throw new Error("這筆歌詞沒有有效時間戳。");
        selection = { record, lyrics, recordCount: 1, timelineCount: 1 };
        availableCandidates = rankCandidateRecords([...availableCandidates, record], currentLyricsRecordId, report.durationMs);
        resolvedTrack = { title: record.trackName, artists: [record.artistName], source: "manual" };
        displayPlaybackSource(report);
        if (typeof record.duration === "number" && Math.abs(record.duration * 1000 - report.durationMs) > durationTolerance(report.durationMs)) {
          setAiLookupStatus("你指定的歌詞片長與影片差距較大；若時間不同步，可用「校正歌詞時間」調整。");
        }
      } catch (error) {
        if (!isCurrent()) return;
        lyricsQueryStatus.textContent = `手動指定的 LRCLIB ${manualId} 無法載入：${error instanceof Error ? error.message : "未知錯誤"}；改用自動比對。`;
        lyricsQueryStatus.hidden = false;
      }
    }

    if (!selection && candidateArtists.length && artistIsVerified) {
      const { recordsByArtist: resultsByArtist, failures } = await searchLyricsForArtists(trackTitle, candidateArtists, lyricsFetcher);
      if (!isCurrent()) return;
      if (failures.length) {
        lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
        lyricsQueryStatus.hidden = false;
        failuresCount = failures.length;
      }
      const exact = exactSyncedCandidatesForArtists(resultsByArtist, trackTitle, candidateArtists);
      availableCandidates = rankCandidateRecords([...availableCandidates, ...exact, ...resultsByArtist.flat()], currentLyricsRecordId, trackDurationMs);
      exactCandidatesCount = exact.length;
      selection = await selectAutomaticLyrics(exact, candidateArtists, trackDurationMs);
      if (!isCurrent()) return;
    }

    if (!selection && report.appId === "youtube" && report.segmentStartMs === undefined && report.durationMs > 0) {
      const credit = report.musicCredits ? selectYouTubeMusicCredit(report.musicCredits) : null;
      if (credit) {
        const { candidates, allCandidates, failures } = await searchLyricsForIdentity({ titles: [credit.title], artists: [credit.artist] }, report.durationMs, lyricsFetcher);
        if (!isCurrent()) return;
        if (failures.length) {
          lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
          lyricsQueryStatus.hidden = false;
          failuresCount = failures.length;
        }
        availableCandidates = rankCandidateRecords([...availableCandidates, ...allCandidates, ...candidates], currentLyricsRecordId, report.durationMs);
        exactCandidatesCount = candidates.length;
        selection = await selectAutomaticLyrics(candidates, [credit.artist], report.durationMs);
        if (!isCurrent()) return;
        if (selection) {
          resolvedTrack = { title: selection.record.trackName, artists: [selection.record.artistName], source: "youtube-credit" };
          displayPlaybackSource(report);
        }
      }
    }

    const canGuessFromTitle = !selection && report.appId === "youtube" && report.segmentStartMs === undefined && report.durationMs > 0;
    const guessRejected = canGuessFromTitle && aiRejectedVideoIds.includes(report.mediaId);
    if (guessRejected) {
      aiMatchRejectButton.textContent = "恢復自動比對";
      aiMatchRejectButton.hidden = false;
      setAiLookupStatus("你已停用這支影片的標題比對。");
    }

    if (canGuessFromTitle && !guessRejected) {
      const { candidates, allCandidates, failures } = await searchLyricsByVideoTitle(report.rawTitle ?? report.title, report.durationMs, lyricsFetcher);
      if (!isCurrent()) return;
      if (failures.length) {
        lyricsQueryStatus.textContent = `部分歌詞查詢失敗（${failures.length} 次）：${failures[0].artist} — ${failures[0].message} 已保留成功結果。`;
        lyricsQueryStatus.hidden = false;
        failuresCount = failures.length;
      }
      availableCandidates = rankCandidateRecords([...availableCandidates, ...allCandidates, ...candidates], currentLyricsRecordId, report.durationMs);
      exactCandidatesCount = candidates.length;
      selection = await selectAutomaticLyrics(candidates, [], report.durationMs);
      if (!isCurrent()) return;
      if (selection) {
        resolvedTrack = { title: selection.record.trackName, artists: [selection.record.artistName], source: "title-match" };
        displayPlaybackSource(report);
        setAiLookupStatus(`依影片標題比對到「${selection.record.trackName}」— ${selection.record.artistName}（LRCLIB ${selection.record.id}）；若不是這首，請按「不是這首」。`);
      }
    }
    if (!selection) {
      selectedLyrics = null;
      lyricsMode = false;
      updateLyricTimingControls();
      lyricsLookupPending = false;
      renderCandidateVersions();
      setCaptionActionsVisible(true);
      renderLines();
      if (!candidateArtists.length) {
        lyricsStatus.textContent = "播放資訊沒有歌手，無法安全比對同步歌詞。";
        setStatus("已取得曲名，但沒有可驗證的歌手資訊。", "idle");
        return;
      }
      if (!artistIsVerified) {
        lyricsStatus.textContent = "YouTube 沒有可驗證的歌手資料；不會猜測歌詞。可展開「手動指定歌詞」自行指定。";
        setStatus("缺少可驗證的歌手資訊，未套用歌詞。", "idle");
        return;
      }
      lyricsStatus.textContent = exactCandidatesCount > 0
        ? "相符資料沒有有效時間戳；未顯示不同步的歌詞。"
        : "沒有找到曲名與歌手相符的同步歌詞；可展開「手動指定歌詞」自行指定。";
      setStatus(failuresCount ? "部分查詢失敗；目前未取得可用同步歌詞，可按「重新偵測」再查。" : `已查詢「${trackTitle}」；目前未取得相符同步歌詞。`, failuresCount ? "error" : "idle");
      return;
    }
    lyricsLookupPending = false;
    setCaptionActionsVisible(false);
    selectedLyrics = selection.lyrics;
    updateLyricTimingControls();
    lyricsMode = true;
    stopButton.disabled = false;
    currentLyricsRecordId = selection.record.id;
    availableCandidates = rankCandidateRecords([...availableCandidates, selection.record], currentLyricsRecordId, report.durationMs);
    renderCandidateVersions();
    const automaticVersion = selection.recordCount > 1;
    modeBadge.textContent = `${resolvedTrack?.source === "manual" ? "手動指定 · " : resolvedTrack?.source === "title-match" ? "標題比對 · " : resolvedTrack?.source === "youtube-credit" ? "YouTube 曲目資訊 · " : ""}${automaticVersion ? "自動選版同步歌詞" : "單曲同步歌詞"}`;
    if (resolvedTrack?.source === "title-match") {
      aiMatchRejectButton.textContent = "不是這首";
      aiMatchRejectButton.hidden = false;
    }
    const hint = availableCandidates.length > 1 ? "也可按頂部「版本」切換其他版本。" : "";
    startLyricsClock();
    lyricsStatus.textContent = automaticVersion
      ? `已從 ${selection.recordCount} 筆相符資料、${selection.timelineCount} 種時間軸自動選版（LRCLIB ${selection.record.id}）；優先比對片長，再比對歌手。MV 片頭可能造成時間差，可到設定「校正歌詞時間」調整。${hint}`
      : `已匹配同步歌詞（LRCLIB ${selection.record.id}）；位置跟隨播放分頁。${hint}`;
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
  updateLyricTimingControls();
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
pinSourceButton.addEventListener("click", () => {
  if (selectedSourceTabId !== null) {
    selectedSourceTabId = null;
    void refreshSourceTabs();
    updateSourceControls();
    if (singalongMode !== "single" || playbackReport === null) void startSingleDetection();
    return;
  }
  if (lockedTabId === null || playbackReport === null || singalongMode !== "single") return;
  selectedSourceTabId = lockedTabId;
  void refreshSourceTabs();
  updateSourceControls();
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
    mixFinalWindowIndex = -1;
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
        if (window.final) mixFinalWindowIndex = windowIndex;
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
  if (aiMatchRejectButton.textContent === "恢復自動比對") {
    aiRejectedVideoIds = aiRejectedVideoIds.filter((id) => id !== mediaId);
    persistAiRejection(mediaId, false);
    void startSingleDetection();
  } else {
    if (!aiRejectedVideoIds.includes(mediaId)) {
      aiRejectedVideoIds.push(mediaId);
      if (aiRejectedVideoIds.length > 200) aiRejectedVideoIds.shift();
    }
    persistAiRejection(mediaId, true);
    void startSingleDetection();
  }
});
copyAiPromptButton.addEventListener("click", () => {
  const report = manualTarget();
  if (!report) return;
  const prompt = manualLyricsPrompt({ rawTitle: report.rawTitle ?? report.title, channel: report.artists.join("、"), durationMs: report.durationMs, pageUrl: report.pageUrl });
  void navigator.clipboard.writeText(prompt).then(
    () => { manualLyricsStatus.textContent = "已複製提示詞；貼到你的 AI，把它回覆的兩行貼回下方。"; },
    () => { manualLyricsStatus.textContent = "瀏覽器拒絕寫入剪貼簿，請再試一次。"; },
  );
});
applyManualLyricsButton.addEventListener("click", () => void applyManualLyrics());
clearManualLyricsButton.addEventListener("click", () => {
  const report = manualTarget();
  if (!report) return;
  manualSelections.delete(report.mediaId);
  manualLyricsStatus.textContent = "已清除；改回自動比對。";
  persistManualSelection(report.mediaId, null);
  renderManualLyricsControls();
  void startSingleDetection();
});
candidateVersionsBtn.addEventListener("click", () => {
  settingsDialog.showModal();
  manualLyricsDetails.open = true;
  candidateVersionsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
openSettingsButton.addEventListener("click", () => {
  settingsDialog.showModal();
});
closeSettingsButton.addEventListener("click", () => {
  settingsDialog.close();
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) {
    settingsDialog.close();
  }
});
void Promise.all([initializeDisplayPreferences(), initializeManualSelections(), initializeLyricTimingCorrections(), initializeAiRejections()]).then(() => {
  void refreshSourceTabs();
  return startSingleDetection();
});
window.addEventListener("pagehide", () => { void stopCapture(false); });
