// Live pulse widget — always-on realtime counters that tick as things happen.
// Subscribes to Supabase realtime on applications / deals / inbox_messages
// INSERTs. When a row arrives, the relevant counter pulses (scale + color
// flash) and the cumulative number updates instantly.
//
// Lightweight: no heavy query every second — uses realtime events to
// increment a local counter, and pulls the initial today-count once on
// mount.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, DollarSign, MessageSquare, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Tile = {
  key: string;
  label: string;
  count: number;
  Icon: typeof Activity;
  color: string;
  pulsedAt: number; // ms timestamp — drives the flash animation
};

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function LivePulse() {
  const [apps, setApps] = useState(0);
  const [deals, setDeals] = useState(0);
  const [dms, setDms] = useState(0);
  const [activity, setActivity] = useState(0);

  const pulsedRef = useRef<Record<string, number>>({
    apps: 0, deals: 0, dms: 0, activity: 0,
  });
  const [, forcePulse] = useState(0);

  const pulse = (key: string) => {
    pulsedRef.current[key] = Date.now();
    forcePulse((n) => n + 1);
  };

  // Initial counts for today
  useEffect(() => {
    const start = startOfTodayISO();
    (async () => {
      const [a, d, m] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", start),
        supabase.from("deals").select("id", { count: "exact", head: true }).gte("created_at", start),
        supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("received_at", start),
      ]);
      setApps(a.count ?? 0);
      setDeals(d.count ?? 0);
      setDms(m.count ?? 0);
    })();
  }, []);

  // Realtime subscriptions
  useEffect(() => {
    const ch = supabase.channel("apex-live-pulse")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, () => {
        setApps((n) => n + 1); setActivity((n) => n + 1); pulse("apps"); pulse("activity");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deals" }, () => {
        setDeals((n) => n + 1); setActivity((n) => n + 1); pulse("deals"); pulse("activity");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inbox_messages", filter: "direction=eq.inbound" }, () => {
        setDms((n) => n + 1); setActivity((n) => n + 1); pulse("dms"); pulse("activity");
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const tiles = useMemo<Tile[]>(() => [
    { key: "apps",     label: "apps today",       count: apps,    Icon: FileText,       color: "#3b82f6", pulsedAt: pulsedRef.current.apps },
    { key: "deals",    label: "deals today",      count: deals,   Icon: DollarSign,     color: "#10b981", pulsedAt: pulsedRef.current.deals },
    { key: "dms",      label: "DMs today",        count: dms,     Icon: MessageSquare,  color: "#8b5cf6", pulsedAt: pulsedRef.current.dms },
    { key: "activity", label: "events all day",   count: activity,Icon: Activity,       color: "#f59e0b", pulsedAt: pulsedRef.current.activity },
  ], [apps, deals, dms, activity]);

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
