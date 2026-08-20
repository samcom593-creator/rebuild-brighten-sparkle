import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";

const BodySchema = v.object({
  va_user_id: v.string({ required: true, min: 1, max: 64 }),
  action: v.enum(["enable", "disable"]),
});

Deno.serve(
  createHandler(
    {
      functionName: "set-va-account",
      requireAuth: true,
      rateLimit: { maxRequests: 30, windowSeconds: 60 },
    },
    async (req, ctx) => {
      if (!ctx.auth) return errorResponse("Unauthorized", 401, "UNAUTHORIZED");
      const { userId, serviceClient } = ctx.auth;
      const { va_user_id, action } = await parseBody(req, BodySchema);

      // Assert caller roles
      const { data: callerRoles } = await serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      const roles = (callerRoles ?? []).map((r: { role: string }) => r.role);
      const isAdmin = roles.includes("admin");
      const isVaManager = roles.includes("va_manager");

      if (!isAdmin && !isVaManager) {
        return errorResponse("Forbidden: caller must be admin or va_manager", 403, "FORBIDDEN");
      }

      // If va_manager and not admin, enforce ownership boundary
      if (!isAdmin) {
        const { data: targetProfile } = await serviceClient
          .from("profiles")
          .select("managed_by")
          .eq("user_id", va_user_id)
          .maybeSingle();

        if (!targetProfile || targetProfile.managed_by !== userId) {
          return errorResponse("Forbidden: VA account is not managed by you", 403, "FORBIDDEN");
        }
      }

      // Perform auth ban duration update
      const banDuration = action === "disable" ? "876000h" : "none";
      const { error: banError } = await serviceClient.auth.admin.updateUserById(va_user_id, {
        ban_duration: banDuration,
      });

      if (banError) {
        return errorResponse(banError.message, 500, "UPDATE_USER_FAILED");
      }

      // Update agent status if present
      await serviceClient
        .from("agents")
        .update({
          is_deactivated: action === "disable",
          status: action === "disable" ? "disabled" : "active",
        })
        .eq("user_id", va_user_id);

      // Audit log
      await serviceClient.from("audit_logs").insert({
        actor_id: userId,
        action: `set_va_account_${action}`,
        target_id: va_user_id,
        details: { va_user_id, action, ban_duration: banDuration },
      });

      return jsonResponse({
        success: true,
        va_user_id,
        action,
        disabled: action === "disable",
      });
    }
  )
);
