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

export type PronunciationNotation = "bopomofo" | "romanization" | "kana";
export type PronunciationStyle = "standard" | "singable";

export interface PronunciationProfile {
  profileId: string;
  sourceLanguage: "korean" | "japanese" | "english" | "auto";
  notation: PronunciationNotation;
  style: PronunciationStyle;
  display: {
    original: boolean;
    pronunciation: boolean;
    translation: boolean;
  };
}

export interface PronunciationSegment {
  segmentId: string;
  sourceText: string;
  phonemes: string[];
  display: string;
  flags?: ("approximation" | "liaison" | "nasalization" | "aspiration" | "tensification")[];
}

export interface LineAnnotation {
  lineId: string;
  startMs?: number;
  endMs?: number;
  originalText: string;
  pronunciation?: {
    displayText: string;
    segments: PronunciationSegment[];
  };
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
}
