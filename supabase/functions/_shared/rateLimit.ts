// In-DB rate limiting (no Upstash dependency)
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface RateLimitOptions {
  bucketKey: string;
  maxRequests: number;
  windowSeconds: number;
}

export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
}

export async function checkRateLimit(
  serviceClient: SupabaseClient,
  opts: RateLimitOptions
): Promise<void> {
  const { data, error } = await serviceClient.rpc("check_rate_limit", {
    _bucket_key: opts.bucketKey,
    _max_requests: opts.maxRequests,
    _window_seconds: opts.windowSeconds,
  });
  if (error) {
    console.warn("[rateLimit] check failed, allowing:", error.message);
    return;
  }
  if (data === false) {
    throw new RateLimitError(opts.windowSeconds);
  }
}
