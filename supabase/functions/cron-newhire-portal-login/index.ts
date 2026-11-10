// cron-newhire-portal-login
// -----------------------------------------------------------------------------
// Fills the gap that left 26% of hired agents never signing in: the audited
// admin sender (send-bulk-portal-logins) only fired on a manual click, so a new
// hire's auth account existed with a password they were never told, no invite
// email, and no magic-link email in the onboarding sequence — only Discord /
// course / call links that all land behind auth. This job auto-mails the SAME
// one-tap magic-login email the admin path sends, but only to the constrained
// set in v_newhire_needs_portal_login (hired <=30d, or <=45d for hires after
// the WP6 cutoff; has a login, NEVER signed in, real email, not
// deactivated/terminated, fewer than 6 real sends, none in the last 72h).
//
// Safety properties, mirroring send-bulk-portal-logins' hard-won ones:
//  - Recipient set comes ONLY from the view. A bare POST cannot mail the roster.
//  - Shared-secret gated: only a caller holding NEWHIRE_CRON_SECRET (pg_cron)
//    can trigger a live send.
//  - dry_run:true returns the recipient count and masked addresses, sends
//    nothing, mints no tokens.
//  - WP6 receipts: both tokens are minted send_status='pending' and resolved
//    from the provider reply ('sent' + send_message_id only on a real message
//    id; 'failed' / 'refused' otherwise). The view's 72h dedupe counts only
//    real sends, so a failed send no longer silences the hire for 3 days, and
//    a failure backs off 24h instead of retrying every hour.
//  - Sent through _shared/email.ts sendEmail (suppression + non-routable guard).
//  - No CC. The old send copied Sam and the manager, which put a working
//    one-tap login for the hire's account in two other inboxes. Sam/Aisha see
//    non-sign-ins on v_newhire_never_signed_in_staged instead.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// 2.90.1 is the build proven to boot (2026-08-17 esm.sh boot-death incident).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { sendEmail } from "../_shared/email.ts";
import { maskEmail, receiptFor } from "./receipt.ts";

const BASE_URL = "https://apex-financial.org";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("NEWHIRE_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mints a token row as send_status='pending'. Throws if the insert fails: the
// old version ignored the insert result and could mail a link whose token was
// never stored (a dead link, counted as sent).
async function generateMagicToken(
  sb: any,
  agentId: string,
  email: string,
  destination: "portal" | "numbers",
): Promise<{ url: string; id: string }> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { data, error } = await sb.from("magic_login_tokens").insert({
    agent_id: agentId,
    email: email.toLowerCase().trim(),
    token,
    destination,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    send_status: "pending",
  }).select("id").limit(1);
  const id = Array.isArray(data) ? data[0]?.id : undefined;
  if (error || !id) throw new Error(`token insert failed: ${error?.message ?? "no id returned"}`);
  return { url: `${BASE_URL}/magic-login?token=${token}`, id };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildEmail(firstName: string, email: string, portalMagicLink: string, numbersMagicLink: string, isLicensed: boolean): string {
  const fn = escapeHtml(firstName);
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #000000;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #0b0b0b 0%, #171512 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(201, 168, 76, 0.3);">
          <div style="text-align: center; margin-bottom: 24px;"><span style="font-size: 64px;">🎯</span></div>
          <h1 style="color: #c9a84c; font-size: 28px; margin: 0 0 16px 0; text-align: center;">Hey ${fn}!</h1>
          <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 24px 0; text-align: center;">Your Portal Access is Ready</h2>
          <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">You can now log your daily numbers and track your performance on the Galaxy Portal. Just tap the button below - no password needed!</p>
          <div style="background: rgba(201, 168, 76, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="color: #c9a84c; font-size: 18px; margin: 0 0 16px 0;">What you can do:</h3>
            <ul style="color: #e2e8f0; font-size: 14px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>Log your daily production numbers</li>
              <li>See how you rank on the leaderboard</li>
              <li>Track your weekly and monthly progress</li>
              <li>Set and achieve income goals</li>
            </ul>
          </div>
          <div style="text-align: center; margin: 32px 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
              <tr><td align="center" bgcolor="#c9a84c" style="border-radius:8px;">
                <a href="${portalMagicLink}" style="display:inline-block;color:#000000;text-decoration:none;padding:18px 48px;font-weight:bold;font-size:18px;">🚀 Open My Portal →</a>
              </td></tr>
            </table>
          </div>
          <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0 0 24px 0;">One-tap login • No password needed</p>
          <div style="background: rgba(245, 158, 11, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
            <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">⚡ Quick Access</p>
            <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">Need to log numbers quickly? Use this:</p>
            <a href="${numbersMagicLink}" style="display: inline-block; background: rgba(245, 158, 11, 0.2); color: #f59e0b; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; border: 1px solid rgba(245, 158, 11, 0.3);">📊 Log Numbers Now →</a>
          </div>
          <div style="background: rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
              Link not working? You can also sign in at <a href="${BASE_URL}/agent-login" style="color: #c9a84c;">apex-financial.org/agent-login</a><br>
              using your email: <strong style="color: #e2e8f0;">${escapeHtml(email)}</strong>
            </p>
          </div>
          <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
            <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">Galaxy Financial<br>Building Empires, Protecting Families</p>
          </div>
        </div>
      </div>
    </body>
    </html>`;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Shared-secret gate: only a caller presenting the cron secret (pg_cron) may
    // trigger this. Format-independent (does not depend on which service-key
    // format the runtime injects). Without it, no recipient list, no send.
    const provided = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!CRON_SECRET || provided !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { dry_run?: unknown } = {};
    try { body = await req.json(); } catch (_e) { body = {}; /* empty body = live run */ }
    const dryRun = body.dry_run === true;

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: recipients, error: viewErr } = await sb
      .from("v_newhire_needs_portal_login")
      .select("agent_id, email, full_name, license_status, portal_sends_so_far");
    if (viewErr) {
      return new Response(JSON.stringify({ error: viewErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const list = recipients ?? [];
    if (dryRun) {
      return new Response(JSON.stringify({
        success: true, dry_run: true, count: list.length,
        recipients: list.map((r: any) => ({
          first_name: String(r.full_name || "").trim().split(/\s+/)[0] || null,
          email: maskEmail(r.email),
          license: r.license_status,
          sends_so_far: r.portal_sends_so_far ?? null,
        })),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = { total: 0, sent: 0, failed: 0, refused: 0, skipped: 0, details: [] as any[] };
    const mailed = new Set<string>();
    for (const r of list as any[]) {
      const email: string = r.email;
      if (!email || mailed.has(email.toLowerCase())) { results.skipped++; continue; }
      mailed.add(email.toLowerCase());
      results.total++;
      const firstName = (r.full_name || "Agent").split(" ")[0] || "Agent";
      const isLicensed = (r.license_status || "") === "licensed";
      const tokenIds: string[] = [];
      try {
        const portal = await generateMagicToken(sb, r.agent_id, email, "portal");
        tokenIds.push(portal.id);
        const numbers = await generateMagicToken(sb, r.agent_id, email, "numbers");
        tokenIds.push(numbers.id);
        const reply = await sendEmail({
          from: "Galaxy Financial <notifications@apex-financial.org>",
          to: email,
          subject: "🎯 Your Galaxy Portal Access - One-Tap Login Inside!",
          html: buildEmail(firstName, email, portal.url, numbers.url, isLicensed),
          tagName: "newhire-portal-login",
        });
        const receipt = receiptFor(reply);
        const { error: stampErr } = await sb.from("magic_login_tokens").update(receipt).in("id", tokenIds);
        if (stampErr) console.warn(`[cron-newhire-portal-login] receipt stamp failed for agent ${r.agent_id}: ${stampErr.message}`);
        if (receipt.send_status === "sent") {
          results.sent++;
          results.details.push({ agent_id: r.agent_id, status: "sent", id: receipt.send_message_id });
        } else {
          if (receipt.send_status === "refused") results.refused++; else results.failed++;
          results.details.push({ agent_id: r.agent_id, status: receipt.send_status, error: String(reply.error ?? "").slice(0, 300) });
        }
      } catch (e) {
        // A token minted before the throw must not read as in flight forever.
        if (tokenIds.length > 0) {
          await sb.from("magic_login_tokens").update({ send_status: "failed" }).in("id", tokenIds);
        }
        results.failed++;
        results.details.push({ agent_id: r.agent_id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }
    return new Response(JSON.stringify({ success: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
