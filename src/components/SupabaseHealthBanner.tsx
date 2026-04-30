import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * SupabaseHealthBanner — pings PostgREST every 60s with a 6s timeout.
 * If the data plane is hung (PostgREST/bot-sql/RPCs all timing out),
 * a non-blocking amber banner appears at the top of the page so Sam
 * knows his dashboard isn't broken — it's a platform issue.
 *
 * Why this exists: 2026-04-29 — the Supabase data plane locked up
 * (bot-sql IDLE_TIMEOUT, RPCs hanging). Site loaded (Vercel was fine)
 * but every dashboard query spun forever with no signal to the user.
 * This gives a clear "platform is sluggish, retrying" indicator.
 */
export function SupabaseHealthBanner() {
  const [state, setState] = useState<"ok" | "slow" | "down">("ok");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 6000);
      const t0 = performance.now();
      try {
        // Cheap query — single row from a small table, served by PostgREST.
        // Aborts after 6s so a hung backend doesn't keep us hanging too.
        const { error } = await supabase
          .from("system_settings")
          .select("key")
          .limit(1)
          .abortSignal(ctrl.signal);
        const ms = performance.now() - t0;
        if (cancelled) return;
        if (error) {
          setState("down");
        } else if (ms > 3000) {
          setState("slow");
        } else {
          setState("ok");
        }
      } catch {
        if (!cancelled) setState("down");
      } finally {
        clearTimeout(timeout);
      }
    };
    probe();
    const id = setInterval(probe, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (dismissed || state === "ok") return null;

  const message = state === "down"
    ? "Backend is unresponsive. Dashboards may load forever or show stale data. This is platform-side — not your build."
    : "Backend is sluggish. Some queries are taking >3s.";

  return (
    <div className="sticky top-0 z-50 bg-amber-500/95 text-amber-950 border-b border-amber-700 px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="truncate"><strong>Supabase {state === "down" ? "down" : "slow"}</strong> · {message}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 hover:bg-amber-600/40 rounded p-1"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
