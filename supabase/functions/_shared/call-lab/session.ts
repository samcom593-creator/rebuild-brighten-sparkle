import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { CompiledScenario } from "./brain.ts";
import type { ObjectionData, PersonaData, RubricData, ScenarioData } from "./types.ts";

/** The frozen snapshot every session carries; compiled once per request. */
export type Snapshot = {
  title: string; data: ScenarioData; persona: PersonaData & { name: string };
  objections: { id: string; key: string; required: boolean; title: string; data: ObjectionData }[];
  rubric: RubricData; claims: { approved: { text: string }[]; prohibited: { text: string; patterns: string[]; severity: string }[] };
};

export type SessionRow = {
  id: string; user_id: string; scenario_id: string; scenario_version: number; scenario_snapshot: Snapshot; mode: string; provider: string; tts: string;
  focus_objection_id: string | null; status: string; brain_state: Record<string, unknown> | null; audio: Record<string, unknown> | null;
  started_at: string | null; ended_at: string | null; end_reason: string | null; duration_ms: number | null; scorecard: Record<string, unknown> | null; created_at: string;
};

export async function loadOwnedSession(service: SupabaseClient, userId: string, sessionId: string): Promise<SessionRow> {
  const { data, error } = await service.from("call_lab_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(`session read failed: ${error.message}`);
  if (!data) throw Object.assign(new Error("Session not found"), { status: 404 });
  const row = data as SessionRow;
  if (row.user_id !== userId) {
    const { data: staff } = await service.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!staff) throw Object.assign(new Error("Not your session"), { status: 403 });
  }
  return row;
}

export function compileSnapshot(sessionId: string, snap: Snapshot): CompiledScenario {
  return {
    scenarioVersionId: sessionId,
    scenario: snap.data,
    persona: snap.persona,
    objections: snap.objections.map((o) => ({ id: o.id, key: o.key, data: o.data, required: o.required })),
    approvedClaims: snap.claims.approved.map((c) => c.text),
    prohibitedPatterns: snap.claims.prohibited.map((p) => ({ text: p.text, patterns: p.patterns, severity: p.severity })),
    scriptSections: [],
  };
}

export const objectionTitle = (o: { title?: string; key: string }) => o.title ?? o.key;
