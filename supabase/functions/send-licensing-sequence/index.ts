import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sam · APEX Financial <notifications@apex-financial.org>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Resend error:", res.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendEmail threw:", e);
    return false;
  }
}

async function logRun(
  supabase: any,
  status: "success" | "error",
  affected: number,
  duration: number,
  errorMessage?: string,
) {
  try {
    await supabase.from("automation_runs").insert({
      automation_name: "Licensing Sequences",
      ran_at: new Date().toISOString(),
      status,
      agents_affected: affected,
      duration_ms: duration,
      error_message: errorMessage ?? null,
    });
  } catch (e) {
    console.error("Failed to log automation_run:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  let supabase: any = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY missing");
    }
    supabase = createClient(supabaseUrl, serviceKey);

    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      // No body — treat as cron sweep
    }
    const { applicationId, step } = payload ?? {};

    // CRON MODE: no applicationId → process all eligible unlicensed apps
    if (!applicationId) {
      let processed = 0;
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: apps, error: appsErr } = await supabase
          .from("applications")
          .select("id, first_name, last_name, email, license_status, license_progress, state, followup_sent_at, followup_unlicensed_2_sent_at")
          .eq("license_status", "unlicensed")
          .is("terminated_at", null)
          .lt("created_at", sevenDaysAgo)
          .limit(100);

        if (appsErr) throw appsErr;

        for (const app of apps ?? []) {
          if (!app?.email) continue;
          // Decide step: 1 if no followup, 2 if step1 sent >7d ago, 3 if step2 sent >7d ago
          let nextStep = 1;
          const now = Date.now();
          if (app.followup_sent_at) {
            const since = (now - new Date(app.followup_sent_at).getTime()) / 86400000;
            if (since >= 7) nextStep = 2;
            else continue; // already sent step 1 recently
          }
          if (app.followup_unlicensed_2_sent_at) {
            const since = (now - new Date(app.followup_unlicensed_2_sent_at).getTime()) / 86400000;
            if (since >= 7) nextStep = 3;
            else continue;
          }
          const sent = await sendStep(supabase, resendKey ?? "", app, nextStep);
          if (sent) processed++;
        }
      } catch (innerErr: any) {
        console.error("Cron sweep failure:", innerErr);
        await logRun(supabase, "error", processed, Date.now() - startedAt, String(innerErr?.message ?? innerErr));
        return new Response(JSON.stringify({ error: String(innerErr?.message ?? innerErr) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await logRun(supabase, "success", processed, Date.now() - startedAt);
      return new Response(JSON.stringify({ success: true, processed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SINGLE-APP MODE
    let app: any = null;
    try {
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, license_status, license_progress, state")
        .eq("id", applicationId)
        .maybeSingle();
      if (error) throw error;
      app = data;
    } catch (qErr: any) {
      console.error("Lookup failed:", qErr);
      await logRun(supabase, "error", 0, Date.now() - startedAt, String(qErr?.message ?? qErr));
      return new Response(JSON.stringify({ error: "Lookup failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!app) {
      await logRun(supabase, "success", 0, Date.now() - startedAt, "Application not found");
      return new Response(JSON.stringify({ error: "Application not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sent = await sendStep(supabase, resendKey ?? "", app, step || 1);
    await logRun(supabase, "success", sent ? 1 : 0, Date.now() - startedAt);

    return new Response(JSON.stringify({ success: sent, step: step || 1 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Unhandled error:", err, err?.stack);
    if (supabase) {
      await logRun(supabase, "error", 0, Date.now() - startedAt, String(err?.message ?? err));
    }
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function sendStep(supabase: any, resendKey: string, app: any, step: number): Promise<boolean> {
  const firstName = app.first_name || "there";
  const sequences: Record<number, { subject: string; html: string }> = {
    1: {
      subject: `${firstName}, here's your licensing roadmap`,
      html: emailWrap(`
        <h2 style="font-family:Syne,sans-serif;font-size:22px;margin:0 0 12px;color:#22d3a5">Welcome to APEX, ${firstName}.</h2>
        <p>Getting licensed is your first step to building a 6-figure income. Here's the roadmap:</p>
        <ol style="line-height:1.9;color:rgba(255,255,255,0.85)">
          <li>Purchase your pre-licensing course (we recommend ExamFX)</li>
          <li>Study 1–2 hours daily — most pass within 2–4 weeks</li>
          <li>Schedule your state exam in ${app.state || "your state"}</li>
          <li>Pass &amp; get your NPN — we handle contracting from there</li>
        </ol>
        <p>Reply if you need help with any step.</p>
        <p style="margin-top:20px">— Sam, APEX Financial</p>
      `),
    },
    2: {
      subject: `Quick check-in, ${firstName} — how's the studying?`,
      html: emailWrap(`
        <h2 style="font-family:Syne,sans-serif;font-size:22px;margin:0 0 12px;color:#22d3a5">Hey ${firstName} 👋</h2>
        <p>Just checking in. The agents who get licensed fastest:</p>
        <ul style="line-height:1.9;color:rgba(255,255,255,0.85)">
          <li>Study at least 1 hour per day</li>
          <li>Take practice exams every 3 days</li>
          <li>Schedule their test ASAP — creates urgency</li>
        </ul>
        <p>Reply with your progress and I'll keep you on track.</p>
        <p style="margin-top:20px">— Sam, APEX Financial</p>
      `),
    },
    3: {
      subject: `${firstName}, don't let the momentum slip`,
      html: emailWrap(`
        <h2 style="font-family:Syne,sans-serif;font-size:22px;margin:0 0 12px;color:#f59e0b">Final push, ${firstName}.</h2>
        <p>You've come this far — every day without your license is money on the table.</p>
        <p>Top-earning agents start making $5,000+/month within 60 days of getting licensed.</p>
        <p>Reply with your test date and I'll make sure you're ready.</p>
        <p style="margin-top:20px">— Sam, APEX Financial</p>
      `),
    },
  };

  const emailData = sequences[step] || sequences[1];
  if (!resendKey) return false;
  const ok = await sendEmail(resendKey, app.email, emailData.subject, emailData.html);

  if (ok) {
    try {
      await supabase.from("contact_history").insert({
        application_id: app.id,
        contact_type: "email",
        email_template: `licensing_sequence_step_${step}`,
        subject: emailData.subject,
      });
      const stampField = step === 2
        ? "followup_unlicensed_2_sent_at"
        : step === 3
        ? "manual_followup_sent_at"
        : "followup_sent_at";
      await supabase.from("applications").update({ [stampField]: new Date().toISOString() }).eq("id", app.id);
    } catch (e) {
      console.error("Post-send DB ops failed:", e);
    }
  }
  return ok;
}

function emailWrap(inner: string): string {
  return `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#030712;color:white;padding:32px;border-radius:12px">
    <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-bottom:24px;border-radius:2px"></div>
    ${inner}
    <div style="height:3px;background:linear-gradient(90deg,#22d3a5,#0ea5e9);margin-top:24px;border-radius:2px"></div>
  </div>`;
}
