export type Speaker = "agent" | "prospect";

export type RawTurn = { turnId: string; speaker: Speaker | "system"; text: string; startMs: number; endMs: number; isFinal: boolean; uncertain?: boolean; seq?: number };
export type NormalizedTurn = { turnId: string; speaker: Speaker; text: string; startMs: number; endMs: number; words: number; uncertain: boolean; index: number };

const WORD = /[A-Za-z0-9$'’-]+/g;
export function countWords(text: string): number {
  return (text.match(WORD) ?? []).length;
}

/**
 * Stage 1 of evaluation. Keeps original text, drops non-final and system turns,
 * de-duplicates by turnId (last write wins, matching the reducer), orders by
 * time, and marks turns whose text is too short or flagged uncertain.
 */
export function normalizeTranscript(raw: RawTurn[]): NormalizedTurn[] {
  const byId = new Map<string, RawTurn>();
  for (const t of raw) {
    if (!t.isFinal || t.speaker === "system") continue;
    byId.set(t.turnId, t);
  }
  const ordered = [...byId.values()].sort((a, b) => a.startMs - b.startMs || (a.seq ?? 0) - (b.seq ?? 0));
  return ordered.map((t, index) => {
    const text = t.text.trim();
    const words = countWords(text);
    return {
      turnId: t.turnId, speaker: t.speaker as Speaker, text, index,
      startMs: Math.max(0, t.startMs), endMs: Math.max(t.startMs, t.endMs), words,
      uncertain: Boolean(t.uncertain) || words === 0,
    };
  });
}
