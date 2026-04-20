import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function toIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(str: string): string {
  return (str || "")
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: feedAuth } = await supabase
      .from("ics_feed_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();

    if (!feedAuth) {
      return new Response("Invalid token", { status: 403, headers: corsHeaders });
    }

    const userId = feedAuth.user_id;

    // Touch last_accessed_at (best effort)
    supabase
      .from("ics_feed_tokens")
      .update({ last_accessed_at: new Date().toISOString() })
      .eq("token", token)
      .then(() => {});

    const { data: agent } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    const agentId = agent?.id;

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//APEX Financial//Task Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:APEX Tasks",
      "X-WR-CALDESC:Your APEX Financial tasks and meetings",
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
    ];

    if (agentId) {
      const { data: tasks } = await supabase
        .from("agent_tasks")
        .select("id, title, description, due_date, completed_at")
        .eq("agent_id", agentId)
        .is("completed_at", null)
        .gte("due_date", new Date().toISOString())
        .lte("due_date", new Date(Date.now() + 60 * 86400000).toISOString());

      for (const task of tasks || []) {
        if (!task.due_date) continue;
        const due = new Date(task.due_date);
        const end = new Date(due.getTime() + 30 * 60 * 1000);
        lines.push(
          "BEGIN:VEVENT",
          `UID:apex-task-${task.id}@apex-financial.org`,
          `DTSTAMP:${toIcsDate(new Date())}`,
          `DTSTART:${toIcsDate(due)}`,
          `DTEND:${toIcsDate(end)}`,
          `SUMMARY:${escapeIcs(task.title || "APEX Task")}`,
          `DESCRIPTION:${escapeIcs(task.description || "APEX task")}`,
          `URL:https://apex-financial.org/dashboard`,
          "END:VEVENT"
        );
      }
    }

    lines.push("END:VCALENDAR");

    return new Response(lines.join("\r\n"), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "inline; filename=apex-tasks.ics",
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  } catch (e: any) {
    console.error("ics-feed error:", e);
    return new Response(`Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
});
