import { describe, expect, it } from "vitest";
import { TranscriberRegistry } from "../src/pronunciation/transcriber-registry.js";
import { KoreanTranscriber } from "../src/pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../src/pronunciation/japanese-transcriber.js";

describe("TranscriberRegistry & Multi-language Homophones", () => {
  const registry = new TranscriberRegistry();
  registry.register(new KoreanTranscriber());
  registry.register(new JapaneseTranscriber());

  it("automatically routes Korean lyrics to Chinese homophones (空耳)", () => {
    const res = registry.transcribe({
      text: "사랑해 너를",
      notation: "chinese_homophone",
    });

    expect(res.detectedLanguage).toBe("ko");
    expect(res.displayText).toContain("撒浪嘿");
    expect(res.layers.length).toBe(1);
    expect(res.layers[0]?.notation).toBe("chinese_homophone");
  });

  it("automatically routes Japanese lyrics to Chinese homophones", () => {
    const res = registry.transcribe({
      text: "ありがとう さようなら",
      notation: "chinese_homophone",
    });

    expect(res.detectedLanguage).toBe("ja");
    expect(res.displayText).toContain("阿里嘎多");
    expect(res.displayText).toContain("撒優哪拉");
  });

  it("supports hybrid mode with both Chinese homophone and Bopomofo layers", () => {
    const res = registry.transcribe({
      text: "오빠",
      notation: "hybrid",
    });

    expect(res.requestedNotation).toBe("hybrid");
    expect(res.displayText).toBe("歐巴");
    expect(res.secondaryDisplayText).toContain("ㄛ");
    expect(res.layers.length).toBe(2);
    expect(res.layers[0]?.notation).toBe("chinese_homophone");
    expect(res.layers[1]?.notation).toBe("bopomofo");
  });

  it("passes through unknown text and punctuation safely", () => {
    const res = registry.transcribe({
      text: "Hello World 123!",
      notation: "chinese_homophone",
    });

    expect(res.detectedLanguage).toBe("unknown");
    expect(res.displayText).toBe("Hello World 123!");
    expect(res.layers[0]?.segments[0]?.tier).toBe("passthrough");
  });
});
