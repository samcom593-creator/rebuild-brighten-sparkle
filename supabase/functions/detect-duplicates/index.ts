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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { contentItemId } = await req.json();

    if (!contentItemId) {
      return new Response(
        JSON.stringify({ error: "contentItemId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the new item
    const { data: newItem, error: fetchError } = await supabase
      .from("content_library")
      .select("id, file_type, file_size, original_name, width, height")
      .eq("id", contentItemId)
      .single();

    if (fetchError || !newItem) {
      throw new Error("Content item not found");
    }

    console.log(`🔍 Checking duplicates for: ${newItem.original_name} (${newItem.file_size} bytes)`);

    // Find similar items by file size (within 5% tolerance) and same file type
    const sizeLower = Math.floor((newItem.file_size || 0) * 0.95);
    const sizeUpper = Math.ceil((newItem.file_size || 0) * 1.05);

    let query = supabase
      .from("content_library")
      .select("id, title, original_name, storage_path, file_size, width, height")
      .eq("file_type", newItem.file_type)
      .neq("id", newItem.id);

    if (newItem.file_size && newItem.file_size > 0) {
      query = query.gte("file_size", sizeLower).lte("file_size", sizeUpper);
    }

    const { data: similarItems } = await query;

    let duplicateOf: string | null = null;

    if (similarItems && similarItems.length > 0) {
      // Further filter: if dimensions match or names are similar
      for (const item of similarItems) {
        const dimMatch = newItem.width && newItem.height &&
          item.width === newItem.width && item.height === newItem.height;
        const nameMatch = newItem.original_name && item.original_name &&
          newItem.original_name.toLowerCase() === item.original_name.toLowerCase();
        const exactSizeMatch = newItem.file_size === item.file_size;

        if (dimMatch || nameMatch || exactSizeMatch) {
          duplicateOf = item.id;
          break;
        }
      }

      // If no exact match found but size is very close (within 1%), still flag
      if (!duplicateOf && newItem.file_size && newItem.file_size > 0) {
        const tightLower = Math.floor(newItem.file_size * 0.99);
        const tightUpper = Math.ceil(newItem.file_size * 1.01);
        const tightMatch = similarItems.find(
          (i) => (i.file_size || 0) >= tightLower && (i.file_size || 0) <= tightUpper
        );
        if (tightMatch) {
          duplicateOf = tightMatch.id;
        }
      }
    }

    if (duplicateOf) {
      await supabase
        .from("content_library")
        .update({
          duplicate_flagged: true,
          possible_duplicate_of: duplicateOf,
        })
        .eq("id", contentItemId);

      console.log(`⚠️ Duplicate found: ${contentItemId} → ${duplicateOf}`);
    } else {
      console.log(`✅ No duplicates found for ${contentItemId}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        duplicate_found: !!duplicateOf,
        duplicate_of: duplicateOf,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Duplicate detection error:", error);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
