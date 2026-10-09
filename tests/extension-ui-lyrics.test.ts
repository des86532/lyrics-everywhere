import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseRecordLyrics, searchLyrics, searchLyricsForArtists, selectAutomaticLyrics } from "../extension-ui/src/lyrics.js";

const record = (syncedLyrics?: string) => ({ id: 42, trackName: "Haru Haru", artistName: "BIGBANG", syncedLyrics });

describe("browser lyrics helpers", () => {
  it("uses shared LRC parsing and the same SHA-256 content hash", async () => {
    const raw = "[offset:500]\n[00:01.00]<00:01.00>보고<00:01.50>싶다";
    const parsed = await parseRecordLyrics(record(raw), "bigbang-haru-haru");
    expect(parsed.contentHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(parsed.format).toBe("lrc");
    expect(parsed.lines[0]?.startMs).toBe(1500);
    expect(parsed.lines[0]?.tokens?.map((token) => [token.text, token.startMs, token.endMs])).toEqual([["보고", 1500, 2000], ["싶다", 2000, undefined]]);
  });

  it("keeps only synchronized results for automatic matching", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify([
      { ...record(undefined), plainLyrics: "plain only" },
      record("[00:01.00]synced"),
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
    const results = await searchLyrics("Haru Haru", "BIGBANG", fetcher);
    expect(results).toHaveLength(1);
    expect(results[0]?.syncedLyrics).toBe("[00:01.00]synced");
  });


  it("merges equivalent parsed timelines and chooses the closest-duration record, not the first result", async () => {
    const sameTimeline = "[00:01.00]사랑해\n[00:05.00]너를";
    const records = [
      { ...record("[00:02.00]사랑해\n[00:06.00]너를"), id: 1, duration: 183 },
      { ...record(sameTimeline), id: 2, duration: 182 },
      { ...record("[00:01.000] 사랑해\n[00:05.000] 너를"), id: 3, duration: 180 },
    ];
    const selected = await selectAutomaticLyrics(records, ["BIGBANG"], 180000);
    expect(selected?.record.id).toBe(3);
    expect(selected?.timelineCount).toBe(2);
    expect(selected?.recordCount).toBe(3);
    expect(selected?.lyrics.lines.map((line) => line.startMs)).toEqual([1000, 5000]);
  });

  it("prioritizes duration over artist-alias order and uses stable ties without usable duration", async () => {
    const primary = { ...record("[00:01.00]primary"), id: 20, duration: 180 };
    const alias = { ...record("[00:02.00]alias"), id: 10, artistName: "빅뱅", duration: 200 };
    expect((await selectAutomaticLyrics([primary, alias], ["BIGBANG", "빅뱅"], 200000))?.record.id).toBe(10);
    expect((await selectAutomaticLyrics([alias, primary], ["BIGBANG", "빅뱅"], 190000))?.record.id).toBe(20);
    const tied = { ...primary, id: 30, syncedLyrics: "[00:03.00]other" };
    const missingDuration = { ...primary, id: 1, duration: undefined };
    expect((await selectAutomaticLyrics([missingDuration, tied, primary], ["BIGBANG"], 180000))?.record.id).toBe(20);
    expect((await selectAutomaticLyrics([tied, primary], ["BIGBANG"], 0))?.record.id).toBe(20);
    expect((await selectAutomaticLyrics([primary, tied], ["BIGBANG"], 0))?.record.id).toBe(20);
  });

  it("keeps different word timestamps distinct and rejects untimed candidates", async () => {
    const first = { ...record("[00:01.00]<00:01.00>보고<00:01.50>싶다"), id: 1, duration: 182 };
    const second = { ...record("[00:01.00]<00:01.00>보고<00:01.80>싶다"), id: 2, duration: 180 };
    const selected = await selectAutomaticLyrics([first, second], ["BIGBANG"], 180000);
    expect(selected?.timelineCount).toBe(2);
    expect(selected?.lyrics.lines[0]?.tokens?.[1]?.startMs).toBe(1800);
    await expect(selectAutomaticLyrics([record("untimed text")], ["BIGBANG"], 180000)).resolves.toBeNull();
  });

  it("preserves usable lyrics when another artist query is unavailable", async () => {
    const available = { ...record("[00:01]사랑해"), artistName: "Heize", trackName: "And July", duration: 226 };
    const fetcher: typeof fetch = async (input) => {
      const artist = new URL(String(input)).searchParams.get("artist_name");
      return artist === "Heize" ? Response.json([available]) : new Response("unavailable", { status: 503 });
    };
    const result = await searchLyricsForArtists("And July", ["Heize", "헤이즈"], fetcher, []);
    expect((await selectAutomaticLyrics(result.recordsByArtist[0], ["Heize"], 228000))?.lyrics.lines[0]?.text).toBe("사랑해");
    expect(result.failures.map(({ artist }) => artist)).toEqual(["헤이즈"]);
  });

  it("distinguishes unavailable queries from a successful search with no matches", async () => {
    const unavailable: typeof fetch = async () => new Response("unavailable", { status: 503 });
    await expect(searchLyricsForArtists("And July", ["Heize", "헤이즈"], unavailable, [])).rejects.toBeInstanceOf(Error);
    const empty: typeof fetch = async () => Response.json([]);
    await expect(searchLyricsForArtists("Unknown Song", ["Heize"], empty)).resolves.toEqual({ recordsByArtist: [[]], failures: [] });
  });

  it("limits parallel searches and retries temporarily unavailable ones instead of reporting no lyrics", async () => {
    const available = { ...record("[00:01]사랑해"), artistName: "Jay Park", trackName: "DRIVE" };
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return calls <= 2 ? new Response("busy", { status: 503 }) : Response.json([available]);
    };
    const result = await searchLyricsForArtists("DRIVE", ["Jay Park", "박재범", "박재범 Jay Park"], fetcher, [0, 0]);
    expect(result.recordsByArtist.flat().map(({ trackName }) => trackName)).toEqual(["DRIVE", "DRIVE", "DRIVE"]);
    expect(result.failures).toEqual([]);
    expect(maxInFlight).toBe(2);
  });

  it("finds an explicitly translated song name after the original-language query has no matches", async () => {
    const available = { ...record("[00:01]거짓말"), trackName: "Lies" };
    const fetcher: typeof fetch = async (input) => Response.json(new URL(String(input)).searchParams.get("track_name") === "Lies" ? [available] : []);
    const result = await searchLyricsForArtists("거짓말 (Lies)", ["BIGBANG"], fetcher);
    expect(result.recordsByArtist[0].map(({ trackName }) => trackName)).toEqual(["Lies"]);
  });
});
