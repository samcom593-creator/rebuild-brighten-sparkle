import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const BASE_URL = "https://apex-financial.org";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Generate magic link token
async function generateMagicToken(
  supabaseAdmin: any,
  agentId: string,
  email: string,
  destination: "portal" | "numbers"
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  
  await supabaseAdmin.from("magic_login_tokens").insert({
    agent_id: agentId,
    email: email.toLowerCase().trim(),
    token,
    destination,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  return `${BASE_URL}/magic-login?token=${token}`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get all active agents with valid profiles by joining via user_id
    const { data: agents, error: agentsError } = await supabaseAdmin
      .from("agents")
      .select("id, user_id, onboarding_stage")
      .eq("is_deactivated", false)
      .not("user_id", "is", null);

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw new Error("Failed to fetch agents");
    }

    console.log(`Found ${agents?.length || 0} agents to process`);

    // Get profiles for these agents
    const userIds = (agents || []).map(a => a.user_id).filter(Boolean);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, id, full_name, email")
      .in("user_id", userIds);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
    }

    // Create a map of user_id to profile
    const profileMap = new Map();
    for (const p of profiles || []) {
      profileMap.set(p.user_id, p);
    }

    console.log(`Found ${profileMap.size} profiles with emails`);

    const results = {
      total: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [] as { name: string; email: string; status: string; error?: string }[],
    };

    for (const agent of agents || []) {
      const profile = profileMap.get(agent.user_id);
      if (!profile?.email) {
        console.log(`Skipping agent ${agent.id} - no email found`);
        results.skipped++;
        continue;
      }

      // Skip placeholder emails
      if (profile.email.includes("placeholder")) {
        console.log(`Skipping ${profile.email} - placeholder email`);
        results.skipped++;
        results.details.push({
          name: profile.full_name || "Unknown",
          email: profile.email,
          status: "skipped",
          error: "Placeholder email",
        });
        continue;
      }

      results.total++;
      const firstName = profile.full_name?.split(" ")[0] || "Agent";

      try {
        // Generate magic links for both destinations
        const portalMagicLink = await generateMagicToken(supabaseAdmin, agent.id, profile.email, "portal");
        const numbersMagicLink = await generateMagicToken(supabaseAdmin, agent.id, profile.email, "numbers");

        // Create tracking record
        const { data: trackingRecord } = await supabaseAdmin
          .from("email_tracking")
          .insert({
            agent_id: agent.id,
            email_type: "bulk_portal_login",
            recipient_email: profile.email,
            metadata: {
              agent_name: profile.full_name,
              onboarding_stage: agent.onboarding_stage,
              bulk_send: true,
              magic_link: true,
            },
          })
          .select("id")
          .single();

        const trackingPixelUrl = trackingRecord
          ? `${SUPABASE_URL}/functions/v1/track-email-open?id=${trackingRecord.id}`
          : "";

        // Send email with magic links
        await resend.emails.send({
          from: "APEX Financial <noreply@apex-financial.org>",
          to: [profile.email],
          subject: "🎯 Your APEX Portal Access - One-Tap Login Inside!",
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #0a0f1a;">
              <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
                <div style="background: linear-gradient(135deg, #0d1526 0%, #1a2a4a 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(20, 184, 166, 0.3);">
                  
                  <div style="text-align: center; margin-bottom: 24px;">
                    <span style="font-size: 64px;">🎯</span>
                  </div>
                  
                  <h1 style="color: #14b8a6; font-size: 28px; margin: 0 0 16px 0; text-align: center;">
                    Hey ${firstName}!
                  </h1>
                  
                  <h2 style="color: #ffffff; font-size: 22px; margin: 0 0 24px 0; text-align: center;">
                    Your Portal Access is Ready
                  </h2>
                  
                  <p style="color: #e2e8f0; font-size: 16px; line-height: 1.8; margin: 0 0 24px 0;">
                    You can now log your daily numbers and track your performance on the APEX Portal. Just tap the button below - no password needed!
                  </p>
                  
                  <div style="background: rgba(20, 184, 166, 0.1); border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <h3 style="color: #14b8a6; font-size: 18px; margin: 0 0 16px 0;">What you can do:</h3>
                    <ul style="color: #e2e8f0; font-size: 14px; line-height: 2; margin: 0; padding-left: 20px;">
                      <li>Log your daily production numbers</li>
                      <li>See how you rank on the leaderboard</li>
                      <li>Track your weekly and monthly progress</li>
                      <li>Set and achieve income goals</li>
                    </ul>
                  </div>
                  
                  <!-- Main CTA - Magic Link to Portal -->
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${portalMagicLink}" style="display: inline-block; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: #0a0f1a; text-decoration: none; padding: 18px 48px; border-radius: 8px; font-weight: bold; font-size: 18px;">
                      🚀 Open My Portal →
                    </a>
                  </div>
                  
                  <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0 0 24px 0;">
                    One-tap login • No password needed
                  </p>

                  <!-- Quick Log Numbers Link - Also Magic Link -->
                  <div style="background: rgba(245, 158, 11, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                    <p style="color: #f59e0b; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                      ⚡ Quick Access
                    </p>
                    <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">
                      Need to log numbers quickly? Use this:
                    </p>
                    <a href="${numbersMagicLink}" style="display: inline-block; background: rgba(245, 158, 11, 0.2); color: #f59e0b; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 14px; border: 1px solid rgba(245, 158, 11, 0.3);">
                      📊 Log Numbers Now →
                    </a>
                  </div>

                  <!-- Discord Link -->
                  <div style="background: rgba(88, 101, 242, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
                    <p style="color: #5865F2; font-size: 14px; font-weight: bold; margin: 0 0 8px 0;">
                      💬 Join Our Team Discord
                    </p>
                    <p style="color: #94a3b8; font-size: 13px; margin: 0 0 12px 0;">
                      Get daily training, support, and connect with the team:
                    </p>
                    <a href="https://discord.gg/GygkGEhb" style="display: inline-block; background: #5865F2; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: bold; font-size: 14px;">
                      Join Discord →
                    </a>
                  </div>

                  <!-- Fallback note -->
                  <div style="background: rgba(148, 163, 184, 0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
                    <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
                      Link not working? You can also sign in at <a href="${BASE_URL}/agent-login" style="color: #14b8a6;">apex-financial.org/agent-login</a><br>
                      using your email: <strong style="color: #e2e8f0;">${profile.email}</strong>
                    </p>
                  </div>
                  
                  <div style="border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 24px; margin-top: 32px;">
                    <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
                      APEX Financial Empire<br>
                      Building Empires, Protecting Families
                    </p>
                  </div>
                  
                  ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="" />` : ""}
                </div>
              </div>
            </body>
            </html>
          `,
        });

        console.log(`✓ Sent magic link email to ${profile.email}`);
        results.sent++;
        results.details.push({
          name: profile.full_name || "Unknown",
          email: profile.email,
          status: "sent",
        });
      } catch (emailError: any) {
        console.error(`✗ Failed to send to ${profile.email}:`, emailError.message);
        results.failed++;
        results.details.push({
          name: profile.full_name || "Unknown",
          email: profile.email,
          status: "failed",
          error: emailError.message,
        });
      }
    }

    console.log(`Bulk send complete: ${results.sent} sent, ${results.failed} failed, ${results.skipped} skipped`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${results.sent} portal login emails with magic links`,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-bulk-portal-logins:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
