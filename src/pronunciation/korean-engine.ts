import type { PronunciationSegment } from "../domain/types.js";

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

// 3. 台灣注音對照表 (Bopomofo Mappings)
const CHO_TO_BOPOMOFO: Record<string, string> = {
  ㄱ: "ㄍ", ㄲ: "ㄍ", ㄴ: "ㄋ", ㄷ: "ㄉ", ㄸ: "ㄉ",
  ㄹ: "ㄌ", ㅁ: "ㄇ", ㅂ: "ㄅ", ㅃ: "ㄅ", ㅅ: "ㄙ",
  ㅆ: "ㄙ", ㅇ: "", ㅈ: "ㄗ", ㅉ: "ㄗ", ㅊ: "ㄘ",
  ㅋ: "ㄎ", ㅌ: "ㄊ", ㅍ: "ㄆ", ㅎ: "ㄏ",
};

const JUNG_TO_BOPOMOFO: Record<string, string> = {
  ㅏ: "ㄚ", ㅐ: "ㄝ", ㅑ: "ㄧㄚ", ㅒ: "ㄧㄝ", ㅓ: "ㄛ",
  ㅔ: "ㄝ", ㅕ: "ㄧㄛ", ㅖ: "ㄧㄝ", ㅗ: "ㄛ", ㅘ: "ㄨㄚ",
  ㅙ: "ㄨㄝ", ㅚ: "ㄨㄝ", ㅛ: "ㄧㄛ", ㅜ: "ㄨ", ㅝ: "ㄨㄛ",
  ㅞ: "ㄨㄝ", ㅟ: "ㄨㄧ", ㅠ: "ㄧㄨ", ㅡ: "ㄜ", ㅢ: "ㄜㄧ", ㅣ: "ㄧ",
};

const JONG_TO_BOPOMOFO: Record<string, string> = {
  ㄱ: "ㄍ˙", ㄲ: "ㄍ˙", ㄴ: "ㄣ", ㄷ: "ㄉ˙", ㄹ: "ㄌ",
  ㅁ: "ㄇ", ㅂ: "ㄅ˙", ㅅ: "ㄉ˙", ㅆ: "ㄉ˙", ㅇ: "ㄥ",
  ㅈ: "ㄉ˙", ㅊ: "ㄉ˙", ㅋ: "ㄍ˙", ㅌ: "ㄉ˙", ㅍ: "ㄅ˙", ㅎ: "",
};

// 4. 韓語轉中文字諧音 (Chinese Homophones / 空耳)
// Tier 1: 常用流行歌詞片語詞典
export const KOREAN_CHINESE_PHRASES: Record<string, string> = {
  사랑해: "撒浪嘿",
  사랑해요: "撒浪嘿呦",
  너를: "呢樂",
  너를사랑해: "呢樂 撒浪嘿",
  보고싶다: "剖勾 喜打",
  "보고 싶다": "剖勾 喜打",
  보고싶어: "剖勾 喜剖",
  "보고 싶어": "剖勾 喜剖",
  오빠: "歐巴",
  감사합니다: "康桑哈米達",
  미안해: "米安嘿",
  안녕: "安妞",
  괜찮아: "快差納",
  가지마: "卡基馬",
  어떻게: "歐透給",
  진짜: "緊甲",
  좋아해: "秋阿嘿",
  행복해: "幸波客",
  영원히: "永遠尼",
  친구: "親故",
};

// 依片語長度降序排序，確保 Longest-match
const SORTED_KOREAN_PHRASES = Object.keys(KOREAN_CHINESE_PHRASES).sort(
  (a, b) => b.length - a.length
);

// Tier 2: 常用音節表 (初聲+中聲對應中文字)
const SYLLABLE_TO_CHINESE: Record<string, string> = {
  // ㄱ
  가: "卡", 갸: "佳", 거: "格", 겨: "覺", 고: "高", 교: "橋", 구: "古", 규: "規", 그: "克", 기: "基",
  개: "凱", 게: "給", 과: "誇", 궈: "果", 귀: "貴",
  // ㄴ
  나: "哪", 냐: "娘", 너: "呢", 녀: "年", 노: "諾", 뇨: "鳥", 누: "奴", 뉴: "紐", 느: "訥", 니: "尼",
  내: "奈", 네: "內", 놔: "諾",
  // ㄷ
  다: "達", 댜: "嗲", 더: "德", 뎌: "點", 도: "多", 됴: "挑", 두: "杜", 듀: "丟", 드: "特", 디: "迪",
  대: "代", 데: "得", 돼: "對",
  // ㄹ
  라: "拉", 랴: "良", 러: "勒", 려: "聯", 로: "羅", 료: "料", 루: "路", 류: "流", 르: "勒", 리: "哩",
  래: "來", 레: "雷",
  // ㅁ
  마: "馬", 먀: "苗", 머: "麼", 며: "免", 모: "莫", 묘: "妙", 무: "木", 뮤: "繆", 므: "默", 미: "米",
  매: "梅", 메: "妹", 뭐: "麼",
  // ㅂ
  바: "巴", 뱌: "變", 버: "伯", 벼: "別", 보: "波", 뵤: "標", 부: "布", 뷰: "標", 브: "不", 비: "比",
  배: "白", 베: "杯",
  // ㅅ
  사: "撒", 샤: "夏", 서: "色", 셔: "寫", 소: "索", 쇼: "秀", 수: "蘇", 슈: "修", 스: "斯", 시: "西",
  새: "塞", 세: "些",
  // ㅇ
  아: "阿", 야: "亞", 어: "俄", 여: "葉", 오: "歐", 요: "優", 우: "烏", 유: "悠", 으: "額", 이: "伊",
  애: "愛", 에: "欸", 왜: "歪", 웨: "衛", 위: "威", 의: "依",
  // ㅈ
  자: "扎", 쟈: "嘉", 저: "澤", 져: "節", 조: "佐", 죠: "照", 주: "朱", 쥬: "主", 즈: "茲", 지: "吉",
  재: "在", 제: "傑",
  // ㅊ
  差: "差", 챠: "恰", 처: "徹", 쳐: "切", 초: "超", 쵸: "俏", 추: "初", 츄: "秋", 츠: "茨", 치: "七",
  채: "彩", 체: "徹",
  // ㅋ
  카: "卡", 캬: "卡", 커: "科", 켜: "科", 코: "闊", 쿄: "扣", 쿠: "庫", 큐: "丘", 크: "克", 키: "琪",
  캐: "開", 케: "凱",
  // ㅌ
  타: "塔", 탸: "塔", 터: "特", 텨: "鐵", 토: "透", 툐: "跳", 투: "兔", 튜: "圖", 트: "特", 티: "踢",
  태: "太", 테: "特",
  // ㅍ
  파: "帕", 퍄: "漂", 퍼: "頗", 펴: "漂", 포: "坡", 표: "飄", 푸: "鋪", 퓨: "飄", 프: "普", 피: "皮",
  패: "派", 페: "配",
  // ㅎ
  하: "哈", 햐: "夏", 허: "賀", 혀: "協", 호: "浩", 효: "孝", 후: "呼", 휴: "休", 흐: "黑", 히: "希",
  해: "嘿", 헤: "黑", 화: "華",
};

const CODA_SYLLABLES_TO_CHINESE: Record<string, string> = {
  랑: "朗", 탕: "湯", 강: "康", 당: "當", 망: "忙", 방: "邦", 상: "桑", 창: "昌", 양: "洋",
  난: "難", 만: "滿", 반: "班", 산: "山", 안: "安", 단: "單", 간: "甘", 선: "善", 련: "聯",
  남: "南", 담: "丹", 밤: "凡", 감: "甘", 삼: "三", 암: "暗",
  달: "達", 말: "末", 발: "拔", 살: "薩", 알: "阿爾",
  할: "哈爾", 날: "哪爾", 를: "樂",
};

export function koreanToBopomofo(text: string): { displayText: string; segments: PronunciationSegment[] } {
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
        tier: "passthrough",
      });
      continue;
    }

    let choBp = CHO_TO_BOPOMOFO[item.cho] || "";
    let jungBp = JUNG_TO_BOPOMOFO[item.jung] || "ㄚ";
    let jongBp = JONG_TO_BOPOMOFO[item.jong] || "";

    if (jungBp.startsWith("ㄧ")) {
      if (choBp === "ㄙ") choBp = "ㄒ";
      else if (choBp === "ㄗ") choBp = "ㄐ";
      else if (choBp === "ㄘ") choBp = "ㄑ";
    }

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
      tier: "syllable",
    });
  }

  return {
    displayText: displayParts.join(" "),
    segments,
  };
}

export function koreanToChineseHomophone(text: string): { displayText: string; segments: PronunciationSegment[] } {
  // Longest-match 片語切詞：找出所有命中 Tier 1 詞典之片段
  const segments: PronunciationSegment[] = [];
  const displayParts: string[] = [];

  let cursor = 0;
  let segId = 0;

  while (cursor < text.length) {
    let matchedPhrase: string | null = null;
    let matchedHomophone: string | null = null;

    // 依長度從長到短檢查是否有命中片語
    for (const phrase of SORTED_KOREAN_PHRASES) {
      if (text.startsWith(phrase, cursor)) {
        matchedPhrase = phrase;
        matchedHomophone = KOREAN_CHINESE_PHRASES[phrase]!;
        break;
      }
    }

    if (matchedPhrase && matchedHomophone) {
      displayParts.push(matchedHomophone);
      segments.push({
        segmentId: `seg-${++segId}`,
        sourceText: matchedPhrase,
        phonemes: [matchedHomophone],
        display: matchedHomophone,
        tier: "phrase",
      });
      cursor += matchedPhrase.length;
      continue;
    }

    // 若未命中片語，取單一字元處理
    const char = text[cursor]!;
    if (!isHangulChar(char)) {
      displayParts.push(char);
      segments.push({
        segmentId: `seg-${++segId}`,
        sourceText: char,
        phonemes: [char],
        display: char,
        tier: "passthrough",
      });
      cursor++;
      continue;
    }

    // 處理單一 Hangul 字元 (先進行單字音節對照)
    const decomposed = decomposeHangulChar(char);
    const surfaceChar = composeHangul(decomposed.cho, decomposed.jung, decomposed.jong);

    if (CODA_SYLLABLES_TO_CHINESE[surfaceChar]) {
      const val = CODA_SYLLABLES_TO_CHINESE[surfaceChar]!;
      displayParts.push(val);
      segments.push({
        segmentId: `seg-${++segId}`,
        sourceText: char,
        phonemes: [val],
        display: val,
        tier: "syllable",
      });
    } else {
      const openChar = composeHangul(decomposed.cho, decomposed.jung);
      let val = SYLLABLE_TO_CHINESE[openChar];
      if (val) {
        if (decomposed.jong) {
          if (decomposed.jong === "ㅇ") val += "昂";
          else if (decomposed.jong === "ㄴ") val += "恩";
          else if (decomposed.jong === "ㅁ") val += "姆";
          else if (decomposed.jong === "ㄹ") val += "爾";
        }
        displayParts.push(val);
        segments.push({
          segmentId: `seg-${++segId}`,
          sourceText: char,
          phonemes: [val],
          display: val,
          tier: decomposed.jong ? "fallback" : "syllable",
        });
      } else {
        const bp = CHO_TO_BOPOMOFO[decomposed.cho] || char;
        displayParts.push(bp);
        segments.push({
          segmentId: `seg-${++segId}`,
          sourceText: char,
          phonemes: [bp],
          display: bp,
          tier: "fallback",
        });
      }
    }

    cursor++;
  }

  // 規範輸出排版：字詞間若包含空白則保留，避免多餘空白
  const displayText = displayParts.join("").replace(/\s+/g, " ").trim();

  return {
    displayText,
    segments,
  };
}
