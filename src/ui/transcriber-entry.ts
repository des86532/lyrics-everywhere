import type { PhoneticSystem } from "../domain/types.js";
import { JapaneseTranscriber } from "../pronunciation/japanese-transcriber.js";
import { KoreanTranscriber } from "../pronunciation/korean-transcriber.js";
import { TranscriberRegistry } from "../pronunciation/transcriber-registry.js";

const registry = new TranscriberRegistry()
  .register(new KoreanTranscriber())
  .register(new JapaneseTranscriber());

export function transcribeDisplayText(
  text: string,
  allowedSystems: PhoneticSystem[],
  targetLocale: string,
  passthroughLanguages: string[],
): string {
  return registry.transcribe({
    text,
    sourceLanguage: "auto",
    targetLocale,
    passthroughLanguages,
    allowedSystems,
    style: "singable",
  }).displayText;
}
