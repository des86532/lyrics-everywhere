import { describe, expect, it } from "vitest";
import {
  GEMINI_API_KEY_STORAGE_KEY,
  readGeminiApiKey,
  saveGeminiApiKey,
} from "../extension-ui/src/gemini-settings.js";
import {
  DISPLAY_PREFERENCES_KEY,
  readDisplayPreferences,
  saveDisplayPreferences,
  type DisplayPreferencesStorage,
} from "../extension-ui/src/preferences.js";

function createStorage(initial: Record<string, unknown> = {}): DisplayPreferencesStorage {
  const values = { ...initial };
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
  };
}

describe("Gemini API key storage", () => {
  it("saves, reloads and clears a key without changing display preferences", async () => {
    const storage = createStorage();
    const preferences = { phoneticSystem: "latin" as const, preservedLanguages: ["ja"] as const };
    await saveDisplayPreferences(storage, preferences);
    await saveGeminiApiKey(storage, "  user-key-value  ");

    await expect(readGeminiApiKey(storage)).resolves.toBe("user-key-value");
    await expect(readDisplayPreferences(storage)).resolves.toEqual(preferences);

    await saveGeminiApiKey(storage, "  ");
    await expect(readGeminiApiKey(storage)).resolves.toBe("");
    await expect(readDisplayPreferences(storage)).resolves.toEqual(preferences);
  });

  it.each([undefined, null, 42, {}, [], "  \t ", "bad\nkey", "bad\u0000key"])(
    "treats corrupt stored values safely as disabled (%s)", async (value) => {
      const initial = value === undefined ? {} : { [GEMINI_API_KEY_STORAGE_KEY]: value };
      await expect(readGeminiApiKey(createStorage(initial))).resolves.toBe("");
    },
  );

  it("accepts the maximum supported key length and rejects longer or invalid input", async () => {
    const storage = createStorage();
    const maxLengthKey = "k".repeat(512);
    await saveGeminiApiKey(storage, maxLengthKey);
    await expect(readGeminiApiKey(storage)).resolves.toBe(maxLengthKey);

    for (const invalidKey of ["k".repeat(513), "bad key", "bad\tkey", "bad\u007fkey"]) {
      await expect(saveGeminiApiKey(storage, invalidKey)).rejects.toThrow("API 金鑰格式不正確。");
    }
    await expect(readGeminiApiKey(storage)).resolves.toBe(maxLengthKey);
  });

  it("propagates storage read and write failures without exposing key contents", async () => {
    const secret = "private-key-value";
    const failed: DisplayPreferencesStorage = {
      get: async () => { throw new Error("read denied"); },
      set: async () => { throw new Error("write denied"); },
    };
    await expect(readGeminiApiKey(failed)).rejects.toThrow("read denied");
    await expect(saveGeminiApiKey(failed, secret)).rejects.toThrow("write denied");
    await expect(saveGeminiApiKey(failed, secret)).rejects.not.toThrow(secret);
  });
});
