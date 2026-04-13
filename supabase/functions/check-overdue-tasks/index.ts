import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const today = new Date().toISOString().split("T")[0];

    // Find overdue tasks
    const { data: overdue, error } = await supabase
      .from("agent_tasks")
      .select("id, title, agent_id, due_date")
      .lt("due_date", today)
      .neq("status", "completed")
      .neq("status", "overdue");

    if (error) throw error;

    // Mark as overdue
    const ids = (overdue || []).map((t: any) => t.id);
    if (ids.length > 0) {
      await supabase
        .from("agent_tasks")
        .update({ status: "overdue" })
        .in("id", ids);
    }

    // Log
    await supabase.from("notification_log").insert({
      notification_type: "task_overdue_check",
      recipient_email: "sam@apex-financial.org",
      subject: `${ids.length} tasks marked overdue`,
      body: `Checked at ${new Date().toISOString()}. ${ids.length} tasks are now overdue.`,
      status: "sent",
    });

    return new Response(JSON.stringify({ success: true, overdueCount: ids.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("check-overdue-tasks error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
