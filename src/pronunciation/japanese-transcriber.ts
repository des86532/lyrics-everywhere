import type {
  PronunciationNotation,
  PronunciationSegment,
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

// Tier 1: 常用流行歌詞片語詞典
export const JAPANESE_PHRASES: Record<string, string> = {
  ありがとう: "阿里嘎多",
  ありがとうございます: "阿里嘎多 勾雜以馬斯",
  愛してる: "愛西貼路",
  あいしてる: "愛西貼路",
  さようなら: "撒優哪拉",
  おはよう: "歐嗨唷",
  こんにちは: "空尼基哇",
  だいじょうぶ: "帶究補",
  大丈夫: "帶究補",
  すごい: "斯勾以",
  かわいい: "卡哇伊",
  カワイイ: "卡哇伊",
  ずっと: "組透",
  いつも: "伊次摸",
};

const SORTED_JAPANESE_PHRASES = Object.keys(JAPANESE_PHRASES).sort(
  (a, b) => b.length - a.length
);

// Tier 2: 五十音對應中文字諧音
const KANA_TO_CHINESE: Record<string, string> = {
  あ: "啊", い: "伊", う: "屋", え: "欸", お: "歐",
  ア: "啊", イ: "伊", ウ: "屋", エ: "欸", オ: "歐",
  か: "卡", き: "奇", く: "庫", け: "凱", こ: "口",
  カ: "卡", キ: "奇", ク: "庫", ケ: "凱", コ: "口",
  さ: "撒", し: "西", す: "斯", せ: "些", そ: "索",
  サ: "撒", シ: "西", ス: "斯", セ: "些", ソ: "索",
  た: "塔", ち: "七", つ: "次", て: "貼", と: "透",
  タ: "塔", チ: "七", ツ: "次", テ: "貼", ト: "透",
  な: "哪", に: "尼", ぬ: "奴", ね: "捏", の: "諾",
  ナ: "哪", ニ: "尼", ヌ: "奴", ネ: "捏", ノ: "諾",
  は: "哈", ひ: "西", ふ: "呼", へ: "黑", ほ: "後",
  ハ: "哈", ヒ: "西", フ: "呼", ヘ: "黑", ホ: "後",
  ま: "媽", み: "米", む: "木", め: "妹", も: "摸",
  マ: "媽", ミ: "米", ム: "木", メ: "妹", モ: "摸",
  や: "亞", ゆ: "優", よ: "唷",
  ヤ: "亞", ユ: "優", ヨ: "唷",
  ら: "拉", り: "哩", る: "路", れ: "雷", ろ: "羅",
  ラ: "拉", リ: "哩", ル: "路", レ: "雷", ロ: "羅",
  わ: "哇", を: "窩", ん: "嗯",
  ワ: "哇", ヲ: "窩", ン: "嗯",
  が: "嘎", ぎ: "吉", ぐ: "古", げ: "給", ご: "果",
  ガ: "嘎", ギ: "吉", グ: "古", ゲ: "給", ゴ: "果",
  ざ: "雜", じ: "幾", ず: "茲", ぜ: "賊", ぞ: "佐",
  ザ: "雜", ジ: "幾", ズ: "茲", ゼ: "賊", ゾ: "佐",
  だ: "達", ぢ: "吉", づ: "茲", で: "得", ど: "多",
  ダ: "達", ヂ: "吉", ヅ: "茲", デ: "得", ド: "多",
  ば: "巴", び: "比", ぶ: "布", べ: "杯", ぼ: "波",
  バ: "巴", ビ: "比", ブ: "布", ベ: "杯", ボ: "波",
  ぱ: "怕", ぴ: "皮", ぷ: "普", ぺ: "配", ぽ: "剖",
  パ: "怕", ピ: "皮", プ: "普", ペ: "配", ポ: "剖",
};

export class JapaneseTranscriber implements LanguageTranscriber {
  readonly id = "japanese-transcriber";
  readonly languages = ["ja", "japanese"] as const;
  readonly supportedNotations: readonly PronunciationNotation[] = [
    "chinese_homophone",
    "kana",
    "romanization",
    "hybrid",
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
    const segments: PronunciationSegment[] = [];
    const displayParts: string[] = [];

    let cursor = 0;
    let segId = 0;

    // Longest-match 片語比對
    while (cursor < text.length) {
      let matchedPhrase: string | null = null;
      let matchedHomophone: string | null = null;

      for (const phrase of SORTED_JAPANESE_PHRASES) {
        if (text.startsWith(phrase, cursor)) {
          matchedPhrase = phrase;
          matchedHomophone = JAPANESE_PHRASES[phrase]!;
          break;
        }
      }

      if (matchedPhrase && matchedHomophone) {
        displayParts.push(matchedHomophone);
        segments.push({
          segmentId: `seg-ja-${++segId}`,
          sourceText: matchedPhrase,
          phonemes: [matchedHomophone],
          display: matchedHomophone,
          tier: "phrase",
        });
        cursor += matchedPhrase.length;
        continue;
      }

      const char = text[cursor]!;
      if (!isKana(char)) {
        displayParts.push(char);
        segments.push({
          segmentId: `seg-ja-${++segId}`,
          sourceText: char,
          phonemes: [char],
          display: char,
          tier: "passthrough",
        });
        cursor++;
        continue;
      }

      const homophone = KANA_TO_CHINESE[char];
      const val = homophone || char;
      displayParts.push(val);
      segments.push({
        segmentId: `seg-ja-${++segId}`,
        sourceText: char,
        phonemes: [val],
        display: val,
        tier: homophone ? "syllable" : "fallback",
      });
      cursor++;
    }

    const displayText = displayParts.join("").replace(/\s+/g, " ").trim();
    return {
      sourceText: text,
      requestedNotation: request.notation,
      detectedLanguage: "ja",
      displayText,
      layers: [
        {
          notation: "chinese_homophone",
          displayText,
          segments,
        },
      ],
      segments,
    };
  }
}
