// call-lab-turn: one prospect turn for a live Call Lab session. The browser
// sends what the agent said; the server's prospect brain answers in character
// and returns tool-like hints (objection surfaced/resolved, commitment, end).
// Brain state and the frozen scenario live on the session row.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { AuthError, requireAuth } from "../_shared/auth.ts";
import { RulesBrain, initialBrainState, seedFromString, type BrainState } from "../_shared/call-lab/brain.ts";
import { compileProspectPrompt, PROSPECT_TOOLS } from "../_shared/call-lab/prompt.ts";
import { compileSnapshot, loadOwnedSession } from "../_shared/call-lab/session.ts";

type Body = { sessionId?: string; turnId?: string; text?: string; elapsedMs?: number };

/** A key that answers 401/403 is skipped for 15 minutes so a dead key cannot add a wasted round trip to every turn. */
let llmDown: { kind: "anthropic" | "openai"; until: number } | null = null;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionId = String(body.sessionId ?? ""); const turnId = String(body.turnId ?? ""); const text = String(body.text ?? "").trim().slice(0, 4000);
    if (!sessionId || !turnId || !text) return errorResponse("sessionId, turnId and text are required", 400, "invalid_request");
    const s = await loadOwnedSession(auth.serviceClient, auth.userId, sessionId);
    if (!["created", "live"].includes(s.status)) return errorResponse("Session is not live", 409, "session_closed");
    const compiled = compileSnapshot(s.id, s.scenario_snapshot);
    const { data: evs } = await auth.serviceClient.from("call_lab_events").select("payload").eq("session_id", s.id).eq("type", "transcript.final").order("at_ms", { ascending: true });
    const transcript = ((evs ?? []) as { payload: { turnId: string; speaker: "agent" | "prospect"; text: string } }[]).map((e) => ({ turnId: e.payload.turnId, speaker: e.payload.speaker, text: e.payload.text }));
    if (!transcript.some((t) => t.turnId === turnId)) transcript.push({ turnId, speaker: "agent", text });
    const state = (s.brain_state as BrainState | null) ?? { ...initialBrainState(seedFromString(s.id)), focus: s.focus_objection_id };
    const brain = await pickBrain();
    const out: Awaited<ReturnType<RulesBrain["nextTurn"]>> & { brain?: string } = await brain.nextTurn({ scenario: compiled, transcript, latest: { turnId, text }, state, elapsedMs: Number(body.elapsedMs ?? 0) });
    await auth.serviceClient.from("call_lab_sessions").update({ brain_state: out.state, status: "live", started_at: s.started_at ?? new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", s.id);
    // Report the brain that actually answered: an LLM brain that fell back to rules must say "rules".
    return jsonResponse({ turnId: `pt_${crypto.randomUUID().slice(0, 8)}`, text: out.text, events: out.events, interrupt: Boolean(out.interrupt), brain: out.brain ?? brain.kind });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, "unauthorized");
    const status = (err as { status?: number }).status ?? 500;
    console.error(JSON.stringify({ fn: "call-lab-turn", error: err instanceof Error ? err.message.slice(0, 200) : String(err) }));
    return errorResponse(status === 500 ? "The prospect could not answer. Nothing you said was lost." : (err as Error).message, status, status === 500 ? "internal" : "refused");
  }
});

/** LLM brains use the same contract when a working key is present; otherwise the deterministic engine answers. */
async function pickBrain() {
  const anthropic = Deno.env.get("ANTHROPIC_API_KEY"); const openai = Deno.env.get("OPENAI_API_KEY");
  const down = (k: "anthropic" | "openai") => llmDown?.kind === k && llmDown.until > Date.now();
  if (anthropic && anthropic.length > 20 && !down("anthropic")) return { kind: "anthropic", nextTurn: (i: Parameters<RulesBrain["nextTurn"]>[0]) => llmTurn("anthropic", anthropic, i) };
  if (openai && openai.length > 20 && !down("openai")) return { kind: "openai", nextTurn: (i: Parameters<RulesBrain["nextTurn"]>[0]) => llmTurn("openai", openai, i) };
  return new RulesBrain();
}

async function llmTurn(kind: "anthropic" | "openai", key: string, input: Parameters<RulesBrain["nextTurn"]>[0]): Promise<Awaited<ReturnType<RulesBrain["nextTurn"]>> & { brain: "anthropic" | "openai" | "rules" }> {
  const system = compileProspectPrompt(input.scenario);
  const msgs = input.transcript.map((t) => ({ role: t.speaker === "agent" ? "user" : "assistant", content: t.text }));
  if (!msgs.length || msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(The trainee has just dialed. Answer the phone in character.)" });
  const fallback = new RulesBrain();
  try {
    if (kind === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_PROSPECT_MODEL") ?? "claude-sonnet-5", max_tokens: 300, system, tools: PROSPECT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })), messages: merge(msgs) }), signal: AbortSignal.timeout(25_000) });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const j = await r.json() as { content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
      const text = j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ").trim();
      const events = toolEvents(j.content.filter((c) => c.type === "tool_use").map((c) => ({ name: c.name ?? "", input: c.input ?? {} })));
      return { text: text || "Go on.", events, brain: "anthropic", state: { ...input.state, agentTurns: input.state.agentTurns + 1, phase: events.some((e) => e.tool === "end_scenario") ? "ended" : input.state.phase } };
    }
    const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_PROSPECT_MODEL") ?? "gpt-5.2", instructions: system, input: msgs, tools: PROSPECT_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })), max_output_tokens: 300 }), signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const j = await r.json() as { output_text?: string; output: { type: string; name?: string; arguments?: string }[] };
    const events = toolEvents(j.output.filter((o) => o.type === "function_call").map((o) => { let input: Record<string, unknown> = {}; try { input = JSON.parse(o.arguments ?? "{}"); } catch { /* empty-catch-allow:malformed-tool-arguments-from-the-model-are (malformed tool arguments from the model are treated as no arguments; the rules brain still runs) */ } return { name: o.name ?? "", input }; }));
    return { text: (j.output_text ?? "").trim() || "Go on.", events, brain: "openai", state: { ...input.state, agentTurns: input.state.agentTurns + 1, phase: events.some((e) => e.tool === "end_scenario") ? "ended" : input.state.phase } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b(401|403)\b/.test(msg)) llmDown = { kind, until: Date.now() + 15 * 60_000 };
    console.warn(JSON.stringify({ fn: "call-lab-turn", brain: kind, fallback: "rules", error: msg }));
    return { ...(await fallback.nextTurn(input)), brain: "rules" };
  }
}
function merge(msgs: { role: string; content: string }[]) { const out: { role: string; content: string }[] = []; for (const m of msgs) { const l = out[out.length - 1]; if (l && l.role === m.role) l.content += `\n${m.content}`; else out.push({ ...m }); } return out; }
function toolEvents(calls: { name: string; input: Record<string, unknown> }[]) {
  const out: ReturnType<RulesBrain["nextTurn"]> extends Promise<infer R> ? (R extends { events: infer E } ? E : never) : never = [] as never;
  for (const c of calls) {
    if (c.name === "surface_objection" && typeof c.input.objectionId === "string") out.push({ tool: "surface_objection", objectionId: c.input.objectionId });
    else if (c.name === "resolve_objection" && typeof c.input.objectionId === "string") out.push({ tool: "resolve_objection", objectionId: c.input.objectionId });
    else if (c.name === "record_commitment" && typeof c.input.summary === "string") out.push({ tool: "record_commitment", summary: c.input.summary });
    else if (c.name === "end_scenario" && typeof c.input.reason === "string") out.push({ tool: "end_scenario", reason: c.input.reason as "earned_next_step" });
  }
  return out;
}
