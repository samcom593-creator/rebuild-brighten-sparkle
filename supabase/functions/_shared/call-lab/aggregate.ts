import type { Confidence, CriticalFailure, Evidence, GateResult, ObjectionScore, RubricData, EndReason } from "./types.ts";
import type { EvaluationResult } from "./schema.ts";
import type { NormalizedTurn } from "./normalize.ts";
import type { DeliveryMetrics } from "./metrics.ts";
import { detectUnsupportedClaim } from "./brain.ts";

export type ObjectionContext = { objectionVersionId: string; key: string; title: string; required: boolean; surfacedInLedger: boolean; resolvedInLedger: boolean; example?: string };

export type AggregateInput = {
  rubric: RubricData;
  rubricVersionId: string;
  evaluation: EvaluationResult;
  turns: NormalizedTurn[];
  metrics: DeliveryMetrics;
  objections: ObjectionContext[];
  prohibited: { text: string; patterns: string[]; severity: string }[];
  endReason: EndReason | null;
};

export type DimensionOutcome = {
  criterionId: string; label: string; pointsEarned: number | null; pointsPossible: number; confidence: Confidence;
  rationale: string; evidence: Evidence[]; nextBehavior: string; excellent: string;
};

export type CoachingItem = {
  rank: number; moment: string; whyItMattered: string; tryInstead: string; example: string;
  drill: { title: string; objective: string; sourceObjectionVersionId: string | null }; evidence: Evidence[];
};

export type AggregateOutput = {
  overallScore: number | null;
  passState: "pass" | "fail" | "insufficient_evidence";
  confidence: Confidence;
  verdict: string;
  evidenceCoverage: number;
  dimensions: DimensionOutcome[];
  objectionScores: Record<string, ObjectionScore>;
  gates: GateResult[];
  criticalFailures: CriticalFailure[];
  coaching: { strongestBehavior: string; highestLeverageCorrection: string; recommendedDrill: { title: string; sourceObjectionVersionId: string | null; objective: string } };
  coachingItems: CoachingItem[];
  validation: { droppedCitations: number; downgradedDimensions: string[] };
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, insufficient_evidence: 0 };

function keepValid(ev: Evidence[], ids: Set<string>): { kept: Evidence[]; dropped: number } {
  const kept = ev.filter((e) => ids.has(e.turnId));
  return { kept, dropped: ev.length - kept.length };
}

/**
 * Stage 4 of evaluation. Deterministic: citations are validated against the
 * real transcript, points are clamped, totals are normalized to evidenced
 * criteria, gates and critical-failure overrides are applied by code, and
 * insufficient evidence is a first-class outcome rather than a zero.
 */
export function aggregate(input: AggregateInput): AggregateOutput {
  const ids = new Set(input.turns.map((t) => t.turnId));
  const agentTurns = input.turns.filter((t) => t.speaker === "agent");
  let droppedCitations = 0;
  const downgraded: string[] = [];

  /* Dimensions */
  const dimensions: DimensionOutcome[] = input.rubric.dimensions.map((d) => {
    const ev = input.evaluation.dimensions.find((x) => x.criterionId === d.id);
    if (!ev) return { criterionId: d.id, label: d.label, pointsEarned: null, pointsPossible: d.points, confidence: "insufficient_evidence", rationale: "The evaluator returned no judgment for this criterion.", evidence: [], nextBehavior: d.excellent, excellent: d.excellent };
    const { kept, dropped } = keepValid(ev.evidence, ids);
    droppedCitations += dropped;
    let confidence = ev.confidence;
    let points: number | null = ev.pointsRecommended === null ? null : clamp(ev.pointsRecommended, 0, d.points);
    if (kept.length === 0 && points !== null) {
      // A scored judgment must rest on transcript evidence. Without any, it is not a score.
      confidence = "insufficient_evidence"; points = null; downgraded.push(d.id);
    }
    if (confidence === "insufficient_evidence") points = null;
    return { criterionId: d.id, label: d.label, pointsEarned: points, pointsPossible: d.points, confidence, rationale: ev.rationale, evidence: kept, nextBehavior: ev.nextBehavior || d.excellent, excellent: d.excellent };
  });

  const possibleAll = dimensions.reduce((a, d) => a + d.pointsPossible, 0);
  const evidenced = dimensions.filter((d) => d.pointsEarned !== null);
  const possibleEvidenced = evidenced.reduce((a, d) => a + d.pointsPossible, 0);
  const earned = evidenced.reduce((a, d) => a + (d.pointsEarned ?? 0), 0);
  const evidenceCoverage = possibleAll ? Math.round((possibleEvidenced / possibleAll) * 100) / 100 : 0;
  const overallScore = possibleEvidenced > 0 ? Math.round((earned / possibleEvidenced) * 1000) / 10 : null;

  /* Objections */
  const stageMax = input.rubric.objectionStages;
  const objectionScores: Record<string, ObjectionScore> = {};
  for (const o of input.objections) {
    const ev = input.evaluation.objections.find((x) => x.objectionId === o.objectionVersionId);
    const surfaced = o.surfacedInLedger || Boolean(ev?.surfaced);
    if (!surfaced) {
      objectionScores[o.objectionVersionId] = { surfaced: false, resolved: null, score: null, confidence: "insufficient_evidence", stages: { acknowledge: null, clarify: null, isolate: null, respond: null, proof: null, confirm: null }, evidence: [], coaching: "This objection never came up in the call, so it cannot be scored.", meetsGate: null };
      continue;
    }
    if (!ev) {
      objectionScores[o.objectionVersionId] = { surfaced: true, resolved: o.resolvedInLedger, score: null, confidence: "insufficient_evidence", stages: { acknowledge: null, clarify: null, isolate: null, respond: null, proof: null, confirm: null }, evidence: [], coaching: "The objection surfaced but the evaluator returned no judgment for it.", meetsGate: null };
      continue;
    }
    const { kept, dropped } = keepValid(ev.evidence, ids); droppedCitations += dropped;
    const stages = { ...ev.stages };
    let confidence: Confidence = ev.confidence;
    if (kept.length === 0) { confidence = "insufficient_evidence"; }
    let score: number | null = null;
    if (confidence !== "insufficient_evidence") {
      let got = 0, possible = 0;
      for (const k of Object.keys(stageMax) as (keyof typeof stageMax)[]) {
        const v = stages[k];
        if (v === null || v === undefined) continue;
        got += clamp(v, 0, stageMax[k]); possible += stageMax[k];
      }
      score = possible > 0 ? Math.round((got / possible) * 100) : null;
      if (score === null) confidence = "insufficient_evidence";
    }
    objectionScores[o.objectionVersionId] = {
      surfaced: true, resolved: ev.resolved ?? o.resolvedInLedger, score, confidence, stages, evidence: kept, coaching: ev.coaching,
      meetsGate: score === null ? null : score >= input.rubric.passRules.requiredObjectionMin,
    };
  }

  /* Critical failures: model candidates + deterministic prohibited-pattern scan. */
  const criticalFailures: CriticalFailure[] = [];
  const ruleById = new Map(input.rubric.criticalFailureRules.map((r) => [r.id, r]));
  for (const c of input.evaluation.criticalFailureCandidates) {
    const { kept } = keepValid(c.evidence, ids);
    const rule = ruleById.get(c.ruleId);
    if (!rule || kept.length === 0) continue;
    const corroborated = kept.some((e) => { const t = input.turns.find((x) => x.turnId === e.turnId); return t ? detectUnsupportedClaim(t.text, input.prohibited).hit : false; });
    criticalFailures.push({ ruleId: c.ruleId, label: rule.label, confidence: c.confidence, evidence: kept, rationale: c.rationale, applied: c.confidence === "high" || (c.confidence === "medium" && corroborated) });
  }
  for (const t of agentTurns) {
    const hit = detectUnsupportedClaim(t.text, input.prohibited);
    if (!hit.hit || hit.severity !== "critical") continue;
    const ruleId = /va|government|military/.test((hit.pattern ?? "").toLowerCase()) ? "government_affiliation" : "fabricated_fact";
    if (criticalFailures.some((c) => c.ruleId === ruleId && c.evidence.some((e) => e.turnId === t.turnId))) continue;
    const rule = ruleById.get(ruleId);
    criticalFailures.push({ ruleId, label: rule?.label ?? ruleId, confidence: "high", evidence: [{ turnId: t.turnId, excerpt: t.text.slice(0, 160) }], rationale: `Deterministic match on the prohibited phrase "${hit.pattern}".`, applied: true });
  }

  /* Gates */
  const rules = input.rubric.passRules;
  const exempt = input.endReason === "critical_hangup" || input.endReason === "prospect_ended";
  const gates: GateResult[] = [];
  const required = input.objections.filter((o) => o.required);
  const unsurfaced = required.filter((o) => !objectionScores[o.objectionVersionId]?.surfaced);
  gates.push({ id: "required_surfaced", label: "Every required objection surfaced", passed: unsurfaced.length === 0 || exempt, detail: unsurfaced.length === 0 ? `${required.length} of ${required.length} surfaced` : exempt ? `${unsurfaced.length} not surfaced; exempt because the call ended early (${input.endReason})` : `Not surfaced: ${unsurfaced.map((o) => o.title).join(", ")}` });
  const belowGate = required.filter((o) => objectionScores[o.objectionVersionId]?.meetsGate === false);
  const unknownGate = required.filter((o) => objectionScores[o.objectionVersionId]?.surfaced && objectionScores[o.objectionVersionId]?.meetsGate === null);
  gates.push({ id: "required_min", label: `Each required objection ≥ ${rules.requiredObjectionMin}/100`, passed: unknownGate.length ? null : belowGate.length === 0, detail: belowGate.length ? `Below ${rules.requiredObjectionMin}: ${belowGate.map((o) => `${o.title} (${objectionScores[o.objectionVersionId].score})`).join(", ")}` : unknownGate.length ? `Insufficient evidence for: ${unknownGate.map((o) => o.title).join(", ")}` : "All required objections met the minimum" });
  const compliance = dimensions.find((d) => d.criterionId === rules.complianceCriterionId);
  gates.push({ id: "compliance_min", label: `Compliance ≥ ${rules.complianceMin}/${compliance?.pointsPossible ?? 5}`, passed: compliance?.pointsEarned === null || compliance === undefined ? null : compliance.pointsEarned >= rules.complianceMin, detail: compliance?.pointsEarned === null || compliance === undefined ? "Insufficient evidence" : `${compliance.pointsEarned}/${compliance.pointsPossible}` });
  const applied = criticalFailures.filter((c) => c.applied);
  gates.push({ id: "no_critical", label: "No critical failure", passed: applied.length === 0, detail: applied.length ? applied.map((c) => c.label).join("; ") : "None detected" });
  gates.push({ id: "overall_min", label: `Overall ≥ ${rules.overallMin}`, passed: overallScore === null ? null : overallScore >= rules.overallMin, detail: overallScore === null ? "No evidenced criteria" : `${overallScore} (normalized to evidenced criteria)` });

  /* Pass state and confidence */
  let passState: AggregateOutput["passState"];
  // An applied critical failure carries its own transcript evidence, so it fails the call
  // even when the rest of the rubric could not be evidenced (a hang-up after one turn).
  if (applied.length > 0) passState = "fail";
  else if (evidenceCoverage < rules.evidenceCoverageMin || overallScore === null) passState = "insufficient_evidence";
  else if (gates.some((g) => g.passed === false)) passState = "fail";
  else if (gates.some((g) => g.passed === null)) passState = "insufficient_evidence";
  else passState = "pass";
  const evidencedConf = evidenced.map((d) => d.confidence).filter((c) => c !== "insufficient_evidence");
  let confidence: Confidence = evidencedConf.length ? evidencedConf.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a)) : "insufficient_evidence";
  if (passState === "insufficient_evidence") confidence = "insufficient_evidence";

  const verdict = passState === "pass"
    ? `Passed with ${overallScore} — every required objection was handled to the minimum and no critical failure occurred.`
    : passState === "fail"
      ? applied.length ? `Failed on a critical failure (${applied[0].label}) regardless of the ${overallScore ?? "—"} score.` : `Scored ${overallScore ?? "—"}; ${gates.filter((g) => g.passed === false).map((g) => g.label.toLowerCase()).join(" and ")} not met.`
      : `Not enough evidence to certify: ${Math.round(evidenceCoverage * 100)}% of the rubric had evidence${overallScore !== null ? ` (${overallScore} on what was evidenced)` : ""}.`;

  /* Coaching: top three, sparse and evidence-linked. */
  const items: CoachingItem[] = [];
  const weakDims = dimensions.filter((d) => d.pointsEarned !== null).map((d) => ({ d, gap: (d.pointsPossible - (d.pointsEarned ?? 0)) / d.pointsPossible })).sort((a, b) => b.gap - a.gap);
  const weakObj = input.objections.map((o) => ({ o, s: objectionScores[o.objectionVersionId] })).filter((x) => x.s?.surfaced && x.s.score !== null).sort((a, b) => (a.s.score ?? 100) - (b.s.score ?? 100));
  for (const c of applied) items.push({ rank: items.length + 1, moment: c.rationale, whyItMattered: `${c.label} is a critical failure: it fails the call on its own.`, tryInstead: "Stay inside approved knowledge; when unsure, say you will confirm rather than assert.", example: "\"I can't promise that — what I can tell you is what the carrier puts in writing.\"", drill: { title: "Approved-claims drill", objective: "Handle a pricing question three times using only approved claims.", sourceObjectionVersionId: null }, evidence: c.evidence });
  for (const x of weakObj) {
    if (items.length >= 3) break;
    if ((x.s.score ?? 100) >= 85) continue;
    items.push({ rank: items.length + 1, moment: x.s.coaching || `The "${x.o.title}" objection scored ${x.s.score}.`, whyItMattered: `Required objections must reach ${rules.requiredObjectionMin}; this one is where the call was won or lost.`, tryInstead: "Acknowledge in one sentence, ask one clarifying question, respond to the concern underneath, then check whether it is handled.", example: x.o.example ? `Example, not a script: "${x.o.example.split("\n")[0].slice(0, 220)}"` : "Example, not a script: \"I hear you. Is it the monthly amount or the total that worries you?\"", drill: { title: `Practice: ${x.o.title}`, objective: `Handle "${x.o.title}" through all six stages and confirm resolution.`, sourceObjectionVersionId: x.o.objectionVersionId }, evidence: x.s.evidence.slice(0, 2) });
  }
  for (const w of weakDims) {
    if (items.length >= 3) break;
    if (w.gap < 0.3) continue;
    items.push({ rank: items.length + 1, moment: w.d.rationale, whyItMattered: `${w.d.label} carries ${w.d.pointsPossible} points; ${w.d.pointsEarned} were earned.`, tryInstead: w.d.nextBehavior, example: `What excellent looks like: ${w.d.excellent}`, drill: { title: `Drill: ${w.d.label}`, objective: w.d.excellent, sourceObjectionVersionId: null }, evidence: w.d.evidence.slice(0, 2) });
  }

  const drillSource = input.evaluation.recommendedDrill.sourceObjectionId && input.objections.some((o) => o.objectionVersionId === input.evaluation.recommendedDrill.sourceObjectionId)
    ? input.evaluation.recommendedDrill.sourceObjectionId : (weakObj[0]?.o.objectionVersionId ?? null);

  return {
    overallScore, passState, confidence, verdict, evidenceCoverage, dimensions, objectionScores, gates, criticalFailures,
    coaching: { strongestBehavior: input.evaluation.strongestBehavior, highestLeverageCorrection: input.evaluation.highestLeverageCorrection, recommendedDrill: { title: input.evaluation.recommendedDrill.title, sourceObjectionVersionId: drillSource, objective: input.evaluation.recommendedDrill.objective } },
    coachingItems: items,
    validation: { droppedCitations, downgradedDimensions: downgraded },
  };
}
