// submit-licensing-milestone (WP2, onboarding audit 2026-11-10)
//
// Anon, application_id-gated self-report from /status/:id: "I booked my exam" (+date),
// "I passed", "My NPN". verify_jwt = false in supabase/config.toml (same design and
// rationale as submit-licensing-proof). All request logic lives in ./logic.ts so it is
// tested offline (logic.test.ts); this file only wires the service-role client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { handleMilestone, type MilestoneDeps } from "./logic.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const deps: MilestoneDeps = {
  async findApplication(id) {
    const { data, error } = await supabase
      .from("applications").select("id, license_status").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as { id: string; license_status: string | null } | null) ?? null;
  },
  async recentReports(id) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("licensing_self_reports").select("kind, created_at")
      .eq("application_id", id).gte("created_at", since).limit(50);
    if (error) throw error;
    return (data as Array<{ kind: string; created_at: string }> | null) ?? [];
  },
  async insertReport(input) {
    const { data, error } = await supabase
      .from("licensing_self_reports")
      .insert({ application_id: input.applicationId, kind: input.kind, exam_date: input.examDate, npn: input.npn })
      .select("applied")
      .single();
    if (error) throw error;
    return { applied: (data as { applied: unknown } | null)?.applied ?? null };
  },
  now: () => new Date(),
};

Deno.serve((req) => handleMilestone(req, deps));
