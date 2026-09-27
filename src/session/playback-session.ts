import type {
  ActiveLyricDisplay,
  FullLyricsSheet,
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
  private currentSheet?: FullLyricsSheet;
  private lastSnapshot?: PlaybackSnapshot;
  private generationSeq = 0;
  private sheetRevision = 0;
  private listeners = new Set<(display: ActiveLyricDisplay) => void>();
  private sheetListeners = new Set<(sheet: FullLyricsSheet) => void>();
  private registry: TranscriberRegistry;

  constructor(
    private connector: MediaConnector,
    private lyricsClient: LrclibClient,
    private profile: PronunciationProfile = {
      profileId: "default",
      sourceLanguage: "auto",
      mode: "streamlined", // 預設使用極簡流暢跟唱模式 (1 音節 = 1 乾淨漢字，0 冗餘字母尾音)
      allowedSystems: ["chinese"],
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

  subscribeSheet(listener: (sheet: FullLyricsSheet) => void): () => void {
    this.sheetListeners.add(listener);
    return () => this.sheetListeners.delete(listener);
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

    if (this.currentLyrics && this.currentTrack) {
      this.sheetRevision++;
      const lines = this.annotateLyrics(this.currentLyrics);
      this.currentSheet = {
        trackKey: this.currentTrack.trackKey,
        lyricsId: this.currentLyrics.lyricsId,
        revision: this.sheetRevision,
        status: "ready",
        mode: this.profile.mode,
        allowedSystems: this.profile.allowedSystems,
        lines,
      };
      this.notifySheet();
      this.notify();
    }
  }

  getProfile(): PronunciationProfile {
    return this.profile;
  }

  getFullSheet(): FullLyricsSheet | undefined {
    return this.currentSheet;
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
      this.sheetRevision++;

      // 發送新歌 loading sheet
      this.currentSheet = {
        trackKey: incomingTrack.trackKey,
        lyricsId: "",
        revision: this.sheetRevision,
        status: "loading",
        mode: this.profile.mode,
        allowedSystems: this.profile.allowedSystems,
        lines: [],
      };
      this.notifySheet();

      this.lyricsClient.resolveLyrics(incomingTrack).then((lyrics) => {
        if (this.generationSeq !== currentGen) return; // Stale guard
        if (lyrics) {
          this.currentLyrics = lyrics;
          const lines = this.annotateLyrics(lyrics);
          this.currentSheet = {
            trackKey: incomingTrack.trackKey,
            lyricsId: lyrics.lyricsId,
            revision: ++this.sheetRevision,
            status: "ready",
            mode: this.profile.mode,
            allowedSystems: this.profile.allowedSystems,
            lines,
          };
          this.notifySheet();
          this.notify();
        } else {
          this.currentSheet = {
            trackKey: incomingTrack.trackKey,
            lyricsId: "",
            revision: ++this.sheetRevision,
            status: "unavailable",
            mode: this.profile.mode,
            allowedSystems: this.profile.allowedSystems,
            lines: [],
          };
          this.notifySheet();
        }
      });
    } else if (!incomingTrack) {
      this.currentTrack = undefined;
      this.currentLyrics = undefined;
      this.currentSheet = undefined;
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
        allowedSystems: this.profile.allowedSystems,
        mode: this.profile.mode,
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
    const lines = this.currentSheet?.lines || [];

    let currentIndex: number | null = null;

    if (lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && line.startMs !== undefined) {
          const nextLine = lines[i + 1];
          const end = line.endMs ?? nextLine?.startMs ?? line.startMs + 4000;
          if (pos >= line.startMs && pos < end) {
            currentIndex = i;
            break;
          }
        }
      }

      if (currentIndex === null) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          if (line && line.startMs !== undefined && line.startMs <= pos) {
            currentIndex = i;
            break;
          }
        }
      }
    }

    const currentLine = currentIndex !== null ? lines[currentIndex] : undefined;
    const previousLine = currentIndex !== null && currentIndex > 0 ? lines[currentIndex - 1] : undefined;
    const nextLine = currentIndex !== null && currentIndex < lines.length - 1
      ? lines[currentIndex + 1]
      : undefined;

    const progressPercent = duration && duration > 0
      ? Math.min(100, Math.max(0, Math.round((pos / duration) * 100)))
      : 0;

    return {
      currentLine,
      previousLine,
      nextLine,
      currentLineIndex: currentIndex,
      activeLineId: currentLine?.lineId,
      progressPercent,
      isPlaying,
      positionMs: pos,
      durationMs: duration,
      mode: this.profile.mode,
      allowedSystems: this.profile.allowedSystems,
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

  private notifySheet() {
    if (!this.currentSheet) return;
    for (const listener of this.sheetListeners) {
      try {
        listener(this.currentSheet);
      } catch {
        // 隔離 listener 錯誤
      }
    }
  }

  getCurrentTrack() {
    return this.currentTrack;
  }

  getAnnotations() {
    return this.currentSheet?.lines || [];
  }
}
