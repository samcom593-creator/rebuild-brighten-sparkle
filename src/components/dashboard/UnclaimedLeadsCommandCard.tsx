import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertOctagon,
  Phone,
  Mail,
  Clock,
  ArrowRight,
  Loader2,
  Sparkles,
  Flame,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * UnclaimedLeadsCommandCard — surfaces every status='new' applicant that
 * has no manager working it. As of 2026-05-19 there are 319 such leads,
 * 285 of them >14 days cold — the biggest single funnel leak.
 *
 * Backed by:
 *   • view  v_unclaimed_new_apps      (heat-coded: urgent/cold/warm/fresh)
 *   • RPC   claim_unclaimed_lead(uuid) (atomically assigns to caller)
 *
 * Mounted at the very top of /dashboard so Sam sees the leak first thing
 * and can drain it one tap at a time. The aurora-gold gradient + pulse
 * dot + ranked-urgency badges make this card visibly distinct from
 * everything else on the page so the next dashboard load feels different.
 *
 * Operating-system audit 2026-05-19 — Move 3, PL-085.
 */

type UnclaimedRow = {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  license_status: string | null;
  license_progress: string | null;
  days_in_queue: number;
  heat: "urgent" | "cold" | "warm" | "fresh";
};

const HEAT_STYLES: Record<UnclaimedRow["heat"], { label: string; pill: string; dot: string }> = {
  urgent: { label: "URGENT",      pill: "border-rose-500/60 bg-rose-500/15 text-rose-200",       dot: "bg-rose-400" },
  cold:   { label: "Cold",        pill: "border-amber-500/50 bg-amber-500/10 text-amber-200",    dot: "bg-amber-400" },
  warm:   { label: "Warm",        pill: "border-sky-500/40 bg-sky-500/10 text-sky-200",          dot: "bg-sky-400" },
  fresh:  { label: "Fresh",       pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200", dot: "bg-emerald-400" },
};

const PREVIEW_ROW_LIMIT = 5;

export function UnclaimedLeadsCommandCard() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["v_unclaimed_new_apps"],
    queryFn: async (): Promise<UnclaimedRow[]> => {
      const { data, error } = await supabase
        .from("v_unclaimed_new_apps" as any)
        .select("*")
        .order("created_at", { ascending: true })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as UnclaimedRow[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      urgent: rows.filter(r => r.heat === "urgent").length,
      cold:   rows.filter(r => r.heat === "cold").length,
      warm:   rows.filter(r => r.heat === "warm").length,
      fresh:  rows.filter(r => r.heat === "fresh").length,
    };
  }, [data]);

  const rows = useMemo(() => {
    const all = data ?? [];
    return expanded ? all : all.slice(0, PREVIEW_ROW_LIMIT);
  }, [data, expanded]);

  const claim = async (row: UnclaimedRow) => {
    setClaimingId(row.id);
    try {
      const { error } = await (supabase as any).rpc("claim_unclaimed_lead", {
        p_application_id: row.id,
      });
      if (error) throw error;
      const displayName = [row.first_name, row.last_name].filter(Boolean).join(" ") || "lead";
      toast.success(`Claimed ${displayName}. They're now in your Reviewing queue.`);
      qc.invalidateQueries({ queryKey: ["v_unclaimed_new_apps"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not claim — check console.");
    } finally {
      setClaimingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-white dark:bg-card p-5 animate-pulse">
        <div className="text-xs text-muted-foreground">Loading unclaimed leads…</div>
      </div>
    );
  }

  if (!data || counts.total === 0) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-white dark:bg-card p-5 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-emerald-200">Inbox zero — every new applicant is claimed</div>
          <div className="text-xs text-muted-foreground mt-0.5">When a fresh app lands, it'll show up here.</div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-md border border-amber-500/40 bg-white dark:bg-card p-5 "
    >
      {/* corner glow */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-amber-500/20 " />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-rose-500/15 " />

      <div className="relative flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-amber-400/40 animate-ping" />
            <div className="relative h-10 w-10 rounded-full bg-white dark:bg-card flex items-center justify-center ">
              <AlertOctagon className="h-5 w-5 text-zinc-950" />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Unclaimed leads · Money on the floor
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
              {counts.total} new {counts.total === 1 ? "applicant" : "applicants"} with nobody working them
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5">
              Tap <span className="text-amber-200 font-semibold">Claim</span> to assign yourself and move them to your Reviewing queue.
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard/applicants?bucket=new&assignment=unclaimed">
            Full queue <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </div>

      <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        <HeatPill label="Urgent · 14d+" value={counts.urgent} tone="rose"    icon={Flame} />
        <HeatPill label="Cold · 7d+"    value={counts.cold}   tone="amber"   icon={Clock} />
        <HeatPill label="Warm · 3d+"    value={counts.warm}   tone="sky"     icon={Clock} />
        <HeatPill label="Fresh"          value={counts.fresh}  tone="emerald" icon={Sparkles} />
      </div>

      <div className="relative space-y-2">
        <AnimatePresence initial={false}>
          {rows.map(row => {
            const display = [row.first_name, row.last_name].filter(Boolean).join(" ") || "(no name)";
            const heatStyle = HEAT_STYLES[row.heat];
            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 rounded-md border border-border/80 bg-white dark:bg-card/60 p-3 hover:border-amber-400/40 hover:bg-white dark:bg-card/80 transition-colors"
              >
                <span className={cn("relative flex h-2.5 w-2.5", row.heat === "urgent" ? "" : "")}>
                  <span className={cn("absolute inset-0 rounded-full opacity-60", heatStyle.dot, row.heat === "urgent" && "animate-ping")} />
                  <span className={cn("relative h-2.5 w-2.5 rounded-full", heatStyle.dot)} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm truncate">{display}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", heatStyle.pill)}>
                      {heatStyle.label} · {row.days_in_queue}d
                    </Badge>
                    {row.state && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.state}</span>
                    )}
                    {row.license_progress && row.license_progress !== "unlicensed" && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">
                        {row.license_progress.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                    {row.phone && (
                      <a href={`tel:${row.phone}`} className="flex items-center gap-1 hover:text-foreground" onClick={e => e.stopPropagation()}>
                        <Phone className="h-3 w-3" /> {row.phone}
                      </a>
                    )}
                    {row.email && (
                      <a href={`mailto:${row.email}`} className="flex items-center gap-1 hover:text-foreground truncate" onClick={e => e.stopPropagation()}>
                        <Mail className="h-3 w-3" /> {row.email}
                      </a>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => claim(row)}
                  disabled={claimingId === row.id}
                  className="bg-white dark:bg-card text-zinc-950 hover:from-amber-300 hover:to-amber-400 font-bold"
                >
                  {claimingId === row.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>Claim <ArrowRight className="h-4 w-4 ml-1" /></>
                  )}
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {counts.total > PREVIEW_ROW_LIMIT && (
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="w-full mt-1.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-white dark:bg-card/40 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-amber-400/30 transition-colors"
          >
            {expanded ? (
              <>Collapse <ChevronUp className="h-3.5 w-3.5" /></>
            ) : (
              <>Show {Math.min(counts.total, 40) - PREVIEW_ROW_LIMIT} more <ChevronDown className="h-3.5 w-3.5" /></>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function HeatPill({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "sky" | "emerald";
  icon: React.ElementType;
}) {
  const toneClasses: Record<typeof tone, string> = {
    rose:    "border-rose-500/40 bg-rose-500/10 text-rose-200",
    amber:   "border-amber-500/40 bg-amber-500/10 text-amber-200",
    sky:     "border-sky-500/40 bg-sky-500/10 text-sky-200",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2 flex items-center gap-2", toneClasses[tone])}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
        <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}
