
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

export type LyricsFormat = "plain" | "lrc";
export type LyricsGranularity = "none" | "line";

export interface SyncedLyrics {
  lyricsId: string;
  trackKey: string;
  provider: {
    name: string;
    recordId: string;
  };
  format: LyricsFormat;
  granularity: LyricsGranularity;
  lines: LyricLine[];
  contentHash: string;
}

// 專為中文使用者收斂的兩種基礎拼音工具系統
export type PhoneticSystem = "chinese" | "latin";

export type PronunciationStyle = "standard" | "singable";


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
  allowedSystems: PhoneticSystem[];
  displayText: string;
  syllables: BlendedSyllable[];
}

