import type {
  PhoneticSystem,
  PronunciationMode,
  PronunciationStyle,
  TranscriptionResult,
} from "../domain/types.js";

export interface TranscriptionRequest {
  text: string;
  sourceLanguage?: string; // BCP 47 或 auto，如 "ko", "ja", "auto"
  targetLocale?: string;   // 預設 "zh-TW"
  mode?: PronunciationMode; // "streamlined" (極簡流暢跟唱) | "precise" (精準標註)
  allowedSystems: PhoneticSystem[]; // 允許使用之拼音系統清單（如 ["chinese"] 或 ["chinese", "latin"]）
  style?: PronunciationStyle;
}

export interface LanguageTranscriber {
  readonly id: string;
  readonly languages: readonly string[];
  readonly supportedSystems: readonly PhoneticSystem[];

  canHandle(input: { text: string; language?: string }): boolean;
  transcribe(request: TranscriptionRequest): TranscriptionResult;
}
