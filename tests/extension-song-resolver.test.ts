import { describe, expect, it } from "vitest";
import { resolveYouTubeSong } from "../extension-ui/src/song-resolver.js";

const KEY = "AIza-test-secret";
const song = { singleSong: true, title: "Lost Without You (feat. Bolbbalgan4)", artist: "Mad Clown", titleAliases: [], artistAliases: [] };
const appleTrack = (overrides: Record<string, unknown> = {}) => ({
  kind: "song", trackName: "Lost Without You (feat. Bolbbalgan4)", artistName: "Mad Clown", trackTimeMillis: 215_904, ...overrides,
});
function geminiResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status });
}
function appleResponse(results: unknown[] = [appleTrack()]): Response {
  return new Response(JSON.stringify({ results }), { status: 200 });
}
function provider(fetchApple: (url: URL) => Response = () => appleResponse(), extraction: unknown = song) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    return url.hostname === "generativelanguage.googleapis.com" ? geminiResponse(extraction) : fetchApple(url);
  };
}

describe("YouTube song resolver", () => {
  it("does no network work when no key is provided", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls += 1; throw new Error("unexpected"); };
    await expect(resolveYouTubeSong({ rawTitle: "Some title", durationMs: 180_000 }, "  ", { fetcher })).resolves.toBeNull();
    expect(calls).toBe(0);
  });

  it("resolves the canonical featured track when the first regional catalog has only a wrong artist", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "generativelanguage.googleapis.com") return geminiResponse(song);
      return url.searchParams.get("country") === "TW"
        ? appleResponse([appleTrack({ artistName: "Different Artist" })])
        : appleResponse();
    };
    await expect(resolveYouTubeSong({ rawTitle: "[MV] Mad Clown _ Lost Without You (Feat. Bolbbalgan4)", durationMs: 215_904 }, KEY, { fetcher }))
      .resolves.toEqual({ title: "Lost Without You (feat. Bolbbalgan4)", artists: ["Mad Clown"], durationMs: 215_904 });
  });

  it("does not match a cover to the original recording through a base-title alias", async () => {
    const cover = { ...song, title: `${song.title} (Cover)`, titleAliases: [song.title] };
    const fetcher = provider(() => appleResponse(), cover);
    await expect(resolveYouTubeSong({ rawTitle: "Mad Clown Lost Without You Cover", durationMs: 216_041 }, KEY, { fetcher })).resolves.toBeNull();
  });

  it("finds translated performer names through title fallback without trusting unrelated artists", async () => {
    const extraction = { singleSong: true, title: "사랑", artist: "비", titleAliases: ["Love"], artistAliases: ["Rain"] };
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "generativelanguage.googleapis.com") return geminiResponse(extraction);
      return appleResponse(url.searchParams.get("term") === "Love" ? [
        appleTrack({ trackName: "Love", artistName: "Different Artist", trackTimeMillis: 180_000 }),
        appleTrack({ trackName: "Love", artistName: "Rain", trackTimeMillis: 180_000 }),
      ] : []);
    };
    await expect(resolveYouTubeSong({ rawTitle: "비 사랑", durationMs: 180_000 }, KEY, { fetcher }))
      .resolves.toEqual({ title: "Love", artists: ["Rain"], durationMs: 180_000 });
  });

  it("returns null for a non-song response or invalid/unsafe structured output", async () => {
    const fetchNonSong: typeof fetch = async (input) => new URL(String(input)).hostname === "generativelanguage.googleapis.com"
      ? geminiResponse({ ...song, singleSong: false }) : appleResponse();
    await expect(resolveYouTubeSong({ rawTitle: "full album playlist", durationMs: 180_000 }, KEY, { fetcher: fetchNonSong })).resolves.toBeNull();
    for (const unsafe of [
      { ...song, title: "x".repeat(121) },
      { ...song, titleAliases: ["song"] },
      { ...song, artistAliases: ["artist", "x".repeat(121)] },
      { ...song, artist: "" },
    ]) {
      const fetcher: typeof fetch = async (input) => new URL(String(input)).hostname === "generativelanguage.googleapis.com"
        ? geminiResponse(unsafe) : appleResponse();
      await expect(resolveYouTubeSong({ rawTitle: "A title", durationMs: 180_000 }, KEY, { fetcher })).resolves.toBeNull();
    }
    const malformed: typeof fetch = async (input) => new URL(String(input)).hostname === "generativelanguage.googleapis.com"
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })) : appleResponse();
    await expect(resolveYouTubeSong({ rawTitle: "A title", durationMs: 180_000 }, KEY, { fetcher: malformed })).resolves.toBeNull();
  });

  it("rejects wrong artists, ambiguous distinct identities and incompatible versions", async () => {
    const wrongArtist = provider(() => appleResponse([appleTrack({ artistName: "Different Artist" })]));
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher: wrongArtist })).resolves.toBeNull();
    const ambiguousSong = {
      ...song,
      titleAliases: ["우리집을 못 찾겠군요"],
    };
    const ambiguous = provider((url) => appleResponse(url.searchParams.get("term")?.includes("우리집을")
      ? [appleTrack({ trackName: "우리집을 못 찾겠군요" })] : [appleTrack()]), ambiguousSong);
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher: ambiguous })).resolves.toBeNull();
    const liveSong = { ...song, title: "Lost Without You (Live)" };
    const wrongVersion = provider(() => appleResponse([appleTrack()]), liveSong);
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You (Live)", durationMs: 215_904 }, KEY, { fetcher: wrongVersion })).resolves.toBeNull();
  });

  it("accepts plausible duration deviations but rejects implausible catalog matches", async () => {
    const plausible = provider(() => appleResponse([appleTrack({ trackTimeMillis: 224_000 })]));
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher: plausible }))
      .resolves.toMatchObject({ durationMs: 224_000 });
    const implausible = provider(() => appleResponse([appleTrack({ trackTimeMillis: 245_000 })]));
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher: implausible })).resolves.toBeNull();
  });

  it("chooses the closest album duplicate instead of the last catalog row", async () => {
    const fetcher = provider(() => appleResponse([
      appleTrack(),
      appleTrack({ trackTimeMillis: 224_000 }),
    ]));
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher }))
      .resolves.toMatchObject({ durationMs: 215_904 });
  });

  it("accepts short Korean aliases corroborated by canonical catalog names", async () => {
    const extraction = { singleSong: true, title: "Love", artist: "Rain", titleAliases: ["사랑"], artistAliases: ["비"] };
    const fetcher = provider(() => appleResponse([appleTrack({ trackName: "사랑", artistName: "비", trackTimeMillis: 180_000 })]), extraction);
    await expect(resolveYouTubeSong({ rawTitle: "Rain Love (비 사랑)", durationMs: 180_000 }, KEY, { fetcher }))
      .resolves.toEqual({ title: "사랑", artists: ["비"], durationMs: 180_000 });
  });

  it("uses only bounded title alias fallback and verifies the returned alias exactly", async () => {
    const localized = { ...song, title: "Familiar Name", titleAliases: ["Lost Without You (feat. Bolbbalgan4)"] };
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "generativelanguage.googleapis.com") return geminiResponse(localized);
      return url.searchParams.get("country") === "TW" && url.searchParams.get("term")?.startsWith("Lost Without You")
        ? appleResponse() : appleResponse([]);
    };
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You by Mad Clown", durationMs: 215_904 }, KEY, { fetcher }))
      .resolves.toMatchObject({ title: "Lost Without You (feat. Bolbbalgan4)" });
  });

  it("converts Gemini auth/quota failures to safe errors without echoing key or provider text", async () => {
    for (const [status, expected] of [[401, "金鑰無效"], [429, "額度不足"]] as const) {
      const fetcher: typeof fetch = async () => new Response(`provider leaked ${KEY}`, { status });
      const error = await resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(expected);
      expect(String(error)).not.toContain(KEY);
      expect(String(error)).not.toContain("provider leaked");
    }
  });

  it("converts catalog failures to safe errors and never reveals a provider body", async () => {
    const fetcher: typeof fetch = async (input) => new URL(String(input)).hostname === "generativelanguage.googleapis.com"
      ? geminiResponse(song) : new Response(`failure ${KEY}`, { status: 500 });
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher }))
      .rejects.toThrow("Apple 音樂目錄查詢失敗");
  });

  it("rejects invalid input and exposes cancellation as a safe fixed error", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls += 1; return geminiResponse(song); };
    await expect(resolveYouTubeSong({ rawTitle: "x", durationMs: Number.NaN }, KEY, { fetcher })).rejects.toThrow("歌曲資訊無效");
    expect(calls).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher, signal: controller.signal }))
      .rejects.toThrow("歌曲辨識已取消");
    expect(calls).toBe(0);
  });

  it("cancels an active Gemini request without continuing to Apple", async () => {
    const controller = new AbortController();
    let appleCalls = 0;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).hostname !== "generativelanguage.googleapis.com") {
        appleCalls += 1;
        return appleResponse();
      }
      started();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
      });
    };
    const pending = resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher, signal: controller.signal });
    await requestStarted;
    controller.abort();
    await expect(pending).rejects.toThrow("歌曲辨識已取消");
    expect(appleCalls).toBe(0);
  });

  it("cancels while reading the Gemini response body without continuing to Apple", async () => {
    const controller = new AbortController();
    const { promise: bodyStarted, resolve: started } = Promise.withResolvers<void>();
    let appleCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).hostname !== "generativelanguage.googleapis.com") {
        appleCalls += 1;
        return appleResponse();
      }
      const body = new ReadableStream({
        start(stream) {
          init?.signal?.addEventListener("abort", () => stream.error(new DOMException("cancelled", "AbortError")), { once: true });
        },
        pull() { started(); },
      }, { highWaterMark: 0 });
      return new Response(body);
    };
    const pending = resolveYouTubeSong({ rawTitle: "Lost Without You", durationMs: 215_904 }, KEY, { fetcher, signal: controller.signal });
    await bodyStarted;
    controller.abort();
    await expect(pending).rejects.toThrow("歌曲辨識已取消");
    expect(appleCalls).toBe(0);
  });
});
