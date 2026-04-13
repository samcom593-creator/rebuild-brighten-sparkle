import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const resend = resendKey ? new Resend(resendKey) : null;

    // Find contracted but not licensed applicants with no recent activity
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: apps, error } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, license_progress, contracted_at, last_response_at, is_ghosted, assigned_agent_id")
      .not("contracted_at", "is", null)
      .is("terminated_at", null)
      .neq("license_status", "licensed")
      .order("contracted_at", { ascending: true });

    if (error) throw error;

    const results: string[] = [];

    for (const app of apps || []) {
      const lastActivity = app.last_response_at || app.contracted_at;
      if (!lastActivity) continue;
      const daysSinceActivity = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000);

      if (daysSinceActivity < 5) continue;

      // Mark as ghosted
      if (!app.is_ghosted) {
        await supabase.from("applications").update({ is_ghosted: true }).eq("id", app.id);
      }

      // Day 5: Re-engagement SMS
      if (daysSinceActivity >= 5 && daysSinceActivity < 8) {
        if (app.phone) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({
                phone: app.phone,
                message: `Hey ${app.first_name}, are you still there? Quick reply - YES (still in) or NO (need to pause). -APEX`,
              }),
            });
          } catch (e) { console.error("Ghost SMS failed:", e); }
        }
        results.push(`Day 5 re-engage: ${app.first_name} ${app.last_name}`);
      }

      // Day 8: Alert Sam personally
      if (daysSinceActivity >= 8 && daysSinceActivity < 9 && resend) {
        try {
          await resend.emails.send({
            from: "APEX Financial <notifications@apex-financial.org>",
            to: ["sam@apex-financial.org"],
            subject: `👻 Ghosted Agent: ${app.first_name} ${app.last_name} — ${daysSinceActivity} days silent`,
            html: `<p><strong>${app.first_name} ${app.last_name}</strong> has gone ${daysSinceActivity} days without responding. Stage: ${app.license_progress || "unknown"}</p>
                   <p>Phone: ${app.phone || "N/A"} | Email: ${app.email}</p>
                   <p><strong>Recommended: Call them directly.</strong></p>`,
          });
        } catch (e) { console.error("Ghost alert email failed:", e); }
        results.push(`Day 8 Sam alert: ${app.first_name} ${app.last_name}`);
      }

      // Day 14: Auto-move to need_follow_up
      if (daysSinceActivity >= 14) {
        if (app.license_progress !== "need_follow_up") {
          await supabase.from("applications")
            .update({ license_progress: "need_follow_up" })
            .eq("id", app.id);
          results.push(`Day 14 auto-moved: ${app.first_name} ${app.last_name}`);
        }
      }
    }

    console.log(`Ghosted detection complete. Actions: ${results.length}`);
    return new Response(JSON.stringify({ success: true, actions: results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    console.error("detect-ghosted error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
