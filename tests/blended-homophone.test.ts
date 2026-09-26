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
      // 純中文模式下，每個韓文音節恰好對應一個漢字
      expect(displayText.replace(/\s+/g, "").length).toBe(1);
    }
  });

  it("synthesizes Chinese + Latin blended homophones (e.g. 밥 -> 巴p, 널 -> 呢l)", () => {
    const res1 = koreanToBlendedHomophone("밥", ["chinese", "latin"]);
    expect(res1.displayText).toBe("巴p");

    const res2 = koreanToBlendedHomophone("널", ["chinese", "latin"]);
    expect(res2.displayText).toBe("呢l");
  });

  it("synthesizes Chinese + Bopomofo blended homophones (e.g. 밥 -> 巴ㄅ˙, 널 -> 呢ㄌ)", () => {
    const res1 = koreanToBlendedHomophone("밥", ["chinese", "bopomofo"]);
    expect(res1.displayText).toBe("巴ㄅ˙");

    const res2 = koreanToBlendedHomophone("널", ["chinese", "bopomofo"]);
    expect(res2.displayText).toBe("呢ㄌ");
  });

  it("preserves natural fused Chinese characters when available (e.g. 난 -> 難, 당 -> 當)", () => {
    const res1 = koreanToBlendedHomophone("난", ["chinese", "latin"]);
    expect(res1.displayText).toBe("難");

    const res2 = koreanToBlendedHomophone("당", ["chinese", "latin"]);
    expect(res2.displayText).toBe("當");
  });

  it("handles multi-word lyrics with mixed phrase dictionary and blended syllables", () => {
    const res = koreanToBlendedHomophone("사랑해 너를", ["chinese", "latin"]);
    expect(res.displayText).toContain("撒浪嘿");
    expect(res.displayText).toContain("呢l");
  });
});
