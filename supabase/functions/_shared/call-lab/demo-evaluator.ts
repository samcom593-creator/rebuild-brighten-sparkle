import { EvaluationResult } from "./schema.ts";
import type { NormalizedTurn } from "./normalize.ts";
import type { DeliveryMetrics } from "./metrics.ts";
import type { RubricData } from "./types.ts";
import { detectUnsupportedClaim } from "./brain.ts";

export type EvaluatorObjection = { id: string; key: string; title: string; required: boolean; resolutionChecks: string[]; responsePrinciples: string[]; surfacedTurnId: string | null; resolvedTurnId: string | null };
export type EvaluatorInput = {
  scenarioTitle: string; rubric: RubricData; rubricVersionId: string; approvedClaims: string[];
  prohibited: { text: string; patterns: string[]; severity: string }[]; objections: EvaluatorObjection[];
  turns: NormalizedTurn[]; metrics: DeliveryMetrics;
};
export interface Evaluator { readonly kind: "demo" | "anthropic" | "openai"; evaluate(input: EvaluatorInput): Promise<EvaluationResult>; }

const norm = (t: string) => t.toLowerCase();
const hasQ = (t: string) => /\?/.test(t) || /\b(what|who|why|how|when|which|would|could|can|do you|did you|are you|does that)\b/i.test(t);
const ex = (t: NormalizedTurn) => ({ turnId: t.turnId, excerpt: t.text.slice(0, 140) });

/**
 * Deterministic heuristic evaluator. Used when no language model is configured
 * and for test fixtures. It cites real turns, never claims high confidence,
 * and says so in its rationale. It is not a substitute for calibration.
 */
export class DemoEvaluator implements Evaluator {
  readonly kind = "demo" as const;
  async evaluate(input: EvaluatorInput): Promise<EvaluationResult> {
    const agent = input.turns.filter((t) => t.speaker === "agent");
    const enough = agent.length >= 4;
    const conf = (n: number): "medium" | "low" | "insufficient_evidence" => (!enough ? "insufficient_evidence" : n >= 3 ? "medium" : "low");
    const q = agent.filter((t) => hasQ(t.text));
    const discoveryQ = q.filter((t) => /\b(who|why|what|how|beneficiary|health|budget|coverage|priority|afford|comfortable)\b/i.test(t.text));
    const acks = agent.filter((t) => /\b(i hear you|understand|makes sense|fair|i get that|appreciate|of course)\b/i.test(t.text));
    const checkins = agent.filter((t) => /\b(make sense|sound fair|fair enough|take care of|does that help|would that work)\b/i.test(t.text));
    const closes = agent.filter((t) => /\b(lock in|set up|get started|bank|draft|next step|go ahead)\b/i.test(t.text));
    const identity = agent.filter((t) => /\b(licensed|agent|agency|license|apex)\b/i.test(t.text));
    const govHits = agent.filter((t) => detectUnsupportedClaim(t.text, input.prohibited).hit);
    const values = agent.filter((t) => /\b(linda|maya|family|wife|daughter|leave|protect|peace of mind|burial cost)\b/i.test(t.text));
    const long = agent.filter((t) => t.words > 110);

    const dims = input.rubric.dimensions.map((d) => {
      const pp = d.points;
      const pts = (ratio: number) => Math.round(Math.min(1, Math.max(0, ratio)) * pp * 10) / 10;
      switch (d.id) {
        case "discovery": return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts(discoveryQ.length / 5) : null, confidence: conf(discoveryQ.length), rationale: `${discoveryQ.length} discovery questions found (heuristic count of who/why/health/budget questions).`, evidence: discoveryQ.slice(0, 3).map(ex), nextBehavior: d.excellent };
        case "objection_recognition": { const named = agent.filter((t) => /\b(sounds like|it's the|the real|what you're saying|your concern|worried about)\b/i.test(t.text)); return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts(0.4 + named.length * 0.3) : null, confidence: conf(named.length), rationale: named.length ? `The agent named the underlying concern ${named.length} time(s).` : "No turn names the concern beneath the objection's words.", evidence: named.slice(0, 2).map(ex), nextBehavior: d.excellent }; }
        case "acknowledge_clarify": return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts((acks.length * 0.5 + q.length * 0.15) / 2.5) : null, confidence: conf(acks.length), rationale: `${acks.length} acknowledgements and ${q.length} questions across ${agent.length} agent turns.`, evidence: [...acks.slice(0, 2), ...q.slice(0, 1)].map(ex), nextBehavior: d.excellent };
        case "response_accuracy": return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts(govHits.length ? 0.2 : 0.8) : null, confidence: conf(agent.length), rationale: govHits.length ? `${govHits.length} turn(s) contain an unsupported or prohibited claim.` : "No prohibited or unsupported claim pattern found in the agent's turns.", evidence: (govHits.length ? govHits : agent.slice(-2)).slice(0, 2).map(ex), nextBehavior: d.excellent };
        case "resolution_advancement": { const ok = input.objections.filter((o) => o.resolvedTurnId).length; const req = input.objections.filter((o) => o.required).length || 1; return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts((ok / req) * 0.7 + (closes.length ? 0.3 : 0) * (checkins.length ? 1 : 0.6)) : null, confidence: conf(ok + closes.length), rationale: `${ok} objections marked resolved in the call ledger; ${closes.length} closing attempt(s); ${checkins.length} resolution check-in(s).`, evidence: [...checkins.slice(0, 1), ...closes.slice(0, 2)].map(ex), nextBehavior: d.excellent }; }
        case "listening_control": { const m = input.metrics; const ratioOk = m.talkRatioAgent !== null && m.talkRatioAgent >= m.benchmarks.talkRatioAgent[0] && m.talkRatioAgent <= m.benchmarks.talkRatioAgent[1]; return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts(0.5 + (ratioOk ? 0.3 : 0) + (long.length === 0 ? 0.2 : 0) - m.interruptionsByAgent * 0.1) : null, confidence: conf(agent.length), rationale: `Talk ratio ${m.talkRatioAgent ?? "n/a"}, ${m.interruptionsByAgent} interruptions by agent, ${long.length} monologue turn(s) over 110 words.`, evidence: (long.length ? long : agent.slice(0, 1)).slice(0, 2).map(ex), nextBehavior: d.excellent }; }
        case "value_articulation": return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? pts(0.3 + values.length * 0.2) : null, confidence: conf(values.length), rationale: `${values.length} turn(s) tie the coverage to the person or reason the prospect named.`, evidence: values.slice(0, 2).map(ex), nextBehavior: d.excellent };
        case "delivery": { const m = input.metrics; const f = m.flags.length; return { criterionId: d.id, pointsPossible: pp, pointsRecommended: m.confidence === "insufficient_evidence" ? null : pts(1 - f * 0.25), confidence: m.confidence === "high" ? "medium" : m.confidence, rationale: f ? `Delivery flags: ${m.flags.join("; ")}.` : "Pace, fillers, monologue length and talk ratio all inside the benchmarks.", evidence: (m.agent.longestTurnId ? input.turns.filter((t) => t.turnId === m.agent.longestTurnId) : agent.slice(0, 1)).map(ex), nextBehavior: d.excellent }; }
        case "compliance": return { criterionId: d.id, pointsPossible: pp, pointsRecommended: enough ? (govHits.length ? 1 : identity.length ? 5 : 3) : null, confidence: conf(agent.length), rationale: govHits.length ? "A prohibited claim pattern appears in the agent's turns." : identity.length ? "Identity and licensing were stated." : "Identity or licensing was never stated plainly.", evidence: (govHits.length ? govHits : identity).slice(0, 2).map(ex), nextBehavior: d.excellent };
        default: return { criterionId: d.id, pointsPossible: pp, pointsRecommended: null, confidence: "insufficient_evidence" as const, rationale: "No heuristic for this criterion.", evidence: [], nextBehavior: d.excellent };
      }
    });

    const objections = input.objections.map((o) => {
      const surfaced = Boolean(o.surfacedTurnId);
      if (!surfaced) return { objectionId: o.id, surfaced: false, scoreRecommended: null, resolved: null, confidence: "insufficient_evidence" as const, stages: { acknowledge: null, clarify: null, isolate: null, respond: null, proof: null, confirm: null }, evidence: [], coaching: "Not surfaced in this call." };
      const sIdx = input.turns.findIndex((t) => t.turnId === o.surfacedTurnId);
      const eIdx = o.resolvedTurnId ? input.turns.findIndex((t) => t.turnId === o.resolvedTurnId) : input.turns.length - 1;
      const window = input.turns.slice(sIdx + 1, eIdx + 1).filter((t) => t.speaker === "agent");
      const st = {
        acknowledge: window.some((t) => /\b(i hear you|understand|makes sense|fair|i get that|appreciate|of course)\b/i.test(t.text)) ? 15 : 4,
        clarify: window.some((t) => hasQ(t.text) && t.words < 60) ? 20 : 6,
        isolate: window.some((t) => /\b(only thing|besides that|other than|if we|specifically|which part)\b/i.test(t.text)) ? 15 : 5,
        respond: window.some((t) => t.words >= 12) ? (o.resolvedTurnId ? 25 : 14) : 5,
        proof: window.some((t) => /\b(a-rated|carrier|licensed|thirty days|30 days|never goes up|written|rate is set)\b/i.test(t.text)) ? 10 : 3,
        confirm: window.some((t) => /\b(make sense|sound fair|fair enough|take care of|does that help|would that work)\b/i.test(t.text)) ? 15 : 3,
      };
      const total = Object.values(st).reduce((a, b) => a + b, 0);
      return { objectionId: o.id, surfaced: true, scoreRecommended: total, resolved: Boolean(o.resolvedTurnId), confidence: window.length >= 2 ? ("medium" as const) : ("low" as const), stages: st, evidence: window.slice(0, 3).map(ex), coaching: total >= 70 ? `Handled to the minimum (${total}). The weakest stage was ${Object.entries(st).sort((a, b) => a[1] - b[1])[0][0]}.` : `Scored ${total}. Missing stages: ${Object.entries(st).filter(([, v]) => v <= 6).map(([k]) => k).join(", ") || "none"}.` };
    });

    const critical = govHits.map((t) => ({ ruleId: /va|government|military/.test(norm(t.text)) ? "government_affiliation" : "fabricated_fact", confidence: "high" as const, evidence: [ex(t)], rationale: "Deterministic match on a prohibited phrase." }));
    const weakest = [...objections].filter((o) => o.surfaced && o.scoreRecommended !== null).sort((a, b) => (a.scoreRecommended ?? 100) - (b.scoreRecommended ?? 100))[0];
    const best = [...dims].filter((d) => d.pointsRecommended !== null).sort((a, b) => (b.pointsRecommended! / b.pointsPossible) - (a.pointsRecommended! / a.pointsPossible))[0];
    const worst = [...dims].filter((d) => d.pointsRecommended !== null).sort((a, b) => (a.pointsRecommended! / a.pointsPossible) - (b.pointsRecommended! / b.pointsPossible))[0];
    const label = (id: string) => input.rubric.dimensions.find((d) => d.id === id)?.label ?? id;
    return EvaluationResult.parse({
      rubricVersionId: input.rubricVersionId,
      evidenceCoverage: dims.filter((d) => d.pointsRecommended !== null).length / dims.length,
      dimensions: dims,
      objections,
      criticalFailureCandidates: critical,
      strongestBehavior: best ? `${label(best.criterionId)}: ${best.rationale}` : "Not enough of the call to name a strength.",
      highestLeverageCorrection: worst ? `${label(worst.criterionId)}: ${worst.nextBehavior}` : "Complete a full call to get a correction.",
      recommendedDrill: weakest && weakest.scoreRecommended !== null && weakest.scoreRecommended < 85
        ? { title: `Practice: ${input.objections.find((o) => o.id === weakest.objectionId)?.title ?? "objection"}`, sourceObjectionId: weakest.objectionId, objective: "Handle this objection through all six stages and confirm it is resolved." }
        : { title: "Discovery drill", sourceObjectionId: null, objective: "Ask five discovery questions before presenting any price." },
    });
  }
}

