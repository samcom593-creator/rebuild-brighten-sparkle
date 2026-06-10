// ClientPipeline v4 — book-of-business cockpit.
//
// Source: agentlink_clients (the 1.6k-row AgentLink mirror, 109 cols).
// RLS handles visibility: admin sees all, manager sees downline, agent sees own.
//
// Sections:
//   1. Hero — book totals + standing
//   2. KPI strip — total clients, SOLD policies, in-flight, untouched/stale
//   3. Stage funnel — NEW_INITIAL → WORKING → ALMOST_THERE → SOLD
//   4. State distribution map (bar)
//   5. Chargebacks watchlist (priority list — PL-044)
//   6. Recent additions
//   7. Full client list — search, stage filter, sort

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Cell,
} from "recharts";
import {
  Users, Search, Phone, Mail, CalendarClock, AlertTriangle, Flame,
  ChevronRight, TrendingUp, MapPin, ShieldCheck, UserPlus,
  Filter, ArrowUpDown, BookMarked, Clock,
} from "lucide-react";
import { format, formatDistanceToNow, isBefore, isAfter, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { AgentLinkConnectionPrompt } from "@/components/dashboard/AgentLinkConnectionPrompt";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Client {
  id: string;
  insuracloud_pipeline_client_id: string | null;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  date_of_birth: string | null;
  pipeline_stage: string | null;
  created_at: string;
  updated_at: string | null;
  stage_changed_at: string | null;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time: string | null;
  do_not_call: boolean | null;
  hostile_language_detected: boolean | null;
  client_health_score: number | null;
  pitch_carrier: string | null;
  pitch_price: number | string | null;
  product_sold: string | null;
  face_amount: number | string | null;
  policy_number: string | null;
  policy_start_date: string | null;
  imported_at: string | null;
  external_source: string | null;
  lead_vendor_name: string | null;
  total_monthly_income: number | string | null;
}

const STAGE_META: Record<string, { label: string; color: string; tint: string }> = {
  NEW_INITIAL:   { label: "New",        color: "bg-blue-500",    tint: "from-blue-500/15 to-blue-500/0 text-blue-600 dark:text-blue-400 border-blue-500/40" },
  WORKING:       { label: "Working",    color: "bg-violet-500",  tint: "from-violet-500/15 to-violet-500/0 text-violet-600 dark:text-violet-400 border-violet-500/40" },
  PITCHED:       { label: "Pitched",    color: "bg-amber-500",   tint: "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  ALMOST_THERE:  { label: "Almost",     color: "bg-orange-500",  tint: "from-orange-500/15 to-orange-500/0 text-orange-600 dark:text-orange-400 border-orange-500/40" },
  SOLD:          { label: "Sold",       color: "bg-emerald-500", tint: "from-emerald-500/15 to-emerald-500/0 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" },
  FOLLOW_UP:     { label: "Follow-up",  color: "bg-rose-500",    tint: "from-rose-500/15 to-rose-500/0 text-rose-600 dark:text-rose-400 border-rose-500/40" },
  INACTIVE:      { label: "Inactive",   color: "bg-slate-500",   tint: "from-slate-500/15 to-slate-500/0 text-slate-400 dark:text-slate-400 border-slate-500/40" },
  UNSORTED:      { label: "Unsorted",   color: "bg-zinc-500",    tint: "from-zinc-500/15 to-zinc-500/0 text-zinc-600 dark:text-zinc-400 border-zinc-500/40" },
};

function fmtMoney(n: unknown): string {
  const v = Number(n ?? 0);
  if (!v) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

export default function ClientPipeline() {
  usePageTitle("Client Pipeline · APEX");
  const { user, isAdmin, isManager } = useAuth();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("__all__");
  const [stateFilter, setStateFilter] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<"recent" | "name" | "stage_changed" | "callback">("recent");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["client-pipeline", isAdmin],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agentlink_clients")
        .select(
          "id, insuracloud_pipeline_client_id, agent_id, first_name, last_name, phone, email, state, city, date_of_birth, pipeline_stage, created_at, updated_at, stage_changed_at, last_contact_date, next_action_date, callback_date, callback_time, do_not_call, hostile_language_detected, client_health_score, pitch_carrier, pitch_price, product_sold, face_amount, policy_number, policy_start_date, imported_at, external_source, lead_vendor_name, total_monthly_income"
        )
        .order("created_at", { ascending: false })
        .limit(2_000);
      if (error) throw error;
      return (data ?? []) as unknown as Client[];
    },
  });

  // ── Derived totals ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = rows.length;
    const sold = rows.filter((c) => c.pipeline_stage === "SOLD").length;
    const inFlight = rows.filter((c) =>
      c.pipeline_stage && c.pipeline_stage !== "SOLD" && c.pipeline_stage !== "INACTIVE"
    ).length;
    const unsorted = rows.filter((c) => !c.pipeline_stage).length;
    const now = Date.now();
    const new7d = rows.filter((c) => now - new Date(c.created_at).getTime() < 7 * 86_400_000).length;
    const callbacksDue = rows.filter((c) => {
      if (!c.callback_date) return false;
      const cb = new Date(c.callback_date);
      return cb.getTime() <= now + 86_400_000 && cb.getTime() > now - 7 * 86_400_000;
    }).length;
    const dnc = rows.filter((c) => c.do_not_call).length;
    const hostile = rows.filter((c) => c.hostile_language_detected).length;
    return { total, sold, inFlight, unsorted, new7d, callbacksDue, dnc, hostile };
  }, [rows]);

  // Stage distribution
  const stageData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of rows) {
      const k = c.pipeline_stage ?? "UNSORTED";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([key, value]) => ({
        key,
        label: STAGE_META[key]?.label ?? key,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  // PL-045: agentlink_clients.state is empty for 100% of rows upstream,
  // so the old Top-states chart was permanently empty. Replaced with a
  // Contact-Freshness Ladder built from last_contact_date — same widget
  // slot, real data, and immediately actionable for closing the cold
  // pool (currently ~1.6k untouched clients).
  const freshnessData = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    const buckets = [
      { label: "Never",  match: (t: number | null) => t === null },
      { label: "≤ 7d",   match: (t: number | null) => t !== null && now - t <= 7 * DAY },
      { label: "8-30d",  match: (t: number | null) => t !== null && now - t > 7 * DAY && now - t <= 30 * DAY },
      { label: "31-60d", match: (t: number | null) => t !== null && now - t > 30 * DAY && now - t <= 60 * DAY },
      { label: "60d+",   match: (t: number | null) => t !== null && now - t > 60 * DAY },
    ];
    return buckets.map(({ label, match }) => ({
      bucket: label,
      count: rows.filter((c) => match(c.last_contact_date ? new Date(c.last_contact_date).getTime() : null)).length,
    }));
  }, [rows]);

  // Chargebacks watch — next 7 days (PL-044: renamed from callbacks)
  const callbacks = useMemo(() => {
    const now = Date.now();
    const horizon = now + 7 * 86_400_000;
    return rows
      .filter((c) => c.callback_date && !c.do_not_call)
      .map((c) => ({ c, t: new Date(c.callback_date!).getTime() }))
      .filter(({ t }) => t > now - 86_400_000 && t < horizon)
      .sort((a, b) => a.t - b.t)
      .slice(0, 8)
      .map(({ c }) => c);
  }, [rows]);

  // Recent additions
  const recent = useMemo(() => rows.slice(0, 8), [rows]);

  // States list for filter
  const states = useMemo(() => {
    const s = new Set<string>();
    for (const c of rows) if (c.state) s.add(c.state);
    return Array.from(s).sort();
  }, [rows]);

  // Filtered + sorted main list
  const list = useMemo(() => {
    let r = rows;
    if (stageFilter !== "__all__") {
      r = r.filter((c) => (c.pipeline_stage ?? "UNSORTED") === stageFilter);
    }
    if (stateFilter !== "__all__") {
      r = r.filter((c) => c.state === stateFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (c) =>
          (c.first_name ?? "").toLowerCase().includes(q) ||
          (c.last_name ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.policy_number ?? "").toLowerCase().includes(q),
      );
    }
    switch (sortKey) {
      case "name":
        r = [...r].sort((a, b) =>
          (a.last_name ?? "").localeCompare(b.last_name ?? ""),
        );
        break;
      case "stage_changed":
        r = [...r].sort((a, b) => {
          const ax = a.stage_changed_at ? new Date(a.stage_changed_at).getTime() : 0;
          const bx = b.stage_changed_at ? new Date(b.stage_changed_at).getTime() : 0;
          return bx - ax;
        });
        break;
      case "callback":
        r = [...r].sort((a, b) => {
          const ax = a.callback_date ? new Date(a.callback_date).getTime() : Number.MAX_SAFE_INTEGER;
          const bx = b.callback_date ? new Date(b.callback_date).getTime() : Number.MAX_SAFE_INTEGER;
          return ax - bx;
        });
        break;
    }
    return r.slice(0, 250); // cap for render perf
  }, [rows, stageFilter, stateFilter, search, sortKey]);

  const scopeLabel = isAdmin ? "agency-wide" : isManager ? "your team" : "your book";

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      {/* HERO */}
      <PageHeader
        eyebrow="Book of Business"
        eyebrowIcon={<BookMarked className="h-3 w-3" />}
        title="Client Pipeline"
        subtitle={
          <>
            Every client in <span className="text-foreground font-medium">{scopeLabel}</span> —
            their pipeline stage, last contact, upcoming callbacks, and policy state.
            Source: AgentLink mirror (1,600+ clients across the team).
          </>
        }
        accent="emerald"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" /> AgentLink sync live
            </Badge>
          </div>
        }
      />

      {/* PL-047 — surface AgentLink sync prompt for non-admin agents w/o data */}
      <AgentLinkConnectionPrompt />

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users}        label="Total clients"      value={stats.total}    sub={`+${stats.new7d} new this week`}                      color="text-foreground" loading={isLoading} />
        <Kpi icon={ShieldCheck}  label="Sold policies"      value={stats.sold}     sub={`${stats.total ? ((stats.sold / stats.total) * 100).toFixed(0) : 0}% of book`} color="text-emerald-500 dark:text-emerald-400" loading={isLoading} />
        <Kpi icon={Flame}        label="Working on it"      value={stats.inFlight} sub="working + pitched + almost"                            color="text-amber-500 dark:text-amber-400" loading={isLoading} />
        <Kpi icon={CalendarClock} label="Chargebacks · 7d"   value={stats.callbacksDue} sub="watch list (wiring period filter next)"            color="text-rose-500 dark:text-rose-400" loading={isLoading} />
      </div>

      {/* Stage funnel + state distribution */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Stage funnel */}
        <GlassCard className="p-4 lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Pipeline stages</p>
              <h3 className="text-lg font-bold">Where your book sits</h3>
            </div>
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
          </div>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
          ) : stageData.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No clients yet" />
          ) : (
            <FunnelStrip steps={stageData.map(s => ({
              label: s.label,
              value: s.value,
              color: (STAGE_META[s.key]?.color ?? "bg-muted"),
            }))} />
          )}
        </GlassCard>

        {/* PL-045: Contact-Freshness Ladder (replaced empty Geographic mix). */}
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Contact freshness</p>
              <h3 className="text-lg font-bold">When were they last touched?</h3>
            </div>
            <MapPin className="h-5 w-5 text-muted-foreground" />
          </div>
          {isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : freshnessData.every((b) => b.count === 0) ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title="No contact data" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={freshnessData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                <XAxis dataKey="bucket" fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {freshnessData.map((_, i) => (
                    <Cell key={i} fill={`hsl(${168 + i * 18} 70% 50%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>

      {/* Chargebacks watchlist + Recent additions */}
      <div className="grid gap-3 lg:grid-cols-2">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Priority queue</p>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-rose-500" /> Chargebacks watchlist
              </h3>
            </div>
            <Badge variant="outline" className="text-xs">{stats.callbacksDue} this week</Badge>
          </div>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : callbacks.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" />}
              title="No callbacks scheduled"
              description="When a client requests a callback, set the date and they'll surface here."
              variant="success"
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {callbacks.map((c) => {
                const isPast = c.callback_date && isBefore(new Date(c.callback_date), new Date());
                return (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {fmtPhone(c.phone)} · {c.state ?? "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${isPast ? "text-rose-500 dark:text-rose-400" : "text-foreground"}`}>
                        {c.callback_date ? format(new Date(c.callback_date), "MMM d") : "—"}
                        {c.callback_time ? ` · ${c.callback_time}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.callback_date ? formatDistanceToNow(new Date(c.callback_date), { addSuffix: true }) : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Just added</p>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" /> Recent clients
              </h3>
            </div>
            <Badge variant="outline" className="text-xs">{stats.new7d} this week</Badge>
          </div>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : recent.length === 0 ? (
            <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No clients on file" />
          ) : (
            <ul className="divide-y divide-border/40">
              {recent.map((c) => {
                const stage = STAGE_META[c.pipeline_stage ?? "UNSORTED"] ?? STAGE_META.UNSORTED;
                return (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                        {(c.first_name?.[0] ?? "?") + (c.last_name?.[0] ?? "")}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {c.city ? `${c.city}, ${c.state}` : c.state ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant="outline" className={`text-[10px]  ${stage.tint}`}>
                        {stage.label}
                      </Badge>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </GlassCard>
      </div>

      {/* Full client list */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Full directory</p>
            <h3 className="text-lg font-bold">All clients</h3>
          </div>
          <Badge variant="outline" className="text-xs">{list.length.toLocaleString()} of {stats.total.toLocaleString()}</Badge>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, city, policy #"
              className="pl-9"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="md:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All stages</SelectItem>
              {Object.entries(STAGE_META).map(([k, m]) => (
                <SelectItem key={k} value={k}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="md:w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All states</SelectItem>
              {states.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
            <SelectTrigger className="md:w-[160px]"><ArrowUpDown className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest first</SelectItem>
              <SelectItem value="name">Name A→Z</SelectItem>
              <SelectItem value="stage_changed">Stage changed</SelectItem>
              <SelectItem value="callback">Callback due</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Filter className="h-6 w-6" />}
            title="No clients match these filters"
            description="Try widening the stage or state filter, or clear the search."
            actions={<Button size="sm" variant="ghost" onClick={() => { setSearch(""); setStageFilter("__all__"); setStateFilter("__all__"); }}>Clear filters</Button>}
          />
        ) : (
          <div className="space-y-1.5">
            {list.map((c, i) => {
              const stage = STAGE_META[c.pipeline_stage ?? "UNSORTED"] ?? STAGE_META.UNSORTED;
              const hasCallback = !!c.callback_date;
              const isOverdue = hasCallback && isBefore(new Date(c.callback_date!), new Date());
              const lastContactDays = c.last_contact_date
                ? Math.floor((Date.now() - new Date(c.last_contact_date).getTime()) / 86_400_000)
                : null;
              const isStale = lastContactDays != null && lastContactDays > 30;
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.005, 0.15) }}
                  className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 hover:border-primary/40 hover:bg-primary/[0.03] transition-colors cursor-pointer"
                  onClick={() => { window.location.href = `/dashboard/clients/${c.id}`; }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") window.location.href = `/dashboard/clients/${c.id}`; }}
                >
                  <div className="h-9 w-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {(c.first_name?.[0] ?? "?") + (c.last_name?.[0] ?? "")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}
                      </p>
                      <Badge variant="outline" className={`text-[10px]  ${stage.tint}`}>
                        {stage.label}
                      </Badge>
                      {c.do_not_call && (
                        <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/40">
                          DNC
                        </Badge>
                      )}
                      {c.hostile_language_detected && (
                        <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/40">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Hostile
                        </Badge>
                      )}
                      {isStale && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
                          <Clock className="h-2.5 w-2.5 mr-0.5" /> {lastContactDays}d cold
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {fmtPhone(c.phone)}
                      {c.email && <> · {c.email}</>}
                      {c.city && <> · {c.city}, {c.state}</>}
                    </p>
                  </div>
                  <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground shrink-0 min-w-[110px]">
                    {hasCallback && (
                      <span className={`font-semibold ${isOverdue ? "text-rose-500 dark:text-rose-400" : "text-foreground"}`}>
                        Callback {format(new Date(c.callback_date!), "MMM d")}
                      </span>
                    )}
                    {c.product_sold && <span>{c.product_sold}</span>}
                    {c.face_amount ? <span className="text-emerald-500 dark:text-emerald-400">{fmtMoney(c.face_amount)}</span> : null}
                    <span>{c.stage_changed_at ? formatDistanceToNow(new Date(c.stage_changed_at), { addSuffix: true }) : `Added ${formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}`}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.phone && !c.do_not_call && (
                      <Button asChild size="icon" variant="ghost" title="Call">
                        <a href={`tel:${c.phone}`}><Phone className="h-4 w-4" /></a>
                      </Button>
                    )}
                    {c.email && (
                      <Button asChild size="icon" variant="ghost" title="Email">
                        <a href={`mailto:${c.email}`}><Mail className="h-4 w-4" /></a>
                      </Button>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </motion.div>
              );
            })}
            {rows.length > list.length && (
              <p className="text-xs text-center text-muted-foreground pt-3">
                Showing first 250 of {list.length.toLocaleString()} matches. Refine your filters to drill in.
              </p>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface KpiProps { icon: React.ElementType; label: string; value: number; sub: string; color: string; loading: boolean; }
function Kpi({ icon: Icon, label, value, sub, color, loading }: KpiProps) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          {loading ? <Skeleton className="h-9 w-24 mt-1" /> : (
            <p className={`text-3xl font-bold tabular-nums mt-1 ${color}`}>{value.toLocaleString()}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>
        </div>
        <Icon className={`h-7 w-7 ${color} opacity-70`} />
      </div>
    </GlassCard>
  );
}

interface FunnelStep { label: string; value: number; color: string; }
function FunnelStrip({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.value.toLocaleString()}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${s.color} rounded-full transition-all duration-500`} style={{ width: `${(s.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
