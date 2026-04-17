import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";

Deno.serve(
  createHandler(
    {
      functionName: "increment-lead-counter",
      // Idempotent-ish daily cron job — guard against accidental floods
      rateLimit: { maxRequests: 20, windowSeconds: 60 },
    },
    async () => {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const { data: counter, error: fetchError } = await supabase
        .from("lead_counter")
        .select("id, count")
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching counter:", fetchError);
        throw new Error("Failed to fetch counter");
      }

      if (!counter) {
        console.log("No counter found, creating one");
        const { error: insertError } = await supabase
          .from("lead_counter")
          .insert({ count: 840 });

        if (insertError) throw insertError;

        return jsonResponse({
          success: true,
          message: "Counter created with initial value 840",
        });
      }

      // Increment by random 1-3 per day
      const increment = Math.floor(Math.random() * 3) + 1;
      const newCount = counter.count + increment;

      const { error: updateError } = await supabase
        .from("lead_counter")
        .update({ count: newCount, updated_at: new Date().toISOString() })
        .eq("id", counter.id);

      if (updateError) {
        console.error("Error updating counter:", updateError);
        throw new Error("Failed to update counter");
      }

      console.log(
        `Lead counter incremented by ${increment}: ${counter.count} -> ${newCount}`
      );

      return jsonResponse({
        success: true,
        previousCount: counter.count,
        increment,
        newCount,
      });
    }
  )
);
