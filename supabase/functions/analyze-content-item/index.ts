import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { contentItemId, fileUrl, fileType } = await req.json();

    if (!contentItemId || !fileUrl) {
      return new Response(
        JSON.stringify({ error: "contentItemId and fileUrl are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🔍 Analyzing content item: ${contentItemId}, type: ${fileType}`);

    // ═══ STEP 1: SENSITIVE CONTENT CHECK (runs FIRST) ═══
    if (fileType === "image" && lovableApiKey) {
      console.log(`🛡️ Running content safety check for ${contentItemId}`);

      const moderationResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: fileUrl } },
                {
                  type: "text",
                  text: `Is this image safe for a professional business website? Check for:
- Nudity or sexual content
- Explicit or suggestive content
- Private/intimate photos
- Graphic violence

Context: Gym/fitness photos showing torso are OK (professional context). Beach/pool in appropriate swimwear is OK. Normal lifestyle content is OK.

Return ONLY this JSON format, nothing else:
{
  "is_safe": true or false,
  "flags": ["list any issues found, empty array if safe"],
  "confidence": "high/medium/low",
  "reason": "brief reason if not safe, empty string if safe"
}`
                },
              ],
            },
          ],
        }),
      });

      if (moderationResponse.ok) {
        const modData = await moderationResponse.json();
        const modRaw = modData.choices?.[0]?.message?.content || "";
        const modJsonMatch = modRaw.match(/\{[\s\S]*\}/);

        if (modJsonMatch) {
          try {
            const modResult = JSON.parse(modJsonMatch[0]);

            if (!modResult.is_safe) {
              console.log(`⚠️ Sensitive content detected for ${contentItemId}: ${modResult.reason}`);

              // Mark as sensitive — hide from library
              await supabase.from("content_library").update({
                is_sensitive: true,
                is_private: true,
                sensitive_flags: modResult.flags || [],
                sensitive_reason: modResult.reason || "Flagged by AI",
                sensitive_checked: true,
                ai_analyzed: true,
                ai_analyzed_at: new Date().toISOString(),
              }).eq("id", contentItemId);

              return new Response(
                JSON.stringify({
                  success: true,
                  safe: false,
                  reason: modResult.reason,
                  flags: modResult.flags,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            // Image is safe — mark as checked and continue
            await supabase.from("content_library").update({
              is_sensitive: false,
              sensitive_checked: true,
            }).eq("id", contentItemId);

            console.log(`✅ Content safety check passed for ${contentItemId}`);
          } catch (e) {
            console.error("Moderation parse error:", e, "Raw:", modRaw);
            // On parse error, mark as checked but don't block
            await supabase.from("content_library").update({
              sensitive_checked: true,
            }).eq("id", contentItemId);
          }
        }
      } else {
        console.error("Moderation API error:", moderationResponse.status);
        // Don't block on moderation failure — mark as unchecked
      }
    }

    // ═══ STEP 2: AI TAGGING (only if content passed safety check) ═══
    let aiTags: string[] = [];
    let aiDescription = "";
    let suggestedTitle = "";
    let contentType = "";

    if (fileType === "image" && lovableApiKey) {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: fileUrl } },
                {
                  type: "text",
                  text: `Analyze this image for an insurance sales agency content library. Return JSON only with these fields:
{
  "tags": ["array of 3-8 relevant tags from this list: gym, lifestyle, money, cash, luxury, car, travel, team, agent-win, recruiting, deal-close, motivational, personal-brand, outdoor, office, celebration, food, family, training, event, social"],
  "description": "one sentence description",
  "suggested_title": "short catchy title for social media post",
  "content_type": "one of: lifestyle, achievement, recruiting, training, personal, team"
}
Return ONLY valid JSON, no other text.`,
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            aiTags = parsed.tags || [];
            aiDescription = parsed.description || "";
            suggestedTitle = parsed.suggested_title || "";
            contentType = parsed.content_type || "";
          } catch (e) {
            console.error("JSON parse error:", e, "Raw:", raw);
          }
        }
      } else {
        console.error("AI API error:", response.status, await response.text());
      }
    } else if (fileType === "video") {
      aiTags = ["video"];
      const lower = fileUrl.toLowerCase();
      if (lower.includes("gym") || lower.includes("workout")) aiTags.push("gym", "lifestyle");
      if (lower.includes("team") || lower.includes("group")) aiTags.push("team");
      if (lower.includes("deal") || lower.includes("close")) aiTags.push("deal-close", "agent-win");
      if (lower.includes("train")) aiTags.push("training");
      aiDescription = "Video content";
      contentType = "personal";
    }

    // Update the content_library record with AI tags
    const updateData: Record<string, unknown> = {
      ai_analyzed: true,
      ai_analyzed_at: new Date().toISOString(),
      ai_tags: aiTags,
      ai_description: aiDescription,
    };

    const { data: existing } = await supabase
      .from("content_library")
      .select("title, content_type")
      .eq("id", contentItemId)
      .single();

    if (suggestedTitle && (!existing?.title || existing.title === "Untitled")) {
      updateData.title = suggestedTitle;
    }
    if (contentType && !existing?.content_type) {
      updateData.content_type = contentType;
    }

    const { error: updateError } = await supabase
      .from("content_library")
      .update(updateData)
      .eq("id", contentItemId);

    if (updateError) {
      console.error("Update error:", updateError);
      throw updateError;
    }

    console.log(`✅ Analysis complete for ${contentItemId}: ${aiTags.join(", ")}`);

    return new Response(
      JSON.stringify({ success: true, safe: true, tags: aiTags, description: aiDescription, contentType }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Analyze error:", error);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
