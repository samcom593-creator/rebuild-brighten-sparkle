import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const BASE_URL = "https://apex-financial.org";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, type } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const normalizedEmail = email.toLowerCase().trim();

    // ---------------------------------------------------------------------
    // MP-453. This endpoint is PUBLIC BY DESIGN (Login.tsx forgot-password and
    // MagicLogin.tsx call it with no session) and must stay that way — gating it
    // breaks real password resets. What it must NOT do is answer differently
    // depending on whether the address owns an account.
    //
    // It used to. Every not-found path returned {success:true, message:"If an
    // account exists..."} while the SUCCESS path returned a bare {success:true},
    // so the PRESENCE OF THE `message` FIELD was an account-enumeration oracle,
    // readable by anyone, with no credential, one address at a time. Proven on
    // live prod 2026-09-06: absent address -> message present; and
    // auth.admin.generateLink answers 200 for a real address and 404
    // user_not_found for an absent one, which is exactly the branch predicate.
    // A thrown send was a SECOND oracle: HTTP 500 could only be reached on the
    // account-exists path, so a failure to mail also confirmed the account.
    //
    // Every account-dependent outcome now returns one byte-identical body.
    // Graded by scripts/check-enumeration-oracle.mjs, which fails any function
    // using this silent-ok idiom that emits a success body without `message`.
    // ---------------------------------------------------------------------
    const uniformOk = () =>
      new Response(
        JSON.stringify({
          success: true,
          message:
            type === "magic_link"
              ? "If an account exists, a link has been sent."
              : "If an account exists, a reset link has been sent.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    // Rate limiting. The RPC is the single source of truth for the rule; it is
    // called inline rather than through _shared/rateLimit.ts on purpose, because
    // that module imports supabase-js@2.45.0 and this function imports @2, and a
    // second SDK copy in one bundle is the MP-273 boot-death class.
    //
    // Two buckets, because they bound different damage:
    //   per-EMAIL  — how much mail one victim's inbox can be made to receive.
    //   per-IP     — how fast one source can sweep addresses. A speed bump, not
    //                a wall: an attacker who rotates IPs still gets one probe
    //                per address per IP. It is not claimed to stop enumeration.
    // Deliberately loose enough not to break an admin sending several resets in
    // a row from /dashboard/accounts (measured caller: DashboardAccounts.tsx:525).
    const clientIp =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "anon";
    for (const [bucket, max, win] of [
      [`send-password-reset:email:${normalizedEmail}`, 3, 900],
      [`send-password-reset:ip:${clientIp}`, 20, 900],
    ] as [string, number, number][]) {
      const { data: allowed, error: rlErr } = await supabaseClient.rpc("check_rate_limit", {
        _bucket_key: bucket,
        _max_requests: max,
        _window_seconds: win,
      });
      // Fail OPEN on a broken limiter: refusing every reset because the limiter
      // is down locks real agents out of their own accounts, which is worse than
      // the unbounded state this replaces. The failure is logged, never silent.
      if (rlErr) {
        console.error("[send-password-reset] rate-limit check failed, allowing:", rlErr.message);
      } else if (allowed === false) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please wait a few minutes and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (type === "magic_link") {
      // profiles.email carries NO unique index, so .maybeSingle() used to return
      // data=null on a DUPLICATE address exactly as it does on an absent one
      // (PostgREST raises PGRST116 and this caller only destructured `data`).
      // Both landed in the branch below and answered "If an account exists, a
      // link has been sent." — so an agent whose profile row had been duplicated
      // could never obtain a magic link, and nothing anywhere said so. Measured
      // 2026-09-01: 9 colliding addresses, 3 of them owning an ACTIVE agent.
      //
      // Ambiguity is its own outcome. It must never be laundered into absence.
      // The caller-facing response is deliberately IDENTICAL in all three cases
      // — it exists to avoid revealing whether an account exists, and that
      // property is preserved. The difference is that ambiguity is now recorded
      // where apex-doctor Check #43 reads it, instead of vanishing.
      const { data: profileRows } = await supabaseClient
        .from("profiles")
        .select("user_id, full_name, email")
        .eq("email", normalizedEmail)
        .limit(10);

      const silentOk = uniformOk;

      if (Array.isArray(profileRows) && profileRows.length > 1) {
        // Record one row per affected account, de-stormed: a person locked out
        // will retry, and a fresh row per retry would bury the signal it exists
        // to raise. Recording is best-effort and must never change the answer.
        for (const row of profileRows) {
          if (!row?.user_id) continue;
          try {
            const { data: already } = await supabaseClient
              .from("auth_provision_failures")
              .select("id")
              .eq("user_id", row.user_id)
              .eq("step", "magic_link_ambiguous")
              .is("resolved_at", null)
              .limit(1);
            if (Array.isArray(already) && already.length > 0) continue;
            await supabaseClient.rpc("fn_record_auth_provision_failure", {
              p_user_id: row.user_id,
              p_email: normalizedEmail,
              p_step: "magic_link_ambiguous",
              p_sqlstate: "PGRST116",
              p_message:
                `${profileRows.length} profile rows share ${normalizedEmail}, so the magic-link lookup cannot ` +
                `identify one account and no link was sent. Merge or correct the duplicate profile rows, then resolve this row.`,
            });
          } catch (e) {
            console.error("magic_link ambiguity record failed:", e);
          }
        }
        console.error("magic_link ambiguous for", normalizedEmail, "rows:", profileRows.length);
        return silentOk();
      }

      const profile = Array.isArray(profileRows) ? profileRows[0] : null;

      if (!profile) {
        // Don't reveal whether email exists
        console.log("No profile found for email:", normalizedEmail);
        return silentOk();
      }

      // Find agent record
      const { data: agent } = await supabaseClient
        .from("agents")
        .select("id")
        .eq("user_id", profile.user_id)
        .maybeSingle();

      if (!agent) {
        return silentOk();
      }

      // Generate magic token
      // A throw anywhere below was the SECOND oracle: the outer catch answers
      // HTTP 500 with the error text, and this code is only reachable once the
      // account is known to exist. Failure is logged and answered uniformly.
      try {
        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await supabaseClient.from("magic_login_tokens").insert({
          agent_id: agent.id,
          email: normalizedEmail,
          token,
          destination: "portal",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        const magicLink = `${BASE_URL}/magic-login?token=${token}`;
        const firstName = profile.full_name?.split(" ")[0] || "there";

        await resend.emails.send({
           from: "APEX Financial <notifications@apex-financial.org>",
          to: [normalizedEmail],
          subject: "Your New Login Link – APEX",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0;">APEX Financial</h1>
              </div>
              <p style="font-size: 16px; color: #333; margin-bottom: 16px;">Hey ${firstName},</p>
              <p style="font-size: 14px; color: #555; margin-bottom: 24px;">Here's your new login link. Click below to access your portal:</p>
              <div style="text-align: center; margin-bottom: 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                  <tr>
                    <td align="center" bgcolor="#7c3aed" style="border-radius:8px;">
                      <a href="${magicLink}" style="display:inline-block;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:600;font-size:16px;">
                        Sign In to Portal
                      </a>
                    </td>
                  </tr>
                </table>
              </div>
              <p style="font-size: 12px; color: #999; text-align: center;">This link expires in 24 hours.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
              <p style="font-size: 11px; color: #aaa; text-align: center;">Powered by Apex Financial</p>
            </div>
          `,
        });
      } catch (sendErr) {
        console.error("magic_link mint/send failed for", normalizedEmail, sendErr);
        return silentOk();
      }

      console.log("Magic link email sent to:", normalizedEmail);
      return silentOk();
    }

    // Default: password reset type
    // Generate a recovery link via admin API
    const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: {
        redirectTo: `${BASE_URL}/dashboard/settings`,
      },
    });

    if (linkError) {
      console.error("Error generating recovery link:", linkError);
      // Don't reveal if user doesn't exist
      return uniformOk();
    }

    // Use the official action_link from Supabase which contains the proper hashed_token
    let recoveryUrl = linkData?.properties?.action_link;
    
    if (recoveryUrl) {
      // Replace the default redirect in action_link to point to our settings page with recovery flag
      try {
        const url = new URL(recoveryUrl);
        url.searchParams.set("redirect_to", `${BASE_URL}/dashboard/settings?recovery=true`);
        recoveryUrl = url.toString();
      } catch {
        // If URL parsing fails, use action_link as-is
        console.log("Could not parse action_link URL, using as-is");
      }
    } else {
      // Fallback: if action_link is not available, build a basic one
      console.warn("action_link not available from generateLink, using fallback");
      recoveryUrl = `${SUPABASE_URL}/auth/v1/verify?type=recovery&token=${linkData?.properties?.hashed_token}&redirect_to=${encodeURIComponent(`${BASE_URL}/dashboard/settings?recovery=true`)}`;
    }

    // Look up name for personalization
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("full_name")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const firstName = profile?.full_name?.split(" ")[0] || "there";

    // Same second oracle as the magic_link branch: only reachable once the
    // account is known to exist, so a send failure must not surface as a 500.
    try {
      await resend.emails.send({
        from: "APEX Financial <notifications@apex-financial.org>",
        to: [normalizedEmail],
        subject: "Reset Your Password – APEX",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0;">APEX Financial</h1>
            </div>
            <p style="font-size: 16px; color: #333; margin-bottom: 16px;">Hey ${firstName},</p>
            <p style="font-size: 14px; color: #555; margin-bottom: 24px;">We received a request to reset your password. Click the button below to set a new password:</p>
            <div style="text-align: center; margin-bottom: 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#7c3aed" style="border-radius:8px;">
                    <a href="${recoveryUrl}" style="display:inline-block;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:600;font-size:16px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
            </div>
            <p style="font-size: 12px; color: #999; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="font-size: 11px; color: #aaa; text-align: center;">Powered by Apex Financial</p>
          </div>
        `,
      });
    } catch (sendErr) {
      console.error("password-reset send failed for", normalizedEmail, sendErr);
      return uniformOk();
    }

    console.log("Password reset email sent to:", normalizedEmail);
    return uniformOk();
  } catch (error: any) {
    console.error("Error in send-password-reset:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
