import { toRomaji } from "wanakana";
import type {
  BlendedSyllable,
  PhoneticSystem,
  TranscriptionResult,
} from "../domain/types.js";
import { preservesLanguage, type LanguageTranscriber, type TranscriptionRequest } from "./language-transcriber.js";

const HIRAGANA_START = 0x3040;
const HIRAGANA_END = 0x309f;
const KATAKANA_START = 0x30a0;
const KATAKANA_END = 0x30ff;

export function isKana(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= HIRAGANA_START && code <= HIRAGANA_END) ||
    (code >= KATAKANA_START && code <= KATAKANA_END)
  );
}

// Tier 1: 常用片語
export const JAPANESE_PHRASES: Record<string, { chinese: string; bopomofo: string; romanization: string }> = {
  ありがとう: { chinese: "阿里嘎多", bopomofo: "ㄚ ㄌㄧ ㄍㄚ ㄉㄨㄛ", romanization: "arigatou" },
  愛してる: { chinese: "愛西貼路", bopomofo: "ㄞ ㄒㄧ ㄊㄧㄝ ㄌㄨ", romanization: "aishiteru" },
  さようなら: { chinese: "撒優哪拉", bopomofo: "ㄙㄚ ㄧㄡ ㄋㄚ ㄌㄚ", romanization: "sayounara" },
  おはよう: { chinese: "歐嗨唷", bopomofo: "ㄡ ㄏㄞ ㄧㄛ", romanization: "ohayou" },
  こんにちは: { chinese: "空尼基哇", bopomofo: "ㄎㄨㄥ ㄋㄧ ㄐㄧ ㄨㄚ", romanization: "konnichiwa" },
  だいじょうぶ: { chinese: "帶究補", bopomofo: "ㄉㄞ ㄐㄧㄡ ㄅㄨ", romanization: "daijoubu" },
  大丈夫: { chinese: "帶究補", bopomofo: "ㄉㄞ ㄐㄧㄡ ㄅㄨ", romanization: "daijoubu" },
  すごい: { chinese: "斯勾以", bopomofo: "ㄙ ㄍㄡ ㄧ", romanization: "sugoi" },
  かわいい: { chinese: "卡哇伊", bopomofo: "ㄎㄚ ㄨㄚ ㄧ", romanization: "kawaii" },
};

const SORTED_JA_KEYS = Object.keys(JAPANESE_PHRASES).sort((a, b) => b.length - a.length);

const KANA_MAP: Record<string, { chinese: string; bopomofo: string; romanization: string }> = {
  あ: { chinese: "啊", bopomofo: "ㄚ", romanization: "a" },
  い: { chinese: "伊", bopomofo: "ㄧ", romanization: "i" },
  う: { chinese: "屋", bopomofo: "ㄨ", romanization: "u" },
  え: { chinese: "欸", bopomofo: "ㄝ", romanization: "e" },
  お: { chinese: "歐", bopomofo: "ㄛ", romanization: "o" },
  か: { chinese: "卡", bopomofo: "ㄎㄚ", romanization: "ka" },
  き: { chinese: "奇", bopomofo: "ㄑㄧ", romanization: "ki" },
  く: { chinese: "庫", bopomofo: "ㄎㄨ", romanization: "ku" },
  け: { chinese: "凱", bopomofo: "ㄎㄞ", romanization: "ke" },
  こ: { chinese: "口", bopomofo: "ㄎㄡ", romanization: "ko" },
  さ: { chinese: "撒", bopomofo: "ㄙㄚ", romanization: "sa" },
  し: { chinese: "西", bopomofo: "ㄒㄧ", romanization: "shi" },
  す: { chinese: "斯", bopomofo: "ㄙ", romanization: "su" },
  せ: { chinese: "些", bopomofo: "ㄙㄝ", romanization: "se" },
  そ: { chinese: "索", bopomofo: "ㄙㄨㄛ", romanization: "so" },
  た: { chinese: "塔", bopomofo: "ㄊㄚ", romanization: "ta" },
  ち: { chinese: "七", bopomofo: "ㄑㄧ", romanization: "chi" },
  つ: { chinese: "次", bopomofo: "ㄘ", romanization: "tsu" },
  て: { chinese: "貼", bopomofo: "ㄊㄧㄝ", romanization: "te" },
  と: { chinese: "透", bopomofo: "ㄊㄡ", romanization: "to" },
  な: { chinese: "哪", bopomofo: "ㄋㄚ", romanization: "na" },
  に: { chinese: "尼", bopomofo: "ㄋㄧ", romanization: "ni" },
  ぬ: { chinese: "奴", bopomofo: "ㄋㄨ", romanization: "nu" },
  ね: { chinese: "捏", bopomofo: "ㄋㄧㄝ", romanization: "ne" },
  の: { chinese: "諾", bopomofo: "ㄋㄨㄛ", romanization: "no" },
  は: { chinese: "哈", bopomofo: "ㄏㄚ", romanization: "ha" },
  ひ: { chinese: "西", bopomofo: "ㄒㄧ", romanization: "hi" },
  ふ: { chinese: "呼", bopomofo: "ㄏㄨ", romanization: "fu" },
  へ: { chinese: "黑", bopomofo: "ㄏㄟ", romanization: "he" },
  ほ: { chinese: "後", bopomofo: "ㄏㄡ", romanization: "ho" },
  ま: { chinese: "媽", bopomofo: "ㄇㄚ", romanization: "ma" },
  み: { chinese: "米", bopomofo: "ㄇㄧ", romanization: "mi" },
  む: { chinese: "木", bopomofo: "ㄇㄨ", romanization: "mu" },
  め: { chinese: "妹", bopomofo: "ㄇㄟ", romanization: "me" },
  も: { chinese: "摸", bopomofo: "ㄇㄛ", romanization: "mo" },
  や: { chinese: "亞", bopomofo: "ㄧㄚ", romanization: "ya" },
  ゆ: { chinese: "優", bopomofo: "ㄧㄡ", romanization: "yu" },
  よ: { chinese: "唷", bopomofo: "ㄧㄛ", romanization: "yo" },
  ら: { chinese: "拉", bopomofo: "ㄌㄚ", romanization: "ra" },
  り: { chinese: "哩", bopomofo: "ㄌㄧ", romanization: "ri" },
  る: { chinese: "路", bopomofo: "ㄌㄨ", romanization: "ru" },
  れ: { chinese: "雷", bopomofo: "ㄌㄟ", romanization: "re" },
  ろ: { chinese: "羅", bopomofo: "ㄌㄨㄛ", romanization: "ro" },
  わ: { chinese: "哇", bopomofo: "ㄨㄚ", romanization: "wa" },
  を: { chinese: "窩", bopomofo: "ㄨㄛ", romanization: "wo" },
  ん: { chinese: "嗯", bopomofo: "ㄣ", romanization: "n" },
};
type KanaReading = { chinese: string; bopomofo: string; romanization: string };

const EXTRA_KANA_MAP: Record<string, KanaReading> = {
  が: { chinese: "嘎", bopomofo: "ㄍㄚ", romanization: "ga" },
  ぎ: { chinese: "吉", bopomofo: "ㄐㄧ", romanization: "gi" },
  ぐ: { chinese: "咕", bopomofo: "ㄍㄨ", romanization: "gu" },
  げ: { chinese: "給", bopomofo: "ㄍㄟ", romanization: "ge" },
  ご: { chinese: "勾", bopomofo: "ㄍㄡ", romanization: "go" },
  ざ: { chinese: "雜", bopomofo: "ㄗㄚ", romanization: "za" },
  じ: { chinese: "吉", bopomofo: "ㄐㄧ", romanization: "ji" },
  ず: { chinese: "滋", bopomofo: "ㄗ", romanization: "zu" },
  ぜ: { chinese: "賊", bopomofo: "ㄗㄟ", romanization: "ze" },
  ぞ: { chinese: "作", bopomofo: "ㄗㄨㄛ", romanization: "zo" },
  だ: { chinese: "搭", bopomofo: "ㄉㄚ", romanization: "da" },
  ぢ: { chinese: "吉", bopomofo: "ㄐㄧ", romanization: "ji" },
  づ: { chinese: "茲", bopomofo: "ㄗ", romanization: "zu" },
  で: { chinese: "爹", bopomofo: "ㄉㄟ", romanization: "de" },
  ど: { chinese: "多", bopomofo: "ㄉㄨㄛ", romanization: "do" },
  ば: { chinese: "巴", bopomofo: "ㄅㄚ", romanization: "ba" },
  び: { chinese: "比", bopomofo: "ㄅㄧ", romanization: "bi" },
  ぶ: { chinese: "布", bopomofo: "ㄅㄨ", romanization: "bu" },
  べ: { chinese: "貝", bopomofo: "ㄅㄟ", romanization: "be" },
  ぼ: { chinese: "波", bopomofo: "ㄅㄛ", romanization: "bo" },
  ぱ: { chinese: "趴", bopomofo: "ㄆㄚ", romanization: "pa" },
  ぴ: { chinese: "屁", bopomofo: "ㄆㄧ", romanization: "pi" },
  ぷ: { chinese: "噗", bopomofo: "ㄆㄨ", romanization: "pu" },
  ぺ: { chinese: "配", bopomofo: "ㄆㄟ", romanization: "pe" },
  ぽ: { chinese: "破", bopomofo: "ㄆㄛ", romanization: "po" },
  ゔ: { chinese: "夫", bopomofo: "ㄨ", romanization: "vu" },
};

const READINGS: Record<string, KanaReading> = { ...KANA_MAP, ...EXTRA_KANA_MAP };
const YOON_ROWS = ["き", "し", "ち", "に", "ひ", "み", "り", "ぎ", "じ", "び", "ぴ"];
const YOON_ENDINGS: Record<string, { chinese: string; bopomofo: string; romanization: string }> = {
  ゃ: { chinese: "亞", bopomofo: "ㄧㄚ", romanization: "ya" },
  ゅ: { chinese: "優", bopomofo: "ㄧㄨ", romanization: "yu" },
  ょ: { chinese: "唷", bopomofo: "ㄧㄛ", romanization: "yo" },
};
const COMPOUND_KANA_MAP: Record<string, KanaReading> = {};
for (const row of YOON_ROWS) {
  const base = READINGS[row]!;
  for (const [smallKana, ending] of Object.entries(YOON_ENDINGS)) {
    const vowel = base.romanization.endsWith("i") ? "i" : "";
    const bopomofoPrefix = base.bopomofo.endsWith("ㄧ") ? base.bopomofo.slice(0, -1) : base.bopomofo;
    COMPOUND_KANA_MAP[`${row}${smallKana}`] = {
      chinese: `${base.chinese}${ending.chinese}`,
      bopomofo: `${bopomofoPrefix}${ending.bopomofo}`,
      romanization: `${base.romanization.slice(0, -vowel.length)}${ending.romanization}`,
    };
  }
}

function toHiragana(char: string): string {
  const code = char.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
}

function displayEntry(entry: KanaReading, systems: PhoneticSystem[]): string {
  if (systems.includes("chinese")) return entry.chinese;
  if (systems.includes("bopomofo")) return entry.bopomofo;
  if (systems.includes("latin")) return entry.romanization;
  return entry.chinese;
}

function finalVowel(entry: KanaReading | undefined): string | undefined {
  return entry?.romanization.match(/[aeiou]$/)?.[0];
}

export class JapaneseTranscriber implements LanguageTranscriber {
  readonly id = "japanese-transcriber";
  readonly languages = ["ja", "japanese"] as const;
  readonly supportedSystems: readonly PhoneticSystem[] = [
    "chinese",
    "bopomofo",
    "latin",
  ];

  canHandle(input: { text: string; language?: string }): boolean {
    if (input.language) {
      const normalized = input.language.toLowerCase().split("-")[0];
      if (normalized === "ja" || normalized === "japanese") return true;
    }
    for (const char of input.text) {
      if (isKana(char)) return true;
    }
    return false;
  }

  transcribe(request: TranscriptionRequest): TranscriptionResult {
    const text = request.text;
    const systems = request.allowedSystems.length > 0 ? request.allowedSystems : (["chinese", "latin"] as PhoneticSystem[]);
    const syllables: BlendedSyllable[] = [];
    const displayParts: string[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      let matchedKey: string | null = null;
      for (const key of SORTED_JA_KEYS) {
        if (text.startsWith(key, cursor) && !(preservesLanguage(request, "zh") && /[\u3400-\u9fff]/.test(key))) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey) {
        const entry = JAPANESE_PHRASES[matchedKey]!;
        const phraseText = systems.includes("chinese")
          ? entry.chinese
          : systems.includes("bopomofo")
            ? entry.bopomofo
            : entry.romanization;
        displayParts.push(phraseText);
        syllables.push({
          sourceText: matchedKey,
          onset: "",
          nucleus: "",
          fragments: [{ system: systems[0] || "chinese", role: "base", text: phraseText, phonemes: [phraseText] }],
          displayText: phraseText,
          tier: "phrase",
        });
        cursor += matchedKey.length;
        continue;
      }

      const char = text[cursor]!;
      if (!isKana(char)) {
        displayParts.push(char);
        syllables.push({
          sourceText: char,
          onset: "",
          nucleus: "",
          fragments: [{ system: systems[0] || "chinese", role: "base", text: char, phonemes: [char] }],
          displayText: char,
          tier: "passthrough",
        });
        cursor++;
        continue;
      }

      let runEnd = cursor + 1;
      while (runEnd < text.length && isKana(text[runEnd]!)) runEnd++;
      const run = text.slice(cursor, runEnd);
      if (systems.includes("latin")) {
        const romanization = toRomaji(run);
        displayParts.push(romanization);
        syllables.push({
          sourceText: run,
          onset: "",
          nucleus: "",
          fragments: [{ system: "latin", role: "base", text: romanization, phonemes: [romanization] }],
          displayText: romanization,
          tier: "syllable",
        });
        cursor = runEnd;
        continue;
      }
      const originalRun = Array.from(run);
      const normalized = originalRun.map((kana) => {
        const code = kana.charCodeAt(0);
        return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : kana;
      });
      let runCursor = 0;
      let previousVowel: string | undefined;
      while (runCursor < normalized.length) {
        const sourceKana = normalized[runCursor]!;
        const nextKana = normalized[runCursor + 1];
        const compoundKey = nextKana && COMPOUND_KANA_MAP[`${sourceKana}${nextKana}`]
          ? `${sourceKana}${nextKana}`
          : sourceKana;
        const entry = COMPOUND_KANA_MAP[compoundKey] ?? READINGS[compoundKey];
        let kanaText = entry ? compoundKey : originalRun[runCursor]!;
        let tier: BlendedSyllable["tier"] = entry ? "syllable" : "fallback";

        if (compoundKey === "っ") {
          kanaText = "・";
          tier = "syllable";
        } else if (compoundKey === "ー") {
          const chinese = { a: "啊", i: "伊", u: "屋", e: "欸", o: "歐" }[previousVowel ?? ""];
          const bopomofo = { a: "ㄚ", i: "ㄧ", u: "ㄨ", e: "ㄝ", o: "ㄛ" }[previousVowel ?? ""];
          kanaText = systems.includes("chinese")
            ? chinese ?? "ー"
            : systems.includes("bopomofo")
              ? bopomofo ?? "ー"
              : "ー";
          tier = previousVowel ? "syllable" : "fallback";
        } else if (entry) {
          kanaText = systems.includes("chinese")
            ? entry.chinese
            : systems.includes("bopomofo")
              ? entry.bopomofo
              : entry.romanization;
          previousVowel = entry.romanization.match(/[aeiou]$/)?.[0];
        } else {
          previousVowel = undefined;
        }
        if (compoundKey === "っ") previousVowel = undefined;

        displayParts.push(kanaText);
        syllables.push({
          sourceText: compoundKey,
          onset: "",
          nucleus: "",
          fragments: [{
            system: systems[0] || "chinese",
            role: "base",
            text: kanaText,
            phonemes: [kanaText],
          }],
          displayText: kanaText,
          tier,
        });
        runCursor += compoundKey.length;
      }
      cursor = runEnd;
    }

    return {
      sourceText: text,
      detectedLanguage: "ja",
      allowedSystems: systems,
      displayText: displayParts.join(""),
      syllables,
    };
  }
}
