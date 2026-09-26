import type {
  PhoneticSystem,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";
import {
  isHangulChar,
  koreanToBlendedHomophone,
} from "./korean-engine.js";

export class KoreanTranscriber implements LanguageTranscriber {
  readonly id = "korean-transcriber";
  readonly languages = ["ko", "korean"] as const;
  readonly supportedSystems: readonly PhoneticSystem[] = [
    "chinese",
    "bopomofo",
    "latin",
  ];

  canHandle(input: { text: string; language?: string }): boolean {
    if (input.language) {
      const normalized = input.language.toLowerCase().split("-")[0];
      if (normalized === "ko" || normalized === "korean") return true;
    }
    for (const char of input.text) {
      if (isHangulChar(char)) return true;
    }
    return false;
  }

  transcribe(request: TranscriptionRequest): TranscriptionResult {
    const systems = request.allowedSystems.length > 0 ? request.allowedSystems : (["chinese", "latin"] as PhoneticSystem[]);
    const result = koreanToBlendedHomophone(request.text, systems);

    return {
      sourceText: request.text,
      detectedLanguage: "ko",
      allowedSystems: systems,
      displayText: result.displayText,
      syllables: result.syllables,
    };
  }
}
