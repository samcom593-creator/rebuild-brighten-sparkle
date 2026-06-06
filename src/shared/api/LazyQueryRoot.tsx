import { lazy, Suspense, type ReactNode } from "react";

// wave-23 (2026-06-06): Single React.lazy chunk anchor for vendor-query.
// Multiple consumers (HeroSection's LiveStats+RecentHires Suspense, Index's lower
// Suspense block, the App-level QueryShell layout route for non-landing pages)
// all reference this same lazy import. First resolution loads vendor-query + the
// tiny QueryProviderInner module; subsequent boundaries hit the module cache and
// resolve synchronously. Keeping the lazy() call here (not inline at every
// consumer) ensures rolldown sees ONE dynamic-import edge per build.
const QueryProviderInner = lazy(() =>
  import("./QueryProviderInner").then((m) => ({ default: m.QueryProviderInner })),
);

export function LazyQueryRoot({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <QueryProviderInner>{children}</QueryProviderInner>
    </Suspense>
  );
}
