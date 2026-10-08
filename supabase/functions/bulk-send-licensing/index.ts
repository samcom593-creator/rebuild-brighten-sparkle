import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // PL-WIB-BLAST-SENDERS-AUTH (2026-10-08). verify_jwt = false and, until this
  // commit, no credential read, so a bare POST from anyone ran the send.
  // Every POST mails licensing instructions to every unlicensed or pending,
  // non-terminated applicant (693 on 2026-10-08). Floor admin_or_manager: the one
  // caller is ControlTerminal on /dashboard/admin (requireAdmin).
  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // dryRun returns the audience size and sends nothing. ControlTerminal sends no
  // body and stays a live send. Added so the gate can be probed with the service
  // key without mailing 693 people.
  const reqBody = await req.json().catch(() => ({}));
  const dryRun = reqBody?.dryRun === true;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query all unlicensed/pending applications that are not terminated
    const { data: applications, error: queryError } = await supabase
      .from("applications")
      .select("id, first_name, email, license_status, assigned_agent_id")
      .in("license_status", ["unlicensed", "pending"])
      .is("terminated_at", null)
      .not("email", "is", null)
      .order("created_at", { ascending: true });

    if (queryError) throw queryError;

    console.log(`[bulk-send-licensing] Found ${applications?.length || 0} unlicensed/pending applicants`);

    if (dryRun) {
      return new Response(
        JSON.stringify({ dryRun: true, total: applications?.length ?? 0 }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const results: { sent: string[]; failed: { email: string; error: string }[] } = {
      sent: [],
      failed: [],
    };

    const functionUrl = `${supabaseUrl}/functions/v1/send-licensing-instructions`;

    for (const app of applications || []) {
      try {
        // Look up manager email if assigned
        let managerEmail: string | undefined;
        if (app.assigned_agent_id) {
          const { data: managerAgent } = await supabase
            .from("agents")
            .select("invited_by_manager_id")
            .eq("id", app.assigned_agent_id)
            .single();

          if (managerAgent?.invited_by_manager_id) {
            const { data: managerProfile } = await supabase
              .from("agents")
              .select("profile_id")
              .eq("id", managerAgent.invited_by_manager_id)
              .single();

            if (managerProfile?.profile_id) {
              const { data: profile } = await supabase
                .from("profiles")
                .select("email")
                .eq("id", managerProfile.profile_id)
                .single();
              managerEmail = profile?.email || undefined;
            }
          }
        }

        const response = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            email: app.email,
            firstName: app.first_name,
            licenseStatus: app.license_status,
            managerEmail,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`HTTP ${response.status}: ${errBody}`);
        }

        results.sent.push(app.email);
        console.log(`[bulk-send-licensing] ✅ Sent to ${app.email}`);

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err: any) {
        console.error(`[bulk-send-licensing] ❌ Failed for ${app.email}:`, err.message);
        results.failed.push({ email: app.email, error: err.message });
      }
    }

    console.log(`[bulk-send-licensing] Complete: ${results.sent.length} sent, ${results.failed.length} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        totalFound: applications?.length || 0,
        sent: results.sent.length,
        failed: results.failed.length,
        failures: results.failed,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("[bulk-send-licensing] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
