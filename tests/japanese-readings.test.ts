import { describe, expect, it } from "vitest";
import {
  needsJapaneseReadings,
  prepareJapaneseReadings,
  type JapaneseToken,
} from "../src/pronunciation/japanese-readings.js";

describe("Japanese reading preparation", () => {
  it("requests tokenization only for mixed kanji and kana runs", () => {
    expect(needsJapaneseReadings("最後までオレの悪い性格")).toBe(true);
    expect(needsJapaneseReadings("かなカナだけ")).toBe(false);
    expect(needsJapaneseReadings("最後中文")).toBe(false);
    expect(needsJapaneseReadings("사랑해 愛してる")).toBe(true);
  });

  it("replaces known kanji tokens with dictionary readings and preserves kana", () => {
    const tokens: JapaneseToken[] = [
      { surface_form: "最後", word_type: "KNOWN", pronunciation: "サイゴ" },
      { surface_form: "まで", word_type: "KNOWN", pronunciation: "マデ" },
      { surface_form: "オレ", word_type: "KNOWN", pronunciation: "オレ" },
      { surface_form: "の", word_type: "KNOWN", pronunciation: "ノ" },
      { surface_form: "悪い", word_type: "KNOWN", pronunciation: "ワルイ" },
      { surface_form: "性格", word_type: "KNOWN", pronunciation: "セイカク" },
    ];
    const result = prepareJapaneseReadings("最後までオレの悪い性格", () => tokens);
    expect(result).toEqual({ text: "サイゴまでオレのワルイセイカク", unresolved: false });
  });

  it("leaves unknown kanji and pure Chinese text untouched", () => {
    const unresolved = prepareJapaneseReadings("未解決して", () => [
      { surface_form: "未解決", word_type: "UNKNOWN" },
      { surface_form: "して", word_type: "KNOWN", reading: "シテ" },
    ]);
    expect(unresolved).toEqual({ text: "未解決して", unresolved: true });

    let tokenized = false;
    const chinese = prepareJapaneseReadings("最後中文", () => {
      tokenized = true;
      return [];
    });
    expect(chinese).toEqual({ text: "最後中文", unresolved: false });
    expect(tokenized).toBe(false);
  });

  it("preserves Korean outside dictionary-processed Japanese runs", () => {
    const result = prepareJapaneseReadings("사랑해 愛してる", (run) => [
      { surface_form: run, word_type: "KNOWN", pronunciation: "アイシテル" },
    ]);
    expect(result).toEqual({ text: "사랑해 アイシテル", unresolved: false });
  });
});
