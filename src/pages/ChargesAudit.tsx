import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DollarSign, AlertTriangle, CheckCircle2, Copy, Search, ExternalLink,
  TrendingUp, RefreshCw, UserX, CircleDollarSign,
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

export default function ChargesAudit() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "anomalies" | "name_mismatch" | "duplicate_window" | "unlinked" | "unusual">("anomalies");

  const { data: rows = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["charges-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_charge_anomalies" as any)
        .select("*")
        .order("charged_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ChargeRow[];
    },
  });

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "anomalies") {
      r = r.filter((c) => c.flag_name_mismatch || c.flag_unlinked || c.flag_unusual_amount || c.flag_duplicate_window);
    } else if (filter === "name_mismatch") {
      r = r.filter((c) => c.flag_name_mismatch);
    } else if (filter === "duplicate_window") {
      r = r.filter((c) => c.flag_duplicate_window);
    } else if (filter === "unlinked") {
      r = r.filter((c) => c.flag_unlinked);
    } else if (filter === "unusual") {
      r = r.filter((c) => c.flag_unusual_amount);
    }
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

  const stats = useMemo(() => {
    const total = rows.length;
    const totalCents = rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);
    const flagged = rows.filter(
      (r) => r.flag_name_mismatch || r.flag_unlinked || r.flag_unusual_amount || r.flag_duplicate_window,
    ).length;
    const dupes = rows.filter((r) => r.flag_duplicate_window).length;
    return {
      total,
      totalUsd: totalCents / 100,
      flagged,
      dupes,
    };
  }, [rows]);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Finance"
        eyebrowIcon={<CircleDollarSign className="h-3 w-3" />}
        title="Charges Audit"
        subtitle="Inspect every Stripe charge that hit the lead-purchase ledger. Surfaces duplicates inside 10-minute windows, name/email mismatches, and unusual amounts (anything outside the $100/$250 SKUs)."
        accent="amber"
        actions={
          <Button onClick={() => refetch()} disabled={isRefetching} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {[
          { label: "Charges synced", value: stats.total, color: "text-foreground", icon: TrendingUp },
          { label: "Total billed", value: `$${stats.totalUsd.toLocaleString()}`, color: "text-emerald-400", icon: DollarSign },
          { label: "Anomalies flagged", value: stats.flagged, color: "text-rose-400", icon: AlertTriangle },
          { label: "Duplicate-window", value: stats.dupes, color: "text-amber-400", icon: Copy },
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

      {/* Sam's $167 incident callout */}
      {filter === "anomalies" && stats.flagged > 0 && (
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
                  show up here.
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
          <Badge variant="outline" className="hidden md:inline-flex">{filtered.length} shown</Badge>
        </div>
      </GlassCard>

      {/* Charges list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard variant="subtle" className="p-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3 opacity-70" />
          <p className="text-lg font-semibold">
            {filter === "anomalies" ? "No anomalies in the current set" : "No charges match these filters"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter === "anomalies"
              ? "Stripe webhook is syncing clean. Refresh after the next charge batch."
              : "Try widening the filter."}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {filtered.map((c, i) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015 }}
              >
                <GlassCard variant="subtle" className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    {/* Amount */}
                    <div className="md:w-[110px] shrink-0">
                      <p className={`text-2xl font-bold tabular-nums ${c.flag_unusual_amount ? "text-rose-400" : "text-emerald-400"}`}>
                        ${c.amount_usd.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.currency?.toUpperCase() ?? "USD"}</p>
                    </div>

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        {c.flag_name_mismatch && (
                          <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/40">
                            <UserX className="h-3 w-3 mr-1" /> Name mismatch
                          </Badge>
                        )}
                        {c.flag_duplicate_window && (
                          <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/40">
                            <Copy className="h-3 w-3 mr-1" /> Duplicate window
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

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(c.stripe_charge_id);
                          toast.success("Charge ID copied");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        <span className="font-mono text-[11px] hidden md:inline">{c.stripe_charge_id.slice(0, 14)}…</span>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
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
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
