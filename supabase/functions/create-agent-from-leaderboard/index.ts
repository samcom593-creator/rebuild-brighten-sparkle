import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const BASE_URL = "https://apex-financial.org";

interface CreateAgentRequest {
  agentId: string;
  email: string;
  fullName: string;
  phone?: string;
  instagramHandle?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, email, fullName, phone, instagramHandle }: CreateAgentRequest = await req.json();

    console.log(`Creating profile and login for agent ${agentId}`, { email, fullName });

    if (!agentId || !email || !fullName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: agentId, email, fullName" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Check if agent already has a user_id
    const { data: existingAgent, error: agentError } = await supabaseAdmin
      .from("agents")
      .select("id, user_id, profile_id")
      .eq("id", agentId)
      .single();

    if (agentError) {
      console.error("Agent lookup failed:", agentError);
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let userId = existingAgent.user_id;
    let profileId = existingAgent.profile_id;

    // If no user exists, create one
    if (!userId) {
      // Check if email already exists
      const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
      const emailUser = existingUser?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

      if (emailUser) {
        userId = emailUser.id;
        console.log(`Found existing user with email: ${userId}`);
      } else {
        // Create new auth user with random password (magic link only)
        const randomPassword = crypto.randomUUID() + crypto.randomUUID();
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: email.toLowerCase().trim(),
          email_confirm: true,
          password: randomPassword,
          user_metadata: { full_name: fullName }
        });

        if (createError) {
          console.error("Failed to create auth user:", createError);
          return new Response(
            JSON.stringify({ error: `Failed to create user: ${createError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        userId = newUser.user.id;
        console.log(`Created new auth user: ${userId}`);
      }
    }

    // Check if profile exists for this user
    if (!profileId) {
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingProfile) {
        profileId = existingProfile.id;
      } else {
        // Create profile
        const { data: newProfile, error: profileError } = await supabaseAdmin
          .from("profiles")
          .insert({
            user_id: userId,
            email: email.toLowerCase().trim(),
            full_name: fullName,
            phone: phone || null,
            instagram_handle: instagramHandle?.replace("@", "") || null,
          })
          .select("id")
          .single();

        if (profileError) {
          console.error("Failed to create profile:", profileError);
          return new Response(
            JSON.stringify({ error: `Failed to create profile: ${profileError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        profileId = newProfile.id;
        console.log(`Created profile: ${profileId}`);
      }
    }

    // Update agent record to link user and profile, set to LIVE
    const { error: updateError } = await supabaseAdmin
      .from("agents")
      .update({
        user_id: userId,
        profile_id: profileId,
        display_name: fullName,
        onboarding_stage: "onboarding", // Start at Step 1
        is_deactivated: false,
        is_inactive: false,
        status: "active",
      })
      .eq("id", agentId);

    if (updateError) {
      console.error("Failed to update agent:", updateError);
      return new Response(
        JSON.stringify({ error: `Failed to update agent: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add agent role if not exists
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "agent")
      .maybeSingle();

    if (!existingRole) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "agent" });
      console.log(`Added agent role for user: ${userId}`);
    }

    // Generate magic link token
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const { error: tokenError } = await supabaseAdmin
      .from("magic_login_tokens")
      .insert({
        agent_id: agentId,
        email: email.toLowerCase().trim(),
        token,
        destination: "portal",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      });

    if (tokenError) {
      console.error("Failed to create magic token:", tokenError);
    }

    const magicLink = `${BASE_URL}/magic-login?token=${token}`;
    const numbersLink = `${BASE_URL}/magic-login?token=${token}&redirect=numbers`;

    // Send welcome email with magic link
    const resend = new Resend(RESEND_API_KEY);
    const { error: emailError } = await resend.emails.send({
      from: "APEX Financial <noreply@apex-financial.org>",
      to: [email],
      subject: "🎉 Your APEX Portal Access is Ready!",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%); border-radius: 16px; border: 1px solid #333;">
          <tr>
            <td style="padding: 40px; text-align: center;">
              <h1 style="color: #f59e0b; margin: 0 0 20px 0; font-size: 28px;">Welcome to APEX! 🚀</h1>
              <p style="color: #e5e5e5; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Hey ${fullName}! Your agent portal is now live and ready for you.
              </p>
              
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto 30px auto;">
                <tr>
                  <td style="padding: 10px;">
                    <a href="${magicLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #000; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 16px;">
                      🏠 Open Your Portal
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px;">
                    <a href="${numbersLink}" style="display: inline-block; padding: 16px 32px; background: transparent; border: 2px solid #f59e0b; color: #f59e0b; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 16px;">
                      📊 Log Your Numbers
                    </a>
                  </td>
                </tr>
              </table>
              
              <div style="background: #1a1a1a; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #333;">
                <p style="color: #9ca3af; font-size: 14px; margin: 0;">
                  <strong style="color: #f59e0b;">💡 Quick Tips:</strong><br>
                  • Submit your daily numbers before 8 PM CST<br>
                  • Leaderboard updates in real-time<br>
                  • Top performers get recognized in team emails!
                </p>
              </div>
              
              <p style="color: #6b7280; font-size: 12px; margin: 20px 0 0 0;">
                This link expires in 7 days. No password needed - just click to access!
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    if (emailError) {
      console.error("Failed to send email:", emailError);
    }

    // Track email
    await supabaseAdmin
      .from("email_tracking")
      .insert({
        agent_id: agentId,
        email_type: "agent_created_login",
        recipient_email: email,
        metadata: { source: "leaderboard_create" }
      });

    console.log(`Successfully created profile and sent login to ${email}`);

    return new Response(
      JSON.stringify({
        success: true,
        userId,
        profileId,
        magicLink,
        message: `Login sent to ${email}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in create-agent-from-leaderboard:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
