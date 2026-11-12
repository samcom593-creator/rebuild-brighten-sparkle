// proof-wall (MP-BRAND-ENGINE part 8). Public, read-only feed for the proof section on sell4daddy.com.
// Returns only what public_proof_wall() selects: first name + last initial, the plaque label, its month,
// and the production amount on dollar plaques, and only for agents whose proof_wall_consent is true.
// No ids, no contact details, nothing writable. verify_jwt=false: the site has no session.
const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "GET only" }), { status: 405, headers: { ...cors, "content-type": "application/json" } });
  const r = await fetch(SB + "/rest/v1/rpc/public_proof_wall", {
    method: "POST",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 8 }),
  });
  if (!r.ok) return new Response(JSON.stringify({ error: "read failed", status: r.status }), { status: 502, headers: { ...cors, "content-type": "application/json" } });
  const rows = (await r.json()) as { who: string; label: string; month: string; production: number | null }[];
  const wins = Array.isArray(rows) ? rows.map((w) => ({ who: w.who, label: w.label, month: w.month, production: w.production })) : [];
  return new Response(JSON.stringify({ wins }), { headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=300" } });
});
