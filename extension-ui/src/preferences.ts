import type { PhoneticSystem } from "../../src/domain/types.js";

export type PreservedLanguage = "zh" | "en" | "ja" | "ko";
export interface DisplayPreferences {
  phoneticSystem: PhoneticSystem;
  preservedLanguages: PreservedLanguage[];
}

export interface DisplayPreferencesStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const DISPLAY_PREFERENCES_KEY = "displayPreferences";
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  phoneticSystem: "chinese",
  preservedLanguages: ["zh", "en"],
};

const phoneticSystems: readonly PhoneticSystem[] = ["chinese", "bopomofo", "latin"];
const languages: readonly PreservedLanguage[] = ["zh", "en", "ja", "ko"];

export async function readDisplayPreferences(storage: DisplayPreferencesStorage): Promise<DisplayPreferences> {
  const stored = await storage.get(DISPLAY_PREFERENCES_KEY);
  const value = stored[DISPLAY_PREFERENCES_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return copyDefaults();

  const candidate = value as Record<string, unknown>;
  const phoneticSystem = phoneticSystems.includes(candidate.phoneticSystem as PhoneticSystem)
    ? candidate.phoneticSystem as PhoneticSystem
    : DEFAULT_DISPLAY_PREFERENCES.phoneticSystem;
  const requestedLanguages = candidate.preservedLanguages;
  const preservedLanguages = Array.isArray(requestedLanguages)
    ? languages.filter((language) => requestedLanguages.includes(language))
    : [...DEFAULT_DISPLAY_PREFERENCES.preservedLanguages];
  return { phoneticSystem, preservedLanguages };
}

export async function saveDisplayPreferences(
  storage: DisplayPreferencesStorage,
  preferences: DisplayPreferences,
): Promise<void> {
  await storage.set({
    [DISPLAY_PREFERENCES_KEY]: {
      phoneticSystem: preferences.phoneticSystem,
      preservedLanguages: languages.filter((language) => preferences.preservedLanguages.includes(language)),
    } satisfies DisplayPreferences,
  });
}

function copyDefaults(): DisplayPreferences {
  return { phoneticSystem: DEFAULT_DISPLAY_PREFERENCES.phoneticSystem, preservedLanguages: [...DEFAULT_DISPLAY_PREFERENCES.preservedLanguages] };
}
