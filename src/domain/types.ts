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

export type PronunciationNotation =
  | "chinese_homophone" // 中文字諧音（空耳跟唱）
  | "bopomofo"           // 台灣注音符號
  | "romanization"       // 羅馬拼音
  | "kana"               // 日語假名
  | "hybrid";            // 漢字諧音為主 + 注音為輔雙排

export type AtomicNotation = Exclude<PronunciationNotation, "hybrid">;
export type PronunciationStyle = "standard" | "singable";

export interface PronunciationProfile {
  profileId: string;
  sourceLanguage: "auto" | "korean" | "japanese" | "english" | string;
  notation: PronunciationNotation;
  style: PronunciationStyle;
  display: {
    original: boolean;
    pronunciation: boolean;
    translation: boolean;
  };
}

export type TranscriptionTier = "phrase" | "syllable" | "fallback" | "passthrough";

export interface PronunciationSegment {
  segmentId: string;
  sourceText: string;
  phonemes: string[];
  display: string;
  tier?: TranscriptionTier;
  flags?: ("approximation" | "liaison" | "nasalization" | "aspiration" | "tensification")[];
}

export interface PronunciationLayer {
  notation: AtomicNotation;
  displayText: string;
  segments: PronunciationSegment[];
}

export interface TranscriptionResult {
  sourceText: string;
  requestedNotation: PronunciationNotation;
  detectedLanguage: string;
  displayText: string; // 主顯示發音文字
  secondaryDisplayText?: string; // 次顯示發音文字 (如 hybrid 模式下的注音列)
  layers: PronunciationLayer[];
  segments: PronunciationSegment[];
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

export interface ActiveLyricDisplay {
  currentLine?: LineAnnotation;
  previousLine?: LineAnnotation;
  nextLine?: LineAnnotation;
  progressPercent: number;
  isPlaying: boolean;
  positionMs: number;
  durationMs?: number;
  activeNotation?: PronunciationNotation;
}
