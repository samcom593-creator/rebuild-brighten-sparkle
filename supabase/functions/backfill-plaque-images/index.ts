import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Backfill PNGs for existing plaque_awards rows that don't have image_png_url.
 * Calls send-plaque-recognition with skipEmail=true to avoid re-spamming.
 *
 * POST { limit?: number, dryRun?: boolean }
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 50), 200);
    const dryRun = !!body.dryRun;

    const { data: orphans } = await supabase
      .from("plaque_awards")
      .select("id, agent_id, milestone_type, amount, milestone_date")
      .is("image_png_url", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!orphans || orphans.length === 0) {
      return new Response(
        JSON.stringify({ message: "No plaques to backfill", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          would_process: orphans.length,
          ids: orphans.map((o) => o.id),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const orphan of orphans) {
      try {
        await supabase.from("plaque_awards").delete().eq("id", orphan.id);

        const res = await supabase.functions.invoke("send-plaque-recognition", {
          body: {
            agentId: orphan.agent_id,
            milestoneType: orphan.milestone_type,
            amount: Number(orphan.amount) || 0,
            date: orphan.milestone_date || new Date().toISOString().split("T")[0],
            skipEmail: true,
          },
        });

        if (res.error) {
          failed++;
          errors.push(`${orphan.id}: ${res.error.message || "unknown"}`);
        } else {
          succeeded++;
        }
      } catch (e: any) {
        failed++;
        errors.push(`${orphan.id}: ${e.message || String(e)}`);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    return new Response(
      JSON.stringify({
        message: "Backfill complete",
        total: orphans.length,
        succeeded,
        failed,
        errors: errors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("backfill-plaque-images error:", error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
