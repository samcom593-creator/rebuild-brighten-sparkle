// Universal edge function handler with auth, rate limiting, audit, error capture
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, errorResponse, jsonResponse } from "./cors.ts";
import { AuthContext, AuthError, requireAuth } from "./auth.ts";
import { RateLimitError, checkRateLimit } from "./rateLimit.ts";
import { logFunctionError } from "./audit.ts";

export interface HandlerOptions {
  functionName: string;
  requireAuth?: boolean;
  rateLimit?: { maxRequests: number; windowSeconds: number };
  idempotent?: boolean;
}

export type HandlerFn = (req: Request, ctx: { auth?: AuthContext; requestId: string }) => Promise<Response>;

export function createHandler(opts: HandlerOptions, fn: HandlerFn): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const startedAt = Date.now();
    let auth: AuthContext | undefined;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    try {
      if (opts.requireAuth) {
        auth = await requireAuth(req);
      }

      if (opts.rateLimit) {
        const bucket = auth?.userId ?? req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "anon";
        await checkRateLimit(serviceClient, {
          bucketKey: `${opts.functionName}:${bucket}`,
          maxRequests: opts.rateLimit.maxRequests,
          windowSeconds: opts.rateLimit.windowSeconds,
        });
      }

      // Idempotency check
      if (opts.idempotent) {
        const idemKey = req.headers.get("idempotency-key");
        if (idemKey) {
          const { data } = await serviceClient
            .from("idempotency_keys")
            .select("response_payload, status_code")
            .eq("idempotency_key", idemKey)
            .maybeSingle();
          if (data?.response_payload) {
            return jsonResponse(data.response_payload, data.status_code ?? 200);
          }
        }
      }

      const response = await fn(req, { auth, requestId });

      console.log(`[${opts.functionName}] ${response.status} ${Date.now() - startedAt}ms req=${requestId}`);
      return response;
    } catch (err) {
      if (err instanceof AuthError) {
        return errorResponse(err.message, err.status, "AUTH_ERROR");
      }
      if (err instanceof RateLimitError) {
        return errorResponse("Too many requests", 429, "RATE_LIMIT", { retryAfter: err.retryAfter });
      }
      await logFunctionError(serviceClient, opts.functionName, err, undefined, auth?.userId, requestId);
      const message = err instanceof Error ? err.message : "Internal server error";
      return errorResponse(message, 500, "INTERNAL_ERROR");
    }
  };
}
