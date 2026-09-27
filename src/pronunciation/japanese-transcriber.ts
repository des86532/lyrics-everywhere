import type {
  BlendedSyllable,
  PhoneticSystem,
  TranscriptionResult,
} from "../domain/types.js";
import type { LanguageTranscriber, TranscriptionRequest } from "./language-transcriber.js";

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
        if (text.startsWith(key, cursor)) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey) {
        const entry = JAPANESE_PHRASES[matchedKey]!;
        let phraseText = entry.chinese;
        if (!systems.includes("chinese")) {
          if (systems.includes("bopomofo")) phraseText = entry.bopomofo;
          else if (systems.includes("latin")) phraseText = entry.romanization;
        }

        displayParts.push(phraseText);
        syllables.push({
          sourceText: matchedKey,
          onset: "",
          nucleus: "",
          fragments: [
            {
              system: systems.includes("chinese") ? "chinese" : systems[0] || "chinese",
              role: "base",
              text: phraseText,
              phonemes: [phraseText],
            },
          ],
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
          fragments: [
            {
              system: systems[0] || "chinese",
              role: "base",
              text: char,
              phonemes: [char],
            },
          ],
          displayText: char,
          tier: "passthrough",
        });
        cursor++;
        continue;
      }

      const entry = KANA_MAP[char];
      let kanaText = char;
      if (entry) {
        if (systems.includes("chinese")) kanaText = entry.chinese;
        else if (systems.includes("bopomofo")) kanaText = entry.bopomofo;
        else if (systems.includes("latin")) kanaText = entry.romanization;
      }

      displayParts.push(kanaText);
      syllables.push({
        sourceText: char,
        onset: "",
        nucleus: "",
        fragments: [
          {
            system: systems.includes("chinese") ? "chinese" : systems[0] || "chinese",
            role: "base",
            text: kanaText,
            phonemes: [kanaText],
          },
        ],
        displayText: kanaText,
        tier: entry ? "syllable" : "fallback",
      });
      cursor++;
    }

    const displayText = displayParts.join("").replace(/\s+/g, " ").trim();
    return {
      sourceText: text,
      detectedLanguage: "ja",
      mode: request.mode || "streamlined",
      allowedSystems: systems,
      displayText,
      syllables,
    };
  }
}
