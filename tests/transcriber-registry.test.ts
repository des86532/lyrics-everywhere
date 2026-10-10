import { describe, expect, it } from "vitest";
import { TranscriberRegistry } from "../src/pronunciation/transcriber-registry.js";
import { KoreanTranscriber } from "../src/pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../src/pronunciation/japanese-transcriber.js";

describe("TranscriberRegistry & Multi-language Blended Homophones", () => {
  const registry = new TranscriberRegistry();
  registry.register(new KoreanTranscriber());
  registry.register(new JapaneseTranscriber());

  it("routes Korean lyrics to concise homophones by default", () => {
    const res = registry.transcribe({
      text: "사랑해 너를",
      allowedSystems: ["chinese", "latin"],
    });

    expect(res.detectedLanguage).toBe("ko");
    expect(res.displayText).toContain("撒浪嘿");
    expect(res.displayText).toContain("呢樂");
    expect(res.displayText).not.toContain("呢l");
  });

  it("preserves Korean when it is the selected original language", () => {
    const res = registry.transcribe({
      text: "사랑해 너를",
      targetLocale: "ko",
      allowedSystems: ["chinese"],
    });

    expect(res.displayText).toBe("사랑해 너를");
  });

  it("transcribes Korean while preserving embedded English text", () => {
    const res = registry.transcribe({
      text: "밥 ABC",
      targetLocale: "zh-TW",
      allowedSystems: ["chinese"],
    });

    expect(res.displayText).toBe("巴 ABC");
  });

  it("preserves Han characters inside Japanese phrases while transcribing kana", () => {
    const res = registry.transcribe({
      text: "愛してる",
      targetLocale: "zh-TW",
      allowedSystems: ["chinese"],
    });

    expect(res.displayText).toBe("愛西貼路");
  });

  it("transcribes voiced, compound, small-tsu, and katakana readings", () => {
    const chinese = registry.transcribe({
      text: "オレがずっと きゃ ヴぱ",
      targetLocale: "",
      allowedSystems: ["chinese"],
    });
    expect(chinese.displayText).toBe("歐雷嘎滋・透 奇亞 夫趴");
    expect(chinese.displayText).not.toMatch(/[ぁ-ゖァ-ヺ]/u);

    const latin = registry.transcribe({
      text: "がっこう コーヒー",
      targetLocale: "",
      allowedSystems: ["latin"],
    });
    expect(latin.displayText).toBe("gakkou koohii");
  });

  it("uses the final mora vowel for long marks and preserves unsupported kana", () => {
    const result = registry.transcribe({
      text: "コー ヵ",
      targetLocale: "",
      allowedSystems: ["chinese"],
    });
    expect(result.displayText).toBe("口歐 ヵ");
    expect(result.syllables.at(-1)?.tier).toBe("fallback");
  });

  it("preserves Japanese when it is the selected original language", () => {
    const res = registry.transcribe({
      text: "愛してる",
      targetLocale: "ja",
      allowedSystems: ["chinese"],
    });

    expect(res.displayText).toBe("愛してる");
  });
  it("preserves only the selected script in mixed Korean and Japanese lyrics", () => {
    const text = "사랑해 愛してる";
    const keepKorean = registry.transcribe({ text, targetLocale: "", passthroughLanguages: ["ko"], allowedSystems: ["chinese"] });
    const keepJapanese = registry.transcribe({ text, targetLocale: "", passthroughLanguages: ["ja"], allowedSystems: ["chinese"] });
    expect(keepKorean.detectedLanguage).toBe("mixed");
    expect(keepKorean.displayText).toBe("사랑해 愛西貼路");
    expect(keepJapanese.displayText).toBe("撒浪嘿 愛してる");
  });

  it("transcribes both language segments when no source language is preserved", () => {
    const result = registry.transcribe({
      text: "사랑해 愛してる",
      targetLocale: "",
      passthroughLanguages: [],
      allowedSystems: ["chinese"],
    });
    expect(result.detectedLanguage).toBe("mixed");
    expect(result.displayText).toBe("撒浪嘿 愛西貼路");
  });

  it("passes through unknown text and punctuation safely", () => {
    const res = registry.transcribe({
      text: "Hello World 123!",
      allowedSystems: ["chinese", "latin"],
    });

    expect(res.detectedLanguage).toBe("unknown");
    expect(res.displayText).toBe("Hello World 123!");
  });
});
