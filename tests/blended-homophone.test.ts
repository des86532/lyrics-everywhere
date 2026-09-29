import { describe, expect, it } from "vitest";
import { koreanToBlendedHomophone } from "../src/pronunciation/korean-engine.js";

describe("Blended Homophone Synthesizer (混成空耳)", () => {
  it("never appends redundant vowel characters like 昂/恩/姆/爾 to split syllables", () => {
    // 測試韓語 7 種代表收音 (ㄱ, ㄴ, ㄷ, ㄹ, ㅁ, ㅂ, ㅇ)
    const testCases = ["당", "신", "밥", "널", "달", "감", "축"];

    for (const text of testCases) {
      const { displayText } = koreanToBlendedHomophone(text, ["chinese"]);
      expect(displayText).not.toContain("昂");
      expect(displayText).not.toContain("恩");
      expect(displayText).not.toContain("姆");
      expect(displayText).not.toContain("爾");
      // 每個受測韓文音節只輸出一個漢字提示。
      expect(displayText.replace(/\s+/g, "").length).toBe(1);
    }
  });

  it("produces concise single-Hanzi cues for Korean syllables", () => {
    const res1 = koreanToBlendedHomophone("밥", ["chinese", "latin"]);
    expect(res1.displayText).toBe("巴");

    const res2 = koreanToBlendedHomophone("날", ["chinese", "latin"]);
    expect(res2.displayText).toBe("乃");
  });

  it("falls back to one Han character for an unmapped Hangul syllable", () => {
    const res = koreanToBlendedHomophone("쀍", ["chinese"]);

    expect(res.displayText).toBe("八");
  });
  it("preserves natural fused Chinese characters when available (e.g. 난 -> 難, 당 -> 當)", () => {
    const res1 = koreanToBlendedHomophone("난", ["chinese", "latin"]);
    expect(res1.displayText).toBe("難");

    const res2 = koreanToBlendedHomophone("당", ["chinese", "latin"]);
    expect(res2.displayText).toBe("當");
  });

  it("handles multi-word lyrics with concise rhythm", () => {
    const res = koreanToBlendedHomophone("사랑해 너를", ["chinese", "latin"]);
    expect(res.displayText).toContain("撒浪嘿");
    expect(res.displayText).toContain("呢樂");
  });
});
