import { describe, expect, it } from "vitest";
import { TranscriberRegistry } from "../src/pronunciation/transcriber-registry.js";
import { KoreanTranscriber } from "../src/pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../src/pronunciation/japanese-transcriber.js";

describe("TranscriberRegistry & Multi-language Blended Homophones", () => {
  const registry = new TranscriberRegistry();
  registry.register(new KoreanTranscriber());
  registry.register(new JapaneseTranscriber());

  it("automatically routes Korean lyrics to blended homophones (中文+英文)", () => {
    const res = registry.transcribe({
      text: "사랑해 너를",
      allowedSystems: ["chinese", "latin"],
    });

    expect(res.detectedLanguage).toBe("ko");
    expect(res.displayText).toContain("撒浪嘿");
    expect(res.displayText).toContain("呢l");
  });

  it("automatically routes Japanese lyrics to Chinese homophones", () => {
    const res = registry.transcribe({
      text: "ありがとう さようなら",
      allowedSystems: ["chinese"],
    });

    expect(res.detectedLanguage).toBe("ja");
    expect(res.displayText).toContain("阿里嘎多");
    expect(res.displayText).toContain("撒優哪拉");
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
