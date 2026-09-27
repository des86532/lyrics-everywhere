import { describe, expect, it } from "vitest";
import { koreanToBlendedHomophone } from "../src/pronunciation/korean-engine.js";

describe("Golden Corpus: 3 YouTube Korean K-POP Classic Songs", () => {
  describe("1. 洪真英 - 愛情的電池 (사랑의 배터리)", () => {
    it("line 1: 나를 사랑으로 채워줘요", () => {
      const res = koreanToBlendedHomophone("나를 사랑으로 채워줘요", ["chinese", "latin"]);
      expect(res.displayText).toContain("撒郎");
      expect(res.displayText).toContain("呢路");
      expect(res.displayText).toContain("七我走有");
    });

    it("line 2: 사랑의 배터리가 다 됐나봐요", () => {
      const res = koreanToBlendedHomophone("사랑의 배터리가 다 됐나봐요", ["chinese", "latin"]);
      expect(res.displayText).toContain("胚偷李嘎");
      expect(res.displayText).toContain("八有");
    });

    it("line 3: 당신 없인 못살아", () => {
      const res = koreanToBlendedHomophone("당신 없인 못살아", ["chinese", "latin"]);
      expect(res.displayText).toContain("偶心");
      expect(res.displayText).toContain("摸撒拉");
    });
  });

  describe("2. 太陽 - 眼, 鼻, 口 (눈, 코, 입)", () => {
    it("line 4: 미안해 미안해 하지마", () => {
      const res = koreanToBlendedHomophone("미안해 미安해 하지마", ["chinese", "latin"]);
      expect(res.displayText).toContain("米安嘿");
      expect(res.displayText).toContain("哈");
    });

    it("line 5: 내가 초라해지잖아", () => {
      const res = koreanToBlendedHomophone("내가 초라해지잖아", ["chinese", "latin"]);
      expect(res.displayText).toContain("內嘎");
      expect(res.displayText).toContain("基炸拿");
    });

    it("line 6: 빨간 예쁜 입술로", () => {
      const res = koreanToBlendedHomophone("빨간 예쁜 입술로", ["chinese", "latin"]);
      expect(res.displayText).toContain("八甘");
      expect(res.displayText).toContain("耶奔");
      expect(res.displayText).toMatch(/依素(漏|路)/);
    });

    it("line 7: 어서 나를 죽이고 가", () => {
      const res = koreanToBlendedHomophone("어서 나를 죽이고 가", ["chinese", "latin"]);
      expect(res.displayText).toContain("偶手");
      expect(res.displayText).toMatch(/朱基勾|朱gi勾/);
      expect(res.displayText).toMatch(/卡|嘎/);
    });

    it("Issue #10 字數精簡驗證: 너의 눈, 코, 입 (5音節 -> 5純漢字)", () => {
      const res = koreanToBlendedHomophone("너의 눈, 코, 입", ["chinese", "latin"], "streamlined");
      expect(res.displayText).toBe("挪耶 潤, 摳, 依");
      // 確保完全無英文字母雜質
      expect(res.displayText).not.toMatch(/[a-zA-Z]/);
    });

    it("Issue #10 字數精簡驗證: 날 만지던 네 손길 (7音節 -> 7簡明字)", () => {
      const res = koreanToBlendedHomophone("날 만지던 네 손길", ["chinese", "latin"], "streamlined");
      expect(res.displayText).toBe("乃 滿基東 內 送ㄍㄧ");
    });

    it("Issue #10 字數精簡驗證: 작은 손톱까지 다 (7音節 -> 7純漢字)", () => {
      const res = koreanToBlendedHomophone("작은 손톱까지 다", ["chinese", "latin"], "streamlined");
      expect(res.displayText).toMatch(/加根 送透嘎基 (他|達)/);
    });
  });

  describe("3. 太妍 - 11:11", () => {
    it("line 8: 오늘이 한 칸이 채 안 남은 그런 시간", () => {
      const res = koreanToBlendedHomophone("오늘이 한 칸이 채 안 남은 그런 시간", ["chinese", "latin"]);
      expect(res.displayText).toContain("偶呢李");
      expect(res.displayText).toContain("那悶");
    });

    it("line 9: 우리 소원을 빌며 웃던 그 시간", () => {
      const res = koreanToBlendedHomophone("우리 소원을 빌며 웃던 그 시간", ["chinese", "latin"]);
      expect(res.displayText).toContain("逼ㄇㄧㄡ");
      expect(res.displayText).toContain("屋東");
    });

    it("line 10: 별 게 다 네 생각이 나", () => {
      const res = koreanToBlendedHomophone("별 게 다 네 생각이 나", ["chinese", "latin"]);
      expect(res.displayText).toContain("ㄅㄧㄡ");
      expect(res.displayText).toContain("生嘎ㄍㄧ");
    });
  });
});
