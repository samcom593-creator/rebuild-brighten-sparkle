import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, BarChart, Bar, Legend,
} from "recharts";
import {
  ShieldAlert, Receipt, AlertTriangle, CheckCircle2, Activity,
  TrendingUp, TrendingDown, DollarSign, Users, Wifi, WifiOff,
  ArrowRight, Crown, Sparkles, Skull, Flame, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface CCRow {
  active_strikes: number;
  active_major: number;
  strikes_7d: number;
  resolved_7d: number;
  total_charges: number;
  flagged_charges: number;
  duplicate_window_charges: number;
  charges_7d: number;
  total_billed_usd: number | string;
  duplicate_overcharge_usd: number | string;
  acknowledged_count: number;
  refund_requested_count: number;
  flagged_agents: number;
  last_charge_at: string | null;
  webhook_silent_minutes: number | string | null;
  webhook_status: "no_data" | "healthy" | "stale" | "silent";
}

interface EventRow {
  event_type: "strike" | "charge_anomaly";
  event_id: string;
  occurred_at: string;
  agent_id: string | null;
  agent_name: string | null;
  severity_or_flag: string | null;
  title: string;
  description: string;
  detail: Record<string, any>;
}

interface StrikeTrendRow { day: string; warnings: number; minor: number; major: number; terminal: number; total: number; }
interface ChargeTrendRow { day: string; total: number; flagged: number; billed_usd: number | string; }
interface AgentChargeRow {
  agent_id: string; agent_name: string; total_charges: number;
  flagged_charges: number; duplicate_charges: number;
  total_billed_usd: number | string; duplicate_amount_usd: number | string;
  last_charged_at: string;
}

export default function ConductCommandCenter() {
  const qc = useQueryClient();
  const [pulse, setPulse] = useState(0);

  // ─── Realtime: bump pulse on any strike or charge action change ──────────
  useRealtimeTable({ table: "agent_strikes", channelSuffix: "cc" }, () => {
    setPulse((p) => p + 1);
    qc.invalidateQueries({ queryKey: ["cc-summary"] });
    qc.invalidateQueries({ queryKey: ["cc-events"] });
    qc.invalidateQueries({ queryKey: ["cc-strike-trend"] });
  });
  useRealtimeTable({ table: "charge_review_actions", channelSuffix: "cc" }, () => {
    setPulse((p) => p + 1);
    qc.invalidateQueries({ queryKey: ["cc-summary"] });
  });

  // ─── Data ─────────────────────────────────────────────────────────────────
  const { data: summary } = useQuery({
    queryKey: ["cc-summary"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_conduct_command_center" as any)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CCRow | null;
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["cc-events"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recent_conduct_events" as any)
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as EventRow[];
    },
  });

  const { data: strikeTrend = [] } = useQuery({
    queryKey: ["cc-strike-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_strike_trend" as any)
        .select("*")
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as StrikeTrendRow[];
    },
  });

  const { data: chargeTrend = [] } = useQuery({
    queryKey: ["cc-charge-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_charge_trend" as any)
        .select("*")
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ChargeTrendRow[];
    },
  });

  const { data: topCharged = [] } = useQuery({
    queryKey: ["cc-agent-charge"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_charge_rollup" as any)
        .select("*")
        .order("total_billed_usd", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as AgentChargeRow[];
    },
  });

  const wh = summary?.webhook_status ?? "no_data";
  const whAge = summary?.webhook_silent_minutes
    ? Number(summary.webhook_silent_minutes)
    : null;
  const dupOvercharge = Number(summary?.duplicate_overcharge_usd ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Operations"
        eyebrowIcon={<Sparkles className="h-3 w-3" />}
        title="Conduct Command Center"
        subtitle="Real-time view of strikes, charge anomalies, agent standing, and webhook health. The single page Sam opens when he wants to know 'where are the problems right now?'"
        accent="purple"
        actions={
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40">
            <span className="live-indicator h-2 w-2 mr-1.5" /> Live
          </Badge>
        }
      />

      {/* ── KPI tiles ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        <KpiTile
          icon={ShieldAlert}
          label="Active strikes"
          value={summary?.active_strikes ?? 0}
          subValue={`${summary?.active_major ?? 0} major+`}
          color="text-rose-400"
          accent="rose"
          href="/dashboard/strikes"
          delay={0}
        />
        <KpiTile
          icon={AlertTriangle}
          label="Flagged charges"
          value={summary?.flagged_charges ?? 0}
          subValue={`${summary?.duplicate_window_charges ?? 0} dupes`}
          color="text-amber-400"
          accent="amber"
          href="/dashboard/charges-audit"
          delay={0.05}
        />
        <KpiTile
          icon={Users}
          label="Agents off-standing"
          value={summary?.flagged_agents ?? 0}
          subValue={`${summary?.strikes_7d ?? 0} new this week`}
          color="text-orange-400"
          accent="rose"
          href="/dashboard/strikes"
          delay={0.10}
        />
        <KpiTile
          icon={DollarSign}
          label="Duplicate overcharge"
          value={`$${dupOvercharge.toLocaleString()}`}
          subValue={`of $${Number(summary?.total_billed_usd ?? 0).toLocaleString()} billed`}
          color={dupOvercharge > 0 ? "text-rose-400" : "text-emerald-400"}
          accent={dupOvercharge > 0 ? "rose" : "emerald"}
          href="/dashboard/charges-audit"
          delay={0.15}
        />
      </div>

      {/* ── Webhook + Standing strip ───────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2 mb-5">
        <WebhookHealthCard status={wh} ageMinutes={whAge} lastAt={summary?.last_charge_at ?? null} pulse={pulse} />
        <StandingCard
          activeStrikes={summary?.active_strikes ?? 0}
          activeMajor={summary?.active_major ?? 0}
          resolved7d={summary?.resolved_7d ?? 0}
          flaggedAgents={summary?.flagged_agents ?? 0}
        />
      </div>

      {/* ── Charts row ─────────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2 mb-5">
        <GlassCard variant="subtle" className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Strikes — last 30 days</p>
              <h3 className="text-lg font-bold">By severity</h3>
            </div>
            <Badge variant="outline" className="text-xs">{summary?.strikes_7d ?? 0} this week</Badge>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={strikeTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
              <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                labelFormatter={(d) => format(new Date(d), "MMM d, yyyy")}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="warnings" stackId="a" fill="hsl(38 95% 55%)" name="Warning" />
              <Bar dataKey="minor"    stackId="a" fill="hsl(25 95% 53%)" name="Minor" />
              <Bar dataKey="major"    stackId="a" fill="hsl(0 70% 55%)"  name="Major" />
              <Bar dataKey="terminal" stackId="a" fill="hsl(0 80% 35%)" name="Terminal" />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        <GlassCard variant="subtle" className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Charges — last 30 days</p>
              <h3 className="text-lg font-bold">Total vs flagged</h3>
            </div>
            <Badge variant="outline" className="text-xs">{summary?.charges_7d ?? 0} this week</Badge>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chargeTrend}>
              <defs>
                <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(168 70% 45%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(168 70% 45%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradFlagged" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0 70% 55%)" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="hsl(0 70% 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
              <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <YAxis allowDecimals={false} fontSize={10} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                labelFormatter={(d) => format(new Date(d), "MMM d, yyyy")}
              />
              <Area type="monotone" dataKey="total"   stroke="hsl(168 70% 45%)" fill="url(#gradTotal)" name="Total" />
              <Area type="monotone" dataKey="flagged" stroke="hsl(0 70% 55%)"   fill="url(#gradFlagged)" name="Flagged" />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* ── Top charged agents + Live feed ─────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3 mb-5">
        <GlassCard variant="subtle" className="p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Highest billed</p>
              <h3 className="text-lg font-bold">Per agent ($)</h3>
            </div>
            <Crown className="h-5 w-5 text-amber-400 opacity-70" />
          </div>
          {topCharged.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No charges synced yet.</p>
          ) : (
            <div className="space-y-2">
              {topCharged.map((a, i) => (
                <motion.div
                  key={a.agent_id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/30 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`h-7 w-7 rounded-md flex items-center justify-center text-xs font-bold ${
                      i === 0 ? "bg-amber-500/15 text-amber-400" :
                      i === 1 ? "bg-zinc-400/15 text-zinc-300" :
                      i === 2 ? "bg-orange-600/15 text-orange-400" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{a.agent_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.total_charges} charges · {a.flagged_charges} flagged
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-emerald-400">
                    ${Number(a.total_billed_usd).toLocaleString()}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard variant="subtle" className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Live feed</p>
              <h3 className="text-lg font-bold">Recent conduct events</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={() => {
              qc.invalidateQueries({ queryKey: ["cc-events"] });
              qc.invalidateQueries({ queryKey: ["cc-summary"] });
            }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {events.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              title="Quiet board — no incidents to triage"
              description="When a strike is issued or an anomalous charge syncs, it lands here in real time."
              variant="success"
            />
          ) : (
            <ul className="space-y-2 max-h-[440px] overflow-y-auto scrollbar-custom pr-1">
              <AnimatePresence initial={false}>
                {events.map((e, i) => (
                  <motion.li
                    key={`${e.event_type}-${e.event_id}`}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: Math.min(i * 0.015, 0.2) }}
                    className="rounded-lg border border-border/30 px-3 py-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                        e.event_type === "strike"
                          ? "bg-rose-500/15 text-rose-400"
                          : "bg-amber-500/15 text-amber-400"
                      }`}>
                        {e.event_type === "strike" ? <Flame className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{e.title}</p>
                          {e.severity_or_flag && (
                            <Badge variant="outline" className="text-[10px]">{e.severity_or_flag}</Badge>
                          )}
                        </div>
                        {e.agent_name && (
                          <p className="text-xs text-muted-foreground">{e.agent_name}</p>
                        )}
                        {e.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{e.description}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(e.occurred_at))}
                      </span>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </GlassCard>
      </div>

      {/* ── Quick-jump strip ───────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <QuickJump
          to="/dashboard/strikes"
          icon={ShieldAlert}
          title="Agent Strikes"
          description="Issue, list, and resolve conduct strikes."
          accent="rose"
        />
        <QuickJump
          to="/dashboard/charges-audit"
          icon={Receipt}
          title="Charges Audit"
          description="Inspect Stripe charges for anomalies + refund-intent."
          accent="amber"
        />
        <QuickJump
          to="/dashboard/my-strikes"
          icon={Activity}
          title="My Strikes (agent)"
          description="Your own conduct record + standing."
          accent="emerald"
        />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface KpiTileProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subValue: string;
  color: string;
  accent: "rose" | "amber" | "emerald";
  href: string;
  delay: number;
}
function KpiTile({ icon: Icon, label, value, subValue, color, href, delay }: KpiTileProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Link to={href} className="block group">
        <GlassCard variant="subtle" className="p-4 group-hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
              <p className={`text-3xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>
            </div>
            <Icon className={`h-8 w-8 ${color} opacity-60`} />
          </div>
        </GlassCard>
      </Link>
    </motion.div>
  );
}

interface WebhookCardProps {
  status: string;
  ageMinutes: number | null;
  lastAt: string | null;
  pulse: number;
}
function WebhookHealthCard({ status, ageMinutes, lastAt, pulse }: WebhookCardProps) {
  const color =
    status === "healthy" ? "text-emerald-400" :
    status === "stale"   ? "text-amber-400" :
    "text-rose-400";
  const Icon = status === "healthy" ? Wifi : WifiOff;
  const label =
    status === "healthy" ? "Healthy" :
    status === "stale"   ? "Stale" :
    status === "silent"  ? "Silent — investigate" : "No data";
  return (
    <motion.div animate={{ scale: [1, 1.005, 1] }} transition={{ duration: 0.6 }} key={pulse}>
      <GlassCard variant="subtle" className="p-4 h-full">
        <div className="flex items-start gap-3">
          <span className={`h-10 w-10 rounded-lg flex items-center justify-center bg-card/60 border border-border/40 ${color}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Stripe webhook</p>
              <Badge variant="outline" className={`${color} bg-current/10 border-current/40 text-xs`}>{label}</Badge>
            </div>
            <p className="text-sm mt-2">
              {lastAt
                ? <>Last charge: <span className="font-semibold">{format(new Date(lastAt), "PPp")}</span></>
                : <>No charges synced yet.</>}
            </p>
            {ageMinutes !== null && (
              <p className="text-xs text-muted-foreground">
                Silent for {ageMinutes < 60
                  ? `${Math.round(ageMinutes)} min`
                  : ageMinutes < 60 * 24
                    ? `${Math.round(ageMinutes / 60)} hr`
                    : `${Math.round(ageMinutes / (60 * 24))} days`}
              </p>
            )}
            {status === "silent" && (
              <p className="text-xs mt-2 text-rose-300/80">
                Webhook hasn&apos;t fired in 3+ days. Verify the lead_purchases sync function or Stripe endpoint is still subscribed.
              </p>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

interface StandingCardProps {
  activeStrikes: number; activeMajor: number; resolved7d: number; flaggedAgents: number;
}
function StandingCard({ activeStrikes, activeMajor, resolved7d, flaggedAgents }: StandingCardProps) {
  const isClean = activeStrikes === 0;
  return (
    <GlassCard variant="subtle" className="p-4 h-full">
      <div className="flex items-start gap-3">
        <span className={`h-10 w-10 rounded-lg flex items-center justify-center bg-card/60 border border-border/40 ${
          isClean ? "text-emerald-400" : "text-rose-400"
        }`}>
          {isClean ? <CheckCircle2 className="h-5 w-5" /> : <Skull className="h-5 w-5" />}
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Team standing</p>
            <Badge variant="outline" className={isClean ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" : "bg-rose-500/10 text-rose-400 border-rose-500/40"}>
              {isClean ? "Clear board" : `${flaggedAgents} off`}
            </Badge>
          </div>
          <p className="text-sm mt-2">
            {isClean
              ? "Zero active strikes across the team."
              : `${activeStrikes} active strikes · ${activeMajor} major+`}
          </p>
          <p className="text-xs text-muted-foreground">{resolved7d} resolved in last 7 days</p>
        </div>
      </div>
    </GlassCard>
  );
}

interface QuickJumpProps {
  to: string;
  icon: React.ElementType;
  title: string;
  description: string;
  accent: "rose" | "amber" | "emerald";
}
function QuickJump({ to, icon: Icon, title, description, accent }: QuickJumpProps) {
  const color =
    accent === "rose" ? "text-rose-400 border-rose-500/40" :
    accent === "amber" ? "text-amber-400 border-amber-500/40" :
    "text-emerald-400 border-emerald-500/40";
  return (
    <Link to={to} className="group">
      <GlassCard variant="subtle" className="p-4 group-hover:border-primary/40 transition-colors h-full">
        <div className="flex items-center gap-3">
          <span className={`h-10 w-10 rounded-lg flex items-center justify-center bg-card/60 border ${color}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </GlassCard>
    </Link>
  );
}
