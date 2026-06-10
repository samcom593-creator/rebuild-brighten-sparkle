import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign, AlertTriangle, CheckCircle2, Copy, Search, ExternalLink,
  TrendingUp, RefreshCw, UserX, CircleDollarSign, Wifi, WifiOff,
  Crown, Sparkles, Banknote, AlertCircle, BadgeCheck,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface ChargeRow {
  id: string;
  stripe_charge_id: string;
  amount_cents: number;
  amount_usd: number;
  currency: string;
  customer_email: string;
  customer_name: string | null;
  description: string | null;
  agent_id_ref: string | null;
  agent_id: string | null;
  resolved_agent_id: string | null;
  resolved_agent_name: string | null;
  charged_at: string;
  metadata: Record<string, unknown> | null;
  flag_name_mismatch: boolean;
  flag_unlinked: boolean;
  flag_unusual_amount: boolean;
  flag_duplicate_window: boolean;
}

interface CCRow {
  total_charges: number;
  flagged_charges: number;
  duplicate_window_charges: number;
  charges_7d: number;
  total_billed_usd: number | string;
  duplicate_overcharge_usd: number | string;
  acknowledged_count: number;
  refund_requested_count: number;
  last_charge_at: string | null;
  webhook_silent_minutes: number | string | null;
  webhook_status: "no_data" | "healthy" | "stale" | "silent";
}

interface TrendRow { day: string; total: number; flagged: number; billed_usd: number | string; }

interface AgentRollup {
  agent_id: string; agent_name: string; total_charges: number;
  flagged_charges: number; duplicate_charges: number;
  total_billed_usd: number | string; duplicate_amount_usd: number | string;
  last_charged_at: string;
}

export default function ChargesAudit() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "anomalies" | "name_mismatch" | "duplicate_window" | "unlinked" | "unusual">("anomalies");
  const [view, setView] = useState<"table" | "cards">("table"); // PL-080: readable table is now default
  const [actionRow, setActionRow] = useState<ChargeRow | null>(null);
  const [actionType, setActionType] = useState<"acknowledged" | "refund_requested" | "duplicate_voided">("acknowledged");
  const [actionNotes, setActionNotes] = useState("");

  useRealtimeTable({ table: "lead_purchases", channelSuffix: "audit" }, () => {
    qc.invalidateQueries({ queryKey: ["charges-audit"] });
    qc.invalidateQueries({ queryKey: ["charges-summary"] });
    qc.invalidateQueries({ queryKey: ["charges-trend"] });
    qc.invalidateQueries({ queryKey: ["charges-rollup"] });
  });
  useRealtimeTable({ table: "charge_review_actions", channelSuffix: "audit" }, () => {
    qc.invalidateQueries({ queryKey: ["charges-summary"] });
    qc.invalidateQueries({ queryKey: ["charges-actions"] });
  });

  const { data: rows = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["charges-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_charge_anomalies" as any)
        .select("*")
        .order("charged_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ChargeRow[];
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["charges-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_conduct_command_center" as any)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CCRow | null;
    },
  });

  const { data: trend = [] } = useQuery({
    queryKey: ["charges-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_charge_trend" as any)
        .select("*")
        .order("day", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TrendRow[];
    },
  });

  const { data: rollup = [] } = useQuery({
    queryKey: ["charges-rollup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_charge_rollup" as any)
        .select("*")
        .order("total_billed_usd", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as AgentRollup[];
    },
  });

  const { data: actionsByChargeId = {} } = useQuery({
    queryKey: ["charges-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("charge_review_actions" as any)
        .select("lead_purchase_id, action, performed_at")
        .order("performed_at", { ascending: false });
      if (error) throw error;
      const m: Record<string, { action: string; performed_at: string }[]> = {};
      for (const r of (data as any[] ?? [])) {
        if (!m[r.lead_purchase_id]) m[r.lead_purchase_id] = [];
        m[r.lead_purchase_id].push({ action: r.action, performed_at: r.performed_at });
      }
      return m;
    },
  });

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "anomalies") {
      r = r.filter((c) => c.flag_name_mismatch || c.flag_unlinked || c.flag_unusual_amount || c.flag_duplicate_window);
    } else if (filter === "name_mismatch") r = r.filter((c) => c.flag_name_mismatch);
    else if (filter === "duplicate_window") r = r.filter((c) => c.flag_duplicate_window);
    else if (filter === "unlinked") r = r.filter((c) => c.flag_unlinked);
    else if (filter === "unusual") r = r.filter((c) => c.flag_unusual_amount);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter(
        (c) =>
          c.customer_email.toLowerCase().includes(s) ||
          (c.customer_name ?? "").toLowerCase().includes(s) ||
          (c.resolved_agent_name ?? "").toLowerCase().includes(s) ||
          c.stripe_charge_id.toLowerCase().includes(s),
      );
    }
    return r;
  }, [rows, filter, search]);

  async function performAction() {
    if (!actionRow) return;
    const { error } = await supabase.rpc("record_charge_action" as any, {
      p_lead_purchase_id: actionRow.id,
      p_action: actionType,
      p_notes: actionNotes.trim() || null,
      p_refund_amount_cents: actionType === "refund_requested" ? actionRow.amount_cents : null,
    });
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success(
      actionType === "refund_requested" ? "Refund flagged for Stripe team" :
      actionType === "duplicate_voided" ? "Duplicate marked voided" :
      "Charge acknowledged"
    );
    setActionRow(null);
    setActionNotes("");
    setActionType("acknowledged");
  }

  // PL-092: one-click strike on anomaly row. Picks reason_code from the flag.
  async function issueStrikeForCharge(c: ChargeRow) {
    const agentId = c.resolved_agent_id ?? c.agent_id_ref ?? c.agent_id;
    if (!agentId) {
      toast.error("No agent linked to this charge — strike skipped");
      return;
    }
    let reason: string = "false_charge";
    if (c.flag_duplicate_window) reason = "billing_dispute";
    else if (c.flag_name_mismatch) reason = "misrepresentation";
    else if (c.flag_unlinked) reason = "compliance";
    else if (c.flag_unusual_amount) reason = "false_charge";
    const description = `Charges Audit anomaly · ${c.stripe_charge_id} · $${c.amount_usd.toFixed(2)} · flags: ${[
      c.flag_name_mismatch && "name_mismatch",
      c.flag_unlinked && "unlinked",
      c.flag_unusual_amount && "unusual_amount",
      c.flag_duplicate_window && "duplicate_window",
    ].filter(Boolean).join(", ")}`;
    const { error } = await supabase.rpc("issue_strike" as any, {
      p_agent_id: agentId,
      p_reason_code: reason,
      p_severity: "minor",
      p_description: description,
      p_evidence_urls: [`https://dashboard.stripe.com/payments/${c.stripe_charge_id}`],
    });
    if (error) { toast.error(`Strike failed: ${error.message}`); return; }
    toast.success(`Strike issued (${reason}) — ${c.resolved_agent_name ?? "agent"}`);
    qc.invalidateQueries({ queryKey: ["charges-audit"] });
  }

  const wh = summary?.webhook_status ?? "no_data";
  const whAge = summary?.webhook_silent_minutes ? Number(summary.webhook_silent_minutes) : null;
  const dupOvercharge = Number(summary?.duplicate_overcharge_usd ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Finance"
        eyebrowIcon={<CircleDollarSign className="h-3 w-3" />}
        title="Charges Audit"
        subtitle="Inspect every Stripe charge that hit the lead-purchase ledger. Catches duplicates inside 10-minute windows, name/email mismatches, and unusual amounts."
        accent="amber"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40">
              <span className="live-indicator h-2 w-2 mr-1.5" /> Live
            </Badge>
            <Button onClick={() => refetch()} disabled={isRefetching} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        {[
          { label: "Charges synced", value: rows.length, color: "text-foreground", icon: TrendingUp },
          { label: "Total billed", value: `$${Number(summary?.total_billed_usd ?? 0).toLocaleString()}`, color: "text-emerald-400", icon: DollarSign },
          { label: "Anomalies flagged", value: summary?.flagged_charges ?? 0, color: "text-rose-400", icon: AlertTriangle },
          { label: "Duplicate overcharge", value: `$${dupOvercharge.toLocaleString()}`, color: dupOvercharge > 0 ? "text-amber-400" : "text-emerald-400", icon: Copy },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <GlassCard variant="subtle" className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</p>
                <p className={`text-2xl font-bold tabular-nums ${s.color} mt-1`}>{s.value}</p>
              </div>
              <s.icon className={`h-8 w-8 ${s.color} opacity-60`} />
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Webhook + Trend */}
      <div className="grid gap-3 lg:grid-cols-3 mb-5">
        <GlassCard variant="subtle" className="p-4 lg:col-span-1">
          <div className="flex items-start gap-3">
            <span className={`h-10 w-10 rounded-lg flex items-center justify-center bg-card/60 border border-border/40 ${
              wh === "healthy" ? "text-emerald-400" : wh === "stale" ? "text-amber-400" : "text-rose-400"
            }`}>
              {wh === "healthy" ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Stripe webhook</p>
                <Badge variant="outline" className={`text-xs ${
                  wh === "healthy" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" :
                  wh === "stale" ? "bg-amber-500/10 text-amber-400 border-amber-500/40" :
                  "bg-rose-500/10 text-rose-400 border-rose-500/40"
                }`}>
                  {wh === "healthy" ? "Healthy" : wh === "stale" ? "Stale" : wh === "silent" ? "Silent" : "No data"}
                </Badge>
              </div>
              <p className="text-sm mt-2">
                {summary?.last_charge_at
                  ? <>Last: <span className="font-semibold">{format(new Date(summary.last_charge_at), "PPp")}</span></>
                  : <>No charges synced yet.</>}
              </p>
              {whAge !== null && (
                <p className="text-xs text-muted-foreground">
                  {whAge < 60 ? `${Math.round(whAge)} min ago`
                    : whAge < 60 * 24 ? `${Math.round(whAge / 60)} hr ago`
                    : `${Math.round(whAge / (60 * 24))} days ago`}
                </p>
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard variant="subtle" className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">30-day trend</p>
              <h3 className="text-lg font-bold">Total vs flagged</h3>
            </div>
            <Badge variant="outline" className="text-xs">{summary?.charges_7d ?? 0} this week</Badge>
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="caGradTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(168 70% 45%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(168 70% 45%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="caGradFlagged" x1="0" y1="0" x2="0" y2="1">
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
              <Area type="monotone" dataKey="total"   stroke="hsl(168 70% 45%)" fill="url(#caGradTotal)" name="Total" />
              <Area type="monotone" dataKey="flagged" stroke="hsl(0 70% 55%)"   fill="url(#caGradFlagged)" name="Flagged" />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      </div>

      {/* Per-agent rollup */}
      {rollup.length > 0 && (
        <GlassCard variant="subtle" className="p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Per-agent rollup</p>
              <h3 className="text-lg font-bold">Highest billed (top 8)</h3>
            </div>
            <Crown className="h-5 w-5 text-amber-400 opacity-70" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {rollup.map((a, i) => (
              <motion.div
                key={a.agent_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="rounded-lg border border-border/30 p-3 hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold truncate">{a.agent_name}</p>
                  {a.flagged_charges > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/40">
                      {a.flagged_charges} flagged
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold tabular-nums text-emerald-400">${Number(a.total_billed_usd).toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">
                  {a.total_charges} charges
                  {a.duplicate_charges > 0 && <span className="text-rose-400"> · {a.duplicate_charges} dup</span>}
                </p>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Sam's $167 incident callout */}
      {filter === "anomalies" && (summary?.flagged_charges ?? 0) > 0 && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
          <GlassCard variant="subtle" className="p-4 border-l-4 border-amber-500">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold">Why agents are reporting wrong charge amounts</p>
                <p className="text-muted-foreground mt-1">
                  Every active SKU is <span className="text-foreground font-medium">$100 (dialer-only weekly)</span> or
                  {" "}<span className="text-foreground font-medium">$250 (Gold Leads + Dialer weekly)</span>. If an
                  agent says they were charged something else (e.g. "$167"), it usually means: Stripe customer name
                  attached to a different person's email <em>or</em> a duplicate charge inside the same week. Both
                  show up here. Use <em>Refund</em> to flag for the Stripe team.
                </p>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Filters */}
      <GlassCard variant="subtle" className="p-3 mb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, name, charge ID"
              className="pl-9"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="md:w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="anomalies">All anomalies</SelectItem>
              <SelectItem value="name_mismatch">Name mismatch</SelectItem>
              <SelectItem value="duplicate_window">Duplicate within 10min</SelectItem>
              <SelectItem value="unlinked">Unlinked (no agent)</SelectItem>
              <SelectItem value="unusual">Unusual amount</SelectItem>
              <SelectItem value="all">All charges</SelectItem>
            </SelectContent>
          </Select>
          {/* PL-080: view toggle — table is now default for digestibility */}
          <div className="inline-flex rounded-md border border-border/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === "table"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card/40 text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
              aria-pressed={view === "table"}
              title="Compact table — easiest to scan"
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setView("cards")}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border/40 ${
                view === "cards"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card/40 text-muted-foreground hover:bg-card/60 hover:text-foreground"
              }`}
              aria-pressed={view === "cards"}
              title="Cards — full detail per row"
            >
              Cards
            </button>
          </div>
          <Badge variant="outline" className="hidden md:inline-flex">{filtered.length} shown</Badge>
        </div>
      </GlassCard>

      {/* Charges list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-md skeleton-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          title={filter === "anomalies" ? "No anomalies in current set" : "No charges match filters"}
          description={filter === "anomalies"
            ? "Stripe webhook is syncing clean. Refresh after the next charge batch."
            : "Try widening the filter."}
          variant="success"
        />
      ) : view === "table" ? (
        // PL-080: compact, scannable table — replaces motion-heavy card list as the digestible default
        <GlassCard variant="subtle" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="text-left font-semibold px-3 py-2 w-[110px]">Amount</th>
                  <th className="text-left font-semibold px-3 py-2">Customer</th>
                  <th className="text-left font-semibold px-3 py-2">Agent on record</th>
                  <th className="text-left font-semibold px-3 py-2">Flags</th>
                  <th className="text-left font-semibold px-3 py-2 w-[150px]">When</th>
                  <th className="text-right font-semibold px-3 py-2 w-[200px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => {
                  const acts = actionsByChargeId[c.id] ?? [];
                  const lastAck = acts.find((a) => a.action === "acknowledged");
                  const lastRefund = acts.find((a) => a.action === "refund_requested" || a.action === "refund_confirmed");
                  const mismatch = c.customer_name && c.resolved_agent_name && c.customer_name !== c.resolved_agent_name;
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-border/20 hover:bg-primary/5 transition-colors ${
                        i % 2 === 0 ? "bg-transparent" : "bg-card/20"
                      }`}
                    >
                      <td className="px-3 py-2 align-top">
                        <span className={`font-bold tabular-nums ${c.flag_unusual_amount ? "text-rose-400" : "text-emerald-400"}`}>
                          ${c.amount_usd.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top min-w-[180px]">
                        <p className="font-medium truncate max-w-[260px]">{c.customer_name ?? <span className="text-muted-foreground italic">(no name)</span>}</p>
                        <p className="text-[11px] text-muted-foreground truncate max-w-[260px]">{c.customer_email}</p>
                      </td>
                      <td className="px-3 py-2 align-top min-w-[160px]">
                        {c.resolved_agent_name ? (
                          <p className={`truncate max-w-[180px] ${mismatch ? "text-rose-400 font-medium" : ""}`}>{c.resolved_agent_name}</p>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">unlinked</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {c.flag_name_mismatch && <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/40 text-[10px] py-0">name</Badge>}
                          {c.flag_duplicate_window && <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/40 text-[10px] py-0">dup</Badge>}
                          {c.flag_unlinked && <Badge variant="outline" className="bg-orange-500/15 text-orange-400 border-orange-500/40 text-[10px] py-0">unlinked</Badge>}
                          {c.flag_unusual_amount && <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/40 text-[10px] py-0">$$</Badge>}
                          {lastAck && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40 text-[10px] py-0">ack</Badge>}
                          {lastRefund && <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/40 text-[10px] py-0">refund</Badge>}
                          {!c.flag_name_mismatch && !c.flag_duplicate_window && !c.flag_unlinked && !c.flag_unusual_amount && (
                            <span className="text-[11px] text-emerald-400/70">clean</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-[11px] text-muted-foreground tabular-nums">
                        <p className="text-foreground">{format(new Date(c.charged_at), "MMM d, h:mm a")}</p>
                        <p>{formatDistanceToNow(new Date(c.charged_at))} ago</p>
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          {!lastAck && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => { setActionRow(c); setActionType("acknowledged"); setActionNotes(""); }}
                              title="Acknowledge"
                            >
                              <BadgeCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!lastRefund && (c.flag_duplicate_window || c.flag_name_mismatch || c.flag_unusual_amount) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-amber-400 hover:bg-amber-500/10"
                              onClick={() => { setActionRow(c); setActionType("refund_requested"); setActionNotes(""); }}
                              title="Flag for Stripe refund"
                            >
                              <Banknote className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(c.flag_name_mismatch || c.flag_unusual_amount || c.flag_duplicate_window) && (c.resolved_agent_id || c.agent_id_ref || c.agent_id) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-500/10"
                              onClick={() => issueStrikeForCharge(c)}
                              title="Issue strike to agent"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => {
                              navigator.clipboard.writeText(c.stripe_charge_id);
                              toast.success("Charge ID copied");
                            }}
                            title="Copy charge ID"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" asChild className="h-7 px-2" title="Open in Stripe">
                            <a href={`https://dashboard.stripe.com/payments/${c.stripe_charge_id}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((c, i) => {
              const acts = actionsByChargeId[c.id] ?? [];
              const lastAck = acts.find((a) => a.action === "acknowledged");
              const lastRefund = acts.find((a) => a.action === "refund_requested" || a.action === "refund_confirmed");
              return (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.015 }}
                >
                  <GlassCard variant="subtle" className="p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start">
                      <div className="md:w-[110px] shrink-0">
                        <p className={`text-2xl font-bold tabular-nums ${c.flag_unusual_amount ? "text-rose-400" : "text-emerald-400"}`}>
                          ${c.amount_usd.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">{c.currency?.toUpperCase() ?? "USD"}</p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {c.flag_name_mismatch && (
                            <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/40">
                              <UserX className="h-3 w-3 mr-1" /> Name mismatch
                            </Badge>
                          )}
                          {c.flag_duplicate_window && (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/40">
                              <Copy className="h-3 w-3 mr-1" /> Duplicate
                            </Badge>
                          )}
                          {c.flag_unlinked && (
                            <Badge variant="outline" className="bg-orange-500/15 text-orange-400 border-orange-500/40">
                              Unlinked
                            </Badge>
                          )}
                          {c.flag_unusual_amount && (
                            <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/40">
                              Unusual amount
                            </Badge>
                          )}
                          {lastAck && (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/40">
                              <BadgeCheck className="h-3 w-3 mr-1" /> Acknowledged
                            </Badge>
                          )}
                          {lastRefund && (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/40">
                              <Banknote className="h-3 w-3 mr-1" /> Refund flagged
                            </Badge>
                          )}
                        </div>

                        <p className="text-sm">
                          <span className="font-semibold">{c.customer_name ?? "(no name)"}</span>
                          {c.customer_name && c.resolved_agent_name && c.customer_name !== c.resolved_agent_name && (
                            <span className="text-muted-foreground">
                              {" "}— agent record says <span className="text-rose-400 font-medium">{c.resolved_agent_name}</span>
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.customer_email} · {c.description ?? "—"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-2">
                          {format(new Date(c.charged_at), "PPp")} · {formatDistanceToNow(new Date(c.charged_at))} ago
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!lastAck && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActionRow(c);
                              setActionType("acknowledged");
                              setActionNotes("");
                            }}
                            title="Acknowledge — mark reviewed"
                          >
                            <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Ack
                          </Button>
                        )}
                        {!lastRefund && (c.flag_duplicate_window || c.flag_name_mismatch || c.flag_unusual_amount) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                            onClick={() => {
                              setActionRow(c);
                              setActionType("refund_requested");
                              setActionNotes("");
                            }}
                            title="Flag for Stripe refund"
                          >
                            <Banknote className="h-3.5 w-3.5 mr-1" /> Refund
                          </Button>
                        )}
                        {(c.flag_name_mismatch || c.flag_unusual_amount || c.flag_duplicate_window) && (c.resolved_agent_id || c.agent_id_ref || c.agent_id) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                            onClick={() => issueStrikeForCharge(c)}
                            title="Issue strike to agent for this anomaly (PL-092)"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Strike
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(c.stripe_charge_id);
                            toast.success("Charge ID copied");
                          }}
                          title="Copy charge ID"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" asChild title="Open in Stripe">
                          <a
                            href={`https://dashboard.stripe.com/payments/${c.stripe_charge_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Action dialog (acknowledge / refund_requested / duplicate_voided) */}
      <Dialog open={!!actionRow} onOpenChange={(o) => !o && setActionRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionType === "refund_requested" ? "Flag for refund" :
               actionType === "duplicate_voided" ? "Mark as duplicate-voided" :
               "Acknowledge charge"}
            </DialogTitle>
          </DialogHeader>
          {actionRow && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/40 p-3 text-sm">
                <p className="font-semibold">${actionRow.amount_usd.toFixed(2)} · {actionRow.customer_email}</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {actionRow.customer_name ?? "(no name)"} · {actionRow.stripe_charge_id}
                </p>
              </div>
              <Textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder={
                  actionType === "refund_requested" ? "Why are we refunding? (logged for Stripe team)"
                  : "Notes (optional)"
                }
                rows={3}
              />
              {actionType === "refund_requested" && (
                <div className="text-xs text-muted-foreground">
                  This creates a refund-intent record. <span className="text-foreground">The actual refund must still be issued in Stripe dashboard.</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActionRow(null)}>Cancel</Button>
            <Button
              onClick={performAction}
              className={actionType === "refund_requested" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
            >
              {actionType === "refund_requested" ? <Banknote className="h-4 w-4 mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              {actionType === "refund_requested" ? "Flag for refund" : "Acknowledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
