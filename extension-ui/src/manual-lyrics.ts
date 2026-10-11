export const MANUAL_LYRICS_STORAGE_KEY = "manualLyricsSelections";
export const MAX_MANUAL_SELECTIONS = 200;

export type ManualLyricsInput =
  | { kind: "lrclib-id"; id: number }
  | { kind: "identity"; title: string; artist: string }
  | { kind: "undetermined" };

const MAX_FIELD_LENGTH = 200;
const WRAPPER_CHARS = /^[\s"'“”「」《》*`]+|[\s"'“”「」《》*`]+$/gu;

function field(value: string, label: RegExp): string {
  return (value.match(label)?.[1] ?? "").replace(WRAPPER_CHARS, "");
}

export function parseManualLyricsInput(text: string): ManualLyricsInput | null {
  const value = text.normalize("NFKC").trim();
  if (!value) return null;

  const idText = value.match(/lrclib\.net\/(?:tracks|api\/get)\/(\d{1,12})(?!\d)/u)?.[1] ?? value.match(/^\d{1,12}$/u)?.[0];
  if (idText !== undefined) {
    const id = Number(idText);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "lrclib-id", id } : null;
  }

  if (value.includes("無法確定") || value.includes("无法确定")) return { kind: "undetermined" };

  const title = field(value, /^[\s*_`#>-]*(?:歌名|曲名|title)[\s*_`]*:\s*(.+)$/imu);
  const artist = field(value, /^[\s*_`#>-]*(?:歌手|artist)[\s*_`]*:\s*(.+)$/imu);
  if (title && artist && title.length <= MAX_FIELD_LENGTH && artist.length <= MAX_FIELD_LENGTH) {
    return { kind: "identity", title, artist };
  }
  return null;
}

export function manualLyricsPrompt(input: { rawTitle: string; channel: string; durationMs: number; pageUrl: string }): string {
  const totalSeconds = Math.round(input.durationMs / 1000);
  const duration = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return [
    "請幫我找出這支影片播放的歌曲，並以正式發行的曲名與歌手回答。",
    "",
    `影片標題：${input.rawTitle}`,
    `播放頁顯示的歌手／頻道：${input.channel || "無"}`,
    `影片長度：${duration}`,
    `影片網址：${input.pageUrl}`,
    "",
    "規則：",
    "- 請查證後再回答；歌名與歌手用正式發行時的寫法，保留原文，不要翻譯。",
    "- 只回答原唱錄音；若影片是 Live、翻唱、混音或多首歌串燒，或你無法確定，只回答「無法確定」。",
    "- 只輸出下面兩行，不要加任何說明：",
    "歌名：<歌名>",
    "歌手：<主唱歌手，多位以逗號分隔>",
  ].join("\n");
}

// Storage holds [videoId, lrclibId] pairs, oldest first.
export function parseManualSelections(value: unknown): Map<string, number> {
  const selections = new Map<string, number>();
  if (!Array.isArray(value)) return selections;
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const [videoId, id] = entry as unknown[];
    if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/u.test(videoId) || !Number.isSafeInteger(id) || (id as number) <= 0) continue;
    selections.delete(videoId);
    selections.set(videoId, id as number);
  }
  while (selections.size > MAX_MANUAL_SELECTIONS) selections.delete(selections.keys().next().value as string);
  return selections;
}
