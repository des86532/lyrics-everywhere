import type {
  BlendedSyllable,
  PhoneticSystem,
  PronunciationFragment,
  PronunciationStyle,
} from "../domain/types.js";
import {
  EXTENDED_OPEN_SYLLABLE_CHINESE,
  MEDIAL_VOICED_CHINESE,
} from "./korean-homophone-data.js";

export interface SurfaceSyllable {
  sourceChar: string;
  onset: string;
  nucleus: string;
  coda?: string; // 歸一化代表收音: "k", "n", "t", "l", "m", "p", "ng"
  isMedial?: boolean; // 是否位於詞中或元音間 (濁化/弱化考量)
}

// 包含常用鼻音/流音的自然單一漢字
export const FUSED_CODA_CHINESE: Record<string, string> = {
  // -ng (ㅇ)
  "ㄱ+ㅏ+ng": "康", "ㄴ+ㅏ+ng": "囊", "ㄷ+ㅏ+ng": "當", "ㄹ+ㅏ+ng": "朗", "ㅁ+ㅏ+ng": "忙", "ㅂ+ㅏ+ng": "邦", "ㅅ+ㅏ+ng": "桑", "ㅇ+ㅏ+ng": "昂", "ㅈ+ㅏ+ng": "張", "ㅊ+ㅏ+ng": "昌", "ㅎ+ㅏ+ng": "航",
  "ㄱ+ㅓ+ng": "更", "ㄷ+ㅓ+ng": "鄧", "ㄹ+ㅓ+ng": "冷", "ㅁ+ㅓ+ng": "蒙", "ㅂ+ㅓ+ng": "朋", "ㅅ+ㅓ+ng": "成", "ㅇ+ㅓ+ng": "恩", "ㅈ+ㅓ+ng": "正", "ㅊ+ㅓ+ng": "青", "ㅎ+ㅓ+ng": "衡",
  "ㄱ+ㅗ+ng": "公", "ㄷ+ㅗ+ng": "東", "ㄹ+ㅗ+ng": "龍", "ㅁ+ㅗ+ng": "夢", "ㅂ+ㅗ+ng": "逢", "ㅅ+ㅗ+ng": "松", "ㅇ+ㅗ+ng": "翁", "ㅈ+ㅗ+ng": "宗", "ㅊ+ㅗ+ng": "聰", "ㅎ+ㅗ+ng": "紅",
  // -n (ㄴ)
  "ㄱ+ㅏ+n": "甘", "ㄴ+ㅏ+n": "難", "ㄷ+ㅏ+n": "單", "ㄹ+ㅏ+n": "蘭", "ㅁ+ㅏ+n": "滿", "ㅂ+ㅏ+n": "班", "ㅅ+ㅏ+n": "山", "ㅇ+ㅏ+n": "安", "ㅈ+ㅏ+n": "占", "ㅊ+ㅏ+n": "餐", "ㅎ+ㅏ+n": "韓",
  "ㄱ+ㅓ+n": "根", "ㄴ+ㅓ+n": "嫩", "ㄷ+ㅓ+n": "頓", "ㄹ+ㅓ+n": "倫", "ㅁ+ㅓ+n": "門", "ㅂ+ㅓ+n": "本", "ㅅ+ㅓ+n": "森", "ㅇ+ㅓ+n": "恩", "ㅈ+ㅓ+n": "真", "ㅊ+ㅓ+n": "陳", "ㅎ+ㅓ+n": "痕",
  "ㄱ+ㅣ+n": "金", "ㄴ+ㅣ+n": "您", "ㄷ+ㅣ+n": "丁", "ㄹ+ㅣ+n": "林", "ㅁ+ㅣ+n": "民", "ㅂ+ㅣ+n": "賓", "ㅅ+ㅣ+n": "辛", "ㅇ+ㅣ+n": "銀", "ㅈ+ㅣ+n": "金", "ㅊ+ㅣ+n": "親", "ㅎ+ㅣ+n": "欣",
  "ㄴ+ㅜ+n": "潤", "ㅅ+ㅗ+n": "送", "ㅃ+ㅡ+n": "奔",
  // -m (ㅁ)
  "ㄱ+ㅏ+m": "甘", "ㄴ+ㅏ+m": "南", "ㄷ+ㅏ+m": "丹", "ㄹ+ㅏ+m": "藍", "ㅁ+ㅏ+m": "滿", "ㅂ+ㅏ+m": "凡", "ㅅ+ㅏ+m": "三", "ㅇ+ㅏ+m": "暗", "ㅈ+ㅏ+m": "湛", "ㅊ+ㅏ+m": "參", "ㅎ+ㅏ+m": "含",
  // -l (ㄹ) - 嚴格單一漢字對照
  "ㄱ+ㅏ+l": "葛", "ㄴ+ㅏ+l": "乃", "ㄷ+ㅏ+l": "達", "ㄹ+ㅏ+l": "拉", "ㅁ+ㅏ+l": "末", "ㅂ+ㅏ+l": "拔", "ㅅ+ㅏ+l": "薩", "ㅇ+ㅏ+l": "阿", "ㅈ+ㅏ+l": "札", "ㅊ+ㅏ+l": "察", "ㅎ+ㅏ+l": "哈",
  "ㄴ+ㅓ+l": "勒", "ㅅ+ㅜ+l": "素",
};

// 羅馬字母聲母對照 (Revised Romanization)
const ONSET_TO_ROMAN: Record<string, string> = {
  ㄱ: "g", ㄲ: "kk", ㄴ: "n", ㄷ: "d", ㄸ: "tt", ㄹ: "r", ㅁ: "m",
  ㅂ: "b", ㅃ: "pp", ㅅ: "s", ㅆ: "ss", ㅇ: "", ㅈ: "j", ㅉ: "jj",
  ㅊ: "ch", ㅋ: "k", ㅌ: "t", ㅍ: "p", ㅎ: "h",
};

// 羅馬字母韻母對照
const NUCLEUS_TO_ROMAN: Record<string, string> = {
  ㅏ: "a", ㅐ: "ae", ㅑ: "ya", ㅒ: "yae", ㅓ: "eo", ㅔ: "e", ㅕ: "yeo",
  ㅖ: "ye", ㅗ: "o", ㅘ: "wa", ㅙ: "wae", ㅚ: "oe", ㅛ: "yo", ㅜ: "u",
  ㅝ: "wo", ㅞ: "we", ㅟ: "wi", ㅠ: "yu", ㅡ: "eu", ㅢ: "ui", ㅣ: "i",
};

export function synthesizeBlendedSyllable(
  syl: SurfaceSyllable,
  allowedSystems: PhoneticSystem[],
  _style: PronunciationStyle = "singable"
): BlendedSyllable {
  const hasChinese = allowedSystems.includes("chinese");
  const hasLatin = allowedSystems.includes("latin");

  const fragments: PronunciationFragment[] = [];

  // 1. 純羅馬拼音模式 (僅限使用者明確只勾選羅馬拼音時)
  if (hasLatin && !hasChinese) {
    const romOnset = ONSET_TO_ROMAN[syl.onset] || "";
    const romNuc = NUCLEUS_TO_ROMAN[syl.nucleus] || "a";
    const romCoda = syl.coda || "";
    const fullRoman = `${romOnset}${romNuc}${romCoda}`;
    fragments.push({
      system: "latin",
      role: "base",
      text: fullRoman,
      phonemes: [fullRoman],
    });
    return {
      sourceText: syl.sourceChar,
      onset: syl.onset,
      nucleus: syl.nucleus,
      coda: syl.coda,
      fragments,
      displayText: fullRoman,
      tier: "syllable",
    };
  }

  // 2. 包含中文漢字的空耳模式 (預設且最符合大眾跟唱體驗)
  // A. 優先嘗試收音自然融合單一漢字 (Fused single Hanzi)
  const fusedKey = `${syl.onset}+${syl.nucleus}+${syl.coda || ""}`;
  if (syl.coda && FUSED_CODA_CHINESE[fusedKey]) {
    const fusedChar = FUSED_CODA_CHINESE[fusedKey]!;
    fragments.push({
      system: "chinese",
      role: "base",
      text: fusedChar,
      phonemes: [fusedChar],
    });
    return {
      sourceText: syl.sourceChar,
      onset: syl.onset,
      nucleus: syl.nucleus,
      coda: syl.coda,
      fragments,
      displayText: fusedChar,
      tier: "syllable",
    };
  }

  // B. 取得開音節漢字作為主音 (Base Hanzi)
  const openKey = `${syl.onset}+${syl.nucleus}`;
  let baseHanzi: string | undefined;

  // 句中/詞中 濁音調諧
  if (syl.isMedial && MEDIAL_VOICED_CHINESE[openKey]) {
    baseHanzi = MEDIAL_VOICED_CHINESE[openKey];
  } else {
    baseHanzi = EXTENDED_OPEN_SYLLABLE_CHINESE[openKey];
  }

  if (!baseHanzi) {
    if (hasChinese) {
      baseHanzi =
        EXTENDED_OPEN_SYLLABLE_CHINESE[`${syl.onset}+ㅏ`] ||
        EXTENDED_OPEN_SYLLABLE_CHINESE[`ㅇ+${syl.nucleus}`] ||
        "啊";
    } else {
      baseHanzi = `${ONSET_TO_ROMAN[syl.onset] || ""}${NUCLEUS_TO_ROMAN[syl.nucleus] || ""}`;
    }
  }

  fragments.push({
    system: "chinese",
    role: "base",
    text: baseHanzi,
    phonemes: [baseHanzi],
  });


  const displayText = baseHanzi;

  return {
    sourceText: syl.sourceChar,
    onset: syl.onset,
    nucleus: syl.nucleus,
    coda: syl.coda,
    fragments,
    displayText,
    tier: "syllable",
    approximation: Boolean(syl.coda),
  };
}
