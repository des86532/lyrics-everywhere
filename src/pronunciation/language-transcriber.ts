import type {
  PhoneticSystem,
  PronunciationStyle,
  TranscriptionResult,
} from "../domain/types.js";

export interface TranscriptionRequest {
  text: string;
  sourceLanguage?: string; // BCP 47 或 auto，如 "ko", "ja", "auto"
  targetLocale?: string;   // 原文保留的主要語言，預設 "zh-TW"
  passthroughLanguages?: string[]; // 額外維持原文的語言
  allowedSystems: PhoneticSystem[];
  style?: PronunciationStyle;
}

export function preservesLanguage(
  request: TranscriptionRequest,
  language: string,
): boolean {
  const baseLanguage = (locale: string) => locale.toLowerCase().split(/[-_]/)[0];
  const preserved = [request.targetLocale ?? "zh-TW", ...(request.passthroughLanguages || [])];
  return preserved.some((locale) => baseLanguage(locale) === baseLanguage(language));
}

export interface LanguageTranscriber {
  readonly id: string;
  readonly languages: readonly string[];
  readonly supportedSystems: readonly PhoneticSystem[];

  canHandle(input: { text: string; language?: string }): boolean;
  transcribe(request: TranscriptionRequest): TranscriptionResult;
}
