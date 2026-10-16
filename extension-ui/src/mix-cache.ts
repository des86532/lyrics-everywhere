import type { TranscriptLine } from "./transcript-lines.js";

export interface CompleteMix {
  videoId: string;
  durationMs: number;
  status: "complete";
  lines: TranscriptLine[];
  completedWindows: number;
  updatedAtMs: number;
}

export interface MixDraft {
  videoId: string;
  durationMs: number;
  status: "recording" | "incomplete";
  lines: TranscriptLine[];
  completedWindows: number;
  updatedAtMs: number;
}

const DATABASE_NAME = "lyrics-everywhere-mixes";
const DATABASE_VERSION = 1;
const COMPLETE_STORE = "mixes";
const DRAFT_STORE = "drafts";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;


export class MixCache {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async initialize(recoverInterrupted = true): Promise<void> {
    await this.open();
    if (recoverInterrupted) await this.markInterruptedDraftsIncomplete();
  }

  async getComplete(videoId: string): Promise<CompleteMix | null> {
    const database = await this.open();
    const transaction = database.transaction(COMPLETE_STORE, "readonly");
    const result = await requestResult<CompleteMix | undefined>(transaction.objectStore(COMPLETE_STORE).get(videoId));
    await transactionComplete(transaction);
    return result?.status === "complete" ? result : null;
  }

  async getDraft(videoId: string): Promise<MixDraft | null> {
    const database = await this.open();
    const transaction = database.transaction(DRAFT_STORE, "readonly");
    const result = await requestResult<MixDraft | undefined>(transaction.objectStore(DRAFT_STORE).get(videoId));
    await transactionComplete(transaction);
    return result ?? null;
  }

  async begin(videoId: string, durationMs: number): Promise<void> {
    this.assertVideo(videoId, durationMs);
    const database = await this.open();
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).put({
      videoId,
      durationMs,
      status: "recording",
      lines: [],
      completedWindows: 0,
      updatedAtMs: Date.now(),
    } satisfies MixDraft);
    await transactionComplete(transaction);
  }

  async appendWindow(videoId: string, lines: TranscriptLine[]): Promise<number> {
    const database = await this.open();
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const request = store.get(videoId);
    const result = new Promise<number>((resolve, reject) => {
      request.onsuccess = () => {
        const draft = request.result as MixDraft | undefined;
        if (!draft || draft.status !== "recording") {
          transaction.abort();
          reject(new Error("找不到進行中的字幕草稿。"));
          return;
        }
        const completedWindows = draft.completedWindows + 1;
        store.put({
          ...draft,
          lines: [...draft.lines, ...lines],
          completedWindows,
          updatedAtMs: Date.now(),
        } satisfies MixDraft);
        resolve(completedWindows);
      };
      request.onerror = () => reject(request.error ?? new Error("無法讀取字幕草稿。"));
    });
    await Promise.all([result, transactionComplete(transaction)]);
    return result;
  }

  async markIncomplete(videoId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const request = store.get(videoId);
    request.onsuccess = () => {
      const draft = request.result as MixDraft | undefined;
      if (draft?.status === "recording") store.put({ ...draft, status: "incomplete", updatedAtMs: Date.now() } satisfies MixDraft);
    };
    await transactionComplete(transaction);
  }

  async complete(videoId: string, expectedWindows: number): Promise<CompleteMix> {
    const database = await this.open();
    const transaction = database.transaction([COMPLETE_STORE, DRAFT_STORE], "readwrite");
    const completeStore = transaction.objectStore(COMPLETE_STORE);
    const draftStore = transaction.objectStore(DRAFT_STORE);
    const request = draftStore.get(videoId);
    const result = new Promise<CompleteMix>((resolve, reject) => {
      request.onsuccess = () => {
        const draft = request.result as MixDraft | undefined;
        if (!draft || draft.status !== "recording" || draft.completedWindows !== expectedWindows || draft.lines.length === 0) {
          transaction.abort();
          reject(new Error("字幕窗口尚未全部完成，或沒有辨識到有效字幕。"));
          return;
        }
        const complete: CompleteMix = { ...draft, status: "complete", updatedAtMs: Date.now() };
        completeStore.put(complete);
        draftStore.delete(videoId);
        resolve(complete);
      };
      request.onerror = () => reject(request.error ?? new Error("無法驗證字幕草稿。"));
    });
    await Promise.all([result, transactionComplete(transaction)]);
    return result;
  }

  private async markInterruptedDraftsIncomplete(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const draft = cursor.value as MixDraft;
      if (draft.status === "recording") cursor.update({ ...draft, status: "incomplete", updatedAtMs: Date.now() } satisfies MixDraft);
      cursor.continue();
    };
    await transactionComplete(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(COMPLETE_STORE)) database.createObjectStore(COMPLETE_STORE, { keyPath: "videoId" });
        if (!database.objectStoreNames.contains(DRAFT_STORE)) database.createObjectStore(DRAFT_STORE, { keyPath: "videoId" });
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.database = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("無法開啟字幕資料庫。"));
      request.onblocked = () => reject(new Error("字幕資料庫升級被其他側欄分頁阻擋。"));
    });
    this.database.catch(() => { this.database = null; }); // a failed open must not be cached; the next call retries
    return this.database;
  }

  private assertVideo(videoId: string, durationMs: number): void {
    if (!VIDEO_ID_PATTERN.test(videoId) || !Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError("無效的 YouTube 影片識別碼或片長。");
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}
