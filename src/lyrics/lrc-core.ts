import type { LyricLine, LyricToken, SyncedLyrics } from "../domain/types.js";

export function parseLrcWithHash(rawContent: string, trackKey: string, providerName: string, contentHash: string): SyncedLyrics {
  const lines = rawContent.split(/\r?\n/);
  const parsedLines: LyricLine[] = [];
  let globalOffsetMs = 0;
  for (const line of lines) {
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch && offsetMatch[1]) globalOffsetMs = Number.parseInt(offsetMatch[1], 10) || 0;
  }

  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  let hasAnyTimestamp = false;
  let lineCounter = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^\[(ti|ar|al|by|length|re|ve|offset):.*\]/i.test(trimmed)) continue;

    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length > 0) {
      hasAnyTimestamp = true;
      const text = trimmed.replace(timestampRegex, "").trim();
      const tokens = parseEnhancedTokens(text, globalOffsetMs);
      for (const match of matches) {
        const mins = Number.parseInt(match[1] || "0", 10);
        const secs = Number.parseInt(match[2] || "0", 10);
        const fractionRaw = match[3] || "0";
        const msFraction = fractionRaw.length === 2 ? Number.parseInt(fractionRaw, 10) * 10 : Number.parseInt(fractionRaw.padEnd(3, "0"), 10);
        const totalStartMs = Math.max(0, mins * 60 * 1000 + secs * 1000 + msFraction + globalOffsetMs);
        parsedLines.push({
          lineId: `line-${++lineCounter}`,
          startMs: totalStartMs,
          text: tokens.length > 0 ? tokens.map((token) => token.text).join("") : text,
          tokens: tokens.length > 0 ? tokens : undefined,
        });
      }
    } else {
      parsedLines.push({ lineId: `line-${++lineCounter}`, text: trimmed });
    }
  }

  if (hasAnyTimestamp) {
    parsedLines.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    for (let index = 0; index < parsedLines.length; index += 1) {
      const current = parsedLines[index];
      const next = current?.startMs === undefined ? undefined : parsedLines.slice(index + 1).find((line) => line.startMs !== undefined && line.startMs > current.startMs!);
      if (current && next?.startMs !== undefined) current.endMs = next.startMs;
      else if (current?.startMs !== undefined) current.endMs = current.startMs + 4000;
    }
  }

  return {
    lyricsId: `lyrics-${contentHash.slice(0, 12)}`,
    trackKey,
    provider: { name: providerName, recordId: contentHash.slice(0, 8) },
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
  for (const match of matches) {
    const mins = Number.parseInt(match[1] || "0", 10);
    const secs = Number.parseInt(match[2] || "0", 10);
    const fractionRaw = match[3] || "0";
    const msFraction = fractionRaw.length === 2 ? Number.parseInt(fractionRaw, 10) * 10 : Number.parseInt(fractionRaw.padEnd(3, "0"), 10);
    const startMs = Math.max(0, mins * 60 * 1000 + secs * 1000 + msFraction + offsetMs);
    tokens.push({ tokenId: `tok-${++tokenCounter}`, text: match[4] || "", startMs });
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (current && next && next.startMs !== undefined) current.endMs = next.startMs;
  }
  return tokens;
}
