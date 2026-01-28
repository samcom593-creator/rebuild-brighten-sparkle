import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Get current counter
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
      
      return new Response(
        JSON.stringify({ success: true, message: "Counter created with initial value 840" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
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

    console.log(`Lead counter incremented by ${increment}: ${counter.count} -> ${newCount}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        previousCount: counter.count,
        increment,
        newCount 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in increment-lead-counter:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
