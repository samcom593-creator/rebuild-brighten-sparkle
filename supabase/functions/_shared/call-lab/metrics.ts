import type { NormalizedTurn } from "./normalize.ts";
import type { AudioAggregate, RubricData } from "./types.ts";

export type Overlap = { initiator: "agent" | "prospect"; startMs: number; durationMs: number };
export type SpeakerMetrics = {
  turns: number; words: number; speakingMs: number; wordsPerMinute: number | null;
  avgTurnMs: number | null; longestTurnMs: number | null; longestTurnId: string | null;
};
export type DeliveryMetrics = {
  agent: SpeakerMetrics;
  prospect: SpeakerMetrics;
  talkRatioAgent: number | null;
  fillersPerMinute: number | null;
  fillerCount: number;
  fillerTurnIds: string[];
  interruptionsByAgent: number;
  interruptionsByProspect: number;
  overlapMsByAgent: number;
  responseLatencyMs: { median: number | null; p90: number | null; samples: number };
  pauses: { over1500ms: number; over4000ms: number; longestMs: number };
  paceVariability: number | null; // std dev of per-turn wpm for the agent
  audio: { agent: AudioAggregate | null; prospect: AudioAggregate | null };
  confidence: "high" | "medium" | "low" | "insufficient_evidence";
  benchmarks: RubricData["deliveryBenchmarks"];
  flags: string[];
  durationMs: number;
};

const FILLERS = /\b(um+|uh+|erm|hmm+|you know|kind of|sort of|basically|literally|actually|i mean|like,)\b/gi;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

function speakerMetrics(turns: NormalizedTurn[]): SpeakerMetrics {
  const words = turns.reduce((a, t) => a + t.words, 0);
  const speakingMs = turns.reduce((a, t) => a + Math.max(0, t.endMs - t.startMs), 0);
  let longest: NormalizedTurn | null = null;
  for (const t of turns) if (!longest || t.endMs - t.startMs > longest.endMs - longest.startMs) longest = t;
  return {
    turns: turns.length, words, speakingMs,
    wordsPerMinute: speakingMs >= 5000 && words > 0 ? Math.round(words / (speakingMs / 60000)) : null,
    avgTurnMs: turns.length ? Math.round(speakingMs / turns.length) : null,
    longestTurnMs: longest ? longest.endMs - longest.startMs : null,
    longestTurnId: longest?.turnId ?? null,
  };
}

/**
 * Stage 2 of evaluation: mechanical signals computed in code, never by the
 * model. Only observable behaviors; no emotion, identity or trait inference.
 */
export function computeDeliveryMetrics(args: {
  turns: NormalizedTurn[]; overlaps: Overlap[]; audio: { agent?: AudioAggregate | null; prospect?: AudioAggregate | null };
  benchmarks: RubricData["deliveryBenchmarks"]; durationMs: number;
}): DeliveryMetrics {
  const agentTurns = args.turns.filter((t) => t.speaker === "agent");
  const prospectTurns = args.turns.filter((t) => t.speaker === "prospect");
  const agent = speakerMetrics(agentTurns);
  const prospect = speakerMetrics(prospectTurns);
  const total = agent.speakingMs + prospect.speakingMs;

  let fillerCount = 0; const fillerTurnIds: string[] = [];
  for (const t of agentTurns) {
    const c = (t.text.match(FILLERS) ?? []).length;
    if (c) { fillerCount += c; fillerTurnIds.push(t.turnId); }
  }
  const agentMinutes = agent.speakingMs / 60000;

  const latencies: number[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < args.turns.length; i++) {
    const prev = args.turns[i - 1], cur = args.turns[i];
    const gap = cur.startMs - prev.endMs;
    if (gap > 0) gaps.push(gap);
    if (prev.speaker === "prospect" && cur.speaker === "agent" && gap >= 0 && gap < 15000) latencies.push(gap);
  }
  const perTurnWpm = agentTurns.filter((t) => t.endMs - t.startMs >= 2000 && t.words >= 5).map((t) => t.words / ((t.endMs - t.startMs) / 60000));
  const meanWpm = perTurnWpm.length ? perTurnWpm.reduce((a, b) => a + b, 0) / perTurnWpm.length : 0;
  const paceVariability = perTurnWpm.length >= 3 ? Math.round(Math.sqrt(perTurnWpm.reduce((a, b) => a + (b - meanWpm) ** 2, 0) / perTurnWpm.length)) : null;

  const byAgent = args.overlaps.filter((o) => o.initiator === "agent");
  const byProspect = args.overlaps.filter((o) => o.initiator === "prospect");

  const flags: string[] = [];
  const b = args.benchmarks;
  if (agent.wordsPerMinute !== null && (agent.wordsPerMinute < b.wordsPerMinute[0] || agent.wordsPerMinute > b.wordsPerMinute[1])) flags.push(`pace ${agent.wordsPerMinute} wpm outside ${b.wordsPerMinute[0]}–${b.wordsPerMinute[1]}`);
  if (agentMinutes > 0.5 && fillerCount / agentMinutes > b.fillersPerMinute) flags.push(`fillers ${(fillerCount / agentMinutes).toFixed(1)}/min above ${b.fillersPerMinute}`);
  if (agent.longestTurnMs !== null && agent.longestTurnMs > b.longestMonologueSec * 1000) flags.push(`longest monologue ${Math.round(agent.longestTurnMs / 1000)}s above ${b.longestMonologueSec}s`);
  const ratio = total > 0 ? agent.speakingMs / total : null;
  if (ratio !== null && (ratio < b.talkRatioAgent[0] || ratio > b.talkRatioAgent[1])) flags.push(`talk ratio ${(ratio * 100).toFixed(0)}% outside ${b.talkRatioAgent[0] * 100}–${b.talkRatioAgent[1] * 100}%`);
  if (byAgent.length >= 3) flags.push(`${byAgent.length} interruptions by agent`);

  let confidence: DeliveryMetrics["confidence"] = "high";
  if (agent.speakingMs < 60000 || agentTurns.length < 6) confidence = agent.speakingMs < 20000 ? "insufficient_evidence" : "low";
  else if (agent.speakingMs < 120000) confidence = "medium";
  const aq = args.audio.agent?.qualityConfidence;
  if (aq === "low" && confidence === "high") confidence = "medium";
  if (aq === "insufficient_evidence" && confidence !== "insufficient_evidence") confidence = confidence === "high" ? "medium" : confidence;

  return {
    agent, prospect,
    talkRatioAgent: ratio === null ? null : Math.round(ratio * 100) / 100,
    fillersPerMinute: agentMinutes >= 0.5 ? Math.round((fillerCount / agentMinutes) * 10) / 10 : null,
    fillerCount, fillerTurnIds,
    interruptionsByAgent: byAgent.length, interruptionsByProspect: byProspect.length,
    overlapMsByAgent: byAgent.reduce((a, o) => a + o.durationMs, 0),
    responseLatencyMs: { median: median(latencies), p90: percentile(latencies, 0.9), samples: latencies.length },
    pauses: { over1500ms: gaps.filter((g) => g > 1500).length, over4000ms: gaps.filter((g) => g > 4000).length, longestMs: gaps.length ? Math.max(...gaps) : 0 },
    paceVariability,
    audio: { agent: args.audio.agent ?? null, prospect: args.audio.prospect ?? null },
    confidence, benchmarks: b, flags, durationMs: args.durationMs,
  };
}
