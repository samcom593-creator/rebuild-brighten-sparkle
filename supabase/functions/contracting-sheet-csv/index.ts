// contracting-sheet-csv — the live CSV behind the "apex new contracting" Google Sheet.
//
// Sam, 2026-10-14: "every agent that's added should be automatically submitted on this form with all the info there,
// and backtrack with all producing agents." No Google service account or OAuth token exists anywhere Apex can reach,
// so instead of pushing rows into the sheet, the sheet PULLS this feed: cell A1 holds
//   =IMPORTDATA("https://<project>.supabase.co/functions/v1/contracting-sheet-csv?k=<feed key>")
// and Google refreshes it on open and about hourly. Every active agent is a row the moment they exist; producing
// agents sort first. The feed is public by URL on purpose and gated by a 64-hex key held in system_settings
// (contracting_sheet_feed_key): rotate the key, update the formula, and the old URL is dead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function text(body: string, status = 200, type = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return text("GET only", 405);
  // The feed key is the credential. Google's IMPORTDATA can only put it in the URL (?k=); an operator with curl can
  // present it as a bearer instead. Either way it is compared against system_settings and refused before the
  // service-role client does anything.
  const auth = req.headers.get("authorization") ?? "";
  const key = new URL(req.url).searchParams.get("k") ?? auth.replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{64}$/.test(key)) return text("forbidden", 403);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: setting, error: sErr } = await sb.from("system_settings").select("value").eq("key", "contracting_sheet_feed_key").maybeSingle();
  if (sErr) return text("feed key unreadable", 500);
  const expected = String(setting?.value ?? "").replace(/^"|"$/g, "");
  if (!expected || key !== expected) return text("forbidden", 403);
  const { data, error } = await sb.rpc("contracting_sheet_csv");
  if (error) return text(`feed failed: ${error.message}`, 500);
  return text(String(data ?? ""), 200, "text/csv; charset=utf-8");
});
