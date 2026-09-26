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
import { TranscriberRegistry } from "../pronunciation/transcriber-registry.js";
import { KoreanTranscriber } from "../pronunciation/korean-transcriber.js";
import { JapaneseTranscriber } from "../pronunciation/japanese-transcriber.js";

export class PlaybackSession {
  private currentTrack?: TrackMetadata;
  private currentLyrics?: SyncedLyrics;
  private annotations: LineAnnotation[] = [];
  private lastSnapshot?: PlaybackSnapshot;
  private generationSeq = 0;
  private listeners = new Set<(display: ActiveLyricDisplay) => void>();
  private registry: TranscriberRegistry;

  constructor(
    private connector: MediaConnector,
    private lyricsClient: LrclibClient,
    private profile: PronunciationProfile = {
      profileId: "default",
      sourceLanguage: "auto",
      notation: "chinese_homophone", // 預設使用中文字諧音（空耳跟唱）
      style: "singable",
      display: {
        original: true,
        pronunciation: true,
        translation: false,
      },
    },
    registry?: TranscriberRegistry
  ) {
    if (registry) {
      this.registry = registry;
    } else {
      this.registry = new TranscriberRegistry();
      this.registry.register(new KoreanTranscriber());
      this.registry.register(new JapaneseTranscriber());
    }
  }

  subscribe(listener: (display: ActiveLyricDisplay) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateProfile(newProfile: Partial<PronunciationProfile>) {
    this.profile = {
      ...this.profile,
      ...newProfile,
      display: {
        ...this.profile.display,
        ...(newProfile.display || {}),
      },
    };
    // 重新標註目前已有的歌詞
    if (this.currentLyrics) {
      this.annotations = this.annotateLyrics(this.currentLyrics);
      this.notify();
    }
  }

  getProfile(): PronunciationProfile {
    return this.profile;
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

      this.lyricsClient.resolveLyrics(incomingTrack).then((lyrics) => {
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
      const transcription = this.registry.transcribe({
        text: line.text,
        sourceLanguage: this.profile.sourceLanguage,
        notation: this.profile.notation,
        style: this.profile.style,
      });

      return {
        lineId: line.lineId,
        startMs: line.startMs,
        endMs: line.endMs,
        originalText: line.text,
        pronunciation: transcription,
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
      activeNotation: this.profile.notation,
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
