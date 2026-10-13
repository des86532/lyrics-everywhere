import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fetchLrclibRecord, LyricsHttpError, lrclibFetcher, parseRecordLyrics, searchLyrics, searchLyricsByVideoTitle, searchLyricsForArtists, searchLyricsForIdentity, selectAutomaticLyrics } from "../extension-ui/src/lyrics.js";

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

  it("searches lyrics for identity, filters out mismatched artists, and enforces duration gate", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const trackName = url.searchParams.get("track_name");
      if (trackName?.includes("TOESA")) {
        return Response.json([
          { id: 38491641, trackName: "I’m gonna TOESA", artistName: "JEON SOYEON", duration: 212, syncedLyrics: "[00:07.02]퇴사할게요" },
          { id: 38526054, trackName: "I’m gonna TOESA (Narr. KIAN84)", artistName: "SOYEON", duration: 211, syncedLyrics: "[00:07.02]퇴사할게요" },
          { id: 99999999, trackName: "I’m gonna TOESA", artistName: "Shin Giwon", duration: 212, syncedLyrics: "[00:07.02]퇴사할게요" },
        ]);
      }
      if (trackName === "Quit") {
        return Response.json([
          { id: 2270441, trackName: "Quit", artistName: "SOYEON", duration: 190, syncedLyrics: "[00:12.78]이제 끌지 말고" },
        ]);
      }
      return Response.json([]);
    };

    const identity = {
      titles: ["퇴사할게여 (Narr. 기안84)", "I'm gonna TOESA (Narr. KIAN84)", "I'm gonna TOESA", "Quit"],
      artists: ["SOYEON", "JEON SOYEON", "소연"],
    };

    const { candidates, failures } = await searchLyricsForIdentity(identity, 212_000, fetcher);
    const ids = new Set(candidates.map((c) => c.id));
    expect(ids).toEqual(new Set([38491641, 38526054]));
    expect(ids.has(2270441)).toBe(false);
    expect(ids.has(99999999)).toBe(false);
    expect(failures).toEqual([]);
  });

  it("rejects when all lyrics searches fail with HTTP 503 and no retries", async () => {
    const fetcher: typeof fetch = async () => new Response("service unavailable", { status: 503 });
    const identity = {
      titles: ["Song A", "Song B"],
      artists: ["Artist A"],
    };
    await expect(searchLyricsForIdentity(identity, 200_000, fetcher, [])).rejects.toThrow("所有歌詞查詢均失敗");
  });

  it("finds a song from video title keywords without AI, retrying transient errors and surviving total failure", async () => {
    const CAPPER = "純享：Capper《無人區玫瑰》粉色系rapper帶來浪漫可愛心動 | 少年說唱企劃 EP12 | iQiyi精选";
    const records = [
      { id: 38664232, trackName: "无人区玫瑰", artistName: "Capper, Apex, LEGGO", duration: 216, syncedLyrics: "[00:01.00]x" },
      { id: 2, trackName: "无人区玫瑰", artistName: "一颗狼星", duration: 222, syncedLyrics: "[00:01.00]x" },
      { id: 3, trackName: "无人区玫瑰 No man's land of Rose", artistName: "capper", syncedLyrics: "[00:01.00]x" },
    ];
    let transientSent = false;
    const fetcher: typeof fetch = async (input) => {
      const q = new URL(String(input)).searchParams.get("q");
      if (q === "無人區玫瑰" && !transientSent) {
        transientSent = true;
        return new Response("overloaded", { status: 503 });
      }
      return new Response(JSON.stringify(q === "无人区玫瑰" ? records : []), { status: 200 });
    };
    const { candidates, failures } = await searchLyricsByVideoTitle(CAPPER, 226_000, fetcher, [0]);
    expect(candidates.map((candidate) => candidate.id)).toEqual([38664232]);
    expect(failures).toEqual([]);
    expect((await selectAutomaticLyrics(candidates, [], 226_000))?.record.id).toBe(38664232);

    const broken: typeof fetch = async () => new Response("boom", { status: 500 });
    const failed = await searchLyricsByVideoTitle(CAPPER, 226_000, broken, [0]);
    expect(failed.candidates).toEqual([]);
    expect(failed.failures.length).toBeGreaterThan(0);
  });

  it("fetches one LRCLIB record by id, mapping 404 to null and other failures to errors", async () => {
    const record = { id: 38664232, trackName: "无人区玫瑰", artistName: "Capper, Apex, LEGGO", duration: 216, syncedLyrics: "[00:01.00]x" };
    const urls: string[] = [];
    const ok: typeof fetch = async (input) => { urls.push(String(input)); return new Response(JSON.stringify(record), { status: 200 }); };
    expect(await fetchLrclibRecord(38664232, ok)).toEqual(record);
    expect(urls).toEqual(["https://lrclib.net/api/get/38664232"]);
    expect(await fetchLrclibRecord(1, async () => new Response("{}", { status: 404 }))).toBeNull();
    await expect(fetchLrclibRecord(1, async () => new Response("down", { status: 503 }))).rejects.toBeInstanceOf(LyricsHttpError);
    await expect(fetchLrclibRecord(1, async () => new Response("{\"x\":1}", { status: 200 }))).rejects.toThrow("無法辨識");
  });

  it("finds a song named by an AI-style 'artist - title' identity with collaboration credits", async () => {
    const records = [
      { id: 38664232, trackName: "无人区玫瑰", artistName: "Capper, Apex, LEGGO", duration: 216, syncedLyrics: "[00:01.00]x" },
      { id: 2, trackName: "无人区玫瑰", artistName: "一颗狼星", duration: 222, syncedLyrics: "[00:01.00]x" },
    ];
    const fetcher: typeof fetch = async (input) => {
      const q = new URL(String(input)).searchParams.get("q");
      return new Response(JSON.stringify(q === "无人区玫瑰" ? records : []), { status: 200 });
    };
    const { candidates } = await searchLyricsByVideoTitle("Capper, Apex, LEGGO - 无人区玫瑰", 226_000, fetcher, [0]);
    expect(candidates.map((candidate) => candidate.id)).toEqual([38664232]);
  });

  it("times out LRCLIB requests with custom error and preserves AbortError for external cancellation", async () => {
    vi.stubGlobal("fetch", (_i: unknown, init: { signal: AbortSignal }) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      if (init.signal.aborted) {
        reject(init.signal.reason);
      } else {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }
      return promise;
    });

    try {
      await expect(lrclibFetcher(undefined, 20)("https://lrclib.net/api/get/1"))
        .rejects.toThrow("LRCLIB 回應逾時（0.02 秒）。");

      const controller = new AbortController();
      controller.abort();
      await expect(lrclibFetcher(controller.signal, 20)("https://lrclib.net/api/get/1"))
        .rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
