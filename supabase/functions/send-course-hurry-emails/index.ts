import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Email template types
type EmailType = "4hour" | "24hour" | "48hour";

const EMAIL_SUBJECTS: Record<EmailType, string> = {
  "4hour": "Most agents finish by now – let's get you caught up!",
  "24hour": "You're almost there – finish your training today",
  "48hour": "⚠️ URGENT: Complete your course to get started",
};

const getEmailHtml = (agentName: string, type: EmailType, percentComplete: number): string => {
  const firstName = agentName.split(" ")[0];
  
  if (type === "4hour") {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a1a; margin-bottom: 20px;">Hey ${firstName}! 👋</h1>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          Just a quick heads up – most of our new agents finish their training course within the first few hours.
        </p>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          You're at <strong>${percentComplete}%</strong> right now. Let's push through and get you ready to start selling!
        </p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="https://rebuild-brighten-sparkle.lovable.app/onboarding" 
             style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            Continue My Training →
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">
          The faster you finish, the sooner you can start earning. We're excited to have you on the team!
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">
          Powered by Apex Financial
        </p>
      </div>
    `;
  } else if (type === "24hour") {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a1a; margin-bottom: 20px;">${firstName}, you're so close! 🎯</h1>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          It's been 24 hours since you started your training, and you're at <strong>${percentComplete}%</strong>.
        </p>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          The top performers on our team finished their training quickly and jumped right into the action. You've got this!
        </p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="https://rebuild-brighten-sparkle.lovable.app/onboarding" 
             style="background: linear-gradient(135deg, #f59e0b, #ef4444); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            Finish My Course Now →
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">
          Every hour you delay is money left on the table. Let's get you selling today!
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">
          Powered by Apex Financial
        </p>
      </div>
    `;
  } else {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #dc2626; margin-bottom: 20px;">⚠️ ${firstName}, this is urgent</h1>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          It's been <strong>48 hours</strong> and your training is still incomplete at <strong>${percentComplete}%</strong>.
        </p>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          We need you to finish your course TODAY. Your manager is waiting to move you into field training, and every day you wait is a day you're not earning.
        </p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="https://rebuild-brighten-sparkle.lovable.app/onboarding" 
             style="background: #dc2626; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
            ⚡ Complete Training NOW
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">
          If you're having technical issues or need help, reach out immediately. But if you're just procrastinating – snap out of it and let's go!
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">
          Powered by Apex Financial
        </p>
      </div>
    `;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const now = new Date();
    const results = { sent: 0, skipped: 0, errors: [] as string[] };

    console.log("[Course Hurry Emails] Starting check at", now.toISOString());

    // Get all agents in training stages with incomplete courses
    const { data: trainingAgents, error: agentsError } = await supabase
      .from("agents")
      .select(`
        id,
        user_id,
        onboarding_stage,
        profiles!agents_profile_id_fkey (
          full_name,
          email
        )
      `)
      .in("onboarding_stage", ["onboarding", "training_online"])
      .eq("is_deactivated", false) as { data: Array<{
        id: string;
        user_id: string | null;
        onboarding_stage: string;
        profiles: { full_name: string | null; email: string | null } | null;
      }> | null; error: any };

    if (agentsError) {
      console.error("Error fetching agents:", agentsError);
      throw agentsError;
    }

    if (!trainingAgents?.length) {
      console.log("[Course Hurry Emails] No agents in training");
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentIds = trainingAgents.map(a => a.id);

    // Get progress for all agents
    const { data: progressData } = await supabase
      .from("onboarding_progress")
      .select("agent_id, passed, started_at")
      .in("agent_id", agentIds);

    // Get total modules count
    const { data: modules } = await supabase
      .from("onboarding_modules")
      .select("id")
      .eq("is_active", true);
    
    const totalModules = modules?.length || 1;

    // Calculate progress per agent
    const agentProgress = new Map<string, { passedCount: number; startedAt: Date | null }>();
    
    progressData?.forEach(p => {
      const existing = agentProgress.get(p.agent_id) || { passedCount: 0, startedAt: null };
      agentProgress.set(p.agent_id, {
        passedCount: existing.passedCount + (p.passed ? 1 : 0),
        startedAt: p.started_at && (!existing.startedAt || new Date(p.started_at) < existing.startedAt) 
          ? new Date(p.started_at) 
          : existing.startedAt,
      });
    });

    // Check existing email logs to prevent duplicates
    const { data: existingLogs } = await supabase
      .from("email_tracking")
      .select("agent_id, email_type")
      .in("agent_id", agentIds)
      .in("email_type", ["course_hurry_4hour", "course_hurry_24hour", "course_hurry_48hour"]);

    const sentEmails = new Set(existingLogs?.map(l => `${l.agent_id}_${l.email_type}`) || []);

    // Process each agent
    for (const agent of trainingAgents) {
      const profile = agent.profiles;
      const email = profile?.email;
      if (!email) {
        results.skipped++;
        continue;
      }

      const progress = agentProgress.get(agent.id);
      const passedCount = progress?.passedCount || 0;
      const percentComplete = Math.round((passedCount / totalModules) * 100);

      // Skip if already complete
      if (percentComplete >= 100) {
        results.skipped++;
        continue;
      }

      // Use course start time or agent creation time
      const startedAt = progress?.startedAt;
      if (!startedAt) {
        // No progress yet, skip hurry emails
        results.skipped++;
        continue;
      }

      const hoursSinceStart = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);

      // Determine which email to send based on hours
      let emailType: EmailType | null = null;
      
      if (hoursSinceStart >= 48 && hoursSinceStart < 72) {
        emailType = "48hour";
      } else if (hoursSinceStart >= 24 && hoursSinceStart < 48) {
        emailType = "24hour";
      } else if (hoursSinceStart >= 4 && hoursSinceStart < 24) {
        emailType = "4hour";
      }

      if (!emailType) {
        results.skipped++;
        continue;
      }

      const emailKey = `${agent.id}_course_hurry_${emailType}`;
      if (sentEmails.has(emailKey)) {
        results.skipped++;
        continue;
      }

      // Send the email
      try {
        const agentName = profile?.full_name || "Agent";
        const { error: emailError } = await resend.emails.send({
          from: "APEX Financial <notifications@apex-financial.org>",
          to: [email],
          cc: ["sam@apex-financial.org"],
          subject: EMAIL_SUBJECTS[emailType],
          html: getEmailHtml(agentName, emailType, percentComplete),
        });

        if (emailError) {
          console.error(`Error sending ${emailType} email to ${email}:`, emailError);
          results.errors.push(`${email}: ${(emailError as any).message || String(emailError)}`);
          continue;
        }

        // Log the email
        await supabase.from("email_tracking").insert({
          agent_id: agent.id,
          recipient_email: email,
          email_type: `course_hurry_${emailType}`,
          metadata: { percent_complete: percentComplete, hours_since_start: hoursSinceStart },
        });

        console.log(`[Course Hurry] Sent ${emailType} email to ${agentName} (${percentComplete}% complete)`);
        results.sent++;
      } catch (err) {
        console.error(`Failed to send email to ${email}:`, err);
        results.errors.push(`${email}: ${String(err)}`);
      }
    }

    console.log("[Course Hurry Emails] Complete:", results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in send-course-hurry-emails:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
