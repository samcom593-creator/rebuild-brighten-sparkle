import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";

Deno.serve(
  createHandler(
    {
      functionName: "check-overdue-tasks",
      rateLimit: { maxRequests: 20, windowSeconds: 60 },
    },
    async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const today = new Date().toISOString().split("T")[0];

      const { data: overdue, error } = await supabase
        .from("agent_tasks")
        .select("id, title, agent_id, due_date")
        .lt("due_date", today)
        .neq("status", "completed")
        .neq("status", "overdue");

      if (error) throw error;

      const ids = (overdue || []).map((t: any) => t.id);
      if (ids.length > 0) {
        await supabase
          .from("agent_tasks")
          .update({ status: "overdue" })
          .in("id", ids);
      }

      await supabase.from("notification_log").insert({
        notification_type: "task_overdue_check",
        recipient_email: "sam@apex-financial.org",
        subject: `${ids.length} tasks marked overdue`,
        body: `Checked at ${new Date().toISOString()}. ${ids.length} tasks are now overdue.`,
        status: "sent",
      });

      return jsonResponse({ success: true, overdueCount: ids.length });
    }
  )
);
