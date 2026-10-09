// cron-newhire-portal-login
// -----------------------------------------------------------------------------
// Fills the gap that left 26% of hired agents never signing in: the audited
// admin sender (send-bulk-portal-logins) only fired on a manual click, so a new
// hire's auth account existed with a password they were never told, no invite
// email, and no magic-link email in the onboarding sequence — only Discord /
// course / call links that all land behind auth. This job auto-mails the SAME
// one-tap magic-login email the admin path sends, but only to the constrained
// set in v_newhire_needs_portal_login (hired <=30d, has a login, NEVER signed
// in, real email, not deactivated/terminated, and not already sent in 72h).
//
// Safety properties, mirroring send-bulk-portal-logins' hard-won ones:
//  - Recipient set comes ONLY from the view. A bare POST cannot mail the roster.
//  - Service-key gated: only a caller holding SERVICE_ROLE_KEY (i.e. pg_cron)
//    can trigger a live send.
//  - dry_run:true returns the recipient list, sends nothing, mints no tokens.
//  - Resend's { data, error } tuple is CHECKED (v2 does not throw on API
//    errors), so results.sent only counts a real message id — no fake success.
//  - 72h self-limit in the view means an un-clicked hire is re-nudged at most
//    once every 3 days, and stops the instant they sign in (view drops them).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const BASE_URL = "https://apex-financial.org";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("NEWHIRE_CRON_SECRET") ?? "";
const ADMIN_EMAIL = "info@kingofsales.net";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function generateMagicToken(
  sb: any,
  agentId: string,
  email: string,
  destination: "portal" | "numbers",
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await sb.from("magic_login_tokens").insert({
    agent_id: agentId,
    email: email.toLowerCase().trim(),
    token,
    destination,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  return `${BASE_URL}/magic-login?token=${token}`;
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
      .select("agent_id, email, full_name, license_status, manager_email");
    if (viewErr) {
      return new Response(JSON.stringify({ error: viewErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const list = recipients ?? [];
    if (dryRun) {
      return new Response(JSON.stringify({
        success: true, dry_run: true, count: list.length,
        recipients: list.map((r: any) => ({ name: r.full_name, email: r.email, license: r.license_status })),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results = { total: 0, sent: 0, failed: 0, skipped: 0, details: [] as any[] };
    const mailed = new Set<string>();
    for (const r of list as any[]) {
      const email: string = r.email;
      if (!email || mailed.has(email.toLowerCase())) { results.skipped++; continue; }
      mailed.add(email.toLowerCase());
      results.total++;
      const firstName = (r.full_name || "Agent").split(" ")[0] || "Agent";
      const isLicensed = (r.license_status || "") === "licensed";
      try {
        const portalLink = await generateMagicToken(sb, r.agent_id, email, "portal");
        const numbersLink = await generateMagicToken(sb, r.agent_id, email, "numbers");
        const ccList = [ADMIN_EMAIL, r.manager_email]
          .filter(Boolean)
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
          .filter((e: string) => e !== email) as string[];
        const { data: sendData, error: sendError } = await resend.emails.send({
          from: "Galaxy Financial <notifications@apex-financial.org>",
          to: [email],
          cc: ccList.length > 0 ? ccList : undefined,
          subject: "🎯 Your Galaxy Portal Access - One-Tap Login Inside!",
          html: buildEmail(firstName, email, portalLink, numbersLink, isLicensed),
        });
        if (sendError || !sendData?.id) {
          const msg = sendError ? (typeof sendError === "string" ? sendError : JSON.stringify(sendError)) : "resend returned no message id";
          results.failed++;
          results.details.push({ name: r.full_name, email, status: "failed", error: msg.slice(0, 300) });
          continue;
        }
        results.sent++;
        results.details.push({ name: r.full_name, email, status: "sent", id: sendData.id });
      } catch (e) {
        results.failed++;
        results.details.push({ name: r.full_name, email, status: "failed", error: e instanceof Error ? e.message : String(e) });
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
