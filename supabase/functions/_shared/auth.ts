// Shared JWT verification & role checks for edge functions
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuthContext {
  userId: string;
  email?: string;
  role?: string;
  client: SupabaseClient;
  serviceClient: SupabaseClient;
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid Authorization header", 401);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new AuthError("Invalid token", 401);
  }

  const serviceClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  return {
    userId: data.claims.sub,
    email: data.claims.email as string | undefined,
    role: data.claims.role as string | undefined,
    client,
    serviceClient,
  };
}

export async function requireRole(ctx: AuthContext, role: "admin" | "manager" | "agent"): Promise<void> {
  const { data, error } = await ctx.serviceClient.rpc("has_role", {
    _user_id: ctx.userId,
    _role: role,
  });
  if (error || !data) {
    throw new AuthError(`Forbidden: requires ${role} role`, 403);
  }
}

export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AuthError";
  }
}
