import type {
  PhoneticSystem,
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

    // Passthrough
    const systems = request.allowedSystems || ["chinese", "latin"];
    return {
      sourceText: request.text,
      detectedLanguage: "unknown",
      mode: request.mode || "streamlined",
      allowedSystems: systems,
      displayText: request.text,
      syllables: [
        {
          sourceText: request.text,
          onset: "",
          nucleus: "",
          fragments: [
            {
              system: systems[0] || "chinese",
              role: "base",
              text: request.text,
              phonemes: [request.text],
            },
          ],
          displayText: request.text,
          tier: "passthrough",
        },
      ],
    };
  }

  listCapabilities(): Array<{ id: string; languages: readonly string[]; supportedSystems: readonly PhoneticSystem[] }> {
    return Array.from(this.transcribers.values()).map((t) => ({
      id: t.id,
      languages: t.languages,
      supportedSystems: t.supportedSystems,
    }));
  }
}
