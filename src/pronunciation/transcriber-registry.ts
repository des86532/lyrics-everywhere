import type {
  PronunciationLayer,
  PronunciationNotation,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";

export class TranscriberRegistry {
  private transcribers = new Map<string, LanguageTranscriber>();

  register(transcriber: LanguageTranscriber): this {
    if (this.transcribers.has(transcriber.id)) {
      throw new Error(`Transcriber with id "${transcriber.id}" is already registered.`);
    }
    this.transcribers.set(transcriber.id, transcriber);
    return this;
  }

  get(id: string): LanguageTranscriber | undefined {
    return this.transcribers.get(id);
  }

  resolve(text: string, preferredLanguage?: string): LanguageTranscriber | null {
    // 1. 若有指定明確語言，優先比對宣告支援該語言的轉寫器
    if (preferredLanguage && preferredLanguage !== "auto") {
      const normalizedLang = preferredLanguage.toLowerCase().split("-")[0] || "";
      for (const transcriber of this.transcribers.values()) {
        if (
          transcriber.languages.some((l) => l.toLowerCase() === normalizedLang) &&
          transcriber.canHandle({ text, language: preferredLanguage })
        ) {
          return transcriber;
        }
      }
    }

    // 2. 自動語言辨識 (Auto-detection via Unicode scripts)
    for (const transcriber of this.transcribers.values()) {
      if (transcriber.canHandle({ text, language: preferredLanguage })) {
        return transcriber;
      }
    }

    return null;
  }

  transcribe(request: TranscriptionRequest): TranscriptionResult {
    const transcriber = this.resolve(request.text, request.sourceLanguage);

    if (transcriber) {
      return transcriber.transcribe(request);
    }

    // 3. Passthrough 兜底 (當無專屬轉寫器時，直接保留原文)
    const passthroughLayer: PronunciationLayer = {
      notation: request.notation === "hybrid" ? "chinese_homophone" : request.notation,
      displayText: request.text,
      segments: [
        {
          segmentId: "seg-passthrough",
          sourceText: request.text,
          phonemes: [request.text],
          display: request.text,
          tier: "passthrough",
        },
      ],
    };

    return {
      sourceText: request.text,
      requestedNotation: request.notation,
      detectedLanguage: "unknown",
      displayText: request.text,
      layers: [passthroughLayer],
      segments: passthroughLayer.segments,
    };
  }

  listCapabilities(): Array<{ id: string; languages: readonly string[]; notations: readonly PronunciationNotation[] }> {
    return Array.from(this.transcribers.values()).map((t) => ({
      id: t.id,
      languages: t.languages,
      notations: t.supportedNotations,
    }));
  }
}
