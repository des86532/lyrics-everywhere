import type {
  PronunciationLayer,
  PronunciationNotation,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";
import {
  isHangulChar,
  koreanToBopomofo,
  koreanToChineseHomophone,
} from "./korean-engine.js";

export class KoreanTranscriber implements LanguageTranscriber {
  readonly id = "korean-transcriber";
  readonly languages = ["ko", "korean"] as const;
  readonly supportedNotations: readonly PronunciationNotation[] = [
    "chinese_homophone",
    "bopomofo",
    "romanization",
    "hybrid",
  ];

  canHandle(input: { text: string; language?: string }): boolean {
    if (input.language) {
      const normalized = input.language.toLowerCase().split("-")[0];
      if (normalized === "ko" || normalized === "korean") return true;
    }
    // 檢查字串中是否有任何 Hangul 字元
    for (const char of input.text) {
      if (isHangulChar(char)) return true;
    }
    return false;
  }

  transcribe(request: TranscriptionRequest): TranscriptionResult {
    const notation = request.notation;

    if (notation === "hybrid") {
      const chinese = koreanToChineseHomophone(request.text);
      const bopomofo = koreanToBopomofo(request.text);

      const layers: PronunciationLayer[] = [
        {
          notation: "chinese_homophone",
          displayText: chinese.displayText,
          segments: chinese.segments,
        },
        {
          notation: "bopomofo",
          displayText: bopomofo.displayText,
          segments: bopomofo.segments,
        },
      ];

      return {
        sourceText: request.text,
        requestedNotation: "hybrid",
        detectedLanguage: "ko",
        displayText: chinese.displayText,
        secondaryDisplayText: bopomofo.displayText,
        layers,
        segments: chinese.segments,
      };
    }

    if (notation === "bopomofo") {
      const result = koreanToBopomofo(request.text);
      return {
        sourceText: request.text,
        requestedNotation: "bopomofo",
        detectedLanguage: "ko",
        displayText: result.displayText,
        layers: [
          {
            notation: "bopomofo",
            displayText: result.displayText,
            segments: result.segments,
          },
        ],
        segments: result.segments,
      };
    }

    // 預設為 chinese_homophone
    const result = koreanToChineseHomophone(request.text);
    return {
      sourceText: request.text,
      requestedNotation: "chinese_homophone",
      detectedLanguage: "ko",
      displayText: result.displayText,
      layers: [
        {
          notation: "chinese_homophone",
          displayText: result.displayText,
          segments: result.segments,
        },
      ],
      segments: result.segments,
    };
  }
}
