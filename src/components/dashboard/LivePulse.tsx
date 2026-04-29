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

type Tile = {
  key: string;
  label: string;
  count: number;
  Icon: typeof Sparkles;
  color: string;
  pulsedAt: number; // ms timestamp — drives the flash animation
};

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayLocalDateStr(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

export function LivePulse() {
  const [apps, setApps] = useState(0);
  const [deals, setDeals] = useState(0);
  const [hires, setHires] = useState(0);
  const [liveProducers, setLiveProducers] = useState(0);

  const pulsedRef = useRef<Record<string, number>>({
    apps: 0, deals: 0, hires: 0, liveProducers: 0,
  });
  const [, forcePulse] = useState(0);
  const liveAgentSetRef = useRef<Set<string>>(new Set());

  const pulse = (key: string) => {
    pulsedRef.current[key] = Date.now();
    forcePulse((n) => n + 1);
  };

  // Initial counts for today.
  // Deals counted by effective_date (agency truth) and only valid statuses
  // — re-syncs would otherwise re-count the same deal.
  useEffect(() => {
    const start = startOfTodayISO();
    const tStr = todayLocalDateStr();
    (async () => {
      const [a, d, h, prod] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", start),
        supabase.from("deals").select("id", { count: "exact", head: true }).eq("effective_date", tStr).in("status", ["submitted", "active"]),
        // Hires = applications closed today (closed_at >= start of day local)
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("closed_at", start),
        // Live producers = distinct agent_ids with a deal that's effective today
        supabase.from("deals").select("agent_id").eq("effective_date", tStr).in("status", ["submitted", "active"]),
      ]);
      setApps(a.count ?? 0);
      setDeals(d.count ?? 0);
      setHires(h.count ?? 0);
      const ids = new Set<string>();
      (prod.data ?? []).forEach((r: any) => r.agent_id && ids.add(r.agent_id));
      liveAgentSetRef.current = ids;
      setLiveProducers(ids.size);
    })();
  }, []);

  // Realtime subscriptions.
  // Deal inserts only tick the counter if the new row's effective_date is
  // today AND status is valid — re-syncs of historical deals don't inflate.
  useEffect(() => {
    const todayStr = todayLocalDateStr();
    const ch = supabase.channel("apex-live-pulse")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, () => {
        setApps((n) => n + 1); pulse("apps");
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
        const effOk = String(row.effective_date ?? "").startsWith(todayStr);
        const statusOk = row.status === "submitted" || row.status === "active";
        if (effOk && statusOk) {
          setDeals((n) => n + 1); pulse("deals");
          if (row.agent_id && !liveAgentSetRef.current.has(row.agent_id)) {
            liveAgentSetRef.current.add(row.agent_id);
            setLiveProducers(liveAgentSetRef.current.size);
            pulse("liveProducers");
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const tiles = useMemo<Tile[]>(() => [
    { key: "apps",          label: "apps today",      count: apps,          Icon: FileText,   color: "#3b82f6", pulsedAt: pulsedRef.current.apps },
    { key: "deals",         label: "deals today",     count: deals,         Icon: DollarSign, color: "#10b981", pulsedAt: pulsedRef.current.deals },
    { key: "hires",         label: "hires today",     count: hires,         Icon: UserCheck,  color: "#8b5cf6", pulsedAt: pulsedRef.current.hires },
    { key: "liveProducers", label: "live producers",  count: liveProducers, Icon: Sparkles,   color: "#f59e0b", pulsedAt: pulsedRef.current.liveProducers },
  ], [apps, deals, hires, liveProducers]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
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
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{t.label}</div>
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
  );
}
