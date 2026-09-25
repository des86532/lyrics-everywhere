import { createHash } from "node:crypto";
import type { LyricLine, LyricToken, SyncedLyrics } from "../domain/types.js";

export function parseLrc(rawContent: string, trackKey: string, providerName = "lrclib"): SyncedLyrics {
  const lines = rawContent.split(/\r?\n/);
  const parsedLines: LyricLine[] = [];
  let globalOffsetMs = 0;

  // 1. 檢查與抽取 global offset
  for (const line of lines) {
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch && offsetMatch[1]) {
      globalOffsetMs = Number.parseInt(offsetMatch[1], 10) || 0;
    }
  }

  // 2. 解析每行時間標籤與歌詞內容
  // 標準 LRC 格式可能一組或多組時間標籤：[00:12.34][00:45.67]歌詞文字
  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  let hasAnyTimestamp = false;
  let lineCounter = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // 忽略常見 metadata tags (ti, ar, al, by, length 等)
    if (/^\[(ti|ar|al|by|length|re|ve|offset):.*\]/i.test(trimmed)) {
      continue;
    }

    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length > 0) {
      hasAnyTimestamp = true;
      const text = trimmed.replace(timestampRegex, "").trim();

      // 檢查 Enhanced LRC 逐字時間戳標籤：<00:12.34>字詞
      const tokens = parseEnhancedTokens(text, globalOffsetMs);

      for (const m of matches) {
        const mins = Number.parseInt(m[1] || "0", 10);
        const secs = Number.parseInt(m[2] || "0", 10);
        const fractionRaw = m[3] || "0";
        // 2 位數是百分之一秒 (x10)，3 位數是毫秒
        const msFraction = fractionRaw.length === 2 ? Number.parseInt(fractionRaw, 10) * 10 : Number.parseInt(fractionRaw.padEnd(3, "0"), 10);
        const totalStartMs = Math.max(0, mins * 60 * 1000 + secs * 1000 + msFraction + globalOffsetMs);

        parsedLines.push({
          lineId: `line-${++lineCounter}`,
          startMs: totalStartMs,
          text: tokens.length > 0 ? tokens.map((t) => t.text).join("") : text,
          tokens: tokens.length > 0 ? tokens : undefined,
        });
      }
    } else {
      // 純文字無時間戳
      parsedLines.push({
        lineId: `line-${++lineCounter}`,
        text: trimmed,
      });
    }
  }

  // 3. 排序並推導每行 endMs
  if (hasAnyTimestamp) {
    parsedLines.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    for (let i = 0; i < parsedLines.length; i++) {
      const current = parsedLines[i];
      const next = parsedLines[i + 1];
      if (current && next && next.startMs !== undefined && current.startMs !== undefined) {
        current.endMs = next.startMs;
      } else if (current && current.startMs !== undefined) {
        // 最後一行預設 4 秒
        current.endMs = current.startMs + 4000;
      }
    }
  }

  const contentHash = createHash("sha256").update(rawContent).digest("hex");

  return {
    lyricsId: `lyrics-${contentHash.slice(0, 12)}`,
    trackKey,
    provider: {
      name: providerName,
      recordId: contentHash.slice(0, 8),
    },
    format: hasAnyTimestamp ? "lrc" : "plain",
    granularity: hasAnyTimestamp ? "line" : "none",
    lines: parsedLines,
    contentHash,
  };
}

function parseEnhancedTokens(lineText: string, offsetMs: number): LyricToken[] {
  const tokenRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?>([^<]+)/g;
  const matches = Array.from(lineText.matchAll(tokenRegex));
  if (matches.length === 0) return [];

  const tokens: LyricToken[] = [];
  let tokenCounter = 0;
  for (const m of matches) {
    const mins = Number.parseInt(m[1] || "0", 10);
    const secs = Number.parseInt(m[2] || "0", 10);
    const fractionRaw = m[3] || "0";
    const msFraction = fractionRaw.length === 2 ? Number.parseInt(fractionRaw, 10) * 10 : Number.parseInt(fractionRaw.padEnd(3, "0"), 10);
    const startMs = Math.max(0, mins * 60 * 1000 + secs * 1000 + msFraction + offsetMs);

    tokens.push({
      tokenId: `tok-${++tokenCounter}`,
      text: m[4] || "",
      startMs,
    });
  }

  // 推導 token endMs
  for (let i = 0; i < tokens.length; i++) {
    const curr = tokens[i];
    const nxt = tokens[i + 1];
    if (curr && nxt && nxt.startMs !== undefined) {
      curr.endMs = nxt.startMs;
    }
  }

  return tokens;
}
