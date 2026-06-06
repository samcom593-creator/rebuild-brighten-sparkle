import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";

// wave-23 (2026-06-06): Lazy boundary anchor for vendor-query.
// Static eager-imports of QueryClientProvider + queryClient (from "@tanstack/react-query")
// were the only edges dragging the 28 KB raw / 7.95 KB gz vendor-query chunk into the
// cold-landing modulepreload chain. Zero eager-landing components reference react-query
// — every useQuery call lives inside a React.lazy boundary (LiveStats, RecentHires,
// CTASection, CareerPathwaySection, and every non-landing route). Loading this tiny
// wrapper through React.lazy() means vendor-query is fetched on-demand by lazy children's
// Suspense, not preloaded by the entry HTML.
// The shared singleton queryClient is still exported from queryClient.ts so every
// QueryClientProvider mount (lazy or otherwise) reuses the same cache.
export function QueryProviderInner({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
