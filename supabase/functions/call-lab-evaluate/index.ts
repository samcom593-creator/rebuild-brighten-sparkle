// call-lab-evaluate: ends a session (idempotently) and scores it out of 100.
// Four stages: normalize the durable transcript, compute deterministic delivery
// metrics, ask the evaluator for schema-bound evidence, then aggregate gates,
// critical failures and coaching in code. The scorecard is written once; a
// retry returns it unchanged.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { AuthError, requireAuth } from "../_shared/auth.ts";
import { compileSnapshot, loadOwnedSession } from "../_shared/call-lab/session.ts";
import { normalizeTranscript } from "../_shared/call-lab/normalize.ts";
import { computeDeliveryMetrics, type Overlap } from "../_shared/call-lab/metrics.ts";
import { DemoEvaluator, type EvaluatorInput } from "../_shared/call-lab/demo-evaluator.ts";
import { EvaluationResult, evaluationJsonSchema } from "../_shared/call-lab/schema.ts";
import { EVALUATOR_SYSTEM_PROMPT, compileEvaluatorUserPrompt } from "../_shared/call-lab/prompt.ts";
import { aggregate } from "../_shared/call-lab/aggregate.ts";
import type { AudioAggregate, EndReason } from "../_shared/call-lab/types.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { sessionId?: string; reason?: string };
    if (!body.sessionId) return errorResponse("sessionId is required", 400, "invalid_request");
    const svc = auth.serviceClient;
    const s = await loadOwnedSession(svc, auth.userId, body.sessionId);
    if (s.scorecard) return jsonResponse({ ok: true, alreadyScored: true, scorecard: s.scorecard });
    const reason = (body.reason ?? s.end_reason ?? "agent_ended") as EndReason;
    const now = new Date();
    const started = s.started_at ? new Date(s.started_at) : new Date(s.created_at);
    await svc.from("call_lab_sessions").update({ status: "evaluating", ended_at: s.ended_at ?? now.toISOString(), end_reason: reason, duration_ms: s.duration_ms ?? Math.max(0, now.getTime() - started.getTime()), updated_at: now.toISOString() }).eq("id", s.id);

    const { data: evs } = await svc.from("call_lab_events").select("type, at_ms, payload").eq("session_id", s.id).order("at_ms", { ascending: true });
    const events = (evs ?? []) as { type: string; at_ms: number; payload: Record<string, unknown> }[];
    const raw = events.filter((e) => e.type === "transcript.final").map((e, i) => ({ turnId: String(e.payload.turnId), speaker: e.payload.speaker as "agent" | "prospect", text: String(e.payload.text ?? ""), startMs: Number(e.payload.startMs ?? e.at_ms), endMs: Number(e.payload.endMs ?? e.at_ms), isFinal: true, seq: i }));
    const turns = normalizeTranscript(raw);
    const overlaps: Overlap[] = events.filter((e) => e.type === "overlap.detected").map((e) => ({ initiator: e.payload.initiator as "agent" | "prospect", startMs: Number(e.payload.startMs), durationMs: Number(e.payload.durationMs) }));
    const snap = s.scenario_snapshot;
    const compiled = compileSnapshot(s.id, snap);
    const audio = (s.audio ?? {}) as { agent?: AudioAggregate; prospect?: AudioAggregate };
    const durationMs = s.duration_ms ?? (turns.at(-1)?.endMs ?? 0);
    const metrics = computeDeliveryMetrics({ turns, overlaps, audio: { agent: audio.agent ?? null, prospect: audio.prospect ?? null }, benchmarks: snap.rubric.deliveryBenchmarks, durationMs });

    const ledger = new Map<string, { s: string | null; r: string | null }>();
    for (const e of events) {
      if (e.type === "objection.surfaced") { const id = String(e.payload.objectionId); if (!ledger.has(id)) ledger.set(id, { s: String(e.payload.turnId), r: null }); }
      if (e.type === "objection.resolved") { const id = String(e.payload.objectionId); const l = ledger.get(id); if (l && !l.r) l.r = String(e.payload.turnId); }
    }
    const objections = snap.objections.map((o) => ({ id: o.id, key: o.key, title: o.title, required: o.required, resolutionChecks: o.data.resolutionChecks, responsePrinciples: o.data.responsePrinciples, surfacedTurnId: ledger.get(o.id)?.s ?? null, resolvedTurnId: ledger.get(o.id)?.r ?? null }));
    const input: EvaluatorInput = { scenarioTitle: snap.title, rubric: snap.rubric, rubricVersionId: `${s.scenario_id}@v${s.scenario_version}`, approvedClaims: compiled.approvedClaims, prohibited: compiled.prohibitedPatterns, objections, turns, metrics };
    const { result, evaluator } = await evaluate(input);
    const ctx = snap.objections.map((o) => ({ objectionVersionId: o.id, key: o.key, title: o.title, required: o.required, surfacedInLedger: Boolean(ledger.get(o.id)?.s), resolvedInLedger: Boolean(ledger.get(o.id)?.r), example: o.data.example }));
    const agg = aggregate({ rubric: snap.rubric, rubricVersionId: input.rubricVersionId, evaluation: result, turns, metrics, objections: ctx, prohibited: compiled.prohibitedPatterns, endReason: reason });
    const scorecard = {
      overallScore: agg.overallScore, passState: agg.passState, confidence: agg.confidence, verdict: agg.verdict, evidenceCoverage: agg.evidenceCoverage,
      dimensions: agg.dimensions, objectionScores: agg.objectionScores, gates: agg.gates, criticalFailures: agg.criticalFailures, coaching: agg.coaching, coachingItems: agg.coachingItems,
      metrics: { ...metrics, audio: undefined }, evaluator, turns: turns.length, frozen: { scenarioId: s.scenario_id, scenarioVersion: s.scenario_version, rubricVersionId: input.rubricVersionId }, scoredAt: new Date().toISOString(),
    };
    const { error } = await svc.from("call_lab_sessions").update({ scorecard, evaluator, status: "complete", updated_at: new Date().toISOString() }).eq("id", s.id).is("scorecard", null);
    if (error) throw new Error(`scorecard write failed: ${error.message}`);
    return jsonResponse({ ok: true, scorecard });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, "unauthorized");
    const status = (err as { status?: number }).status ?? 500;
    console.error(JSON.stringify({ fn: "call-lab-evaluate", error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
    return errorResponse(status === 500 ? "The evaluation did not complete. Your transcript is safe; retry from the report." : (err as Error).message, status, status === 500 ? "internal" : "refused");
  }
});

async function evaluate(input: EvaluatorInput): Promise<{ result: EvaluationResult; evaluator: string }> {
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY"); const openai = Deno.env.get("OPENAI_API_KEY");
  const user = compileEvaluatorUserPrompt({ scenarioTitle: input.scenarioTitle, rubricJson: JSON.stringify({ rubricVersionId: input.rubricVersionId, dimensions: input.rubric.dimensions, objectionStages: input.rubric.objectionStages, criticalFailureRules: input.rubric.criticalFailureRules }), approvedClaims: input.approvedClaims, prohibitedClaims: input.prohibited.map((p) => p.text), objections: input.objections.map((o) => ({ id: o.id, title: o.title, required: o.required, resolutionChecks: o.resolutionChecks, responsePrinciples: o.responsePrinciples })), transcript: input.turns.map((t) => ({ turnId: t.turnId, speaker: t.speaker, startMs: t.startMs, endMs: t.endMs, text: t.text })), metricsJson: JSON.stringify({ ...input.metrics, audio: undefined }) });
  try {
    if (anthropic && anthropic.length > 20) {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_EVALUATOR_MODEL") ?? "claude-sonnet-5", max_tokens: 8000, system: EVALUATOR_SYSTEM_PROMPT, tools: [{ name: "submit_evaluation", description: "Submit the structured evaluation.", input_schema: evaluationJsonSchema() }], tool_choice: { type: "tool", name: "submit_evaluation" }, messages: [{ role: "user", content: user }] }), signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const j = await r.json() as { content: { type: string; input?: unknown }[] };
      const tool = j.content.find((c) => c.type === "tool_use");
      const parsed = EvaluationResult.safeParse(tool?.input);
      if (parsed.success) return { result: parsed.data, evaluator: "anthropic" };
      throw new Error("anthropic result failed schema");
    }
    if (openai && openai.length > 20) {
      const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openai}`, "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_EVALUATOR_MODEL") ?? "gpt-5.2", instructions: EVALUATOR_SYSTEM_PROMPT, input: user, text: { format: { type: "json_schema", name: "evaluation_result", strict: true, schema: strictify(evaluationJsonSchema()) } } }), signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`openai ${r.status}`);
      const j = await r.json() as { output_text?: string };
      const parsed = EvaluationResult.safeParse(JSON.parse(j.output_text ?? "{}"));
      if (parsed.success) return { result: parsed.data, evaluator: "openai" };
      throw new Error("openai result failed schema");
    }
  } catch (err) {
    console.warn(JSON.stringify({ fn: "call-lab-evaluate", fallback: "demo", error: err instanceof Error ? err.message : String(err) }));
  }
  return { result: await new DemoEvaluator().evaluate(input), evaluator: "demo" };
}
function strictify(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => { if (Array.isArray(node)) return node.map(walk); if (node && typeof node === "object") { const o = { ...(node as Record<string, unknown>) }; if (o.type === "object" && o.properties && typeof o.properties === "object") { o.required = Object.keys(o.properties as Record<string, unknown>); o.additionalProperties = false; } for (const k of Object.keys(o)) o[k] = walk(o[k]); return o; } return node; };
  return walk(schema) as Record<string, unknown>;
}
