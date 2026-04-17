import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const { transcript, applicationId, agentId, durationSeconds, audioUrl } = await req.json();

    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Transcript text is required (min 10 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert transcript row first (status: processing)
    const { data: row, error: insertErr } = await supabaseAdmin
      .from("call_transcripts")
      .insert({
        application_id: applicationId || null,
        agent_id: agentId || null,
        recorded_by: userId,
        transcript: transcript.trim(),
        audio_url: audioUrl || null,
        duration_seconds: durationSeconds || null,
        status: "processing",
        ai_model: "google/gemini-2.5-flash",
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Use Lovable AI to summarize and analyze sentiment
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      await supabaseAdmin
        .from("call_transcripts")
        .update({ status: "completed", summary: "(AI analysis unavailable)" })
        .eq("id", row.id);
      return new Response(JSON.stringify({ id: row.id, summary: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You analyze sales/recruiting call transcripts. Output strict JSON: {\"summary\": string (3-5 sentence concise summary), \"sentiment\": \"positive\" | \"neutral\" | \"negative\", \"call_outcome\": short tag like 'Interested', 'Booked Interview', 'No Show', 'Not Interested', 'Needs Followup'}. No markdown, no extra text.",
            },
            {
              role: "user",
              content: `Analyze this call transcript:\n\n${transcript.trim().slice(0, 12000)}`,
            },
          ],
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        throw new Error(`AI gateway: ${aiResp.status} ${errText}`);
      }

      const aiData = await aiResp.json();
      const content = aiData.choices?.[0]?.message?.content || "{}";
      const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
      let parsed: any = {};
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { summary: cleaned.slice(0, 500), sentiment: "neutral", call_outcome: "Reviewed" };
      }

      await supabaseAdmin
        .from("call_transcripts")
        .update({
          summary: parsed.summary || null,
          sentiment: parsed.sentiment || "neutral",
          call_outcome: parsed.call_outcome || null,
          status: "completed",
        })
        .eq("id", row.id);

      return new Response(
        JSON.stringify({ id: row.id, ...parsed, status: "completed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (aiErr: any) {
      console.error("AI analysis failed:", aiErr);
      await supabaseAdmin
        .from("call_transcripts")
        .update({ status: "failed", error_message: aiErr.message })
        .eq("id", row.id);
      return new Response(
        JSON.stringify({ id: row.id, error: aiErr.message, status: "failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    console.error("transcribe-call error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
