import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_KEY,
  readDisplayPreferences,
  saveDisplayPreferences,
  type DisplayPreferencesStorage,
} from "../extension-ui/src/preferences.js";

function storageWith(value?: unknown): DisplayPreferencesStorage {
  const values: Record<string, unknown> = value === undefined ? {} : { [DISPLAY_PREFERENCES_KEY]: value };
  return {
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
  };
}

describe("display preferences", () => {
  it("uses independent defaults and accepts an empty preserved-language selection", async () => {
    const storage = storageWith({ phoneticSystem: "invalid", preservedLanguages: [] });
    await expect(readDisplayPreferences(storage)).resolves.toEqual({ phoneticSystem: "chinese", preservedLanguages: [] });
    await expect(readDisplayPreferences(storageWith())).resolves.toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it("filters, de-duplicates and orders supported languages while validating the system", async () => {
    const storage = storageWith({ phoneticSystem: "latin", preservedLanguages: ["ko", "xx", "zh", "ko", "ja"] });
    await expect(readDisplayPreferences(storage)).resolves.toEqual({ phoneticSystem: "latin", preservedLanguages: ["zh", "ja", "ko"] });
    await expect(readDisplayPreferences(storageWith({ phoneticSystem: "bopomofo", preservedLanguages: "ko" })))
      .resolves.toEqual({ phoneticSystem: "bopomofo", preservedLanguages: ["zh", "en"] });
  });

  it.each(["chinese", "bopomofo", "latin"] as const)("persists and reloads the single %s display system", async (phoneticSystem) => {
    const storage = storageWith();
    const preferences = { phoneticSystem, preservedLanguages: ["ja", "ko"] as const };
    await saveDisplayPreferences(storage, preferences);
    await expect(readDisplayPreferences(storage)).resolves.toEqual(preferences);
  });

  it("propagates storage read and write failures", async () => {
    const failed: DisplayPreferencesStorage = {
      get: async () => { throw new Error("read denied"); },
      set: async () => { throw new Error("write denied"); },
    };
    await expect(readDisplayPreferences(failed)).rejects.toThrow("read denied");
    await expect(saveDisplayPreferences(failed, DEFAULT_DISPLAY_PREFERENCES)).rejects.toThrow("write denied");
  });
});
