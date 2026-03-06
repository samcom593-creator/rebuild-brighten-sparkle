import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

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

const ADMIN_EMAIL = "sam@apex-financial.org";

// Calendly URLs
const UNLICENSED_CALENDLY = "https://calendly.com/sam-com593/licensed-prospect-call-clone";
const LICENSED_CALENDLY = "https://calendly.com/sam-com593/1on1-call-clone";
const DASHBOARD_URL = "https://rebuild-brighten-sparkle.lovable.app/dashboard/applicants";

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
      from: "APEX Financial <notifications@tx.apex-financial.org>",
      to: [app.email],
      cc: ccList.length > 0 ? ccList : undefined,
      subject: "Need Help Getting Licensed? We're Here For You! 📋",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">Having Trouble Getting Licensed?</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hey ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              We noticed you submitted your application a few days ago and wanted to check in. 
              <strong>Getting your insurance license can feel overwhelming</strong> — but don't worry, we're here to help!
            </p>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 500;">
                🎓 Remember: APEX covers most of your licensing costs. You're not alone in this process!
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              If you're stuck or have questions about:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>The pre-licensing course</li>
              <li>Exam preparation</li>
              <li>State requirements</li>
              <li>Scheduling your exam</li>
              <li>Or anything else...</li>
            </ul>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px; font-weight: 600;">
              Book a quick call with us and we'll walk you through everything step-by-step!
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${UNLICENSED_CALENDLY}" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; 
                         padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                         box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4); max-width:100%; box-sizing:border-box;">
                 📞 Schedule a Licensing Help Call
              </a>
            </div>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 25px;">
              <h3 style="color: #111827; margin-top: 0; margin-bottom: 15px; font-size: 16px;">Quick Resources:</h3>
              <ul style="color: #4b5563; margin: 0; padding-left: 20px; line-height: 1.8;">
                <li><a href="https://youtu.be/i1e5p-GEfAU" style="color: #059669;">Watch: Licensing Overview Video</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669;">Licensing Step-by-Step Guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669;">Start Pre-Licensing Course</a></li>
              </ul>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              We believe in you! The license is just the first step to an incredible career.
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
      from: "APEX Financial <notifications@tx.apex-financial.org>",
      to: [app.email],
      cc: ccList2.length > 0 ? ccList2 : undefined,
      subject: "Are You Licensed Yet? 🎓",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">How's It Coming Along?</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hey ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              It's been about a week since you applied to join APEX Financial. We wanted to check in and see how your licensing journey is going!
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 600; font-size: 18px;">
                🎓 Are you licensed yet?
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              If you've completed your licensing, <strong>congratulations!</strong> Let's get you started right away. Book your onboarding call below:
            </p>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="${LICENSED_CALENDLY}" 
                 style="display: inline-block; background: linear-gradient(135deg, #059669, #047857); color: white; 
                         padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                         box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4); max-width:100%; box-sizing:border-box;">
                 📅 I'm Licensed - Schedule My Call!
              </a>
            </div>

            <div style="border-top: 1px solid #e5e7eb; margin: 25px 0; padding-top: 25px;">
              <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
                <strong>Still working on it?</strong> No worries! Here are your resources again:
              </p>
              
              <ul style="color: #4b5563; line-height: 2; font-size: 15px; margin: 15px 0;">
                <li><a href="https://youtu.be/i1e5p-GEfAU" style="color: #059669; font-weight: 500;">▶️ Watch: Licensing Overview Video</a></li>
                <li><a href="https://docs.google.com/document/d/1WBN_bh7Tl6IkhdXwQvrUa6Q58xmV9As_q048aKAeyNg/edit" style="color: #059669; font-weight: 500;">📄 Licensing Step-by-Step Guide</a></li>
                <li><a href="https://partners.xcelsolutions.com/afe" style="color: #059669; font-weight: 500;">📚 Start/Continue Pre-Licensing Course</a></li>
              </ul>
            </div>

            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #92400e; font-weight: 500;">
                💡 Need help? Schedule a quick call and we'll walk you through the process step-by-step!
              </p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
              <a href="${UNLICENSED_CALENDLY}" 
                 style="display: inline-block; background: #f59e0b; color: white; 
                         padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; max-width:100%; box-sizing:border-box;">
                 📞 I Need Help Getting Licensed
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              We're here to support you every step of the way!
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
      from: "APEX Financial <notifications@tx.apex-financial.org>",
      to: [app.email],
      cc: ccList3.length > 0 ? ccList3 : undefined,
      subject: "Did We Get to You Yet? Let's Connect! 🚀",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669, #047857); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 26px;">We Haven't Forgotten About You!</h1>
          </div>
          
          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #111827; margin-top: 0;">Hi ${app.first_name}! 👋</h2>
            
            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              We wanted to follow up on your application. If you haven't had a chance to speak with our team yet, 
              <strong>now is the perfect time to schedule your onboarding call!</strong>
            </p>

            <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 15px 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #047857; font-weight: 500;">
                ⚡ As a licensed agent, you're ready to start earning immediately. Don't let this opportunity slip by!
              </p>
            </div>

            <p style="color: #4b5563; line-height: 1.6; font-size: 16px;">
              On your onboarding call, we'll cover:
            </p>
            
            <ul style="color: #4b5563; line-height: 1.8; font-size: 15px;">
              <li>Your personalized fast-track to production</li>
              <li>Our proven sales systems and training</li>
              <li>Commission structures and earning potential</li>
              <li>Getting you contracted and ready to sell</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${LICENSED_CALENDLY}" 
                 style="display: inline-block; background: linear-gradient(135deg, #dc2626, #b91c1c); color: white; 
                         padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;
                         box-shadow: 0 4px 14px rgba(220, 38, 38, 0.4); max-width:100%; box-sizing:border-box;">
                 📅 Schedule Your Call NOW
              </a>
            </div>

            <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 15px 20px; border-radius: 8px; margin-top: 20px;">
              <p style="margin: 0; color: #991b1b; font-size: 14px; text-align: center;">
                <strong>Spots fill up fast!</strong> Our top performers started exactly where you are right now.
              </p>
            </div>

            <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 25px;">
              Ready to transform your career? We're excited to have you on the team!
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
