// InsuraCloud outbox processor
// Pushes deals to InsuraCloud /policies endpoint and marks them as synced.
// Modes:
//   - { deal_id: "..." }  → process one deal (called from trigger)
//   - { sweep: true }      → process all unsynced deals (called from cron)
//
// Failure modes are saved to deals.insuracloud_sync_error so admins can
// fix the underlying mapping and the cron sweeper will retry automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const INSURACLOUD_BASE = Deno.env.get("INSURACLOUD_BASE_URL") || "https://agentlink.insuracloud.ai";
const SWEEP_BATCH_SIZE = 25;

interface OutboxRequest {
  deal_id?: string;
  sweep?: boolean;
}

type DealRow = {
  id: string;
  agent_id: string;
  carrier_id: string | null;
  client_first_name: string;
  client_last_name: string;
  client_phone: string;
  client_dob: string;
  product_sold: string;
  policy_number: string;
  monthly_premium: number;
  annual_premium: number;
  face_amount: number;
  effective_date: string;
  policy_expiration_date: string | null;
  status: string;
  notes: string | null;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const defaultToken = Deno.env.get("INSURACLOUD_API_TOKEN");

async function pushOne(deal: DealRow): Promise<{ ok: boolean; error?: string; insuracloud_id?: number | string }> {
  // redeploy: trigger refresh for cd05deb session-cookie support
  // Resolve agent → InsuraCloud user id + token
  const { data: agent } = await supabase
    .from("agents")
    .select("insuracloud_api_token, insuracloud_user_id, display_name, profile_id, profiles:profile_id(email, full_name)")
    .eq("id", deal.agent_id)
    .maybeSingle();

  if (!agent) return { ok: false, error: "Agent record not found" };

  // ATTRIBUTION GUARD (2026-08-11).
  //
  // `agent.insuracloud_api_token || defaultToken` was the misattribution bug.
  // InsuraCloud's POST /api/deals payload carries no producer field — carrierId,
  // client details, policy number, premiums, externalId, and nothing else — so
  // the deal is credited to WHOEVER'S SESSION POSTS IT. The default token is
  // Sam's harvested connect.sid.
  //
  // Measured on the live queue: of the 3 push-eligible deals, 2 are Kolade
  // Ayedun's (insuracloud_user_id 792) and neither he nor Sam has a per-agent
  // token. Under the old line both would have posted as Sam (user 211),
  // crediting him with another producer's $1,531.68 inside agentlink_book —
  // the table commissions and every leaderboard are computed from.
  //
  // That never fired only because the stored credential is an unusable al_ API
  // key. An accident is not a safety property: the moment anyone "fixes the
  // auth" — which the open backlog explicitly asked the next worker to do — the
  // fallback silently starts misattributing other people's business.
  //
  // So the fallback is now scoped to its owner. A deal belonging to any other
  // producer needs that producer's own token and fails loudly until it has one.
  // INSURACLOUD_DEFAULT_TOKEN_AGENT_ID names the agent the shared token
  // actually belongs to; unset means the shared token is used for nobody.
  const defaultTokenOwnerId = Deno.env.get("INSURACLOUD_DEFAULT_TOKEN_AGENT_ID") ?? "";
  const ownToken = agent.insuracloud_api_token;
  const mayUseDefault = defaultTokenOwnerId !== "" && deal.agent_id === defaultTokenOwnerId;
  const token = ownToken || (mayUseDefault ? defaultToken : null);

  if (!token) {
    // Fall back through BOTH name sources before surrendering to the raw uuid.
    // profiles.full_name is null for Sam's own agent row, so on 2026-08-12 the
    // stored error for his deal read "No InsuraCloud credential exists anywhere
    // for cde14d07-2366-444a-80cc-58a8f7da6f95" while Kolade's read as a name.
    // That cost a reviewer real time: a uuid reads as a system id, so the row
    // looked like a foreign producer's deal that must never be pushed, when in
    // fact it is the one deal here the shared session could legitimately post.
    // agents.display_name is populated for both of them.
    const who = (agent as { profiles?: { full_name?: string } })?.profiles?.full_name
      ?? (agent as { display_name?: string })?.display_name
      ?? deal.agent_id;
    // Name the ACTUAL blocker. Three different states used to collapse into one
    // sentence, and this integration has already lost four months to an error
    // string that named the wrong fix: 1,058 deals said "No InsuraCloud API
    // token configured" while the real problem was that the only token anyone
    // had was a read-only al_ API key. A diagnostic that points at the wrong
    // repair is worse than no diagnostic, because someone acts on it.
    let error: string;
    if (!defaultToken && !ownToken) {
      error =
        `No InsuraCloud credential exists anywhere for ${who}: the agent has no insuracloud_api_token and the INSURACLOUD_API_TOKEN secret is unset. Note a connect.sid session is required — an al_ API key cannot POST deals (that endpoint is read-only).`;
    } else if (!mayUseDefault) {
      error =
        `Refusing to push: ${who} has no InsuraCloud token of their own, and the shared session belongs to a different producer. POST /api/deals carries no producer field, so this would credit the deal to whoever's session posts it and corrupt attribution in agentlink_book. Harvest a per-agent token, or set INSURACLOUD_DEFAULT_TOKEN_AGENT_ID if the shared session genuinely belongs to this agent.`;
    } else {
      error = "No InsuraCloud API token configured";
    }
    return { ok: false, error };
  }

  // Resolve carrier
  let insuracloudCarrierId: number | null = null;
  if (deal.carrier_id) {
    const { data: carrier } = await supabase
      .from("carriers")
      .select("name, insuracloud_carrier_id")
      .eq("id", deal.carrier_id)
      .maybeSingle();
    if (!carrier) return { ok: false, error: "Carrier record not found" };
    insuracloudCarrierId = carrier.insuracloud_carrier_id;
    if (insuracloudCarrierId === null) {
      return { ok: false, error: `Carrier "${carrier.name}" has no insuracloud_carrier_id mapping` };
    }
  } else {
    return { ok: false, error: "Deal has no carrier" };
  }

  // Build payload for InsuraCloud's POST /api/deals endpoint. Numbers must
  // be actual numbers (the schema rejects stringified decimals).
  const dealPayload = {
    carrierId: insuracloudCarrierId,
    clientFirstName: deal.client_first_name,
    clientLastName: deal.client_last_name,
    clientPhoneNumber: deal.client_phone,
    clientDateOfBirth: deal.client_dob,
    productSold: deal.product_sold,
    policyNumber: deal.policy_number,
    monthlyPremium: Number(deal.monthly_premium),
    annualPremium: Number(deal.annual_premium),
    faceAmount: Number(deal.face_amount),
    effectiveDate: deal.effective_date,
    externalId: deal.id,
    externalSource: "apex-financial",
    notes: deal.notes ?? undefined,
  };

  // InsuraCloud has no stateless API-key POST path for deals — the public
  // /api/v1/book-of-business endpoint is read-only, and /api/deals requires
  // an authenticated session + CSRF token. We treat the stored token as
  // either:
  //   • an al_* API key (used as a Bearer, tried first for future-proofing), or
  //   • a connect.sid session cookie value, in which case we fetch a CSRF
  //     token against that session and POST /api/deals with both.
  const isApiKey = token.startsWith("al_");

  try {
    if (isApiKey) {
      // Best-effort api-key attempt — returns 403 today because of CSRF, but
      // leaves the door open if InsuraCloud ships a stateless endpoint later.
      const res = await fetch(`${INSURACLOUD_BASE}/api/v1/book-of-business`, {
        method: "POST",
        headers: {
          "x-api-key": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ deals: [dealPayload] }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        return { ok: true, insuracloud_id: data?.deals?.[0]?.id };
      }
      const text = await res.text();
      return { ok: false, error: `InsuraCloud api-key ${res.status}: ${text.slice(0, 300)}` };
    }

    // Session-cookie flow: grab a CSRF token on the same session, then POST.
    const csrfRes = await fetch(`${INSURACLOUD_BASE}/api/csrf-token`, {
      headers: { Cookie: `connect.sid=${token}` },
    });
    if (!csrfRes.ok) {
      return { ok: false, error: `csrf-token fetch ${csrfRes.status}` };
    }
    const { csrfToken } = await csrfRes.json() as { csrfToken: string };

    const res = await fetch(`${INSURACLOUD_BASE}/api/deals`, {
      method: "POST",
      headers: {
        Cookie: `connect.sid=${token}`,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(dealPayload),
    });

    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      return { ok: false, error: `InsuraCloud ${res.status}: ${text.slice(0, 400)}` };
    }

    return { ok: true, insuracloud_id: data?.id ?? data?.policy_id };
  } catch (e: any) {
    return { ok: false, error: `Network error: ${e?.message ?? String(e)}` };
  }
}

// MP-312 (2026-08-20): THE RETURN VALUE NOW SAYS WHICH THING HAPPENED.
//
// Four different events used to return `{ ok: true }`: a real push, an
// already-synced no-op, a draft skip, and a GUARD REFUSAL. The caller could not
// tell them apart, so a deal the guard refused was indistinguishable from a deal
// that reached InsuraCloud. That is the same shape as the 465 fake-success
// InsuraCloud sync rows and the 198 AgentLink zombie rows: the row says success
// and no write happened.
//
// `ok` deliberately stays TRUE on a refusal. It is not an error — the function
// did exactly its job. Flipping it to false would make apex-outbox-dispatcher's
// callFunction() throw, which routes a PLACEHOLDER-<uuid> policy into the retry
// ladder forever and pages about a row whose remedy is nothing. That is the
// alert-storm disease (1,221 undelivered insuracloud_sync_error alerts) traded
// for the silence disease. The truth goes in `outcome`, which every caller
// branches on explicitly.
export type OutboxOutcome =
  | "pushed"
  | "already_synced"
  | "skipped_draft"
  | "not_a_candidate"
  | "refused"
  | "failed";

export type ProcessResult = {
  deal_id: string;
  ok: boolean;
  outcome: OutboxOutcome;
  error?: string;
  refused_reason?: string;
};

async function processDeal(dealId: string): Promise<ProcessResult> {
  const { data: deal, error } = await supabase
    .from("deals")
    .select(
      "id, agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob, product_sold, policy_number, monthly_premium, annual_premium, face_amount, effective_date, policy_expiration_date, status, notes, synced_to_insuracloud_at",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (error || !deal) {
    return { deal_id: dealId, ok: false, outcome: "failed", error: error?.message ?? "Deal not found" };
  }
  if (deal.synced_to_insuracloud_at) {
    return { deal_id: dealId, ok: true, outcome: "already_synced" };
  }
  if (deal.status === "draft") {
    return { deal_id: dealId, ok: true, outcome: "skipped_draft" };
  }

  // wave-outbox-direction 2026-08-11: the sweep now reads the eligibility view,
  // but processDeal is also reachable directly by deal_id from the autopush
  // trigger and from a manual retry in AutomationHub. Re-check here so no
  // caller can route an imported or already-present policy to pushOne(). The
  // trigger carries the same rule, so this is the second of two locks, not the
  // only one.
  //
  // MP-312: this reads v_insuracloud_push_verdict, the SINGLE source MP-311
  // shipped, rather than the v_insuracloud_push_eligible projection. Reading the
  // projection told us only "absent", which collapses "the guard refused this"
  // and "this was never a candidate" into one silent branch. The verdict view
  // carries the reason, so the refusal can name itself. One rule, one read.
  const { data: verdict } = await supabase
    .from("v_insuracloud_push_verdict")
    .select("push_verdict")
    .eq("id", dealId)
    .maybeSingle();

  if (!verdict) {
    // Not in the candidate set at all — an agent_link import, or a row already
    // present in agentlink_book. Never pushed, and correctly so.
    return { deal_id: dealId, ok: true, outcome: "not_a_candidate" };
  }

  const pushVerdict = (verdict as { push_verdict?: string }).push_verdict ?? "unknown";
  if (pushVerdict !== "eligible") {
    return { deal_id: dealId, ok: true, outcome: "refused", refused_reason: pushVerdict };
  }

  const result = await pushOne(deal as DealRow);

  if (result.ok) {
    await supabase
      .from("deals")
      .update({
        synced_to_insuracloud_at: new Date().toISOString(),
        insuracloud_sync_error: null,
      })
      .eq("id", deal.id);
    return { deal_id: deal.id, ok: true, outcome: "pushed" };
  }

  await supabase
    .from("deals")
    .update({ insuracloud_sync_error: result.error?.slice(0, 500) ?? "Unknown error" })
    .eq("id", deal.id);

  return { deal_id: deal.id, ok: false, outcome: "failed", error: result.error };
}

type SweepSummary = {
  processed: number;
  succeeded: number;
  failed: number;
  refused: number;
  skipped: number;
};

async function sweepUnsynced(): Promise<SweepSummary> {
  // wave-outbox-direction 2026-08-11: this used to select `deals` directly on
  // (synced_to_insuracloud_at IS NULL AND status <> 'draft') with no dedupe,
  // which described 1,759 rows. 1,749 of them are source='agent_link' — they
  // came FROM InsuraCloud via agentlink_book — and 1,667 carry a policy number
  // the destination is already holding. The only thing standing between that
  // query and 1,667 duplicate policies in the book Sam's commissions are
  // computed from was the stored token being an unusable al_ api-key. The
  // session-cookie branch below works today (verified live against
  // /api/csrf-token and /api/deals), so that accident is not a safety net.
  // v_insuracloud_push_eligible applies both rules live. Measured at cutover:
  // 1,759 -> 10 eligible, $9,104.04 AP.
  //
  // MP-312 re-measured the handed-forward claim that this loop "counts refused
  // rows as succeeded". It does not, and could not: its input IS the eligible
  // projection, so a refused row is structurally absent (verified live — the
  // eligible and refused sets have 0 overlap). The counters were honest here.
  // The lie lived on the deal_id path, which the trigger, the dispatcher and
  // DealEntryForm all use. `refused`/`skipped` are still counted separately
  // because processDeal re-checks the verdict, so a row whose eligibility
  // changes between this SELECT and that re-check lands in one of them — and a
  // bucket that exists is how you find out that race is real.
  const { data: deals } = await supabase
    .from("v_insuracloud_push_eligible")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(SWEEP_BATCH_SIZE);

  const ids = (deals ?? []).map((d) => d.id);
  let succeeded = 0, failed = 0, refused = 0, skipped = 0;

  for (const id of ids) {
    const r = await processDeal(id);
    if (r.outcome === "pushed") succeeded++;
    else if (r.outcome === "failed") failed++;
    else if (r.outcome === "refused") refused++;
    else skipped++;
  }

  // Session keepalive: InsuraCloud's connect.sid rolls on every request.
  // If no deals synced this tick, ping csrf-token for each stored cookie so
  // the session doesn't quietly expire after 7 days of no-new-deals.
  if (ids.length === 0) {
    const { data: agents } = await supabase
      .from("agents")
      .select("insuracloud_api_token")
      .not("insuracloud_api_token", "is", null);
    for (const a of agents ?? []) {
      const tok = (a as any).insuracloud_api_token as string;
      if (!tok || tok.startsWith("al_")) continue;
      fetch(`${INSURACLOUD_BASE}/api/csrf-token`, {
        headers: { Cookie: `connect.sid=${tok}` },
      }).catch(() => {});
    }
  }

  return { processed: ids.length, succeeded, failed, refused, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: OutboxRequest = {};
  try { body = await req.json(); } catch { /* empty body OK */ }

  try {
    if (body.sweep) {
      const result = await sweepUnsynced();
      return new Response(JSON.stringify({ mode: "sweep", ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.deal_id) {
      return new Response(JSON.stringify({ error: "deal_id or sweep:true is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await processDeal(body.deal_id);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[insuracloud-outbox] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
