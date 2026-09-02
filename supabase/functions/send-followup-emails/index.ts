import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { SCHEDULING_LINKS } from "../_shared/apex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const resend = resendApiKey ? new Resend(resendApiKey) : null;

const ADMIN_EMAIL = "info@kingofsales.net";

// Calendly URLs
const UNLICENSED_CALENDLY = SCHEDULING_LINKS.unlicensed;
const LICENSED_CALENDLY = SCHEDULING_LINKS.licensed;

async function getManagerEmailForApp(appId: string): Promise<string | null> {
  try {
    // Get the assigned agent for this application
    const { data: app } = await supabaseAdmin.from("applications").select("assigned_agent_id").eq("id", appId).single();
    if (!app?.assigned_agent_id) return null;
    const { data: agent } = await supabaseAdmin.from("agents").select("user_id, invited_by_manager_id").eq("id", app.assigned_agent_id).single();
    if (!agent) return null;
    const managerId = agent.invited_by_manager_id || app.assigned_agent_id;
    const { data: manager } = await supabaseAdmin.from("agents").select("user_id").eq("id", managerId).single();
    if (!manager?.user_id) return null;
    const { data: authData } = await supabaseAdmin.auth.admin.getUserById(manager.user_id);
    return authData?.user?.email || null;
  } catch (e) {
    console.error("Error resolving manager email for app:", e);
    return null;
  }
}

// Send unlicensed follow-up (3 days after application)
async function sendUnlicensedFollowup(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<boolean> {
  if (!resend) {
    console.log("Resend not configured, skipping unlicensed followup for:", app.email);
    return false;
  }

  try {
    // Resolve manager email for CC
    const managerEmail = await getManagerEmailForApp(app.id);
    const ccList = [ADMIN_EMAIL, managerEmail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

    const response = await resend.emails.send({
       from: "APEX Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: "Your APEX path is waiting: complete the license step",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #050505; padding: 24px;">
          <div style="background: #0a0a0a; padding: 30px; border: 1px solid #d4af37; border-radius: 10px 10px 0 0; text-align: center;">
            <p style="color: #d4af37; margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 2px;">APEX FINANCIAL · LICENSING PATH</p>
            <h1 style="color: white; margin: 0; font-size: 26px;">The license unlocks the platform.</h1>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border: 1px solid #d4af37; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">${app.first_name},</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              You applied to APEX because you wanted more than another job application. The next move is not complicated: finish the licensing step that gives you legal access to the business.
            </p>

            <div style="background: #fffbeb; border-left: 4px solid #d4af37; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #78350f; font-weight: 600;">
                You are not getting licensed just to sell one policy. The license opens the producer, manager, and agency-owner paths inside APEX.
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              After state approval, your path can include:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>Multi-carrier contracting and product access</li>
              <li>Lead access, ReadyMode, CRM workflows, and scripts</li>
              <li>Live training, call review, and production coaching</li>
              <li>Production and book-of-business visibility</li>
              <li>A measurable path from producer to agency owner</li>
            </ul>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px; font-weight: 600;">
              Every week you wait is a week you are not contracting, training, producing, or building your book. Open the roadmap and complete the next unfinished step.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#d4af37" style="border-radius:8px;">
                    <a href="https://apex-financial.org/get-licensed#licensing-video" style="display:inline-block;color:#111111;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      Open My Licensing Roadmap
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 25px;">
              <h3 style="color: #111827; margin-top: 0; margin-bottom: 15px; font-size: 16px;">Licensing resources</h3>
              <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
                <li><a href="https://apex-financial.org/get-licensed#licensing-video" style="color: #9a7418;">Watch the licensing walkthrough</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #9a7418;">Review the step-by-step guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #9a7418;">Start or continue the pre-licensing course</a></li>
                <li><a href="${UNLICENSED_CALENDLY}" style="color: #9a7418;">Book a licensing support call</a></li>
              </ul>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              Independent-contractor opportunity. Licensing requirements and fees vary by state. Income is not guaranteed.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Unlicensed followup sent to:", app.email, response);
    return true;
  } catch (error) {
    console.error("Failed to send unlicensed followup to:", app.email, error);
    return false;
  }
}

// Send second unlicensed follow-up (7 days after application - "Are you licensed yet?")
async function sendUnlicensedFollowup2(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<boolean> {
  if (!resend) {
    console.log("Resend not configured, skipping second unlicensed followup for:", app.email);
    return false;
  }

  try {
    const managerEmail2 = await getManagerEmailForApp(app.id);
    const ccList2 = [ADMIN_EMAIL, managerEmail2].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];
    const response = await resend.emails.send({
       from: "APEX Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList2.length > 0 ? ccList2 : undefined,
      subject: "Choose your next APEX step",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #050505; padding: 24px;">
          <div style="background: #0a0a0a; padding: 30px; border: 1px solid #d4af37; border-radius: 10px 10px 0 0; text-align: center;">
            <p style="color: #d4af37; margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 2px;">APEX FINANCIAL · LICENSING CHECKPOINT</p>
            <h1 style="color: white; margin: 0; font-size: 26px;">Continue the path or pause it.</h1>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border: 1px solid #d4af37; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">${app.first_name},</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              It has been one week since you applied. Interest opened the door; completing the next step is what moves you through it.
            </p>

            <div style="background: #fffbeb; border-left: 4px solid #d4af37; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #78350f; font-weight: 600; font-size: 17px;">
                Your application does not activate carrier, platform, training, or lead access by itself.
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              <strong>If your license is now active,</strong> book the brokerage activation call so the team can review contracting and your production path.
            </p>
            
            <div style="text-align: center; margin: 25px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#d4af37" style="border-radius:8px;">
                    <a href="${LICENSED_CALENDLY}" style="display:inline-block;color:#111111;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      My License Is Active — Book Activation
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <div style="border-top: 1px solid #e5e7eb; margin: 25px 0; padding-top: 25px;">
              <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                <strong>If you are still unlicensed,</strong> reopen the roadmap and finish the next incomplete requirement:
              </p>
              
              <ul style="color: #4b5563; line-height: 2; font-size: 15px; margin: 15px 0;">
                <li><a href="https://apex-financial.org/get-licensed#licensing-video" style="color: #9a7418; font-weight: 500;">Open the licensing roadmap</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #9a7418; font-weight: 500;">Review the licensing guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #9a7418; font-weight: 500;">Start or continue the course</a></li>
              </ul>
            </div>

            <div style="background: #f9fafb; border-left: 4px solid #111111; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #374151; font-weight: 500;">
                Serious builders learn to finish the small, unglamorous step in front of them. This is that step.
              </p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="${UNLICENSED_CALENDLY}" 
                 style="display: inline-block; background: #f59e0b; color: white; 
                         padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; max-width:100%; box-sizing:border-box;">
                 Book Licensing Support
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              Independent-contractor opportunity. Income is not guaranteed. Licensing requirements vary by state.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Second unlicensed followup sent to:", app.email, response);
    return true;
  } catch (error) {
    console.error("Failed to send second unlicensed followup to:", app.email, error);
    return false;
  }
}

// Send licensed follow-up (3-4 days after application if not contacted)
async function sendLicensedFollowup(app: {
  id: string;
  first_name: string;
  email: string;
}): Promise<boolean> {
  if (!resend) {
    console.log("Resend not configured, skipping licensed followup for:", app.email);
    return false;
  }

  try {
    const managerEmail3 = await getManagerEmailForApp(app.id);
    const ccList3 = [ADMIN_EMAIL, managerEmail3].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];
    const response = await resend.emails.send({
      from: "APEX Financial <notifications@apex-financial.org>",
      to: [app.email],
      cc: ccList3.length > 0 ? ccList3 : undefined,
      subject: "Your APEX application is not activated yet",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #050505; padding: 24px;">
          <div style="background: #0a0a0a; padding: 30px; border: 1px solid #d4af37; border-radius: 10px 10px 0 0; text-align: center;">
            <p style="color: #d4af37; margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: 2px;">APEX FINANCIAL · LICENSED PRODUCER</p>
            <h1 style="color: white; margin: 0; font-size: 26px;">The application was step one.</h1>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border: 1px solid #d4af37; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">${app.first_name},</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              You already cleared the legal entry point by earning your license. The next step is a brokerage activation call to determine fit, contracting, and the cleanest path into production.
            </p>

            <div style="background: #fffbeb; border-left: 4px solid #d4af37; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #78350f; font-weight: 600;">
                APEX is not offering another comp sheet. It is offering an operating platform designed to move producers toward leadership and ownership.
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              On the activation call, the team will review:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>Your current license, carrier contracts, and market fit</li>
              <li>Contracting, lead access, ReadyMode, CRM, and scripts</li>
              <li>Live training, call review, and production expectations</li>
              <li>Your path as a producer, manager, recruiter, or agency builder</li>
            </ul>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px; font-weight: 600;">
              Until this step is complete, your application has not activated carrier, platform, training, or lead access through APEX. Every week you wait is a week you are not building production history or leverage.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#d4af37" style="border-radius:8px;">
                    <a href="${LICENSED_CALENDLY}" style="display:inline-block;color:#111111;padding:16px 32px;text-decoration:none;font-weight:bold;font-size:16px;">
                      Book My APEX Activation Call
                    </a>
                  </td>
                </tr>
              </table>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              Independent-contractor opportunity. Contract levels, carrier appointments, and income vary. Income is not guaranteed.
            </p>
          </div>
        </div>
      `,
    });

    console.log("Licensed followup sent to:", app.email, response);
    return true;
  } catch (error) {
    console.error("Failed to send licensed followup to:", app.email, error);
    return false;
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting follow-up email check...");

    // Calculate the date range for 3 days ago (give or take a few hours)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStart = new Date(threeDaysAgo);
    threeDaysAgoStart.setHours(0, 0, 0, 0);
    const threeDaysAgoEnd = new Date(threeDaysAgo);
    threeDaysAgoEnd.setHours(23, 59, 59, 999);

    // For licensed, also check 4 days ago
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
    const fourDaysAgoStart = new Date(fourDaysAgo);
    fourDaysAgoStart.setHours(0, 0, 0, 0);

    // For second unlicensed followup, check 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStart = new Date(sevenDaysAgo);
    sevenDaysAgoStart.setHours(0, 0, 0, 0);
    const sevenDaysAgoEnd = new Date(sevenDaysAgo);
    sevenDaysAgoEnd.setHours(23, 59, 59, 999);

    console.log("Checking for unlicensed apps from:", threeDaysAgoStart.toISOString(), "to", threeDaysAgoEnd.toISOString());
    console.log("Checking for licensed apps from:", fourDaysAgoStart.toISOString(), "to", threeDaysAgoEnd.toISOString());
    console.log("Checking for second unlicensed followup from:", sevenDaysAgoStart.toISOString(), "to", sevenDaysAgoEnd.toISOString());

    // Find unlicensed applicants from exactly 3 days ago who haven't received followup
    const { data: unlicensedApps, error: unlicensedError } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .eq("license_status", "unlicensed")
      .is("followup_sent_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .gte("created_at", threeDaysAgoStart.toISOString())
      .lte("created_at", threeDaysAgoEnd.toISOString());

    if (unlicensedError) {
      console.error("Error fetching unlicensed apps:", unlicensedError);
    }

    // Find unlicensed applicants from 7 days ago for second followup ("Are you licensed yet?")
    const { data: unlicensedApps2, error: unlicensedError2 } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .eq("license_status", "unlicensed")
      .not("followup_sent_at", "is", null) // Must have received first followup
      .is("followup_unlicensed_2_sent_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .gte("created_at", sevenDaysAgoStart.toISOString())
      .lte("created_at", sevenDaysAgoEnd.toISOString());

    if (unlicensedError2) {
      console.error("Error fetching second unlicensed apps:", unlicensedError2);
    }

    // Find licensed applicants from 3-4 days ago who haven't been contacted and haven't received followup
    const { data: licensedApps, error: licensedError } = await supabaseAdmin
      .from("applications")
      .select("id, first_name, email")
      .eq("license_status", "licensed")
      .is("followup_licensed_sent_at", null)
      .is("contacted_at", null)
      .is("closed_at", null)
      .is("terminated_at", null)
      .gte("created_at", fourDaysAgoStart.toISOString())
      .lte("created_at", threeDaysAgoEnd.toISOString());

    if (licensedError) {
      console.error("Error fetching licensed apps:", licensedError);
    }

    console.log("Found unlicensed apps for followup:", unlicensedApps?.length || 0);
    console.log("Found unlicensed apps for second followup:", unlicensedApps2?.length || 0);
    console.log("Found licensed apps for followup:", licensedApps?.length || 0);

    let unlicensedSent = 0;
    let unlicensed2Sent = 0;
    let licensedSent = 0;

    // Send unlicensed follow-ups (first - 3 days)
    for (const app of unlicensedApps || []) {
      const sent = await sendUnlicensedFollowup(app);
      if (sent) {
        // Mark as sent
        await supabaseAdmin
          .from("applications")
          .update({ followup_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        unlicensedSent++;
      }
    }

    // Send second unlicensed follow-ups (7 days - "Are you licensed yet?")
    for (const app of unlicensedApps2 || []) {
      const sent = await sendUnlicensedFollowup2(app);
      if (sent) {
        // Mark as sent
        await supabaseAdmin
          .from("applications")
          .update({ followup_unlicensed_2_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        unlicensed2Sent++;
      }
    }

    // Send licensed follow-ups
    for (const app of licensedApps || []) {
      const sent = await sendLicensedFollowup(app);
      if (sent) {
        // Mark as sent
        await supabaseAdmin
          .from("applications")
          .update({ followup_licensed_sent_at: new Date().toISOString() })
          .eq("id", app.id);
        licensedSent++;
      }
    }

    const result = {
      success: true,
      unlicensedChecked: unlicensedApps?.length || 0,
      unlicensedSent,
      unlicensed2Checked: unlicensedApps2?.length || 0,
      unlicensed2Sent,
      licensedChecked: licensedApps?.length || 0,
      licensedSent,
      timestamp: new Date().toISOString(),
    };

    console.log("Follow-up email job completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-followup-emails:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
