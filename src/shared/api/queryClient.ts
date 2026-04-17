import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

/**
 * Smart retry: never retry on 4xx (client errors), retry up to 2x on 5xx/network.
 */
function smartRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return true;
}

/**
 * Fire-and-forget: log unexpected query/mutation errors to function_errors
 * so the Observability panel surfaces them.
 */
async function logClientError(scope: "query" | "mutation", key: string, error: unknown) {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    await supabase.from("function_errors").insert({
      function_name: `client:${scope}:${key}`,
      error_message: message,
      error_stack: stack ?? null,
    });
  } catch {
    /* swallow — never let logging break the app */
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120_000, // 2 min
      gcTime: 300_000,    // 5 min
      refetchOnWindowFocus: false,
      retry: smartRetry,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = Array.isArray(query.queryKey) ? query.queryKey.join(":") : String(query.queryKey);
      // Only log if there's no UI handler registered (avoid duplicate noise)
      if (!query.meta?.silent) {
        void logClientError("query", key, error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const key = mutation.options.mutationKey?.join(":") ?? "anon";
      void logClientError("mutation", key, error);
      // Global toast unless the mutation opts out via meta.silent
      if (!mutation.meta?.silent) {
        const message = error instanceof Error ? error.message : "Something went wrong";
        toast({
          title: "Action failed",
          description: message,
          variant: "destructive",
        });
      }
    },
  }),
});
