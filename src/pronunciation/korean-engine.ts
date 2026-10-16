import type {
  BlendedSyllable,
  PhoneticSystem,
  PronunciationStyle,
} from "../domain/types.js";
import {
  synthesizeBlendedSyllable,
  type SurfaceSyllable,
} from "./blended-homophone.js";
import { GRAMMAR_PARTICLES } from "./korean-homophone-data.js";

// 1. Hangul Unicode Constants
export const HANGUL_BASE = 0xac00;
export const HANGUL_END = 0xd7a3;

export const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

export const JUNGSEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

export const JONGSEONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

export interface DecomposedHangul {
  cho: string;
  jung: string;
  jong: string;
  isHangul: boolean;
  char: string;
}

export function isHangulChar(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_END;
}

export function decomposeHangulChar(char: string): DecomposedHangul {
  if (!isHangulChar(char)) {
    return { cho: "", jung: "", jong: "", isHangul: false, char };
  }
  const code = char.charCodeAt(0) - HANGUL_BASE;
  const jongIdx = code % 28;
  const jungIdx = Math.floor(code / 28) % 21;
  const choIdx = Math.floor(code / (28 * 21));

  return {
    cho: CHOSEONG[choIdx] || "",
    jung: JUNGSEONG[jungIdx] || "",
    jong: JONGSEONG[jongIdx] || "",
    isHangul: true,
    char,
  };
}

export function composeHangul(cho: string, jung: string, jong = ""): string {
  const choIdx = CHOSEONG.indexOf(cho as (typeof CHOSEONG)[number]);
  const jungIdx = JUNGSEONG.indexOf(jung as (typeof JUNGSEONG)[number]);
  const jongIdx = JONGSEONG.indexOf(jong as (typeof JONGSEONG)[number]);

  if (choIdx === -1 || jungIdx === -1) return "";
  const code = HANGUL_BASE + (choIdx * 21 + jungIdx) * 28 + (jongIdx === -1 ? 0 : jongIdx);
  return String.fromCharCode(code);
}

// 2. 整行音韻序列解析 (Line-level Phonology Sequence)
// 由左至右在同一個可變陣列上執行音變，保證連音聲母移位能傳遞給下一字！
export function applyKoreanPhonology(text: string): DecomposedHangul[] {
  const chars = Array.from(text);
  const items = chars.map(decomposeHangulChar);

  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    const nextIdx = i + 1;
    const next = items[nextIdx];
    if (!curr || !curr.isHangul) continue;

    // A. ㅎ 相關音變 (ㅎ-elision & Aspiration)
    if (curr.jong === "ㅎ" || curr.jong === "ㄶ" || curr.jong === "ㅀ") {
      if (next && next.isHangul) {
        if (next.cho === "ㅇ") {
          if (curr.jong === "ㅎ") curr.jong = "";
          else if (curr.jong === "ㄶ") { curr.jong = ""; next.cho = "ㄴ"; }
          else if (curr.jong === "ㅀ") { curr.jong = ""; next.cho = "ㄹ"; }
        } else if (next.cho === "ㄱ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅋ";
        } else if (next.cho === "ㄷ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅌ";
        } else if (next.cho === "ㅈ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅊ";
        }
      }
    }

    // B. 收音遇 ㅎ 送氣化 (ㄱ/ㄷ/ㅂ/ㅈ + ㅎ -> ㅋ/ㅌ/ㅍ/ㅊ)
    if (next && next.isHangul && next.cho === "ㅎ") {
      if (curr.jong === "ㄱ" || curr.jong === "ㅋ" || curr.jong === "ㄺ") {
        curr.jong = curr.jong === "ㄺ" ? "ㄹ" : "";
        next.cho = "ㅋ";
      } else if (curr.jong === "ㄷ" || curr.jong === "ㅅ" || curr.jong === "ㅈ" || curr.jong === "ㅊ" || curr.jong === "ㅌ") {
        curr.jong = "";
        next.cho = "ㅌ";
      } else if (curr.jong === "ㅂ" || curr.jong === "ㅍ" || curr.jong === "ㄼ" || curr.jong === "ㅄ") {
        curr.jong = curr.jong === "ㄼ" ? "ㄹ" : "";
        next.cho = "ㅍ";
      }
    }

    // C. 連音化 (Liaison): 收音遇下一音節以 ㅇ 開頭
    if (curr.jong && next && next.isHangul && next.cho === "ㅇ") {
      if (curr.jong === "ㄳ") { curr.jong = "ㄱ"; next.cho = "ㅅ"; }
      else if (curr.jong === "ㄵ") { curr.jong = "ㄴ"; next.cho = "ㅈ"; }
      else if (curr.jong === "ㄼ") { curr.jong = "ㄹ"; next.cho = "ㅂ"; }
      else if (curr.jong === "ㄽ") { curr.jong = "ㄹ"; next.cho = "ㅅ"; }
      else if (curr.jong === "ㄾ") { curr.jong = "ㄹ"; next.cho = "ㅌ"; }
      else if (curr.jong === "ㄿ") { curr.jong = "ㄹ"; next.cho = "ㅍ"; }
      else if (curr.jong === "ㅄ") { curr.jong = "ㅂ"; next.cho = "ㅅ"; }
      else if (curr.jong === "ㄺ") { curr.jong = "ㄹ"; next.cho = "ㄱ"; }
      else if (curr.jong === "ㄻ") { curr.jong = "ㄹ"; next.cho = "ㅁ"; }
      else if (curr.jong !== "ㅇ") {
        next.cho = curr.jong;
        curr.jong = "";
      }
    }

    // D. 流音化 (Lateralization): ㄴ + ㄹ -> ㄹ + ㄹ, ㄹ + ㄴ -> ㄹ + ㄹ
    if (next && next.isHangul) {
      if (curr.jong === "ㄴ" && next.cho === "ㄹ") {
        curr.jong = "ㄹ";
      } else if (curr.jong === "ㄹ" && next.cho === "ㄴ") {
        next.cho = "ㄹ";
      }
    }

    // E. 鼻音化 (Nasalization): ㄱ/ㄷ/ㅂ 代表音接 ㄴ/ㅁ 變為 ㅇ/ㄴ/ㅁ
    if (next && next.isHangul && (next.cho === "ㄴ" || next.cho === "ㅁ")) {
      const neutral = getNeutralCoda(curr.jong);
      if (neutral === "ㄱ") curr.jong = "ㅇ";
      else if (neutral === "ㄷ") curr.jong = "ㄴ";
      else if (neutral === "ㅂ") curr.jong = "ㅁ";
    }
  }

  return items;
}

function getNeutralCoda(jong: string): string {
  if (!jong) return "";
  if (["ㄱ", "ㅋ", "ㄲ", "ㄳ", "ㄺ"].includes(jong)) return "ㄱ";
  if (["ㄴ", "ㄵ", "ㄶ"].includes(jong)) return "ㄴ";
  if (["ㄷ", "ㅅ", "ㅆ", "ㅈ", "ㅊ", "ㅌ", "ㅎ"].includes(jong)) return "ㄷ";
  if (["ㄹ", "ㄼ", "ㄽ", "ㄾ", "ㅀ"].includes(jong)) return "ㄹ";
  if (["ㅁ", "ㄻ"].includes(jong)) return "ㅁ";
  if (["ㅂ", "ㅍ", "ㅄ", "ㄿ"].includes(jong)) return "ㅂ";
  if (jong === "ㅇ") return "ㅇ";
  return jong;
}

function codaToStandardKey(jong: string): string | undefined {
  const neutral = getNeutralCoda(jong);
  switch (neutral) {
    case "ㄱ": return "k";
    case "ㄴ": return "n";
    case "ㄷ": return "t";
    case "ㄹ": return "l";
    case "ㅁ": return "m";
    case "ㅂ": return "p";
    case "ㅇ": return "ng";
    default: return undefined;
  }
}

// 常用流行歌詞片語詞典
export const KOREAN_PHRASES: Record<string, { chinese: string; romanization: string }> = {
  ...GRAMMAR_PARTICLES,
  사랑해: { chinese: "撒浪嘿", romanization: "saranghae" },
  사랑해요: { chinese: "撒浪嘿呦", romanization: "saranghaeyo" },
  너를: { chinese: "呢樂", romanization: "neoreul" },
  "보고 싶다": { chinese: "剖勾 喜打", romanization: "bogo sipda" },
  보고싶다: { chinese: "剖勾 喜打", romanization: "bogo sipda" },
  "보고 싶어": { chinese: "剖勾 喜剖", romanization: "bogo sipeo" },
  보고싶어: { chinese: "剖勾 喜剖", romanization: "bogo sipeo" },
  오빠: { chinese: "歐巴", romanization: "oppa" },
  감사합니다: { chinese: "康桑哈米達", romanization: "gamsahamnida" },
  미안해: { chinese: "米安嘿", romanization: "mianhae" },
  안녕: { chinese: "安妞", romanization: "annyeong" },
  괜찮아: { chinese: "快差納", romanization: "gwaenchana" },
  가지마: { chinese: "卡基馬", romanization: "gajima" },
  어떻게: { chinese: "歐透給", romanization: "eotteoke" },
  진짜: { chinese: "緊甲", romanization: "jinjja" },
};

const SORTED_KOREAN_KEYS = Object.keys(KOREAN_PHRASES).sort((a, b) => b.length - a.length);

// 3. 混成空耳合成核心 (Blended Homophone Synthesizer)
export function koreanToBlendedHomophone(
  text: string,
  allowedSystems: PhoneticSystem[] = ["chinese", "latin"],
  style: PronunciationStyle = "singable"
): { displayText: string; syllables: BlendedSyllable[] } {
  const syllables: BlendedSyllable[] = [];
  const displayParts: string[] = [];

  // 1. 先對整行文字執行整行音韻序列解析，保證連音聲母移位至下一字！
  const phonologyItems = applyKoreanPhonology(text);

  let cursor = 0;
  let itemIndex = 0; // phonologyItems is indexed by code point, cursor by UTF-16 unit

  while (cursor < text.length) {
    // A. 先檢查片語詞典 (Tier 1: 最長匹配)
    let matchedKey: string | null = null;
    for (const key of SORTED_KOREAN_KEYS) {
      if (text.startsWith(key, cursor)) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      const entry = KOREAN_PHRASES[matchedKey]!;
      let phraseDisplay = entry.chinese;

      if (!allowedSystems.includes("chinese")) {
        if (allowedSystems.includes("latin")) phraseDisplay = entry.romanization;
      } else if (matchedKey === "너를") {
        phraseDisplay = "呢樂";
      }

      displayParts.push(phraseDisplay);
      syllables.push({
        sourceText: matchedKey,
        onset: "",
        nucleus: "",
        fragments: [
          {
            system: allowedSystems.includes("chinese") ? "chinese" : allowedSystems[0] || "chinese",
            role: "base",
            text: phraseDisplay,
            phonemes: [phraseDisplay],
          },
        ],
        displayText: phraseDisplay,
        tier: "phrase",
      });
      cursor += matchedKey.length;
      itemIndex += matchedKey.length; // phrase keys are BMP-only Hangul
      continue;
    }

    // B. 未命中片語，取得目前音韻處理後的字元
    const char = String.fromCodePoint(text.codePointAt(cursor)!);
    if (!isHangulChar(char)) {
      displayParts.push(char);
      syllables.push({
        sourceText: char,
        onset: "",
        nucleus: "",
        fragments: [
          {
            system: allowedSystems[0] || "chinese",
            role: "base",
            text: char,
            phonemes: [char],
          },
        ],
        displayText: char,
        tier: "passthrough",
      });
      cursor += char.length;
      itemIndex++;
      continue;
    }

    // 取出整行音韻序列中對應的表面發音音節
    const item = phonologyItems[itemIndex] || decomposeHangulChar(char);
    const isMedial = cursor > 0 && text[cursor - 1] !== " ";

    const surface: SurfaceSyllable = {
      sourceChar: char,
      onset: item.cho,
      nucleus: item.jung,
      coda: codaToStandardKey(item.jong),
      isMedial,
    };

    const blended = synthesizeBlendedSyllable(surface, allowedSystems, style);
    displayParts.push(blended.displayText);
    syllables.push(blended);

    cursor++;
    itemIndex++;
  }

  const displayText = displayParts.join("").replace(/\s+/g, " ").trim();
  return { displayText, syllables };
}
