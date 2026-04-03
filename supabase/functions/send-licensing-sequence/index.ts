import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "APEX Financial <onboarding@rebuildbrightenseattle.com>", to: [to], subject, html }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { applicationId, step } = await req.json();

    if (!applicationId) {
      return new Response(JSON.stringify({ error: "applicationId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: app, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, license_status, license_progress, state")
      .eq("id", applicationId)
      .single();

    if (error || !app) {
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstName = app.first_name;
    const currentStep = step || 1;

    const sequences: Record<number, { subject: string; html: string }> = {
      1: {
        subject: `${firstName}, here's your licensing roadmap 🗺️`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#22d3a5;">Welcome to APEX, ${firstName}!</h2>
          <p>Getting licensed is your first step to building a 6-figure income in insurance. Here's your personalized roadmap:</p>
          <ol style="line-height:2;">
            <li><strong>Purchase your pre-licensing course</strong> — We recommend ExamFX or Kaplan</li>
            <li><strong>Study 1-2 hours daily</strong> — Most pass within 2-4 weeks</li>
            <li><strong>Schedule your state exam</strong> — PSI or Pearson VUE in ${app.state || 'your state'}</li>
            <li><strong>Pass & get your NPN</strong> — We'll handle contracting from there</li>
          </ol>
          <p>Reply to this email if you need help with any step!</p>
          <p style="color:#888;font-size:12px;">Powered by APEX Financial</p>
        </div>`,
      },
      2: {
        subject: `Quick check-in: How's the studying going, ${firstName}?`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#22d3a5;">Hey ${firstName} 👋</h2>
          <p>Just checking in on your licensing progress. The agents who get licensed fastest are the ones who:</p>
          <ul style="line-height:2;">
            <li>✅ Study at least 1 hour per day</li>
            <li>✅ Take practice exams every 3 days</li>
            <li>✅ Schedule their test date ASAP (creates urgency)</li>
          </ul>
          <p><strong>Pro tip:</strong> Schedule your exam date now, even if you don't feel 100% ready. Having a deadline accelerates learning.</p>
          <p>Reply with your progress and I'll help you stay on track!</p>
          <p style="color:#888;font-size:12px;">Powered by APEX Financial</p>
        </div>`,
      },
      3: {
        subject: `${firstName}, don't let momentum slip! 🏃`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#f59e0b;">Final Push, ${firstName}!</h2>
          <p>You've come this far — don't stop now. Every day without your license is money left on the table.</p>
          <p>Our top-earning agents started making $5,000+/month within their first 60 days of getting licensed.</p>
          <p><strong>Your next step:</strong> Schedule your exam if you haven't already. Reply with your test date and we'll make sure you're prepared.</p>
          <p style="color:#888;font-size:12px;">Powered by APEX Financial</p>
        </div>`,
      },
    };

    const emailData = sequences[currentStep] || sequences[1];
    const sent = await sendEmail(resendKey, app.email, emailData.subject, emailData.html);

    if (sent) {
      // Log the contact
      await supabase.from("contact_history").insert({
        application_id: app.id,
        contact_type: "email",
        email_template: `licensing_sequence_step_${currentStep}`,
        subject: emailData.subject,
      });
    }

    return new Response(JSON.stringify({ success: sent, step: currentStep }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
