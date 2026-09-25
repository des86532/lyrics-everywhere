import type { PronunciationSegment } from "../domain/types.js";

// 1. Hangul Unicode Constants
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;

const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const JUNGSEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

const JONGSEONG = [
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

// 2. 音韻變音規則引擎 (Contextual Phonological Transformation)
export function applyKoreanPhonology(text: string): DecomposedHangul[] {
  const chars = Array.from(text);
  const items = chars.map(decomposeHangulChar);

  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    const next = items[i + 1];
    if (!curr || !curr.isHangul) continue;

    // A. ㅎ 相關音變 (ㅎ-elision & Aspiration)
    if (curr.jong === "ㅎ" || curr.jong === "ㄶ" || curr.jong === "ㅀ") {
      if (next && next.isHangul) {
        if (next.cho === "ㅇ") {
          // ㅎ-elision: 좋아 -> 조아, 넣어 -> 너어
          if (curr.jong === "ㅎ") curr.jong = "";
          else if (curr.jong === "ㄶ") { curr.jong = ""; next.cho = "ㄴ"; }
          else if (curr.jong === "ㅀ") { curr.jong = ""; next.cho = "ㄹ"; }
        } else if (next.cho === "ㄱ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅋ"; // 送氣
        } else if (next.cho === "ㄷ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅌ"; // 送氣: 좋다 -> 조타
        } else if (next.cho === "ㅈ") {
          curr.jong = curr.jong === "ㄶ" ? "ㄴ" : curr.jong === "ㅀ" ? "ㄹ" : "";
          next.cho = "ㅊ"; // 送氣
        }
      }
    }

    // B. 收音遇 ㅎ 送氣化 (ㄱ/ㄷ/ㅂ/ㅈ + ㅎ -> ㅋ/ㅌ/ㅍ/ㅊ)
    if (next && next.isHangul && next.cho === "ㅎ") {
      if (curr.jong === "ㄱ" || curr.jong === "ㅋ" || curr.jong === "ㄺ") {
        curr.jong = curr.jong === "ㄺ" ? "ㄹ" : "";
        next.cho = "ㅋ"; // 축하 -> 추카
      } else if (curr.jong === "ㄷ" || curr.jong === "ㅅ" || curr.jong === "ㅈ" || curr.jong === "ㅊ" || curr.jong === "ㅌ") {
        curr.jong = "";
        next.cho = "ㅌ";
      } else if (curr.jong === "ㅂ" || curr.jong === "ㅍ" || curr.jong === "ㄼ" || curr.jong === "ㅄ") {
        curr.jong = curr.jong === "ㄼ" ? "ㄹ" : "";
        next.cho = "ㅍ"; // 입학 -> 이팍
      }
    }

    // C. 連音化 (Liaison): 收音遇下一個字的初聲是 ㅇ
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
        // 單純收音移至下一音節
        next.cho = curr.jong;
        curr.jong = "";
      }
    }

    // D. 流音化 (Lateralization): ㄴ + ㄹ -> ㄹ + ㄹ, ㄹ + ㄴ -> ㄹ + ㄹ
    if (next && next.isHangul) {
      if (curr.jong === "ㄴ" && next.cho === "ㄹ") {
        curr.jong = "ㄹ"; // 신라 -> 실라
      } else if (curr.jong === "ㄹ" && next.cho === "ㄴ") {
        next.cho = "ㄹ"; // 연락 -> 열락
      }
    }

    // E. 鼻音化 (Nasalization): ㄱ/ㄷ/ㅂ 代表音接 ㄴ/ㅁ 變為 ㅇ/ㄴ/ㅁ
    if (next && next.isHangul && (next.cho === "ㄴ" || next.cho === "ㅁ")) {
      const neutral = getNeutralCoda(curr.jong);
      if (neutral === "ㄱ") curr.jong = "ㅇ"; // 한국말 -> 한궁말
      else if (neutral === "ㄷ") curr.jong = "ㄴ"; // 끝말 -> 끈말
      else if (neutral === "ㅂ") curr.jong = "ㅁ"; // 감사합니다 -> 감사함니다
    }
  }

  return items;
}

// 7 代表收音中和
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

// 3. 台灣注音對照表 (Bopomofo Mappings)
const CHO_TO_BOPOMOFO: Record<string, string> = {
  ㄱ: "ㄍ",
  ㄲ: "ㄍ",
  ㄴ: "ㄋ",
  ㄷ: "ㄉ",
  ㄸ: "ㄉ",
  ㄹ: "ㄌ",
  ㅁ: "ㄇ",
  ㅂ: "ㄅ",
  ㅃ: "ㄅ",
  ㅅ: "ㄙ",
  ㅆ: "ㄙ",
  ㅇ: "",
  ㅈ: "ㄗ",
  ㅉ: "ㄗ",
  ㅊ: "ㄘ",
  ㅋ: "ㄎ",
  ㅌ: "ㄊ",
  ㅍ: "ㄆ",
  ㅎ: "ㄏ",
};

const JUNG_TO_BOPOMOFO: Record<string, string> = {
  ㅏ: "ㄚ",
  ㅐ: "ㄝ",
  ㅑ: "ㄧㄚ",
  ㅒ: "ㄧㄝ",
  ㅓ: "ㄛ",
  ㅔ: "ㄝ",
  ㅕ: "ㄧㄛ",
  ㅖ: "ㄧㄝ",
  ㅗ: "ㄛ",
  ㅘ: "ㄨㄚ",
  ㅙ: "ㄨㄝ",
  ㅚ: "ㄨㄝ",
  ㅛ: "ㄧㄛ",
  ㅜ: "ㄨ",
  ㅝ: "ㄨㄛ",
  ㅞ: "ㄨㄝ",
  ㅟ: "ㄨㄧ",
  ㅠ: "ㄧㄨ",
  ㅡ: "ㄜ",
  ㅢ: "ㄜㄧ",
  ㅣ: "ㄧ",
};

const JONG_TO_BOPOMOFO: Record<string, string> = {
  ㄱ: "ㄍ˙",
  ㄲ: "ㄍ˙",
  ㄴ: "ㄣ",
  ㄷ: "ㄉ˙",
  ㄹ: "ㄌ",
  ㅁ: "ㄇ",
  ㅂ: "ㄅ˙",
  ㅅ: "ㄉ˙",
  ㅆ: "ㄉ˙",
  ㅇ: "ㄥ",
  ㅈ: "ㄉ˙",
  ㅊ: "ㄉ˙",
  ㅋ: "ㄍ˙",
  ㅌ: "ㄉ˙",
  ㅍ: "ㄅ˙",
  ㅎ: "",
};

// 歌詞高頻詞例外詞典 (Lexicon exceptions for natural sing-along transcription)
const LEXICON_PHRASES: Record<string, string> = {
  사랑해: "ㄙㄚ ㄌㄤ ㄏㄟ",
  사랑해요: "ㄙㄚ ㄌㄤ ㄏㄟ ㄧㄛ",
  너를: "ㄋㄜ ㄌㄜ˙",
  보고싶어: "ㄆㄛ ㄍㄛ ㄒㄧ ㄆㄛ",
  보고_싶어: "ㄆㄛ ㄍㄛ ㄒㄧ ㄆㄛ",
  오빠: "ㄛ ㄅㄚ",
  감사합니다: "ㄍㄢ ㄙㄚ ㄏㄚㄇ ㄋㄧ ㄉㄚ",
  미안해: "ㄇㄧ ㄢ ㄏㄟ",
  안녕: "ㄢ ㄋㄩㄥ",
  괜찮아: "ㄎㄨㄝㄣ ㄘㄚ ㄋㄚ",
};

export function koreanToBopomofo(text: string): { displayText: string; segments: PronunciationSegment[] } {
  // 檢查是否命中整行/整片詞典
  const normalizedKey = text.replace(/\s+/g, "");
  if (LEXICON_PHRASES[normalizedKey]) {
    const val = LEXICON_PHRASES[normalizedKey]!;
    return {
      displayText: val,
      segments: [
        {
          segmentId: "seg-lexicon",
          sourceText: text,
          phonemes: [val],
          display: val,
          flags: ["liaison"],
        },
      ],
    };
  }

  // 套用音韻學音變 (Hangul Phonological Rules)
  const items = applyKoreanPhonology(text);
  const segments: PronunciationSegment[] = [];
  const displayParts: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    if (!item.isHangul) {
      displayParts.push(item.char);
      segments.push({
        segmentId: `seg-${i}`,
        sourceText: item.char,
        phonemes: [item.char],
        display: item.char,
      });
      continue;
    }

    let choBp = CHO_TO_BOPOMOFO[item.cho] || "";
    let jungBp = JUNG_TO_BOPOMOFO[item.jung] || "ㄚ";
    let jongBp = JONG_TO_BOPOMOFO[item.jong] || "";

    // 顎音化調諧：ㅅ/ㅈ/ㅊ/ㅆ 遇 ㄧ 介音轉為 ㄒ/ㄐ/ㄑ
    if (jungBp.startsWith("ㄧ")) {
      if (choBp === "ㄙ") choBp = "ㄒ";
      else if (choBp === "ㄗ") choBp = "ㄐ";
      else if (choBp === "ㄘ") choBp = "ㄑ";
    }

    // 複合音調整：例如 ㄛ + ㄥ -> ㄨㄥ；ㄚ + ㄥ -> ㄤ
    if (jungBp === "ㄚ" && jongBp === "ㄥ") {
      jungBp = "ㄤ";
      jongBp = "";
    } else if (jungBp === "ㄛ" && jongBp === "ㄥ") {
      jungBp = "ㄨㄥ";
      jongBp = "";
    } else if (jungBp === "ㄚ" && jongBp === "ㄣ") {
      jungBp = "ㄢ";
      jongBp = "";
    }

    const syllableBp = `${choBp}${jungBp}${jongBp}`;
    displayParts.push(syllableBp);
    segments.push({
      segmentId: `seg-${i}`,
      sourceText: item.char,
      phonemes: [syllableBp],
      display: syllableBp,
    });
  }

  return {
    displayText: displayParts.join(" "),
    segments,
  };
}
