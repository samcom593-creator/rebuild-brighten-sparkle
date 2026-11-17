// contracting-nudge-sweep — the MGN contracting nudge lane (MP-CONTRACTING-MGN-LINK, Sam 2026-11-17:
// "implement all three ROI moves at the absolute highest level possible to maximize conversions").
//
// Population: licensed, active agents with NO appointment evidence — contracted_at null, first_deal_at
// null, zero deals rows — a deliverable profile email and no bounce on record. Measured 2026-11-17 the
// pool was 28 agents. Each gets the contracting-profile email (MGN hub first, five-field profile second),
// the same wording the vitest contract pins, with their own mgn_link when the team has set one.
//
// Throttle, by design, not by accident:
//   - at most `limit` sends per run (default 5, hard cap 20) — the BoB canary precedent;
//   - never the same agent twice within 14 days;
//   - never more than 2 nudges per agent, ever. After two unanswered emails this lane stops and the
//     agent belongs to the call list, where a human decides.
// Receipts: one email_delivery_log row per send, template='contracting_nudge' — the same table the
// dedupe reads, so a logged send IS the throttle (no second bookkeeping that can drift).
//
// Callers: pg_cron daily (Authorization: Bearer <apex_bot_token vault secret>), the service role, or an
// operator. Body: { dry_run?: boolean, limit?: number }. dry_run returns the planned recipients and
// sends nothing. Every response lists per-agent outcomes — no blanket success over partial failure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { gateResend } from "../_shared/resend-gate.ts";
import { BRAND_FROM, BRAND_REPLY_TO } from "../_shared/email.ts";
import {
  CONTRACTING_PROFILE_SUBJECT,
  MGN_CONTRACTING_URL,
  contractingProfileEmailHtml,
  contractingProfileEmailText,
} from "../_shared/contracting-profile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function tokenMatches(presented: string, expected: string): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const COOLDOWN_DAYS = 14;
const MAX_NUDGES_PER_AGENT = 2;
const DEFAULT_LIMIT = 5;
const HARD_CAP = 20;

type Candidate = {
  id: string;
  display_name: string | null;
  mgn_link: string | null;
  profile: { email: string | null; full_name: string | null } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const presented = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const botToken = (Deno.env.get("APEX_BOT_TOKEN") ?? "").trim();
  if (!tokenMatches(presented, SERVICE_ROLE) && !tokenMatches(presented, botToken)) {
    return json({ error: "unauthorized" }, 401);
  }

  let dryRun = false;
  let limit = DEFAULT_LIMIT;
  try {
    const body = await req.json();
    dryRun = Boolean(body?.dry_run);
    if (Number.isFinite(body?.limit)) limit = Math.max(0, Math.min(HARD_CAP, Number(body.limit)));
  } catch { // empty-catch-allow:no-body-means-defaults — a cron POST with no body runs the default live sweep.
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const { data: agents, error: agentsError } = await supabase
      .from("agents")
      .select("id, display_name, mgn_link, is_deactivated, is_inactive, status, profile:profiles!agents_profile_id_fkey(email, full_name)")
      .eq("license_status", "licensed")
      .is("contracted_at", null)
      .is("first_deal_at", null)
      .is("email_bounced_at", null);
    if (agentsError) throw agentsError;

    const live = (agents ?? []).filter((a: Record<string, unknown>) =>
      !a.is_deactivated && !a.is_inactive && !["inactive", "terminated"].includes(String(a.status ?? "")),
    ) as unknown as Candidate[];
    const withEmail = live.filter((a) => a.profile?.email?.trim());

    const ids = withEmail.map((a) => a.id);
    if (ids.length === 0) return json({ ok: true, dry_run: dryRun, planned: [], sent: [], skipped: "pool empty" });

    // Appointment evidence beyond the stamps: any deals row disqualifies.
    const { data: dealRows, error: dealsError } = await supabase
      .from("deals").select("agent_id").in("agent_id", ids);
    if (dealsError) throw dealsError;
    const hasDeals = new Set((dealRows ?? []).map((d: { agent_id: string }) => d.agent_id));

    // The throttle reads the receipts: template='contracting_nudge' rows, keyed by BOTH the agent id
    // and the recipient address. Keying on the id alone would let a duplicate agent pair (one person,
    // two rows — the known identity-dupes class; the first dry run surfaced one) collect one nudge per
    // row. The address is the person; it gets the same quota however many rows point at it.
    const emails = withEmail.map((a) => a.profile!.email!.trim().toLowerCase());
    const [byAgent, byEmail] = await Promise.all([
      supabase.from("email_delivery_log").select("agent_id, recipient_email, sent_at").eq("template", "contracting_nudge").in("agent_id", ids),
      supabase.from("email_delivery_log").select("agent_id, recipient_email, sent_at").eq("template", "contracting_nudge").in("recipient_email", emails),
    ]);
    if (byAgent.error) throw byAgent.error;
    if (byEmail.error) throw byEmail.error;
    const counts = new Map<string, { total: number; last: number }>();
    const bump = (key: string, at: number) => {
      const prev = counts.get(key) ?? { total: 0, last: 0 };
      counts.set(key, { total: prev.total + 1, last: Math.max(prev.last, at) });
    };
    const seenLogRow = new Set<string>();
    for (const row of [...(byAgent.data ?? []), ...(byEmail.data ?? [])] as Array<{ agent_id: string | null; recipient_email: string | null; sent_at: string | null }>) {
      const rowKey = `${row.agent_id}|${row.recipient_email}|${row.sent_at}`;
      if (seenLogRow.has(rowKey)) continue; // the two queries overlap on well-formed rows
      seenLogRow.add(rowKey);
      const at = row.sent_at ? new Date(row.sent_at).getTime() : 0;
      if (row.agent_id) bump(row.agent_id, at);
      if (row.recipient_email) bump(`email:${row.recipient_email.trim().toLowerCase()}`, at);
    }
    const cooldownMs = COOLDOWN_DAYS * 86_400_000;
    const now = Date.now();

    const underQuota = (key: string) => {
      const c = counts.get(key);
      return !c || (c.total < MAX_NUDGES_PER_AGENT && now - c.last > cooldownMs);
    };
    const plannedEmails = new Set<string>(); // one person, one nudge per run, however many agent rows they hold
    const eligible = withEmail.filter((a) => {
      if (hasDeals.has(a.id)) return false;
      const email = a.profile!.email!.trim().toLowerCase();
      if (plannedEmails.has(email)) return false;
      if (!underQuota(a.id) || !underQuota(`email:${email}`)) return false;
      plannedEmails.add(email);
      return true;
    }).slice(0, limit);

    const planned = eligible.map((a) => ({
      agent_id: a.id,
      name: a.profile?.full_name ?? a.display_name ?? "(unnamed)",
      mgn_link: a.mgn_link?.trim() || MGN_CONTRACTING_URL,
    }));
    if (dryRun) return json({ ok: true, dry_run: true, pool: withEmail.length, planned });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY missing" }, 500);
    const resend = gateResend(new Resend(resendKey));

    const sent: Array<{ agent_id: string; ok: boolean; id?: string; error?: string }> = [];
    for (const a of eligible) {
      const email = a.profile!.email!.trim();
      const first = (a.profile?.full_name ?? a.display_name ?? "").trim().split(/\s+/)[0] ?? "";
      const mgnLink = a.mgn_link?.trim() || MGN_CONTRACTING_URL;
      const { data, error } = await resend.emails.send({
        from: BRAND_FROM,
        reply_to: BRAND_REPLY_TO,
        to: [email],
        subject: CONTRACTING_PROFILE_SUBJECT,
        text: contractingProfileEmailText(first, undefined, mgnLink),
        html: contractingProfileEmailHtml(first, undefined, mgnLink),
      });
      if (error || !data?.id) {
        sent.push({ agent_id: a.id, ok: false, error: String((error as { message?: string })?.message ?? error ?? "no id") });
        continue; // no receipt row: an unsent nudge must not consume the agent's quota
      }
      const { error: logInsertError } = await supabase.from("email_delivery_log").insert({
        template: "contracting_nudge",
        recipient_email: email,
        agent_id: a.id,
        subject: CONTRACTING_PROFILE_SUBJECT,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      // A sent email whose receipt failed to write is the one state that can double-send later; say it loudly.
      sent.push({ agent_id: a.id, ok: true, id: data.id, error: logInsertError ? `receipt write failed: ${logInsertError.message}` : undefined });
    }

    return json({ ok: sent.every((s) => s.ok), dry_run: false, pool: withEmail.length, planned, sent });
  } catch (e) {
    console.error("[contracting-nudge-sweep]", e);
    return json({ error: (e as Error)?.message ?? "internal error" }, 500);
  }
});
