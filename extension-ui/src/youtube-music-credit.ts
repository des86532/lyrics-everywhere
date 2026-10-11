import { normalizeTrackName } from "./playback.js";

export type YouTubeMusicCredit = { title: string; artist: string };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 120 || CONTROL_CHARACTERS.test(trimmed)) return null;
  return trimmed;
}

export function selectYouTubeMusicCredit(cards: readonly YouTubeMusicCredit[]): YouTubeMusicCredit | null {
  const credits = new Map<string, YouTubeMusicCredit>();
  for (const card of cards) {
    const title = cleanText(card.title);
    const artist = cleanText(card.artist);
    if (!title || !artist) continue;
    const normalizedTitle = normalizeTrackName(title);
    const normalizedArtist = normalizeTrackName(artist);
    // Symbol-only names normalize to "", which would collide with unrelated credits.
    if (!normalizedTitle || !normalizedArtist) continue;
    const key = `${normalizedTitle}\u0000${normalizedArtist}`;
    if (!credits.has(key)) credits.set(key, { title, artist });
  }

  // Zero credits means no music section; several distinct credits usually mean a compilation or medley.
  if (credits.size !== 1) return null;
  return credits.values().next().value ?? null;
}
