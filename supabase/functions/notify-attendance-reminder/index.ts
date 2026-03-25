import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const { type } = await req.json().catch(() => ({ type: "all" }));

    const results: string[] = [];

    const sendReminder = async (email: string, name: string, attendanceType: string) => {
      const crmUrl = "https://rebuild-brighten-sparkle.lovable.app/dashboard/crm";
      const { error } = await resend.emails.send({
        from: "Apex Financial <notifications@apex-financial.org>",
        to: [email],
        subject: `⏰ Time to Mark ${attendanceType} Attendance`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3b82f6;">Good Morning, ${name.split(" ")[0]}! 👋</h2>
            <p style="font-size: 16px; color: #374151;">
              This is your daily reminder to <strong>mark ${attendanceType.toLowerCase()} attendance</strong> for today.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
              <tr>
                <td style="background-color: #3b82f6; border-radius: 8px;">
                  <a href="${crmUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px;">
                    Mark Attendance Now →
                  </a>
                </td>
              </tr>
            </table>
            <p style="color: #9ca3af; font-size: 12px;">Powered by Apex Financial</p>
          </div>
        `,
      });

      if (error) {
        console.error(`Failed to send to ${email}:`, error);
        return false;
      }
      results.push(`Sent ${attendanceType} reminder to ${name} (${email})`);
      return true;
    };

    // Look up Obiajulu Ifediora's email
    if (type === "training" || type === "all") {
      const { data: obieProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .ilike("full_name", "%obiajulu%")
        .limit(1)
        .maybeSingle();

      if (obieProfile?.email) {
        const sent = await sendReminder(obieProfile.email, obieProfile.full_name || "Obie", "Training Room");
        if (sent) {
          // Also send SMS
          try {
            const phone = await getPhoneForEmail(supabase, obieProfile.email);
            if (phone) {
              await supabase.functions.invoke("send-sms-auto-detect", {
                body: { phone, message: `⏰ Reminder: Mark Training Room attendance today! → ${crmUrl}` },
              });
            }
          } catch (e) { console.error("SMS failed for Obie:", e); }
        }
      } else {
        results.push("Could not find Obiajulu Ifediora profile");
      }
    }

    // Send to Sam for agency meeting
    if (type === "meeting" || type === "all") {
      const sent = await sendReminder("sam@apex-financial.org", "Samuel James", "Agency Meeting");
      if (sent) {
        try {
          const phone = await getPhoneForEmail(supabase, "sam@apex-financial.org");
          if (phone) {
            await supabase.functions.invoke("send-sms-auto-detect", {
              body: { phone, message: "⏰ Reminder: Mark Agency Meeting attendance today!" },
            });
          }
        } catch (e) { console.error("SMS failed for Sam:", e); }
      }
    }

    console.log("Attendance reminders:", results);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

const crmUrl = "https://rebuild-brighten-sparkle.lovable.app/dashboard/crm";

async function getPhoneForEmail(supabase: any, email: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("phone")
    .eq("email", email)
    .maybeSingle();
  return data?.phone || null;
}

serve(handler);
