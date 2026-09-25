import type { SyncedLyrics, TrackMetadata } from "../domain/types.js";
import { parseLrc } from "./lrc-parser.js";

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number; // in seconds
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

export class LrclibClient {
  private readonly baseUrl = "https://lrclib.net/api";
  private readonly userAgent = "UniversalSingAlong/0.1.0 (https://github.com/des86532/lyrics-everywhere)";
  private cache = new Map<string, SyncedLyrics>();

  constructor(private customFetch: typeof fetch = fetch) {}

  async resolveLyrics(track: TrackMetadata): Promise<SyncedLyrics | null> {
    if (this.cache.has(track.trackKey)) {
      return this.cache.get(track.trackKey)!;
    }

    // 1. 嘗試精確匹配 (Exact lookup)
    const exact = await this.getExact(track);
    if (exact && (exact.syncedLyrics || exact.plainLyrics)) {
      const raw = exact.syncedLyrics || exact.plainLyrics || "";
      const parsed = parseLrc(raw, track.trackKey, "lrclib");
      this.cache.set(track.trackKey, parsed);
      return parsed;
    }

    // 2. 備援搜尋 (Search fallback with candidate scoring)
    const searchResult = await this.searchBestCandidate(track);
    if (searchResult && (searchResult.syncedLyrics || searchResult.plainLyrics)) {
      const raw = searchResult.syncedLyrics || searchResult.plainLyrics || "";
      const parsed = parseLrc(raw, track.trackKey, "lrclib");
      this.cache.set(track.trackKey, parsed);
      return parsed;
    }

    return null;
  }

  private async getExact(track: TrackMetadata): Promise<LrclibRecord | null> {
    try {
      const params = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artists[0] || "",
      });
      if (track.album) params.set("album_name", track.album);
      if (track.durationMs) params.set("duration", Math.round(track.durationMs / 1000).toString());

      const res = await this.customFetch(`${this.baseUrl}/get?${params.toString()}`, {
        headers: { "User-Agent": this.userAgent },
      });
      if (!res.ok) return null;
      return (await res.json()) as LrclibRecord;
    } catch {
      return null;
    }
  }

  private async searchBestCandidate(track: TrackMetadata): Promise<LrclibRecord | null> {
    try {
      const params = new URLSearchParams({
        track_name: track.title,
        artist_name: track.artists[0] || "",
      });
      const res = await this.customFetch(`${this.baseUrl}/search?${params.toString()}`, {
        headers: { "User-Agent": this.userAgent },
      });
      if (!res.ok) return null;
      const records = (await res.json()) as LrclibRecord[];
      if (!Array.isArray(records) || records.length === 0) return null;

      // 候選評分：時長差越小、且有 syncedLyrics 者優先
      const scored = records.map((rec) => {
        let score = 0;
        if (rec.syncedLyrics) score += 50;
        if (track.durationMs) {
          const diffSec = Math.abs(rec.duration - Math.round(track.durationMs / 1000));
          if (diffSec <= 2) score += 40;
          else if (diffSec <= 5) score += 20;
          else score -= diffSec * 2;
        }
        return { rec, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored[0]?.score && scored[0].score > 20 ? scored[0].rec : null;
    } catch {
      return null;
    }
  }
}
