import type { LyricLine, LyricToken, SyncedLyrics } from "../domain/types.js";

export function parseLrcWithHash(rawContent: string, trackKey: string, providerName: string, contentHash: string): SyncedLyrics {
  const lines = rawContent.split(/\r?\n/);
  const parsedLines: LyricLine[] = [];
  let globalOffsetMs = 0;
  for (const line of lines) {
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offsetMatch && offsetMatch[1]) globalOffsetMs = Number.parseInt(offsetMatch[1], 10) || 0;
  }

  const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const untimedLines: string[] = [];
  let lineCounter = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length > 0) {
      const text = trimmed.replace(timestampRegex, "").trim();
      for (const match of matches) {
        const totalStartMs = stampToMs(match[1], match[2], match[3], globalOffsetMs);
        const tokens = parseEnhancedTokens(text, globalOffsetMs, totalStartMs);
        parsedLines.push({
          lineId: `line-${++lineCounter}`,
          startMs: totalStartMs,
          text: tokens.length > 0 ? tokens.map((token) => token.text).join("") : text,
          tokens: tokens.length > 0 ? tokens : undefined,
        });
      }
    } else if (!/^\[[a-z#][a-z0-9_#-]*:.*\]$/i.test(trimmed)) {
      untimedLines.push(trimmed);
    }
  }

  const hasAnyTimestamp = parsedLines.length > 0;
  if (hasAnyTimestamp) {
    parsedLines.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    for (let index = 0; index < parsedLines.length; index += 1) {
      const current = parsedLines[index];
      const next = current?.startMs === undefined ? undefined : parsedLines.slice(index + 1).find((line) => line.startMs !== undefined && line.startMs > current.startMs!);
      if (current && next?.startMs !== undefined) current.endMs = next.startMs;
      else if (current?.startMs !== undefined) current.endMs = current.startMs + 4000;
      const lastToken = current?.tokens?.[current.tokens.length - 1];
      if (current?.endMs !== undefined && lastToken && lastToken.endMs === undefined && lastToken.startMs !== undefined && current.endMs > lastToken.startMs) lastToken.endMs = current.endMs;
    }
  } else {
    for (const text of untimedLines) parsedLines.push({ lineId: `line-${++lineCounter}`, text });
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

/** [offset:] follows the mainstream LRC convention: a positive offset shows lyrics earlier, so it is subtracted. */
function stampToMs(minsRaw: string | undefined, secsRaw: string | undefined, fractionRaw: string | undefined, offsetMs: number): number {
  const fractionMs = fractionRaw ? Math.round(Number(`0.${fractionRaw}`) * 1000) : 0;
  return Math.max(0, Number.parseInt(minsRaw || "0", 10) * 60 * 1000 + Number.parseInt(secsRaw || "0", 10) * 1000 + fractionMs - offsetMs);
}

function parseEnhancedTokens(lineText: string, offsetMs: number, lineStartMs: number): LyricToken[] {
  const tokenRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]+)/g;
  const matches = Array.from(lineText.matchAll(tokenRegex));
  if (matches.length === 0) return [];
  const tokens: LyricToken[] = [];
  let tokenCounter = 0;
  const leadingText = lineText.slice(0, matches[0]?.index ?? 0);
  if (leadingText.trim()) tokens.push({ tokenId: `tok-${++tokenCounter}`, text: leadingText, startMs: lineStartMs });
  for (const match of matches) tokens.push({ tokenId: `tok-${++tokenCounter}`, text: match[4] || "", startMs: stampToMs(match[1], match[2], match[3], offsetMs) });
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (current && next && next.startMs !== undefined) current.endMs = next.startMs;
  }
  return tokens;
}
