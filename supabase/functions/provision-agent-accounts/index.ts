/**
 * provision-agent-accounts — close the gap between "hired" and "has a login".
 *
 * MEASURED: account provisioning has been degrading since May. 2026-03 gave 54
 * logins to 56 hires and 2026-05 gave 30 to 30; then 2026-06 gave 17 of 26,
 * 2026-07 gave 0 of 2, and 2026-08 gave 13 of 18. The tell is exact — of the 17
 * agents created in four months without a login, ALL 17 also have no profile
 * row, while 39 of the 60 with a login have one. The working path writes auth
 * user + profile + agent together; the failing path writes an agent row alone.
 *
 * create-new-agent-account already does the full job correctly. Nothing ever
 * SWEEPS for the ones it missed, so a hire that slipped through stayed
 * account-less indefinitely — six of the last sixteen hires had never accessed
 * the platform, four of them because they were never given a door.
 *
 * This only ever touches agents the database already says are fixable:
 * v_agent_account_gaps.gap_kind = 'fixable_now' means a real email exists on
 * their profile or their originating application. Agents with no email are
 * reported, never guessed at — no automation can invent a contact address.
 *
 * Safety: managers are skipped (an account with elevated standing is Sam's call,
 * matching the /claim link's refusal), every action is idempotent on the
 * agent's user_id, and a failure to link removes the auth user it just made
 * rather than leaving an orphan.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Gap {
  agent_id: string;
  display_name: string | null;
  resolvable_email: string | null;
  gap_kind: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Trusted callers only: this mints auth users.
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const trusted = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("APEX_BOT_TOKEN"),
  ].filter((t): t is string => Boolean(t && t.length > 16));
  const { data: settingRows } = await admin
    .from("system_settings").select("value").in("key", ["service_role_key", "apex_bot_token"]);
  for (const r of (settingRows ?? []) as { value: string | null }[]) {
    if (r.value && r.value.length > 16) trusted.push(r.value);
  }
  if (!presented || !trusted.includes(presented)) return json({ error: "unauthorized" }, 401);

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // empty-catch-allow:empty-body-is-a-valid-cron-invocation
    dryRun = false;
  }

  const { data: gaps, error: gapErr } = await admin
    .from("v_agent_account_gaps")
    .select("agent_id, display_name, resolvable_email, gap_kind");
  if (gapErr) return json({ error: gapErr.message }, 500);

  const rows = (gaps ?? []) as Gap[];
  const fixable = rows.filter((g) => g.gap_kind === "fixable_now" && g.resolvable_email);
  const blocked = rows.filter((g) => g.gap_kind !== "fixable_now");

  const provisioned: string[] = [];
  const skipped: { agent: string; reason: string }[] = [];

  for (const g of fixable) {
    const email = g.resolvable_email!.toLowerCase().trim();

    // A manager account is elevated standing; Sam creates those deliberately.
    const { data: agentRow } = await admin
      .from("agents").select("is_manager, user_id").eq("id", g.agent_id).maybeSingle();
    if (agentRow?.user_id) { skipped.push({ agent: g.agent_id, reason: "already linked" }); continue; }
    if (agentRow?.is_manager) { skipped.push({ agent: g.agent_id, reason: "manager — needs Sam" }); continue; }

    if (dryRun) { provisioned.push(`${g.display_name} <${email}> (dry run)`); continue; }

    // An existing auth user for this address is a LINK, not a second account —
    // creating another is how duplicate identities get made.
    let userId: string | null = null;
    const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (page?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) {
      userId = found.id;
    } else {
      const { data: made, error: mkErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: g.display_name ?? "", provisioned_by: "provision-agent-accounts" },
      });
      if (mkErr || !made?.user) { skipped.push({ agent: g.agent_id, reason: mkErr?.message ?? "createUser failed" }); continue; }
      userId = made.user.id;
    }

    // profiles is keyed by its own id with a separate user_id, and the
    // on_auth_user_created trigger has usually already written the row.
    let profileId: string | null = null;
    const { data: prof } = await admin.from("profiles").select("id").eq("user_id", userId).maybeSingle();
    if (prof?.id) {
      profileId = prof.id;
      await admin.from("profiles").update({ email, full_name: g.display_name ?? null }).eq("id", profileId);
    } else {
      const { data: mk } = await admin.from("profiles")
        .insert({ user_id: userId, email, full_name: g.display_name ?? null })
        .select("id").maybeSingle();
      profileId = mk?.id ?? null;
    }

    const { data: linked, error: linkErr } = await admin.from("agents")
      .update({ user_id: userId, profile_id: profileId })
      .eq("id", g.agent_id).is("user_id", null).select("id");

    if (linkErr || !linked?.length) {
      if (!found) {
        // empty-catch-allow:rollback-of-the-user-we-just-made; the real failure is reported in `skipped`
        try { await admin.auth.admin.deleteUser(userId); } catch (_e) { /* nothing better to do */ }
      }
      skipped.push({ agent: g.agent_id, reason: linkErr?.message ?? "raced" });
      continue;
    }

    await admin.from("user_roles").upsert({ user_id: userId, role: "agent" }, { onConflict: "user_id,role" });
    provisioned.push(`${g.display_name} <${email}>`);
  }

  return json({
    ok: true,
    dryRun,
    provisioned_count: provisioned.length,
    provisioned,
    skipped,
    // Reported, never guessed at. No automation can invent an email address.
    blocked_needs_an_email: blocked.map((b) => b.display_name),
  });
});
