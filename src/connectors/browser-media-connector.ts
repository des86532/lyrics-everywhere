import type { PlaybackSnapshot, PlaybackState, TrackMetadata } from "../domain/types.js";
import type { MediaConnector } from "./media-connector.js";

export type BrowserAppId = "youtube" | "youtube-music";
export type BrowserReportState = Exclude<PlaybackState, "unavailable">;

export interface BrowserPlaybackReport {
  version: 1;
  tabId: string;
  sessionId: string;
  appId: BrowserAppId;
  pageUrl: string;
  videoId: string;
  title: string;
  artists: string[];
  album?: string;
  state: BrowserReportState;
  positionMs: number;
  durationMs: number;
  playbackRate: number;
  capturedAtMs: number;
  isAd?: boolean;
}

export interface BrowserReportValidation { ok: true; report: BrowserPlaybackReport; }
export interface BrowserReportRejection { ok: false; reason: string; }
export type BrowserReportResult = BrowserReportValidation | BrowserReportRejection;

interface StoredReport { report: BrowserPlaybackReport; receivedAtMs: number; }
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_BODY_STRING = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function boundedString(value: unknown, max = MAX_BODY_STRING): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateBrowserPlaybackReport(input: unknown): BrowserReportResult {
  if (!isRecord(input) || input.version !== 1) return { ok: false, reason: "unsupported version" };
  if (!boundedString(input.tabId, 128) || !boundedString(input.sessionId, 128)) return { ok: false, reason: "invalid tab identity" };
  if (input.appId !== "youtube" && input.appId !== "youtube-music") return { ok: false, reason: "invalid app id" };
  if (!boundedString(input.pageUrl, 2048)) return { ok: false, reason: "invalid page url" };
  try {
    const url = new URL(input.pageUrl);
    if (url.protocol !== "https:" || (url.hostname !== "www.youtube.com" && url.hostname !== "music.youtube.com")) return { ok: false, reason: "unsupported page host" };
  } catch {
    return { ok: false, reason: "invalid page url" };
  }
  if (!boundedString(input.videoId, 32) || !VIDEO_ID_PATTERN.test(input.videoId)) return { ok: false, reason: "invalid video id" };
  if (!boundedString(input.title)) return { ok: false, reason: "missing title" };
  if (!Array.isArray(input.artists) || input.artists.length === 0 || input.artists.length > 8) return { ok: false, reason: "missing artists" };
  const artists = input.artists.filter((artist): artist is string => boundedString(artist, 200));
  if (artists.length !== input.artists.length) return { ok: false, reason: "invalid artists" };
  if (input.album !== undefined && !boundedString(input.album, 500)) return { ok: false, reason: "invalid album" };
  if (input.state !== "playing" && input.state !== "paused" && input.state !== "stopped") return { ok: false, reason: "invalid playback state" };
  if (!finiteNonNegative(input.positionMs) || !finiteNonNegative(input.durationMs)) return { ok: false, reason: "invalid position or duration" };
  if (typeof input.playbackRate !== "number" || !Number.isFinite(input.playbackRate) || input.playbackRate < 0 || input.playbackRate > 16) return { ok: false, reason: "invalid playback rate" };
  if (!finiteNonNegative(input.capturedAtMs)) return { ok: false, reason: "invalid capture time" };
  if (input.isAd !== undefined && typeof input.isAd !== "boolean") return { ok: false, reason: "invalid ad flag" };
  if (input.isAd === true) return { ok: false, reason: "advertisement report" };
  return { ok: true, report: { version: 1, tabId: input.tabId, sessionId: input.sessionId, appId: input.appId, pageUrl: input.pageUrl, videoId: input.videoId, title: input.title, artists, album: input.album, state: input.state, positionMs: input.positionMs, durationMs: input.durationMs, playbackRate: input.playbackRate, capturedAtMs: input.capturedAtMs } };
}

export interface BrowserMediaConnectorOptions { staleAfterMs?: number; now?: () => number; }

export class BrowserMediaConnector implements MediaConnector {
  readonly name = "browser";
  private readonly reports = new Map<string, StoredReport>();
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private eventSeq = 0;
  private activeKey?: string;

  constructor(options: BrowserMediaConnectorOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 5000;
    this.now = options.now ?? Date.now;
  }

  ingest(input: unknown, receivedAtMs = this.now()): BrowserReportResult {
    const result = validateBrowserPlaybackReport(input);
    if (!result.ok) return result;
    this.reports.set(this.key(result.report), { report: result.report, receivedAtMs });
    return result;
  }

  disconnect(tabId: string, sessionId?: string): void {
    for (const [key, stored] of this.reports) {
      if (stored.report.tabId === tabId && (sessionId === undefined || stored.report.sessionId === sessionId)) {
        this.reports.delete(key);
        if (this.activeKey === key) this.activeKey = undefined;
      }
    }
  }

  async isAvailable(): Promise<boolean> { return (await this.snapshot()).state !== "unavailable"; }

  async snapshot(): Promise<PlaybackSnapshot> {
    const selected = this.selectReport();
    this.eventSeq += 1;
    if (!selected) return { eventSeq: this.eventSeq, state: "unavailable", sampledAtMs: this.now(), playbackRate: 0 };
    this.activeKey = this.key(selected.report);
    const track: TrackMetadata = {
      trackKey: "youtube:" + selected.report.videoId,
      source: { connector: "browser", appId: selected.report.appId, sourceTrackId: selected.report.videoId },
      title: selected.report.title,
      artists: selected.report.artists,
      album: selected.report.album,
      durationMs: selected.report.durationMs || undefined,
    };
    return { eventSeq: this.eventSeq, track, state: selected.report.state, positionMs: selected.report.positionMs, sampledAtMs: selected.report.capturedAtMs, playbackRate: selected.report.playbackRate };
  }

  private selectReport(): StoredReport | undefined {
    const now = this.now();
    const fresh = [...this.reports.entries()].filter(([, stored]) => now - stored.receivedAtMs <= this.staleAfterMs);
    for (const [key] of this.reports) if (!fresh.some(([freshKey]) => freshKey === key)) this.reports.delete(key);
    if (fresh.length === 0) { this.activeKey = undefined; return undefined; }
    const active = fresh.find(([key]) => key === this.activeKey)?.[1];
    if (active?.report.state === "playing") return active;
    const playing = fresh.filter(([, stored]) => stored.report.state === "playing").sort((a, b) => b[1].receivedAtMs - a[1].receivedAtMs);
    if (playing.length > 0) return playing[0][1];
    if (active) return active;
    return fresh.sort((a, b) => b[1].receivedAtMs - a[1].receivedAtMs)[0]?.[1];
  }

  private key(report: BrowserPlaybackReport): string { return report.tabId + ":" + report.sessionId; }
}
