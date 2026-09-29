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

  it("preserves Japanese when it is the selected original language", () => {
    const res = registry.transcribe({
      text: "愛してる",
      targetLocale: "ja",
      allowedSystems: ["chinese"],
    });

    expect(res.displayText).toBe("愛してる");
  });

  it("supports pure Bopomofo when only Bopomofo is allowed", () => {
    const res = registry.transcribe({
      text: "오빠",
      allowedSystems: ["bopomofo"],
    });

    expect(res.displayText).toContain("ㄛ");
    expect(res.displayText).toContain("ㄅ");
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
