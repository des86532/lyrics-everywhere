import { describe, expect, it } from "vitest";
import { identifySong } from "../extension-ui/src/song-resolver.js";

const KEY = "AIza-test-secret";

function geminiResponse(parts: Array<{ text: string }> | unknown, status = 200, finishReason: string | null = "STOP"): Response {
  const partsPayload = Array.isArray(parts) ? parts : [{ text: JSON.stringify(parts) }];
  const candidate: Record<string, unknown> = {
    content: { parts: partsPayload },
  };
  if (finishReason !== null) {
    candidate.finishReason = finishReason;
  }
  return new Response(
    JSON.stringify({
      candidates: [candidate],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("YouTube song identifier", () => {
  it("does no network work and returns null when no key is provided", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return geminiResponse({});
    };
    const result = await identifySong(
      { rawTitle: "Lost Without You", channel: "StarshipTV", durationMs: 215_904 },
      "",
      { fetcher },
    );
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("returns null without fetching when signal is already aborted", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return geminiResponse({});
    };
    const controller = new AbortController();
    controller.abort();
    const result = await identifySong(
      { rawTitle: "Lost Without You", channel: "StarshipTV", durationMs: 215_904 },
      KEY,
      { fetcher, signal: controller.signal },
    );
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("sends tools with google_search, passes key in header, and omits responseSchema from generationConfig", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody: { tools?: unknown; generationConfig?: { temperature?: number; maxOutputTokens?: number; thinkingConfig?: unknown; responseSchema?: unknown; responseMimeType?: unknown } } | undefined;

    const fetcher: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body));
      return geminiResponse({
        singleSong: true,
        titles: ["Lost Without You"],
        artists: ["Mad Clown"],
      });
    };

    const result = await identifySong(
      { rawTitle: `Lost Without You ${KEY}`, channel: `Channel ${KEY}`, durationMs: 215_904 },
      KEY,
      { fetcher },
    );

    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
    expect((capturedHeaders as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(capturedBody.tools).toEqual([{ google_search: {} }]);
    expect(capturedBody.generationConfig.temperature).toBe(0);
    expect(capturedBody.generationConfig.maxOutputTokens).toBe(1024);
    expect(capturedBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(capturedBody.generationConfig.responseSchema).toBeUndefined();
    expect(capturedBody.generationConfig.responseMimeType).toBeUndefined();

    // Key must not appear in user prompt or anywhere in body
    const bodyStr = JSON.stringify(capturedBody);
    expect(bodyStr.includes(KEY)).toBe(false);
    expect(bodyStr.includes("[redacted]")).toBe(true);

    expect(result).toEqual({
      titles: ["Lost Without You"],
      artists: ["Mad Clown"],
    });
  });

  it("parses titles and artists when first part is explanation and second part is fenced JSON", async () => {
    const fetcher: typeof fetch = async () => {
      return geminiResponse([
        { text: "Here is the official song information found via search:\n" },
        {
          text:
            "```json\n" +
            JSON.stringify({
              singleSong: true,
              titles: ["Lost Without You (feat. Bolbbalgan4)", "Lost Without You"],
              artists: ["Mad Clown", "매드클라운"],
            }) +
            "\n```",
        },
      ]);
    };

    const result = await identifySong(
      { rawTitle: "Lost Without You", channel: "StarshipTV", durationMs: 215_904 },
      KEY,
      { fetcher },
    );

    expect(result).toEqual({
      titles: ["Lost Without You (feat. Bolbbalgan4)", "Lost Without You"],
      artists: ["Mad Clown", "매드클라운"],
    });
  });

  it("returns null for non-song, excessive aliases, reserved words, non-JSON, or non-STOP finishReason", async () => {
    const testCases: Array<{ parts: unknown; finishReason?: string | null }> = [
      // singleSong: false
      { parts: { singleSong: false, titles: ["Title"], artists: ["Artist"] } },
      // titles count > 6
      { parts: { singleSong: true, titles: ["T1", "T2", "T3", "T4", "T5", "T6", "T7"], artists: ["Artist"] } },
      // artists count > 4
      { parts: { singleSong: true, titles: ["Title"], artists: ["A1", "A2", "A3", "A4", "A5"] } },
      // titles empty
      { parts: { singleSong: true, titles: [], artists: ["Artist"] } },
      // artists empty
      { parts: { singleSong: true, titles: ["Title"], artists: [] } },
      // reserved word in titles
      { parts: { singleSong: true, titles: ["live"], artists: ["Artist"] } },
      // reserved word in artists
      { parts: { singleSong: true, titles: ["Title"], artists: ["remix"] } },
      // invalid non-JSON text
      { parts: [{ text: "Sorry, I could not find this song." }] },
      // finishReason != STOP
      {
        parts: { singleSong: true, titles: ["Title"], artists: ["Artist"] },
        finishReason: "SAFETY",
      },
    ];

    for (const tc of testCases) {
      const fetcher: typeof fetch = async () => geminiResponse(tc.parts, 200, tc.finishReason ?? "STOP");
      const result = await identifySong(
        { rawTitle: "Some Video", channel: "Channel", durationMs: 200_000 },
        KEY,
        { fetcher },
      );
      expect(result).toBeNull();
    }
  });

  it("converts Gemini auth/quota failures to safe errors without echoing key or provider text", async () => {
    const fetchQuota: typeof fetch = async () => new Response("quota exceeded", { status: 429 });
    await expect(
      identifySong({ rawTitle: "Lost Without You", channel: "", durationMs: 215_904 }, KEY, { fetcher: fetchQuota }),
    ).rejects.toThrow("Gemini 查詢額度不足或過於頻繁，請稍後再試。");

    const fetchAuth: typeof fetch = async () => new Response("forbidden", { status: 403 });
    await expect(
      identifySong({ rawTitle: "Lost Without You", channel: "", durationMs: 215_904 }, KEY, { fetcher: fetchAuth }),
    ).rejects.toThrow("Gemini API 金鑰無效或未獲授權，請檢查金鑰與模型權限。");

    const fetchErr: typeof fetch = async () => new Response("server error", { status: 500 });
    await expect(
      identifySong({ rawTitle: "Lost Without You", channel: "", durationMs: 215_904 }, KEY, { fetcher: fetchErr }),
    ).rejects.toThrow("Gemini 歌曲辨識失敗，請檢查 API 金鑰或稍後再試。");
  });

  it("rejects invalid input", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return geminiResponse({});
    };

    await expect(
      identifySong({ rawTitle: "x", channel: "", durationMs: Number.NaN }, KEY, { fetcher }),
    ).rejects.toThrow("歌曲資訊無效，無法進行辨識。");

    await expect(
      identifySong({ rawTitle: "", channel: "", durationMs: 200_000 }, KEY, { fetcher }),
    ).rejects.toThrow("歌曲資訊無效，無法進行辨識。");

    await expect(
      identifySong({ rawTitle: "x", channel: "a".repeat(201), durationMs: 200_000 }, KEY, { fetcher }),
    ).rejects.toThrow("歌曲資訊無效，無法進行辨識。");

    await expect(
      identifySong({ rawTitle: "x", channel: "", durationMs: 200_000 }, "bad key with spaces", { fetcher }),
    ).rejects.toThrow("Gemini API 金鑰格式無效。");

    expect(calls).toBe(0);
  });

  it("cancels an active Gemini request with fixed cancellation error", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher: typeof fetch = async (_input, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
      });
    };
    const pending = identifySong(
      { rawTitle: "Lost Without You", channel: "", durationMs: 215_904 },
      KEY,
      { fetcher, signal: controller.signal },
    );
    await requestStarted;
    controller.abort();
    await expect(pending).rejects.toThrow("歌曲辨識已取消。");
  });

  it("cancels while reading the Gemini response body with fixed cancellation error", async () => {
    const controller = new AbortController();
    const { promise: bodyStarted, resolve: started } = Promise.withResolvers<void>();
    const fetcher: typeof fetch = async (_input, init) => {
      const body = new ReadableStream(
        {
          start(stream) {
            init?.signal?.addEventListener("abort", () => stream.error(new DOMException("cancelled", "AbortError")), { once: true });
          },
          pull() {
            started();
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body);
    };
    const pending = identifySong(
      { rawTitle: "Lost Without You", channel: "", durationMs: 215_904 },
      KEY,
      { fetcher, signal: controller.signal },
    );
    await bodyStarted;
    controller.abort();
    await expect(pending).rejects.toThrow("歌曲辨識已取消。");
  });
});
