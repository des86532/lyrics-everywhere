import { normalizeTrackName } from "./playback.js";

export type YouTubeMusicCredit = { title: string; artist: string };

const INITIAL_DATA_MARKER = "var ytInitialData = ";
const INITIAL_DATA_END = ";</script>";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const MUSIC_ICON = "MUSIC";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function get(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 120 || CONTROL_CHARACTERS.test(trimmed)) return null;
  return trimmed;
}

export function parseYouTubeMusicCredit(html: string, videoId: string): YouTubeMusicCredit | null {
  const markerStart = html.indexOf(INITIAL_DATA_MARKER);
  if (markerStart < 0) return null;
  const jsonStart = markerStart + INITIAL_DATA_MARKER.length;
  const jsonEnd = html.indexOf(INITIAL_DATA_END, jsonStart);
  if (jsonEnd < 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(html.slice(jsonStart, jsonEnd));
  } catch {
    return null;
  }
  if (get(data, "currentVideoEndpoint", "watchEndpoint", "videoId") !== videoId) return null;

  const panels = get(data, "engagementPanels");
  if (!Array.isArray(panels)) return null;

  const credits = new Map<string, YouTubeMusicCredit>();
  for (const panel of panels) {
    const items = get(panel, "engagementPanelSectionListRenderer", "content", "structuredDescriptionContentRenderer", "items");
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const list = get(item, "horizontalCardListRenderer");
      if (get(list, "footerButton", "buttonViewModel", "iconName") !== MUSIC_ICON) continue;
      const cards = get(list, "cards");
      if (!Array.isArray(cards)) continue;
      for (const card of cards) {
        const attribute = get(card, "videoAttributeViewModel");
        const title = cleanText(get(attribute, "title"));
        const artist = cleanText(get(attribute, "subtitle"));
        if (!title || !artist) continue;
        const normalizedTitle = normalizeTrackName(title);
        const normalizedArtist = normalizeTrackName(artist);
        // Symbol-only names normalize to "", which would collide with unrelated credits.
        if (!normalizedTitle || !normalizedArtist) continue;
        const key = `${normalizedTitle}\u0000${normalizedArtist}`;
        if (!credits.has(key)) credits.set(key, { title, artist });
      }
    }
  }

  // Zero credits means no music section; several distinct credits usually mean a compilation or medley.
  if (credits.size !== 1) return null;
  return credits.values().next().value ?? null;
}

export async function fetchYouTubeMusicCredit(videoId: string, fetcher: typeof fetch = fetch): Promise<YouTubeMusicCredit | null> {
  if (!VIDEO_ID_PATTERN.test(videoId)) return null;
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error(`YouTube 頁面讀取失敗（HTTP ${response.status}）。`);
  return parseYouTubeMusicCredit(await response.text(), videoId);
}
