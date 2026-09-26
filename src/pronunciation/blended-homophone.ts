import type {
  BlendedSyllable,
  PhoneticSystem,
  PronunciationFragment,
} from "../domain/types.js";

export interface SurfaceSyllable {
  sourceChar: string;
  onset: string;
  nucleus: string;
  coda?: string; // 歸一化代表收音: "k", "n", "t", "l", "m", "p", "ng" 或空
}

// 基礎映射資源
export const OPEN_SYLLABLE_CHINESE: Record<string, string> = {
  // ㄱ / k, g
  "ㄱ+ㅏ": "卡", "ㄱ+ㅑ": "佳", "ㄱ+ㅓ": "格", "ㄱ+ㅕ": "覺", "ㄱ+ㅗ": "高", "ㄱ+ㅛ": "橋", "ㄱ+ㅜ": "古", "ㄱ+ㅠ": "規", "ㄱ+ㅡ": "克", "ㄱ+ㅣ": "基",
  "ㄱ+ㅐ": "凱", "ㄱ+ㅔ": "給", "ㄱ+ㅘ": "誇", "ㄱ+ㅝ": "果", "ㄱ+ㅟ": "貴",
  // ㄴ / n
  "ㄴ+ㅏ": "哪", "ㄴ+ㅑ": "娘", "ㄴ+ㅓ": "呢", "ㄴ+ㅕ": "年", "ㄴ+ㅗ": "諾", "ㄴ+ㅛ": "鳥", "ㄴ+ㅜ": "奴", "ㄴ+ㅠ": "紐", "ㄴ+ㅡ": "訥", "ㄴ+ㅣ": "尼",
  "ㄴ+ㅐ": "奈", "ㄴ+ㅔ": "內", "ㄴ+ㅘ": "諾",
  // ㄷ / t, d
  "ㄷ+ㅏ": "達", "ㄷ+ㅑ": "嗲", "ㄷ+ㅓ": "德", "ㄷ+ㅕ": "點", "ㄷ+ㅗ": "多", "ㄷ+ㅛ": "挑", "ㄷ+ㅜ": "杜", "ㄷ+ㅠ": "丟", "ㄷ+ㅡ": "特", "ㄷ+ㅣ": "迪",
  "ㄷ+ㅐ": "代", "ㄷ+ㅔ": "得", "ㄷ+ㅙ": "對",
  // ㄹ / r, l
  "ㄹ+ㅏ": "拉", "ㄹ+ㅑ": "良", "ㄹ+ㅓ": "勒", "ㄹ+ㅕ": "聯", "ㄹ+ㅗ": "羅", "ㄹ+ㅛ": "料", "ㄹ+ㅜ": "路", "ㄹ+ㅠ": "流", "ㄹ+ㅡ": "勒", "ㄹ+ㅣ": "哩",
  "ㄹ+ㅐ": "來", "ㄹ+ㅔ": "雷",
  // ㅁ / m
  "ㅁ+ㅏ": "馬", "ㅁ+ㅑ": "苗", "ㅁ+ㅓ": "麼", "ㅁ+ㅕ": "免", "ㅁ+ㅗ": "莫", "ㅁ+ㅛ": "妙", "ㅁ+ㅜ": "木", "ㅁ+ㅠ": "繆", "ㅁ+ㅡ": "默", "ㅁ+ㅣ": "米",
  "ㅁ+ㅐ": "梅", "ㅁ+ㅔ": "妹", "ㅁ+ㅝ": "麼",
  // ㅂ / p, b
  "ㅂ+ㅏ": "巴", "ㅂ+ㅑ": "變", "ㅂ+ㅓ": "伯", "ㅂ+ㅕ": "別", "ㅂ+ㅗ": "波", "ㅂ+ㅛ": "標", "ㅂ+ㅜ": "布", "ㅂ+ㅠ": "標", "ㅂ+ㅡ": "不", "ㅂ+ㅣ": "比",
  "ㅂ+ㅐ": "白", "ㅂ+ㅔ": "杯",
  // ㅅ / s
  "ㅅ+ㅏ": "撒", "ㅅ+ㅑ": "夏", "ㅅ+ㅓ": "色", "ㅅ+ㅕ": "寫", "ㅅ+ㅗ": "索", "ㅅ+ㅛ": "秀", "ㅅ+ㅜ": "蘇", "ㅅ+ㅠ": "修", "ㅅ+ㅡ": "斯", "ㅅ+ㅣ": "西",
  "ㅅ+ㅐ": "塞", "ㅅ+ㅔ": "些",
  // ㅇ / null
  "ㅇ+ㅏ": "阿", "ㅇ+ㅑ": "亞", "ㅇ+ㅓ": "俄", "ㅇ+ㅕ": "葉", "ㅇ+ㅗ": "歐", "ㅇ+ㅛ": "優", "ㅇ+ㅜ": "烏", "ㅇ+ㅠ": "悠", "ㅇ+ㅡ": "額", "ㅇ+ㅣ": "伊",
  "ㅇ+애": "愛", "ㅇ+에": "欸", "ㅇ+왜": "歪", "ㅇ+웨": "衛", "ㅇ+위": "威", "ㅇ+의": "依",
  // ㅈ / ch, j
  "ㅈ+ㅏ": "扎", "ㅈ+ㅑ": "嘉", "ㅈ+ㅓ": "澤", "ㅈ+ㅕ": "節", "ㅈ+ㅗ": "佐", "ㅈ+ㅛ": "照", "ㅈ+ㅜ": "朱", "ㅈ+ㅠ": "主", "ㅈ+ㅡ": "茲", "ㅈ+ㅣ": "吉",
  "ㅈ+ㅐ": "在", "ㅈ+ㅔ": "傑",
  // ㅊ / ch'
  "ㅊ+ㅏ": "差", "ㅊ+ㅑ": "恰", "ㅊ+ㅓ": "徹", "ㅊ+ㅕ": "切", "ㅊ+ㅗ": "超", "ㅊ+ㅛ": "俏", "ㅊ+ㅜ": "初", "ㅊ+ㅠ": "秋", "ㅊ+ㅡ": "茨", "ㅊ+ㅣ": "七",
  "ㅊ+ㅐ": "彩", "ㅊ+ㅔ": "徹",
  // ㅋ / k'
  "ㅋ+ㅏ": "卡", "ㅋ+ㅑ": "卡", "ㅋ+ㅓ": "科", "ㅋ+ㅕ": "科", "ㅋ+ㅗ": "闊", "ㅋ+ㅛ": "扣", "ㅋ+ㅜ": "庫", "ㅋ+ㅠ": "丘", "ㅋ+ㅡ": "克", "ㅋ+ㅣ": "琪",
  "ㅋ+ㅐ": "開", "ㅋ+ㅔ": "凱",
  // ㅌ / t'
  "ㅌ+ㅏ": "塔", "ㅌ+ㅑ": "塔", "ㅌ+ㅓ": "特", "ㅌ+ㅕ": "鐵", "ㅌ+ㅗ": "透", "ㅌ+툐": "跳", "ㅌ+ㅜ": "兔", "ㅌ+ㅠ": "圖", "ㅌ+ㅡ": "特", "ㅌ+ㅣ": "踢",
  "ㅌ+ㅐ": "太", "ㅌ+ㅔ": "特",
  // ㅍ / p'
  "ㅍ+ㅏ": "帕", "ㅍ+ㅑ": "漂", "ㅍ+ㅓ": "頗", "ㅍ+ㅕ": "漂", "ㅍ+ㅗ": "坡", "ㅍ+ㅛ": "飄", "ㅍ+ㅜ": "鋪", "ㅍ+ㅠ": "飄", "ㅍ+ㅡ": "普", "ㅍ+ㅣ": "皮",
  "ㅍ+패": "派", "ㅍ+페": "配",
  // ㅎ / h
  "ㅎ+ㅏ": "哈", "ㅎ+ㅑ": "夏", "ㅎ+ㅓ": "賀", "ㅎ+ㅕ": "協", "ㅎ+ㅗ": "浩", "ㅎ+ㅛ": "孝", "ㅎ+ㅜ": "呼", "ㅎ+ㅠ": "休", "ㅎ+ㅡ": "黑", "ㅎ+ㅣ": "希",
  "ㅎ+ㅐ": "嘿", "ㅎ+ㅔ": "黑", "ㅎ+ㅘ": "華",
};

export const FUSED_CODA_CHINESE: Record<string, string> = {
  "ㄱ+ㅏ+ng": "康", "ㄴ+ㅏ+ng": "囊", "ㄷ+ㅏ+ng": "當", "ㄹ+ㅏ+ng": "朗", "ㅁ+ㅏ+ng": "忙", "ㅂ+ㅏ+ng": "邦", "ㅅ+ㅏ+ng": "桑", "ㅇ+ㅏ+ng": "昂", "ㅈ+ㅏ+ng": "張", "ㅊ+ㅏ+ng": "昌", "ㅎ+ㅏ+ng": "航",
  "ㄱ+ㅓ+ng": "更", "ㄷ+ㅓ+ng": "鄧", "ㄹ+ㅓ+ng": "冷", "ㅁ+ㅓ+ng": "蒙", "ㅂ+ㅓ+ng": "朋", "ㅅ+ㅓ+ng": "成", "ㅇ+ㅓ+ng": "恩", "ㅈ+ㅓ+ng": "正", "ㅊ+ㅓ+ng": "青", "ㅎ+ㅓ+ng": "衡",
  "ㄱ+ㅗ+ng": "公", "ㄷ+ㅗ+ng": "東", "ㄹ+ㅗ+ng": "龍", "ㅁ+ㅗ+ng": "夢", "ㅂ+ㅗ+ng": "逢", "ㅅ+ㅗ+ng": "松", "ㅇ+ㅗ+ng": "翁", "ㅈ+ㅗ+ng": "宗", "ㅊ+ㅗ+ng": "聰", "ㅎ+ㅗ+ng": "紅",
  "ㄱ+ㅏ+n": "甘", "ㄴ+ㅏ+n": "難", "ㄷ+ㅏ+n": "單", "ㄹ+ㅏ+n": "蘭", "ㅁ+ㅏ+n": "滿", "ㅂ+ㅏ+n": "班", "ㅅ+ㅏ+n": "山", "ㅇ+ㅏ+n": "安", "ㅈ+ㅏ+n": "占", "ㅊ+ㅏ+n": "餐", "ㅎ+ㅏ+n": "韓",
  "ㄱ+ㅓ+n": "根", "ㄴ+ㅓ+n": "嫩", "ㄷ+ㅓ+n": "頓", "ㄹ+ㅓ+n": "倫", "ㅁ+ㅓ+n": "門", "ㅂ+ㅓ+n": "本", "ㅅ+ㅓ+n": "森", "ㅇ+ㅓ+n": "恩", "ㅈ+ㅓ+n": "真", "ㅊ+ㅓ+n": "陳", "ㅎ+ㅓ+n": "痕",
  "ㄱ+ㅣ+n": "金", "ㄴ+ㅣ+n": "您", "ㄷ+ㅣ+n": "丁", "ㄹ+ㅣ+n": "林", "ㅁ+ㅣ+n": "民", "ㅂ+ㅣ+n": "賓", "ㅅ+ㅣ+n": "辛", "ㅇ+ㅣ+n": "銀", "ㅈ+ㅣ+n": "金", "ㅊ+ㅣ+n": "親", "ㅎ+ㅣ+n": "欣",
  "ㄱ+ㅏ+m": "甘", "ㄴ+ㅏ+m": "南", "ㄷ+ㅏ+m": "丹", "ㄹ+ㅏ+m": "藍", "ㅁ+ㅏ+m": "滿", "ㅂ+ㅏ+m": "凡", "ㅅ+ㅏ+m": "三", "ㅇ+ㅏ+m": "暗", "ㅈ+ㅏ+m": "湛", "ㅊ+ㅏ+m": "參", "ㅎ+ㅏ+m": "含",
  "ㄱ+ㅏ+l": "葛", "ㄴ+ㅏ+l": "那", "ㄷ+ㅏ+l": "達", "ㄹ+ㅏ+l": "拉", "ㅁ+ㅏ+l": "末", "ㅂ+ㅏ+l": "拔", "ㅅ+ㅏ+l": "薩", "ㅇ+ㅏ+l": "阿", "ㅈ+ㅏ+l": "札", "ㅊ+ㅏ+l": "察", "ㅎ+ㅏ+l": "哈",
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

// 注音聲母對照
const ONSET_TO_BOPOMOFO: Record<string, string> = {
  ㄱ: "ㄍ", ㄲ: "ㄍ", ㄴ: "ㄋ", ㄷ: "ㄉ", ㄸ: "ㄉ", ㄹ: "ㄌ", ㅁ: "ㄇ",
  ㅂ: "ㄅ", ㅃ: "ㄅ", ㅅ: "ㄙ", ㅆ: "ㄙ", ㅇ: "", ㅈ: "ㄗ", ㅉ: "ㄗ",
  ㅊ: "ㄘ", ㅋ: "ㄎ", ㅌ: "ㄊ", ㅍ: "ㄆ", ㅎ: "ㄏ",
};

// 注音韻母對照
const NUCLEUS_TO_BOPOMOFO: Record<string, string> = {
  ㅏ: "ㄚ", ㅐ: "ㄝ", ㅑ: "ㄧㄚ", ㅒ: "ㄧㄝ", ㅓ: "ㄛ", ㅔ: "ㄝ", ㅕ: "ㄧㄛ",
  ㅖ: "ㄧㄝ", ㅗ: "ㄛ", ㅘ: "ㄨㄚ", ㅙ: "ㄨㄝ", ㅚ: "ㄨㄝ", ㅛ: "ㄧㄛ", ㅜ: "ㄨ",
  ㅝ: "ㄨㄛ", ㅞ: "ㄨㄝ", ㅟ: "ㄨㄧ", ㅠ: "ㄧㄨ", ㅡ: "ㄜ", ㅢ: "ㄜㄧ", ㅣ: "ㄧ",
};

// 收音注音尾符
const CODA_TO_BOPOMOFO: Record<string, string> = {
  k: "ㄍ˙", n: "ㄣ", t: "ㄉ˙", l: "ㄌ", m: "ㄇ", p: "ㄅ˙", ng: "ㄥ",
};

export function synthesizeBlendedSyllable(
  syl: SurfaceSyllable,
  allowedSystems: PhoneticSystem[]
): BlendedSyllable {
  const hasChinese = allowedSystems.includes("chinese");
  const hasLatin = allowedSystems.includes("latin");
  const hasBopomofo = allowedSystems.includes("bopomofo");

  const fragments: PronunciationFragment[] = [];

  // 1. 純 Latin 模式 (例如使用者只選英文)
  if (hasLatin && !hasChinese && !hasBopomofo) {
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

  // 2. 純 Bopomofo 模式 (例如使用者只選注音)
  if (hasBopomofo && !hasChinese && !hasLatin) {
    let bpOnset = ONSET_TO_BOPOMOFO[syl.onset] || "";
    let bpNuc = NUCLEUS_TO_BOPOMOFO[syl.nucleus] || "ㄚ";
    const bpCoda = syl.coda ? CODA_TO_BOPOMOFO[syl.coda] || "" : "";

    if (bpNuc.startsWith("ㄧ")) {
      if (bpOnset === "ㄙ") bpOnset = "ㄒ";
      else if (bpOnset === "ㄗ") bpOnset = "ㄐ";
      else if (bpOnset === "ㄘ") bpOnset = "ㄑ";
    }

    const fullBp = `${bpOnset}${bpNuc}${bpCoda}`;
    fragments.push({
      system: "bopomofo",
      role: "base",
      text: fullBp,
      phonemes: [fullBp],
    });
    return {
      sourceText: syl.sourceChar,
      onset: syl.onset,
      nucleus: syl.nucleus,
      coda: syl.coda,
      fragments,
      displayText: fullBp,
      tier: "syllable",
    };
  }

  // 3. 包含中文漢字的混成模式 (預設且最強大跟唱模式)
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

  // B. 取得開音節常用漢字作為主音 (Base Hanzi)
  const openKey = `${syl.onset}+${syl.nucleus}`;
  let baseHanzi = OPEN_SYLLABLE_CHINESE[openKey];

  if (!baseHanzi) {
    // 若無常用漢字，依勾選工具以注音或羅馬字母作基底
    if (hasBopomofo) {
      baseHanzi = `${ONSET_TO_BOPOMOFO[syl.onset] || ""}${NUCLEUS_TO_BOPOMOFO[syl.nucleus] || ""}`;
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

  // C. 收音處理：混成尾輔音 (Blended Coda Fragment)
  let codaModifier = "";
  if (syl.coda) {
    if (hasLatin) {
      // 優先使用英文字母標註無母音收音 (如 巴p, 呢l, 巴k)
      codaModifier = syl.coda;
      fragments.push({
        system: "latin",
        role: "coda",
        text: codaModifier,
        phonemes: [codaModifier],
      });
    } else if (hasBopomofo) {
      // 若未啟用英文但有注音，使用注音收音符 (如 巴ㄅ˙, 呢ㄌ)
      codaModifier = CODA_TO_BOPOMOFO[syl.coda] || "";
      fragments.push({
        system: "bopomofo",
        role: "coda",
        text: codaModifier,
        phonemes: [codaModifier],
      });
    }
    // 若僅選中文且無自然融合字：不加任何尾字，維持單個漢字一拍！
  }

  const displayText = `${baseHanzi}${codaModifier}`;

  return {
    sourceText: syl.sourceChar,
    onset: syl.onset,
    nucleus: syl.nucleus,
    coda: syl.coda,
    fragments,
    displayText,
    tier: syl.coda && !codaModifier ? "fallback" : "syllable",
    approximation: Boolean(syl.coda && !codaModifier),
  };
}
