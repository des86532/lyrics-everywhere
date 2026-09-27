export type SourceConnectorKind = "spotify-macos" | "windows-smtc" | "mock" | "browser";

export interface TrackMetadata {
  trackKey: string;
  source: {
    connector: SourceConnectorKind;
    appId?: string;
    sourceTrackId?: string;
  };
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
}

export type PlaybackState = "playing" | "paused" | "stopped" | "unavailable";

export interface PlaybackSnapshot {
  eventSeq: number;
  track?: TrackMetadata;
  state: PlaybackState;
  positionMs?: number;
  sampledAtMs: number;
  playbackRate: number;
}

export interface LyricToken {
  tokenId: string;
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface LyricLine {
  lineId: string;
  startMs?: number;
  endMs?: number;
  text: string;
  tokens?: LyricToken[];
}

export type LyricsFormat = "plain" | "lrc" | "enhanced-lrc";
export type LyricsGranularity = "none" | "line" | "word";

export interface SyncedLyrics {
  lyricsId: string;
  trackKey: string;
  provider: {
    name: string;
    recordId: string;
    attribution?: string;
  };
  format: LyricsFormat;
  granularity: LyricsGranularity;
  lines: LyricLine[];
  contentHash: string;
}

// 專為中文使用者收斂的三種基礎拼音工具系統
export type PhoneticSystem = "chinese" | "bopomofo" | "latin";

export type PronunciationStyle = "standard" | "singable";

// 跟唱模式：streamlined (極簡流暢，1韓字=1漢字，不加冗餘英文字母，跟得上速度) | precise (精準標註，保留收音字母)
export type PronunciationMode = "streamlined" | "precise";

export interface PronunciationProfile {
  profileId: string;
  sourceLanguage: "auto" | "korean" | "japanese" | "english" | string;
  mode: PronunciationMode; // 預設 "streamlined"
  allowedSystems: PhoneticSystem[]; // 允許融合之拼音工具組合，長度 1~3，例如 ["chinese"] 或 ["chinese", "latin"]
  style: PronunciationStyle;
  display: {
    original: boolean;
    pronunciation: boolean;
    translation: boolean;
  };
}

export type TranscriptionTier = "phrase" | "syllable" | "fallback" | "passthrough";

export interface PronunciationFragment {
  system: PhoneticSystem;
  role: "base" | "coda" | "modifier";
  text: string;
  phonemes: string[];
}

export interface BlendedSyllable {
  sourceText: string;
  onset: string;
  nucleus: string;
  coda?: string;
  fragments: PronunciationFragment[];
  displayText: string;
  tier?: TranscriptionTier;
  approximation?: boolean;
}

export interface TranscriptionResult {
  sourceText: string;
  detectedLanguage: string;
  mode: PronunciationMode;
  allowedSystems: PhoneticSystem[];
  displayText: string; // 唯一融合的單行混成空耳字串（Streamlined 模式下為純淨 1:1 繁中常用字）
  syllables: BlendedSyllable[];
}

export interface LineAnnotation {
  lineId: string;
  startMs?: number;
  endMs?: number;
  originalText: string;
  pronunciation?: TranscriptionResult;
  translation?: {
    text: string;
    locale: string;
  };
}

// 全篇歌譜清單（換歌或偏好變更時推播一次）
export interface FullLyricsSheet {
  trackKey: string;
  lyricsId: string;
  revision: number;
  status: "loading" | "ready" | "unavailable";
  mode: PronunciationMode;
  allowedSystems: PhoneticSystem[];
  lines: LineAnnotation[];
}

// 輕量播放游標（每秒 tick 即時推播）
export interface PlaybackCursor {
  trackKey?: string;
  sheetRevision?: number;
  currentLineIndex: number | null; // 間奏中或無對應行為 null
  activeLineId?: string;
  positionMs: number;
  durationMs?: number;
  progressPercent: number;
  isPlaying: boolean;
}

// 保持與既有 UI 相容的 ActiveLyricDisplay
export interface ActiveLyricDisplay {
  currentLine?: LineAnnotation;
  previousLine?: LineAnnotation;
  nextLine?: LineAnnotation;
  currentLineIndex: number | null;
  activeLineId?: string;
  progressPercent: number;
  isPlaying: boolean;
  positionMs: number;
  durationMs?: number;
  mode?: PronunciationMode;
  allowedSystems?: PhoneticSystem[];
}
