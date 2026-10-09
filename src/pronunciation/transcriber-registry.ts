import type {
  PhoneticSystem,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";
import { preservesLanguage } from "./language-transcriber.js";
import { isKana } from "./japanese-transcriber.js";


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
    const systems: PhoneticSystem[] = request.allowedSystems.length > 0 ? request.allowedSystems : ["chinese"];
    const hasKorean = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(request.text);
    const hasJapanese = Array.from(request.text).some(isKana);
    if (hasKorean && hasJapanese) return this.transcribeMixed(request, systems);

    const transcriber = this.resolve(request.text, request.sourceLanguage);
    if (!transcriber) return this.passthrough(request.text, "unknown", systems);
    const language = transcriber.languages[0] || "unknown";
    if (preservesLanguage(request, language)) return this.passthrough(request.text, language, systems);
    return transcriber.transcribe({ ...request, allowedSystems: systems });
  }

  private transcribeMixed(request: TranscriptionRequest, systems: PhoneticSystem[]): TranscriptionResult {
    const characters = Array.from(request.text);
    const segments: Array<{ language: "ko" | "ja" | null; text: string }> = [];
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index]!;
      let language: "ko" | "ja" | null = null;
      if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(character)) {
        language = "ko";
      } else if (isKana(character)) {
        language = "ja";
      } else if (/[\u3400-\u9fff]/u.test(character)) {
        let next = index + 1;
        while (next < characters.length && /[\u3400-\u9fff]/u.test(characters[next]!)) next += 1;
        if (next < characters.length && isKana(characters[next]!)) language = "ja";
      }

      const current = segments.at(-1);
      if (current?.language === language) current.text += character;
      else segments.push({ language, text: character });
    }

    const results = segments.map(({ language, text }) => {
      if (!language) return this.passthrough(text, "unknown", systems);
      const transcriber = Array.from(this.transcribers.values()).find((candidate) =>
        candidate.languages.some((item) => item.toLowerCase().split("-")[0] === language),
      );
      if (!transcriber || preservesLanguage(request, language)) return this.passthrough(text, language, systems);
      return transcriber.transcribe({ ...request, text, allowedSystems: systems });
    });
    return {
      sourceText: request.text,
      detectedLanguage: "mixed",
      allowedSystems: systems,
      displayText: results.map((result) => result.displayText).join(""),
      syllables: results.flatMap((result) => result.syllables),
    };
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
