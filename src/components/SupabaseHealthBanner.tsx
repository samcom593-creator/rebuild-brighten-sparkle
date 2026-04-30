import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
export function SupabaseHealthBanner() {
  const [state, setState] = useState<"ok" | "slow" | "down">("ok");
  const [dismissed, setDismissed] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [downSince, setDownSince] = useState<Date | null>(null);
  const [probing, setProbing] = useState(false);
  const [, setTick] = useState(0);
  const probeRef = useRef<() => Promise<void>>(async () => {});

  const probe = useCallback(async () => {
    setProbing(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const t0 = performance.now();
    try {
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
    probeRef.current();
    const id = setInterval(() => probeRef.current(), 60_000);
    const tickId = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { clearInterval(id); clearInterval(tickId); };
  }, []);

  if (dismissed || state === "ok") return null;

  const downFor = downSince ? Math.floor((Date.now() - downSince.getTime()) / 1000) : 0;
  const downForLabel = downFor < 60
    ? `${downFor}s`
    : downFor < 3600
      ? `${Math.floor(downFor / 60)}m`
      : `${Math.floor(downFor / 3600)}h ${Math.floor((downFor % 3600) / 60)}m`;
  const lastCheckedLabel = lastChecked
    ? `${Math.max(1, Math.floor((Date.now() - lastChecked.getTime()) / 1000))}s ago`
    : "—";

  const message = state === "down"
    ? `Postgres data plane unresponsive (${downForLabel}). Dashboards may load forever or show stale data. Platform-side, not your build.`
    : "Backend is sluggish. Some queries are taking >3s.";

  return (
    <div className="sticky top-0 z-50 bg-amber-500/95 text-amber-950 border-b border-amber-700 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">
          <strong>Supabase {state === "down" ? "down" : "slow"}</strong> · {message}
          <span className="hidden sm:inline opacity-70"> · last checked {lastCheckedLabel}</span>
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
