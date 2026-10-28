// social-lead-csv — the two call lists behind /dashboard/social-command, as CSV for ReadyMode's importer.
//
// Sam, 2026-10-28: "find as many leads for ReadyMode from old applications as possible, bring back as many agents
// as possible." The lists are live views (v_readymode_lead_pool, v_agent_winback_pool); social_lead_csv() renders
// them. Same contract as contracting-sheet-csv: public by URL on purpose (a download link on the page), gated by a
// 64-hex feed key held in system_settings (social_lead_feed_key) and compared before the service-role client does
// anything. Rotate the key and the old links are dead; the page reads the new one on its next load.
//   GET /social-lead-csv?list=readymode&k=<feed key>
//   GET /social-lead-csv?list=winback&k=<feed key>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function text(body: string, status = 200, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": "no-store", ...extra } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return text("GET only", 405);
  const url = new URL(req.url);
  const list = url.searchParams.get("list") ?? "";
  if (list !== "readymode" && list !== "winback") return text("list must be readymode or winback", 400);
  const auth = req.headers.get("authorization") ?? "";
  const key = url.searchParams.get("k") ?? auth.replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(key)) return text("forbidden", 403);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: setting, error: sErr } = await sb.from("system_settings").select("value").eq("key", "social_lead_feed_key").maybeSingle();
  if (sErr) return text("feed key unreadable", 500);
  const expected = String(setting?.value ?? "").replace(/^"|"$/g, "");
  if (!expected || key !== expected) return text("forbidden", 403);
  const { data, error } = await sb.rpc("social_lead_csv", { p_list: list });
  if (error) return text(`list failed: ${error.message}`, 500);
  const day = new Date().toISOString().slice(0, 10);
  return text(String(data ?? ""), 200, "text/csv; charset=utf-8", { "content-disposition": `attachment; filename="${list}-${day}.csv"` });
});
