// XCEL last-synced badge (MP-245 · 2026-07-06)
//
// Small inline badge on DashboardCommandCenter showing the most recent
// xcel_events row's created_at timestamp. Rose-colored when the newest
// event is older than 24h — same disease Sam saw with InsuraCloud auth
// silently returning "success" while the pipeline was actually dead.
//
// Reads MAX(created_at) from public.xcel_events. Selects order desc + limit 1
// (cheap, indexed by default on primary key + created_at fallback).
import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function XcelLastSyncedBadge({ className }: { className?: string }) {
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("xcel_events")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setFailed(true);
        } else {
          setLastSynced((data?.created_at as string | null) ?? null);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;
  if (failed) return null;

  const isStale =
    !lastSynced ||
    Date.now() - new Date(lastSynced).getTime() > STALE_THRESHOLD_MS;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        isStale
          ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
          : "border-slate-300/40 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
        className,
      )}
      title={
        lastSynced
          ? `Most recent XCEL sync: ${new Date(lastSynced).toLocaleString()}`
          : "No XCEL syncs yet"
      }
    >
      {isStale ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      <span>
        XCEL sync: {lastSynced ? timeAgo(lastSynced) : "never"}
      </span>
    </div>
  );
}
