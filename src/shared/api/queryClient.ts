import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@/shared/ui/lazyToast";

// wave-19 (2026-06-04): supabase pulled out of module-scope static graph.
// queryClient is one of App.tsx's eager imports; the supabase client was only
// used inside the error-handler path (logClientError). Lazy-loading at the
// error site means vendor-supabase no longer gets preloaded via this edge.

/**
 * Smart retry: never retry on 4xx (client errors), retry up to 2x on 5xx/network.
 */
function smartRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  // 429 (rate-limited) is transient — retry it instead of blanking a KPI.
  if (status === 429) return true;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return true;
}

/**
 * Fire-and-forget: log unexpected query/mutation errors to function_errors
 * so the Observability panel surfaces them.
 */
async function logClientError(scope: "query" | "mutation", key: string, error: unknown) {
  try {
    // PostgREST errors are plain objects, so String() yields "[object Object]" —
    // which cost three diagnoses on 2026-11-09 alone (the lead-drop 409 had to be
    // recovered from the edge + postgres logs). Serialize the fields instead.
    const message = error instanceof Error
      ? error.message
      : (() => {
          const e = error as { message?: string; code?: string; details?: string; hint?: string } | null;
          const parts = [e?.code, e?.message, e?.details, e?.hint].filter(Boolean);
          if (parts.length) return parts.join(" | ").slice(0, 500);
          try { return JSON.stringify(error).slice(0, 500); } catch { return String(error); }
        })();
    const stack = error instanceof Error ? error.stack : undefined;
    const { supabase } = await import("@/integrations/supabase/client");
    // function_errors is not anon-writable (RLS). On public pages (hall-of-fame,
    // apply, leaderboard) an anonymous visitor's query error would fire an INSERT
    // that 403s — pure network noise with zero observability gain (the write
    // fails anyway). Only log when there's a session.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from("function_errors").insert({
      function_name: `client:${scope}:${key}`,
      error_message: message,
      error_stack: stack ?? null,
    });
  } catch { // empty-catch-allow:telemetry-fire-and-forget
    /* swallow — never let logging break the app */
  }
}

/**
 * The sink's function_name is `client:query:<key>`. Array.join stringifies an
 * object part as "[object Object]", which is what every lead-pool error row
 * read as on 2026-11-09 (key = ["lead-pool", pool, filters]) — the exact
 * filters that reproduced a statement timeout were unrecoverable from the
 * row. Object parts are JSON now; the key is capped so a big filter object
 * cannot blow out the column.
 */
export function serializeQueryKey(queryKey: unknown): string {
  const part = (p: unknown): string => {
    if (p === null || p === undefined) return String(p);
    if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") return String(p);
    try { return JSON.stringify(p) ?? String(p); } catch { return String(p); }
  };
  const key = Array.isArray(queryKey) ? queryKey.map(part).join(":") : part(queryKey);
  return key.slice(0, 200);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Render in-memory/service-worker cached truth immediately when the
      // network disappears, then refetch every active view on reconnect.
      networkMode: "offlineFirst",
      staleTime: 120_000, // 2 min
      gcTime: 300_000,    // 5 min
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: smartRetry,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = serializeQueryKey(query.queryKey);
      // Only log if there's no UI handler registered (avoid duplicate noise)
      if (!query.meta?.silent) {
        void logClientError("query", key, error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey ? serializeQueryKey(mutation.options.mutationKey) : "anon";
      void logClientError("mutation", key, error);
      // Global toast unless the mutation opts out via meta.silent
      if (!mutation.meta?.silent) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast.error("Action failed", { description: message });
      }
    },
  }),
});
