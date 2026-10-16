import { describe, expect, it } from "vitest";
import { parseLrcWithHash } from "../src/lyrics/lrc-core.js";

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
    expect(result.lines[0]?.startMs).toBe(1500); // 1000 + 500
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
