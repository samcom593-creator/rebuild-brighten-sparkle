import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date().toISOString();

    // Get all pending tasks that are due
    const { data: dueTasks } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(100);

    if (!dueTasks || dueTasks.length === 0) {
      return new Response(JSON.stringify({ message: "No tasks due" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    for (const task of dueTasks) {
      try {
        const payload = task.payload as any;

        if (task.task_type === "exam_reminder" || task.task_type === "exam_result_followup") {
          // Send SMS
          if (payload?.phone && payload?.message) {
            await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
              method: "POST",
              headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ to: payload.phone, message: payload.message }),
            });
          }

          // Log
          await supabase.from("notification_log").insert({
            notification_type: task.task_type,
            recipient_phone: payload?.phone,
            agent_id: task.agent_id,
            application_id: task.application_id,
            subject: task.task_type,
            body: payload?.message,
            channel: "sms",
            status: "sent",
          });
        } else if (task.task_type === "fingerprint_reminder") {
          if (payload?.phone && payload?.message) {
            await fetch(`${supabaseUrl}/functions/v1/send-sms-auto-detect`, {
              method: "POST",
              headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ to: payload.phone, message: payload.message }),
            });
          }

          await supabase.from("notification_log").insert({
            notification_type: "fingerprint_reminder",
            recipient_phone: payload?.phone,
            agent_id: task.agent_id,
            application_id: task.application_id,
            subject: "Fingerprint reminder",
            body: payload?.message,
            channel: "sms",
            status: "sent",
          });
        }

        // Mark task as completed
        await supabase
          .from("scheduled_tasks")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", task.id);

        processed++;
      } catch (taskErr) {
        console.error(`Task ${task.id} failed:`, taskErr);
        await supabase
          .from("scheduled_tasks")
          .update({ status: "failed" })
          .eq("id", task.id);
      }
    }

    return new Response(JSON.stringify({ success: true, processed, total: dueTasks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
