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
export const JAPANESE_PHRASES: Record<string, { chinese: string; romanization: string }> = {
  ありがとう: { chinese: "阿里嘎多", romanization: "arigatou" },
  愛してる: { chinese: "愛西貼路", romanization: "aishiteru" },
  さようなら: { chinese: "撒優哪拉", romanization: "sayounara" },
  おはよう: { chinese: "歐嗨唷", romanization: "ohayou" },
  こんにちは: { chinese: "空尼基哇", romanization: "konnichiwa" },
  だいじょうぶ: { chinese: "帶究補", romanization: "daijoubu" },
  大丈夫: { chinese: "帶究補", romanization: "daijoubu" },
  すごい: { chinese: "斯勾以", romanization: "sugoi" },
  かわいい: { chinese: "卡哇伊", romanization: "kawaii" },
};

const SORTED_JA_KEYS = Object.keys(JAPANESE_PHRASES).sort((a, b) => b.length - a.length);

const KANA_MAP: Record<string, { chinese: string; romanization: string }> = {
  あ: { chinese: "啊", romanization: "a" },
  い: { chinese: "伊", romanization: "i" },
  う: { chinese: "屋", romanization: "u" },
  え: { chinese: "欸", romanization: "e" },
  お: { chinese: "歐", romanization: "o" },
  か: { chinese: "卡", romanization: "ka" },
  き: { chinese: "奇", romanization: "ki" },
  く: { chinese: "庫", romanization: "ku" },
  け: { chinese: "凱", romanization: "ke" },
  こ: { chinese: "口", romanization: "ko" },
  さ: { chinese: "撒", romanization: "sa" },
  し: { chinese: "西", romanization: "shi" },
  す: { chinese: "斯", romanization: "su" },
  せ: { chinese: "些", romanization: "se" },
  そ: { chinese: "索", romanization: "so" },
  た: { chinese: "塔", romanization: "ta" },
  ち: { chinese: "七", romanization: "chi" },
  つ: { chinese: "次", romanization: "tsu" },
  て: { chinese: "貼", romanization: "te" },
  と: { chinese: "透", romanization: "to" },
  な: { chinese: "哪", romanization: "na" },
  に: { chinese: "尼", romanization: "ni" },
  ぬ: { chinese: "奴", romanization: "nu" },
  ね: { chinese: "捏", romanization: "ne" },
  の: { chinese: "諾", romanization: "no" },
  は: { chinese: "哈", romanization: "ha" },
  ひ: { chinese: "西", romanization: "hi" },
  ふ: { chinese: "呼", romanization: "fu" },
  へ: { chinese: "黑", romanization: "he" },
  ほ: { chinese: "後", romanization: "ho" },
  ま: { chinese: "媽", romanization: "ma" },
  み: { chinese: "米", romanization: "mi" },
  む: { chinese: "木", romanization: "mu" },
  め: { chinese: "妹", romanization: "me" },
  も: { chinese: "摸", romanization: "mo" },
  や: { chinese: "亞", romanization: "ya" },
  ゆ: { chinese: "優", romanization: "yu" },
  よ: { chinese: "唷", romanization: "yo" },
  ら: { chinese: "拉", romanization: "ra" },
  り: { chinese: "哩", romanization: "ri" },
  る: { chinese: "路", romanization: "ru" },
  れ: { chinese: "雷", romanization: "re" },
  ろ: { chinese: "羅", romanization: "ro" },
  わ: { chinese: "哇", romanization: "wa" },
  を: { chinese: "窩", romanization: "wo" },
  ん: { chinese: "嗯", romanization: "n" },
};
type KanaReading = { chinese: string; romanization: string };

const EXTRA_KANA_MAP: Record<string, KanaReading> = {
  が: { chinese: "嘎", romanization: "ga" },
  ぎ: { chinese: "吉", romanization: "gi" },
  ぐ: { chinese: "咕", romanization: "gu" },
  げ: { chinese: "給", romanization: "ge" },
  ご: { chinese: "勾", romanization: "go" },
  ざ: { chinese: "雜", romanization: "za" },
  じ: { chinese: "吉", romanization: "ji" },
  ず: { chinese: "滋", romanization: "zu" },
  ぜ: { chinese: "賊", romanization: "ze" },
  ぞ: { chinese: "作", romanization: "zo" },
  だ: { chinese: "搭", romanization: "da" },
  ぢ: { chinese: "吉", romanization: "ji" },
  づ: { chinese: "茲", romanization: "zu" },
  で: { chinese: "爹", romanization: "de" },
  ど: { chinese: "多", romanization: "do" },
  ば: { chinese: "巴", romanization: "ba" },
  び: { chinese: "比", romanization: "bi" },
  ぶ: { chinese: "布", romanization: "bu" },
  べ: { chinese: "貝", romanization: "be" },
  ぼ: { chinese: "波", romanization: "bo" },
  ぱ: { chinese: "趴", romanization: "pa" },
  ぴ: { chinese: "屁", romanization: "pi" },
  ぷ: { chinese: "噗", romanization: "pu" },
  ぺ: { chinese: "配", romanization: "pe" },
  ぽ: { chinese: "破", romanization: "po" },
  ゔ: { chinese: "夫", romanization: "vu" },
};

const READINGS: Record<string, KanaReading> = { ...KANA_MAP, ...EXTRA_KANA_MAP };
const YOON_ROWS = ["き", "し", "ち", "に", "ひ", "み", "り", "ぎ", "じ", "び", "ぴ"];
const YOON_ENDINGS: Record<string, { chinese: string; romanization: string }> = {
  ゃ: { chinese: "亞", romanization: "ya" },
  ゅ: { chinese: "優", romanization: "yu" },
  ょ: { chinese: "唷", romanization: "yo" },
};
const COMPOUND_KANA_MAP: Record<string, KanaReading> = {};
for (const row of YOON_ROWS) {
  const base = READINGS[row]!;
  for (const [smallKana, ending] of Object.entries(YOON_ENDINGS)) {
    const vowel = base.romanization.endsWith("i") ? "i" : "";
    COMPOUND_KANA_MAP[`${row}${smallKana}`] = { chinese: `${base.chinese}${ending.chinese}`, romanization: `${base.romanization.slice(0, -vowel.length)}${ending.romanization}` };
  }
}

function toHiragana(char: string): string {
  const code = char.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
}

function displayEntry(entry: KanaReading, systems: PhoneticSystem[]): string {
  if (systems.includes("chinese")) return entry.chinese;
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
        const phraseText = systems.includes("chinese") ? entry.chinese : entry.romanization;
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
          kanaText = systems.includes("chinese") ? chinese ?? "ー" : "ー";
          tier = previousVowel ? "syllable" : "fallback";
        } else if (entry) {
          kanaText = systems.includes("chinese") ? entry.chinese : entry.romanization;
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
