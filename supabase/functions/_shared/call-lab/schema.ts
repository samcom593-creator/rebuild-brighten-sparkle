import { z } from "https://esm.sh/zod@4.5.4";

/**
 * The evaluator's structured contract. Enforced as a strict JSON Schema for
 * OpenAI Structured Outputs and as a tool input schema for Claude; validated
 * with Zod on the way back in either case. The evaluator recommends; the
 * application computes totals, gates and pass/fail deterministically.
 */
export const Confidence = z.enum(["high", "medium", "low", "insufficient_evidence"]);
export const Evidence = z.object({ turnId: z.string().min(1), excerpt: z.string().min(1).max(400) });

export const DimensionEval = z.object({
  criterionId: z.string().min(1),
  pointsRecommended: z.number().nullable(),
  pointsPossible: z.number().min(0),
  confidence: Confidence,
  rationale: z.string().min(1).max(1200),
  evidence: z.array(Evidence).max(8),
  nextBehavior: z.string().min(1).max(600),
});

export const ObjectionEval = z.object({
  objectionId: z.string().min(1),
  surfaced: z.boolean(),
  scoreRecommended: z.number().nullable(),
  resolved: z.boolean().nullable(),
  confidence: Confidence,
  stages: z.object({
    acknowledge: z.number().nullable(),
    clarify: z.number().nullable(),
    isolate: z.number().nullable(),
    respond: z.number().nullable(),
    proof: z.number().nullable(),
    confirm: z.number().nullable(),
  }),
  evidence: z.array(Evidence).max(8),
  coaching: z.string().max(800),
});

export const CriticalFailureCandidate = z.object({
  ruleId: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(Evidence).min(1).max(6),
  rationale: z.string().min(1).max(800),
});

export const EvaluationResult = z.object({
  rubricVersionId: z.string().min(1),
  evidenceCoverage: z.number().min(0).max(1),
  dimensions: z.array(DimensionEval).min(1),
  objections: z.array(ObjectionEval),
  criticalFailureCandidates: z.array(CriticalFailureCandidate),
  strongestBehavior: z.string().min(1).max(600),
  highestLeverageCorrection: z.string().min(1).max(600),
  recommendedDrill: z.object({
    title: z.string().min(1).max(120),
    sourceObjectionId: z.string().nullable(),
    objective: z.string().min(1).max(400),
  }),
});
export type EvaluationResult = z.infer<typeof EvaluationResult>;
export type DimensionEval = z.infer<typeof DimensionEval>;
export type ObjectionEval = z.infer<typeof ObjectionEval>;

/** JSON Schema for provider-side enforcement (strict mode: every property required, no extras). */
export function evaluationJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(EvaluationResult, { target: "draft-7" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}
