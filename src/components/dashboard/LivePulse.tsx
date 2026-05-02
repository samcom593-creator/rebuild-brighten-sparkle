// Live pulse widget — always-on realtime counters that tick as things happen.
// Subscribes to Supabase realtime on applications / deals / new-hire INSERTs.
// When a row arrives, the relevant counter pulses (scale + color flash) and
// the cumulative number updates instantly.
//
// Sam 2026-04-29: replaced "DMs today" + "events all day" (low-signal) with
// "hires today" (closed_at = today) + "live producers" (distinct agents
// with a deal today). Both reflect the only metrics that actually move
// the agency forward.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, DollarSign, UserCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getBusinessDayBounds, getBusinessDayKey } from "@/lib/dateUtils";
import { METRIC_REGISTRY, getTodayMetricSummary } from "@/lib/metricTruth";

type Tile = {
  key: string;
  label: string;
  count: number;
  Icon: typeof Sparkles;
  color: string;
  pulsedAt: number;
  hint: string;
};

export function LivePulse() {
  const [apps, setApps] = useState(0);
  const [deals, setDeals] = useState(0);
  const [hires, setHires] = useState(0);
  const [liveProducers, setLiveProducers] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const pulsedRef = useRef<Record<string, number>>({
    apps: 0, deals: 0, hires: 0, liveProducers: 0,
  });
  const [, forcePulse] = useState(0);
  const liveAgentSetRef = useRef<Set<string>>(new Set());

  const pulse = (key: string) => {
    pulsedRef.current[key] = Date.now();
    forcePulse((n) => n + 1);
  };

  // Initial counts for today in America/Chicago.
  useEffect(() => {
    const { startIso, endIso } = getBusinessDayBounds();
    (async () => {
      const [a, d, h, prod, syncRow] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", startIso).lt("created_at", endIso),
        supabase.from("deals").select("id", { count: "exact", head: true }).gte("posted_at", startIso).lt("posted_at", endIso).in("status", ["submitted", "active"]),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("closed_at", startIso).lt("closed_at", endIso),
        supabase.from("deals").select("agent_id").gte("posted_at", startIso).lt("posted_at", endIso).in("status", ["submitted", "active"]),
        supabase.from("agentlink_sync_log" as any).select("finished_at, started_at").eq("status", "ok").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setApps(a.count ?? 0);
      setDeals(d.count ?? 0);
      setHires(h.count ?? 0);
      const ids = new Set<string>();
      (prod.data ?? []).forEach((r: any) => r.agent_id && ids.add(r.agent_id));
      liveAgentSetRef.current = ids;
      setLiveProducers(ids.size);
      const latestSync = syncRow.data as { finished_at?: string | null; started_at?: string | null } | null;
      setLastUpdatedAt(latestSync?.finished_at || latestSync?.started_at || null);
    })();
  }, []);

  // Realtime subscriptions.
  // Deal inserts only tick the counter if the new row's posted_at falls inside
  // the current Central-time day and the status is production-valid.
  useEffect(() => {
    const { startIso, endIso } = getBusinessDayBounds();
    const todayStr = getBusinessDayKey();
    const ch = supabase.channel("apex-live-pulse")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, (payload: any) => {
        const row = payload?.new ?? {};
        const createdAt = row.created_at ? new Date(row.created_at).toISOString() : "";
        const createdToday = createdAt >= startIso && createdAt < endIso;
        if (createdToday) {
          setApps((n) => n + 1);
          pulse("apps");
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "applications" }, (payload: any) => {
        // Detect a hire: closed_at goes from null → today.
        const oldRow = payload?.old ?? {};
        const newRow = payload?.new ?? {};
        const wasNull = !oldRow.closed_at;
        const nowSet = !!newRow.closed_at && String(newRow.closed_at).startsWith(todayStr);
        if (wasNull && nowSet) {
          setHires((n) => n + 1); pulse("hires");
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deals" }, (payload: any) => {
        const row = payload?.new ?? {};
        const postedAt = row.posted_at ? new Date(row.posted_at).toISOString() : "";
        const postedToday = postedAt >= startIso && postedAt < endIso;
        const statusOk = row.status === "submitted" || row.status === "active";
        if (postedToday && statusOk) {
          setDeals((n) => n + 1); pulse("deals");
          if (row.agent_id && !liveAgentSetRef.current.has(row.agent_id)) {
            liveAgentSetRef.current.add(row.agent_id);
            setLiveProducers(liveAgentSetRef.current.size);
            pulse("liveProducers");
          }
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agentlink_sync_log" }, (payload: any) => {
        const row = payload?.new ?? {};
        if (row.status === "ok") {
          setLastUpdatedAt(row.finished_at || row.started_at || null);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const tiles = useMemo<Tile[]>(() => [
    {
      key: "apps",
      label: "Applications Today",
      count: apps,
      Icon: FileText,
      color: "#3b82f6",
      pulsedAt: pulsedRef.current.apps,
      hint: "applications.created_at",
    },
    {
      key: "deals",
      label: "Deals Today",
      count: deals,
      Icon: DollarSign,
      color: "#10b981",
      pulsedAt: pulsedRef.current.deals,
      hint: METRIC_REGISTRY.dealsToday.dateField,
    },
    {
      key: "hires",
      label: "Hires Today",
      count: hires,
      Icon: UserCheck,
      color: "#8b5cf6",
      pulsedAt: pulsedRef.current.hires,
      hint: "applications.closed_at",
    },
    {
      key: "liveProducers",
      label: "Live Producers",
      count: liveProducers,
      Icon: Sparkles,
      color: "#f59e0b",
      pulsedAt: pulsedRef.current.liveProducers,
      hint: "distinct agent_id from deals.posted_at",
    },
  ], [apps, deals, hires, liveProducers]);

  return (
    <div className="mb-5 space-y-2">
      <p className="text-[11px] text-muted-foreground">{getTodayMetricSummary(lastUpdatedAt)}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => {
        const fresh = Date.now() - t.pulsedAt < 2000;
        return (
          <motion.div
            key={t.key}
            animate={fresh ? { scale: [1, 1.05, 1] } : { scale: 1 }}
            transition={{ duration: 0.6 }}
            className="relative overflow-hidden rounded-xl border bg-card px-4 py-3 shadow-sm"
            style={fresh ? { borderColor: `${t.color}80` } : undefined}
          >
            <AnimatePresence>
              {fresh && (
                <motion.div
                  key={t.pulsedAt}
                  initial={{ opacity: 0.6 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 1.2 }}
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at top right, ${t.color}35, transparent 60%)` }}
                />
              )}
            </AnimatePresence>
            <div className="flex items-center gap-2 relative">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${t.color}15`, color: t.color }}>
                <t.Icon className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                <motion.div
                  key={t.count}
                  initial={{ y: -6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="text-xl font-bold tabular-nums"
                  style={fresh ? { color: t.color } : undefined}
                >
                  {t.count}
                </motion.div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{t.hint}</div>
              </div>
              {fresh && (
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="absolute top-1 right-1 w-2 h-2 rounded-full"
                  style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }}
                />
              )}
            </div>
          </motion.div>
        );
        })}
      </div>
    </div>
  );
}
