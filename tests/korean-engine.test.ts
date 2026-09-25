import { describe, expect, it } from "vitest";
import {
  applyKoreanPhonology,
  composeHangul,
  decomposeHangulChar,
  koreanToBopomofo,
} from "../src/pronunciation/korean-engine.js";

describe("Korean Phonology & Bopomofo Engine", () => {
  it("decomposes and recomposes Hangul syllables correctly", () => {
    const dec = decomposeHangulChar("한");
    expect(dec.cho).toBe("ㅎ");
    expect(dec.jung).toBe("ㅏ");
    expect(dec.jong).toBe("ㄴ");
    expect(composeHangul(dec.cho, dec.jung, dec.jong)).toBe("한");
  });

  it("applies aspiration rule (좋다 -> 조타, 축하 -> 추카)", () => {
    const res1 = applyKoreanPhonology("좋다");
    expect(res1[0]?.jong).toBe("");
    expect(res1[1]?.cho).toBe("ㅌ"); // ㄷ -> ㅌ

    const res2 = applyKoreanPhonology("축하");
    expect(res2[0]?.jong).toBe("");
    expect(res2[1]?.cho).toBe("ㅋ"); // ㄱ -> ㅋ
  });

  it("applies liaison rule (음악 -> 으막)", () => {
    const res = applyKoreanPhonology("음악");
    expect(res[0]?.jong).toBe("");
    expect(res[1]?.cho).toBe("ㅁ");
  });

  it("applies nasalization rule (감사합니다 -> 감사함니다)", () => {
    const res = applyKoreanPhonology("감사합니다");
    // 합(ㅂ) + 니(ㄴ) -> 함(ㅁ) + 니
    expect(res[2]?.jong).toBe("ㅁ");
  });

  it("transcribes Korean lyrics to singable Bopomofo", () => {
    const { displayText } = koreanToBopomofo("사랑해 너를");
    expect(displayText).toContain("ㄙㄚ");
    expect(displayText).toContain("ㄌㄤ");
  });
});
