import { describe, expect, it } from "vitest";
import { parseLrcWithHash } from "../src/lyrics/lrc-core.js";

const NL = String.fromCharCode(10);

describe("LRC Parser", () => {

  it("parses standard LRC format and derives line start/end timings", () => {
    const raw = `
[ti:Spring Day]
[ar:BTS]
[00:10.50]보고 싶다
[00:15.20]이렇게 말하니까 더 보고 싶다
[00:22.00]너희 사진을 보고 있어도
    `;
    const result = parseLrcWithHash(raw, "bts-spring-day", "lrclib", "b".repeat(64));

    expect(result.format).toBe("lrc");
    expect(result.granularity).toBe("line");
    expect(result.lines.length).toBe(3);

    expect(result.lines[0]?.startMs).toBe(10500);
    expect(result.lines[0]?.endMs).toBe(15200);
    expect(result.lines[0]?.text).toBe("보고 싶다");

    expect(result.lines[1]?.startMs).toBe(15200);
    expect(result.lines[1]?.endMs).toBe(22000);
    expect(result.lines[1]?.text).toBe("이렇게 말하니까 더 보고 싶다");

    expect(result.lines[2]?.startMs).toBe(22000);
    expect(result.lines[2]?.endMs).toBe(26000); // 4000ms default tail
  });

  it("ends lines sharing a timestamp at the next strictly later line", () => {
    const raw = ["[00:10.00]안녕", "[00:10.00]Hello", "[00:14.00]다음"].join(String.fromCharCode(10));
    const result = parseLrcWithHash(raw, "test-same-ts", "lrclib", "e".repeat(64));
    expect(result.lines.map((line) => line.endMs)).toEqual([14000, 14000, 18000]);
  });

  it("handles offset tags correctly", () => {
    const raw = `
[offset:500]
[00:01.00]Hello World
    `;
    const result = parseLrcWithHash(raw, "test-offset", "lrclib", "c".repeat(64));
    expect(result.lines[0]?.startMs).toBe(500); // positive offset shows lyrics earlier: 1000 - 500
  });

  it("clamps a negative result of a positive offset to zero and delays on negative offsets", () => {
    const early = parseLrcWithHash(["[offset:2000]", "[00:01.00]A"].join(NL), "o1", "lrclib", "c".repeat(64));
    expect(early.lines[0]?.startMs).toBe(0);
    const late = parseLrcWithHash(["[offset:-500]", "[00:01.00]A"].join(NL), "o2", "lrclib", "c".repeat(64));
    expect(late.lines[0]?.startMs).toBe(1500);
  });

  it("accepts tenths, colon-separated hundredths and three-digit minutes", () => {
    const raw = ["[00:01.5]a", "[00:02:25]b", "[100:03.04]c", "[01:02.03]d"].join(NL);
    const result = parseLrcWithHash(raw, "t", "lrclib", "f".repeat(64));
    expect(result.lines.map((line) => [line.text, line.startMs])).toEqual([["a", 1500], ["d", 62030], ["b", 2250], ["c", 6003040]].sort((x, y) => (x[1] as number) - (y[1] as number)));
  });

  it("skips any untimed metadata tag but never a timestamp line", () => {
    const raw = ["[au:Someone]", "[id:abc]", "[la:ko]", "[tool:x]", "[#:1]", "[01:02.03]real"].join(NL);
    const result = parseLrcWithHash(raw, "t", "lrclib", "f".repeat(64));
    expect(result.lines.map((line) => line.text)).toEqual(["real"]);
    expect(result.lines[0]?.startMs).toBe(62030);
  });

  it("drops untimed lines when the file has timestamps", () => {
    const raw = ["[Chorus]", "stray text", "[00:05.00]first", "[00:09.00]second"].join(NL);
    const result = parseLrcWithHash(raw, "t", "lrclib", "f".repeat(64));
    expect(result.lines.map((line) => line.text)).toEqual(["first", "second"]);
    expect(result.lines.map((line) => line.lineId)).toEqual(["line-1", "line-2"]);
  });

  it("keeps text before the first word tag and ends the last word at the line end", () => {
    const raw = ["[00:01.00]Oh <00:01.50>hello <00:02.00>world", "[00:04.00]next"].join(NL);
    const first = parseLrcWithHash(raw, "t", "lrclib", "f".repeat(64)).lines[0];
    expect(first?.text).toBe("Oh hello world");
    expect(first?.tokens?.map((token) => [token.text, token.startMs, token.endMs])).toEqual([["Oh ", 1000, 1500], ["hello ", 1500, 2000], ["world", 2000, 4000]]);
  });

  it("subtracts the offset from word tokens too", () => {
    const first = parseLrcWithHash(["[offset:200]", "[00:01.00]<00:01.00>a <00:02.00>b"].join(NL), "t", "lrclib", "f".repeat(64)).lines[0];
    expect(first?.startMs).toBe(800);
    expect(first?.tokens?.map((token) => token.startMs)).toEqual([800, 1800]);
  });

  it("gracefully degrades when no timestamps exist", () => {
    const raw = `
Line 1 without timestamps
Line 2 without timestamps
    `;
    const result = parseLrcWithHash(raw, "test-plain", "lrclib", "d".repeat(64));
    expect(result.format).toBe("plain");
    expect(result.granularity).toBe("none");
    expect(result.lines.length).toBe(2);
    expect(result.lines[0]?.startMs).toBeUndefined();
  });
});
