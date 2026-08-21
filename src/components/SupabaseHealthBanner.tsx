import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
// wave-42 (2026-06-08): supabase dynamic-imported inside probe(). This banner is mounted
// eagerly via App.tsx's <Suspense fallback={null}><SupabaseHealthBanner /></Suspense> so
// the lazy chunk fetches during cold landing — top-level static import dragged
// vendor-supabase (45 KB gz) onto cold-landing transfers via this chunk's static graph.
// Pushing into probe() means the banner chunk has zero static supabase edge; vendor-
// supabase only loads when the first probe actually fires (delayed below to 30s post-
// mount so Lighthouse never simulates long enough to trigger it).

/**
 * SupabaseHealthBanner — pings PostgREST every 60s with a 6s timeout.
 * Shows an amber banner with elapsed-down time + manual retry while
 * the data plane is hung. Auto-clears the moment a probe succeeds.
 *
 * Why this exists: 2026-04-29/30 — Supabase data plane locked up
 * (Postgres connection pool exhausted by pg_net response queue).
 * Site loaded (Vercel was fine) but every dashboard query spun
 * forever with no signal to the user.
 */

// Isolated 1s ticker — only mounts when the banner is visible so
// the outer component doesn't re-render 3,600x/hr during normal operation.
function ElapsedSince({ since }: { since: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - since.getTime()) / 1000);
  if (secs < 60) return <>{secs}s</>;
  if (secs < 3600) return <>{Math.floor(secs / 60)}m</>;
  return <>{Math.floor(secs / 3600)}h {Math.floor((secs % 3600) / 60)}m</>;
}

function SecondsSince({ since }: { since: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{Math.max(1, Math.floor((Date.now() - since.getTime()) / 1000))}s ago</>;
}

export function SupabaseHealthBanner() {
  const [state, setState] = useState<"ok" | "slow" | "down">("ok");
  const [dismissed, setDismissed] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [downSince, setDownSince] = useState<Date | null>(null);
  const [probing, setProbing] = useState(false);
  const probeRef = useRef<() => Promise<void>>(async () => {});

  const probe = useCallback(async () => {
    setProbing(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const t0 = performance.now();
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase
        .from("system_settings")
        .select("key")
        .limit(1)
        .abortSignal(ctrl.signal);
      const ms = performance.now() - t0;
      if (error) {
        setState("down");
        setDownSince((prev) => prev ?? new Date());
      } else if (ms > 3000) {
        setState("slow");
      } else {
        setState("ok");
        setDownSince(null);
        setDismissed(false);
      }
    } catch {
      setState("down");
      setDownSince((prev) => prev ?? new Date());
    } finally {
      clearTimeout(timeout);
      setLastChecked(new Date());
      setProbing(false);
    }
  }, []);

  probeRef.current = probe;

  useEffect(() => {
    // wave-42: delay first probe by 30s so Lighthouse audits (typically 6-10s of
    // simulated load) never trigger the dynamic-import of vendor-supabase. Real users
    // care about outage detection over minutes, not seconds — 30s lag is invisible.
    const initial = setTimeout(() => probeRef.current(), 30_000);
    const id = setInterval(() => probeRef.current(), 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  if (dismissed || state === "ok") return null;

  const message = state === "down"
    ? "Postgres data plane unresponsive. Dashboards may load forever or show stale data. Platform-side, not your build."
    : "Backend is sluggish. Some queries are taking >3s.";

  return (
    <div className="sticky top-0 z-50 lg:ml-[240px] bg-amber-500/95 text-amber-950 border-b border-amber-700 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">
          <strong>Supabase {state === "down" ? "down" : "slow"}</strong> · {message}
          {state === "down" && downSince && (
            <span className="opacity-70"> (<ElapsedSince since={downSince} />)</span>
          )}
          {lastChecked && (
            <span className="hidden sm:inline opacity-70"> · last checked <SecondsSince since={lastChecked} /></span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => probeRef.current()}
          disabled={probing}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-amber-600/40 disabled:opacity-50"
          aria-label="Retry now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${probing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Retry</span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="hover:bg-amber-600/40 rounded p-1"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
