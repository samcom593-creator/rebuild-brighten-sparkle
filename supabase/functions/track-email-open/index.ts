import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1x1 transparent GIF
const TRACKING_PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 
  0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 
  0x01, 0x00, 0x3b
]);

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const trackingId = url.searchParams.get("id");

  if (!trackingId) {
    console.log("No tracking ID provided");
    return new Response(TRACKING_PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get current tracking record
    const { data: existing } = await supabaseClient
      .from("email_tracking")
      .select("opened_at, open_count")
      .eq("id", trackingId)
      .single();

    // Update tracking - set opened_at only on first open, always increment count
    const updateData: Record<string, unknown> = {
      open_count: (existing?.open_count || 0) + 1
    };

    if (!existing?.opened_at) {
      updateData.opened_at = new Date().toISOString();
    }

    const { error } = await supabaseClient
      .from("email_tracking")
      .update(updateData)
      .eq("id", trackingId);

    if (error) {
      console.error("Failed to update tracking:", error);
    } else {
      console.log(`Email opened - tracking ID: ${trackingId}, open count: ${updateData.open_count}`);
    }
  } catch (error) {
    console.error("Error tracking email open:", error);
  }

  // Always return the tracking pixel regardless of errors
  return new Response(TRACKING_PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
};

serve(handler);
