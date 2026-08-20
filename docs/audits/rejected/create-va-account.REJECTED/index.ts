import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { createHandler } from "../_shared/handler.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseBody, v } from "../_shared/validate.ts";
import { requireAuth } from "../_shared/auth.ts";

const BodySchema = v.object({
  full_name: v.string({ required: true, min: 1, max: 128 }),
  email: v.string({ required: true, min: 3, max: 256 }),
  password: v.string({ max: 128 }),
});

function generateSecurePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

Deno.serve(
  createHandler(
    {
      functionName: "create-va-account",
      requireAuth: true,
      rateLimit: { maxRequests: 20, windowSeconds: 60 },
    },
    async (req, ctx) => {
      if (!ctx.auth) return errorResponse("Unauthorized", 401, "UNAUTHORIZED");
      const { userId, serviceClient } = ctx.auth;

      // Assert caller is admin or va_manager
      const { data: callerRoles } = await serviceClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      const roles = (callerRoles ?? []).map((r: { role: string }) => r.role);
      const isAllowed = roles.includes("admin") || roles.includes("va_manager");

      if (!isAllowed) {
        return errorResponse("Forbidden: caller must be admin or va_manager", 403, "FORBIDDEN");
      }

      const { full_name, email, password: customPassword } = await parseBody(req, BodySchema);
      const targetEmail = email.trim().toLowerCase();
      const password = customPassword?.trim() || generateSecurePassword();

      // Create auth user
      const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
        email: targetEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { role: "va" },
      });

      if (createError || !newUser.user) {
        return errorResponse(createError?.message || "Failed to create user", 400, "CREATE_USER_FAILED");
      }

      const newUserId = newUser.user.id;

      // Assign app_role = 'va'
      await serviceClient.from("user_roles").upsert(
        { user_id: newUserId, role: "va" },
        { onConflict: "user_id,role" }
      );

      // Upsert profile with managed_by set to caller
      const { data: profile } = await serviceClient
        .from("profiles")
        .upsert(
          {
            user_id: newUserId,
            full_name,
            email: targetEmail,
            managed_by: userId,
          },
          { onConflict: "user_id" }
        )
        .select("id")
        .maybeSingle();

      // Create corresponding agent record if needed
      await serviceClient.from("agents").upsert(
        {
          user_id: newUserId,
          profile_id: profile?.id,
          display_name: full_name,
          status: "active",
          onboarding_stage: "evaluated",
        },
        { onConflict: "user_id" }
      );

      // Audit log without password
      await serviceClient.from("audit_logs").insert({
        actor_id: userId,
        action: "create_va_account",
        target_id: newUserId,
        details: { email: targetEmail, full_name, managed_by: userId },
      });

      return jsonResponse({
        success: true,
        user_id: newUserId,
        email: targetEmail,
        password,
      });
    }
  )
);
