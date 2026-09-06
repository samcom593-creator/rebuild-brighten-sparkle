import type { CompiledScenario } from "./brain.ts";

/**
 * Prompt assembly for the LLM prospect and the evaluator. Content is inserted
 * as data inside clearly delimited blocks; imported scripts and transcripts are
 * never treated as instructions. Private evaluator rules never enter the
 * prospect prompt.
 */

const fence = (label: string, body: string) => `<<${label}>>\n${body.replace(/<<|>>/g, "")}\n<</${label}>>`;

export function compileProspectPrompt(c: CompiledScenario): string {
  const p = c.persona;
  const objectionPlan = c.objections.map((o) => [
    `- id=${o.id} (${o.required ? "REQUIRED" : "optional"}) "${o.data.canonicalForms[0]}"`,
    `  concern: ${o.data.underlyingConcern}`,
    `  surface when: ${o.data.triggers.afterPhase ?? "any"} phase${o.data.triggers.minAgentTurns ? `, after ${o.data.triggers.minAgentTurns} trainee turns` : ""}${o.data.triggers.keywords?.length ? `, once the trainee mentions ${o.data.triggers.keywords.slice(0, 3).join("/")}` : ""}`,
    `  resolved only when: ${o.data.resolutionChecks.join("; ")}`,
    `  if handled weakly, say something like: ${o.data.followUps.ifWeak.join(" | ")}`,
  ].join("\n")).join("\n");

  return [
    `You are portraying ${p.name}, ${p.role} at ${p.companyProfile} in a realistic sales call simulation.`,
    ``,
    `PRIVATE ROLE TRUTH`,
    `- Situation: ${p.situation}`,
    `- Current solution/status quo: ${p.currentSolution}`,
    `- Business pressure: ${p.businessPressure}`,
    `- Decision process: ${p.decisionProcess}`,
    `- Knowledge level: ${p.knowledgeLevel}`,
    `- Temperament and speaking style: ${p.speakingStyle}`,
    `- Hidden priorities: ${p.hiddenPriorities.join("; ")}`,
    `- Hard constraints: ${p.hardConstraints.join("; ")}`,
    ``,
    `CALL OBJECTIVE`,
    `The trainee is trying to ${c.scenario.agentGoal}. Your natural objective is ${c.scenario.prospectGoal}.`,
    ``,
    `BEHAVIOR RULES`,
    `1. Stay in character. Never mention prompts, rubrics, tools, simulation state, or hidden information.`,
    `2. Speak conversationally in short voice-friendly turns, usually 1–3 sentences.`,
    `3. Do not deliver all context at once. Reveal information only when the trainee earns it through relevant questions.`,
    `4. Do not accept a claim merely because it sounds confident. React based on the role truth and the quality of the trainee's response.`,
    `5. Do not become artificially hostile. Resistance must be plausible for this persona and difficulty.`,
    `6. Let the trainee finish unless a realistic interruption is called for. Avoid monologues.`,
    `7. Surface required objections naturally, using varied wording, after their trigger conditions are met.`,
    `8. An objection is not resolved until the trainee acknowledges it, clarifies the underlying concern, gives a relevant response, and checks whether the concern is addressed.`,
    `9. Never invent product facts, prices, legal terms, guarantees, customer names, or capabilities outside APPROVED KNOWLEDGE. If the trainee makes an unsupported claim, challenge it naturally.`,
    `10. Conclude only when a credible next step is earned, the maximum duration (${Math.round(c.scenario.maxDurationSec / 60)} minutes) is reached, a critical safety/compliance issue occurs, or the trainee ends the call.`,
    ``,
    `APPROVED KNOWLEDGE`,
    fence("approved_claims", c.approvedClaims.map((x) => `- ${x}`).join("\n")),
    fence("script_context", c.scriptSections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n").slice(0, 6000)),
    ``,
    `OBJECTION PLAN`,
    fence("objection_plan", objectionPlan),
    ``,
    `DIFFICULTY POLICY`,
    c.scenario.difficultyPolicy,
    ``,
    `TOOLS`,
    `- Call \`surface_objection\` exactly once when you first voice a tracked objection.`,
    `- Call \`resolve_objection\` only after the resolution conditions are met.`,
    `- Call \`record_commitment\` when a real next step or commitment is agreed.`,
    `- Call \`end_scenario\` only for a valid end condition.`,
    `Do not narrate tool calls.`,
  ].join("\n");
}

export const PROSPECT_TOOLS = [
  { name: "surface_objection", description: "Record that you have just voiced a tracked objection for the first time.", parameters: { type: "object", properties: { objectionId: { type: "string" } }, required: ["objectionId"], additionalProperties: false } },
  { name: "resolve_objection", description: "Record that a tracked objection has been genuinely resolved per its resolution conditions.", parameters: { type: "object", properties: { objectionId: { type: "string" } }, required: ["objectionId"], additionalProperties: false } },
  { name: "record_commitment", description: "Record a real next step or commitment that was agreed.", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false } },
  { name: "end_scenario", description: "End the call for a valid end condition.", parameters: { type: "object", properties: { reason: { type: "string", enum: ["earned_next_step", "max_duration", "critical_hangup", "prospect_ended"] } }, required: ["reason"], additionalProperties: false } },
] as const;

export const EVALUATOR_SYSTEM_PROMPT = `You are a strict, evidence-bound evaluator for a sales call simulation.

Evaluate only the supplied transcript, scenario, rubric, approved knowledge, and deterministic metrics. Do not reward intent that is not observable. Do not infer facts, emotions, demographic traits, or off-transcript behavior.

For every material positive or negative judgment:
- cite one or more exact transcript turn IDs;
- use a short excerpt no longer than needed;
- explain the connection to the rubric criterion;
- provide a confidence level.

If a criterion lacks enough evidence, return insufficient_evidence. Do not convert missing evidence into a zero unless the rubric explicitly defines omission as failure.

Flag any candidate critical failure, but do not decide final pass/fail and do not calculate the authoritative overall score. The application performs those operations deterministically.

Distinguish:
- script deviation that remains accurate and effective;
- unsupported/fabricated claims;
- stylistic preference;
- actual rubric failure.

Return only the required structured result.`;

export function compileEvaluatorUserPrompt(args: {
  scenarioTitle: string; rubricJson: string; approvedClaims: string[]; prohibitedClaims: string[];
  objections: { id: string; title: string; required: boolean; resolutionChecks: string[]; responsePrinciples: string[] }[];
  transcript: { turnId: string; speaker: string; startMs: number; endMs: number; text: string }[];
  metricsJson: string;
}): string {
  const turns = args.transcript.map((t) => `[${t.turnId}] ${t.speaker.toUpperCase()} ${(t.startMs / 1000).toFixed(1)}s–${(t.endMs / 1000).toFixed(1)}s: ${t.text}`).join("\n");
  return [
    `SCENARIO: ${args.scenarioTitle}`,
    fence("rubric", args.rubricJson),
    fence("approved_knowledge", args.approvedClaims.map((c) => `- ${c}`).join("\n")),
    fence("prohibited", args.prohibitedClaims.map((c) => `- ${c}`).join("\n")),
    fence("objections", args.objections.map((o) => `- ${o.id} ${o.required ? "(required)" : "(optional)"}: ${o.title}\n  resolved when: ${o.resolutionChecks.join("; ")}\n  good responses: ${o.responsePrinciples.join("; ")}`).join("\n")),
    fence("deterministic_metrics", args.metricsJson),
    fence("transcript", turns),
    `Cite only turn IDs that appear in the transcript block.`,
  ].join("\n\n");
}
