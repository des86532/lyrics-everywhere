import type {
  PronunciationNotation,
  PronunciationStyle,
  TranscriptionResult,
} from "../domain/types.js";

export interface TranscriptionRequest {
  text: string;
  sourceLanguage?: string; // BCP 47 或 auto，如 "ko", "ja", "auto"
  targetLocale?: string;   // 預設 "zh-TW"
  notation: PronunciationNotation;
  style?: PronunciationStyle;
}

export interface LanguageTranscriber {
  readonly id: string;
  readonly languages: readonly string[];
  readonly supportedNotations: readonly PronunciationNotation[];

  canHandle(input: { text: string; language?: string }): boolean;
  transcribe(request: TranscriptionRequest): TranscriptionResult;
}
