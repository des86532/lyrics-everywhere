import type {
  ActiveLyricDisplay,
  LineAnnotation,
  PlaybackSnapshot,
  PronunciationProfile,
  SyncedLyrics,
  TrackMetadata,
} from "../domain/types.js";
import type { MediaConnector } from "../connectors/media-connector.js";
import type { LrclibClient } from "../lyrics/lrclib-client.js";
import { koreanToBopomofo } from "../pronunciation/korean-engine.js";

export class PlaybackSession {
  private currentTrack?: TrackMetadata;
  private currentLyrics?: SyncedLyrics;
  private annotations: LineAnnotation[] = [];
  private lastSnapshot?: PlaybackSnapshot;
  private generationSeq = 0;
  private listeners = new Set<(display: ActiveLyricDisplay) => void>();

  constructor(
    private connector: MediaConnector,
    private lyricsClient: LrclibClient,
    private profile: PronunciationProfile = {
      profileId: "default",
      sourceLanguage: "auto",
      notation: "bopomofo",
      style: "singable",
      display: {
        original: true,
        pronunciation: true,
        translation: false,
      },
    }
  ) {}

  subscribe(listener: (display: ActiveLyricDisplay) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async tick(): Promise<ActiveLyricDisplay> {
    const snapshot = await this.connector.snapshot();
    return this.processSnapshot(snapshot);
  }

  async processSnapshot(snapshot: PlaybackSnapshot): Promise<ActiveLyricDisplay> {
    this.lastSnapshot = snapshot;
    const incomingTrack = snapshot.track;

    // 換歌偵測
    if (incomingTrack && incomingTrack.trackKey !== this.currentTrack?.trackKey) {
      this.currentTrack = incomingTrack;
      const currentGen = ++this.generationSeq;
      this.currentLyrics = undefined;
      this.annotations = [];

      // 非同步解析歌詞與發音標記
      this.lyricsClient.resolveLyrics(incomingTrack).then((lyrics) => {
        // 如果在請求期間歌曲又換了，丟棄此 stale 結果
        if (this.generationSeq !== currentGen) return;
        if (lyrics) {
          this.currentLyrics = lyrics;
          this.annotations = this.annotateLyrics(lyrics);
          this.notify();
        }
      });
    } else if (!incomingTrack) {
      this.currentTrack = undefined;
      this.currentLyrics = undefined;
      this.annotations = [];
    }

    const display = this.computeDisplay(snapshot);
    this.notify(display);
    return display;
  }

  private annotateLyrics(lyrics: SyncedLyrics): LineAnnotation[] {
    return lyrics.lines.map((line) => {
      const pron = koreanToBopomofo(line.text);
      return {
        lineId: line.lineId,
        startMs: line.startMs,
        endMs: line.endMs,
        originalText: line.text,
        pronunciation: {
          displayText: pron.displayText,
          segments: pron.segments,
        },
      };
    });
  }

  computeDisplay(snapshot?: PlaybackSnapshot): ActiveLyricDisplay {
    const snap = snapshot || this.lastSnapshot;
    const pos = snap?.positionMs ?? 0;
    const isPlaying = snap?.state === "playing";
    const duration = snap?.track?.durationMs;

    let currentIndex = -1;
    if (this.annotations.length > 0) {
      // 依目前時間找到對應的行
      for (let i = 0; i < this.annotations.length; i++) {
        const line = this.annotations[i];
        if (line && line.startMs !== undefined) {
          const nextLine = this.annotations[i + 1];
          const end = line.endMs ?? nextLine?.startMs ?? line.startMs + 4000;
          if (pos >= line.startMs && pos < end) {
            currentIndex = i;
            break;
          }
        }
      }

      // 若未精確落入區間，找最近且 startMs <= pos 的行
      if (currentIndex === -1) {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
          const line = this.annotations[i];
          if (line && line.startMs !== undefined && line.startMs <= pos) {
            currentIndex = i;
            break;
          }
        }
      }
    }

    const currentLine = currentIndex >= 0 ? this.annotations[currentIndex] : undefined;
    const previousLine = currentIndex > 0 ? this.annotations[currentIndex - 1] : undefined;
    const nextLine = currentIndex >= 0 && currentIndex < this.annotations.length - 1
      ? this.annotations[currentIndex + 1]
      : undefined;

    const progressPercent = duration && duration > 0
      ? Math.min(100, Math.max(0, Math.round((pos / duration) * 100)))
      : 0;

    return {
      currentLine,
      previousLine,
      nextLine,
      progressPercent,
      isPlaying,
      positionMs: pos,
      durationMs: duration,
    };
  }

  private notify(display?: ActiveLyricDisplay) {
    const d = display || this.computeDisplay();
    for (const listener of this.listeners) {
      try {
        listener(d);
      } catch {
        // 隔離 listener 錯誤
      }
    }
  }

  getCurrentTrack() {
    return this.currentTrack;
  }

  getAnnotations() {
    return this.annotations;
  }
}
