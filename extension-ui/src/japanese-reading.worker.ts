import { builder, type IpadicFeatures, type Tokenizer } from "@sglkc/kuromoji";
import { prepareJapaneseReadings } from "../../src/pronunciation/japanese-readings.js";

type ReadingRequest = { id: number; text: string; dicPath: string };
type ReadingResponse =
  | { type: "ready" }
  | { type: "result"; id: number; text: string; readingText: string; unresolved: boolean }
  | { type: "error"; id?: number; text?: string; error: string; dictionary?: boolean };

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null;

function loadTokenizer(dicPath: string): Promise<Tokenizer<IpadicFeatures>> {
  if (!tokenizerPromise) {
    const localDictionaryPath = new URL(dicPath).pathname;
    tokenizerPromise = new Promise((resolve, reject) => {
      builder({ dicPath: localDictionaryPath }).build((error, tokenizer) => {
        if (error) {
          tokenizerPromise = null;
          reject(error);
        } else resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}
self.addEventListener("message", (event: MessageEvent<ReadingRequest>) => {
  const { id, text, dicPath } = event.data;
  const fail = (error: unknown, dictionary: boolean) => {
    self.postMessage({
      type: "error",
      id,
      text,
      error: error instanceof Error ? error.message : String(error),
      dictionary,
    } satisfies ReadingResponse);
  };
  void loadTokenizer(dicPath).then((tokenizer) => {
    try {
      self.postMessage({ type: "ready" } satisfies ReadingResponse);
      const prepared = prepareJapaneseReadings(text, (run) => tokenizer.tokenize(run));
      self.postMessage({
        type: "result",
        id,
        text,
        readingText: prepared.text,
        unresolved: prepared.unresolved,
      } satisfies ReadingResponse);
    } catch (error) {
      fail(error, false);
    }
  }, (error: unknown) => {
    tokenizerPromise = null;
    fail(error, true);
  });
});
