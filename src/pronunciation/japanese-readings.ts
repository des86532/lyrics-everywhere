export interface JapaneseToken {
  surface_form: string;
  word_type: string;
  reading?: string;
  pronunciation?: string;
}

export type JapaneseTokenizer = (run: string) => JapaneseToken[];

const JAPANESE_TEXT_RUN = /[\u3400-\u9fff\u3040-\u30ff々ー]+/gu;
const HAN_CHARACTER = /[\u3400-\u9fff]/u;
const KANA_CHARACTER = /[\u3040-\u30ff]/u;

export function needsJapaneseReadings(text: string): boolean {
  for (const match of text.matchAll(JAPANESE_TEXT_RUN)) {
    if (HAN_CHARACTER.test(match[0]) && KANA_CHARACTER.test(match[0])) return true;
  }
  return false;
}

export function prepareJapaneseReadings(
  text: string,
  tokenize: JapaneseTokenizer,
): { text: string; unresolved: boolean } {
  let unresolved = false;
  const prepared = text.replace(JAPANESE_TEXT_RUN, (run) => {
    if (!HAN_CHARACTER.test(run) || !KANA_CHARACTER.test(run)) return run;

    const tokens = tokenize(run);
    let cursor = 0;
    let result = "";
    for (const token of tokens) {
      const surface = token.surface_form;
      const surfaceIndex = run.indexOf(surface, cursor);
      if (surfaceIndex === -1) {
        unresolved = true;
        return run;
      }
      result += run.slice(cursor, surfaceIndex);
      const hasKanji = HAN_CHARACTER.test(surface);
      const reading = token.pronunciation && token.pronunciation !== "*"
        ? token.pronunciation
        : token.reading && token.reading !== "*"
          ? token.reading
          : undefined;
      if (token.word_type === "KNOWN" && hasKanji && reading) {
        result += reading;
      } else {
        result += surface;
        if (hasKanji) unresolved = true;
      }
      cursor = surfaceIndex + surface.length;
    }
    return result + run.slice(cursor);
  });
  return { text: prepared, unresolved };
}
