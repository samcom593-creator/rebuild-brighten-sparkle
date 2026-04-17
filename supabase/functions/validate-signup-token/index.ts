import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const BodySchema = v.object({
  token: v.string({ required: true, min: 32, max: 256 }),
});

Deno.serve(
  createHandler(
    {
      functionName: "validate-signup-token",
      // Brute-force protection on token guessing
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req) => {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const { token } = await parseBody(req, BodySchema);

      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      const { data, error } = await supabaseAdmin
        .from("manager_signup_tokens")
        .select("id, manager_name, manager_email, is_used, expires_at")
        .eq("token", token)
        .maybeSingle();

      if (error || !data) {
        return jsonResponse({ valid: false, error: "Token not found" });
      }

      if (data.is_used) {
        return jsonResponse({ valid: false, error: "This invite link has already been used" });
      }

      if (new Date(data.expires_at) < new Date()) {
        return jsonResponse({ valid: false, error: "This invite link has expired" });
      }

      return jsonResponse({
        valid: true,
        manager_name: data.manager_name,
        manager_email: data.manager_email,
      });
    }
  )
);
