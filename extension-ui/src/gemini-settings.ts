import type { DisplayPreferencesStorage } from "./preferences.js";

export const GEMINI_API_KEY_STORAGE_KEY = "geminiApiKey";
const MAX_GEMINI_API_KEY_LENGTH = 512;

export async function readGeminiApiKey(storage: DisplayPreferencesStorage): Promise<string> {
  const stored = await storage.get(GEMINI_API_KEY_STORAGE_KEY);
  const value = stored[GEMINI_API_KEY_STORAGE_KEY];
  if (typeof value !== "string") return "";
  const key = value.trim();
  return isValidGeminiApiKey(key) ? key : "";
}

export async function saveGeminiApiKey(storage: DisplayPreferencesStorage, key: string): Promise<void> {
  const normalizedKey = key.trim();
  if (!isValidGeminiApiKey(normalizedKey)) {
    throw new Error("API 金鑰格式不正確。");
  }
  await storage.set({ [GEMINI_API_KEY_STORAGE_KEY]: normalizedKey });
}

function isValidGeminiApiKey(key: string): boolean {
  return key.length <= MAX_GEMINI_API_KEY_LENGTH && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(key);
}
