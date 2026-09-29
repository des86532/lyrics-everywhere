import type {
  PhoneticSystem,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";
import { preservesLanguage } from "./language-transcriber.js";

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
          transcriber.languages.some((language) => language.toLowerCase() === normalizedLang) &&
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
    const systems: PhoneticSystem[] = request.allowedSystems.length > 0 ? request.allowedSystems : ["chinese"];

    if (!transcriber) {
      return this.passthrough(request.text, "unknown", systems);
    }

    const language = transcriber.languages[0] || "unknown";
    if (preservesLanguage(request, language)) {
      return this.passthrough(request.text, language, systems);
    }

    return transcriber.transcribe({ ...request, allowedSystems: systems });
  }

  listCapabilities(): Array<{ id: string; languages: readonly string[]; supportedSystems: readonly PhoneticSystem[] }> {
    return Array.from(this.transcribers.values()).map((transcriber) => ({
      id: transcriber.id,
      languages: transcriber.languages,
      supportedSystems: transcriber.supportedSystems,
    }));
  }

  private passthrough(text: string, language: string, systems: PhoneticSystem[]): TranscriptionResult {
    return {
      sourceText: text,
      detectedLanguage: language,
      allowedSystems: systems,
      displayText: text,
      syllables: [
        {
          sourceText: text,
          onset: "",
          nucleus: "",
          fragments: [
            {
              system: systems[0] || "chinese",
              role: "base",
              text,
              phonemes: [text],
            },
          ],
          displayText: text,
          tier: "passthrough",
        },
      ],
    };
  }
}
