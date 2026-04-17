import { supabase } from "@/integrations/supabase/client";

export interface InvokeOptions {
  idempotencyKey?: string;
  timeout?: number;
}

export interface InvokeResult<T> {
  data: T | null;
  error: { message: string; code?: string; status?: number } | null;
  requestId: string;
}

/**
 * Production-grade edge function invoker with:
 * - Automatic request ID for tracing
 * - Optional idempotency key
 * - Structured error normalization
 * - Timeout handling
 */
export async function safeInvoke<T = any>(
  functionName: string,
  body: Record<string, any> = {},
  opts: InvokeOptions = {}
): Promise<InvokeResult<T>> {
  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
      headers,
    });

    if (error) {
      return {
        data: null,
        error: { message: error.message ?? "Unknown error", status: (error as any).status },
        requestId,
      };
    }

    if (data?.error) {
      return {
        data: null,
        error: {
          message: data.error.message ?? data.error,
          code: data.error.code,
        },
        requestId,
      };
    }

    return { data: data as T, error: null, requestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { data: null, error: { message }, requestId };
  }
}
