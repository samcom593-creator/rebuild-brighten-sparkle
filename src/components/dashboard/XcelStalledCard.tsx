import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  GraduationCap,
  AlertTriangle,
  Phone,
  Mail,
  ArrowRight,
  Flame,
  Clock,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * XcelStalledCard — every pre-licensing student who hasn't touched their
 * XCEL course in 10+ days. Live counts from v_xcel_pipeline (which the
 * audit just created — was missing in DB and runtime-erroring the
 * licensing dashboard).
 *
 * Mounts under UnclaimedLeadsCommandCard so the two biggest funnel leaks
 * (unclaimed apps + stalled students) sit side-by-side at the very top
 * of /dashboard. Each row deep-links to the agent's profile for full
 * context + manager action.
 *
 * Operating-system audit 2026-05-19 — Move 1 follow-up surface.
 */

type XcelRow = {
  student_email: string;
  student_name: string | null;
  last_login: string | null;
  xcel_state: "active" | "recent" | "stalled" | "never_started";
  days_since_login: number | null;
  application_id: string | null;
  app_first_name: string | null;
  app_last_name: string | null;
  app_phone: string | null;
  license_status: string | null;
  license_progress: string | null;
  manager_name: string | null;
  manager_avatar: string | null;
  action_label: string | null;
};

export function XcelStalledCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["v_xcel_pipeline", "stalled"],
    queryFn: async (): Promise<XcelRow[]> => {
      const { data, error } = await supabase
        .from("v_xcel_pipeline" as any)
        .select("*")
        .in("xcel_state", ["stalled", "never_started"])
        .order("days_since_login", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as XcelRow[];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      stalled: rows.filter(r => r.xcel_state === "stalled").length,
      never:   rows.filter(r => r.xcel_state === "never_started").length,
    };
  }, [data]);

  const top = useMemo(() => (data ?? []).slice(0, 5), [data]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-transparent p-5 animate-pulse">
        <div className="text-xs text-muted-foreground">Loading XCEL pipeline…</div>
      </div>
    );
  }

  if (!data || counts.total === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="relative overflow-hidden rounded-2xl border border-purple-500/40 bg-gradient-to-br from-purple-500/12 via-fuchsia-500/8 to-transparent p-5 shadow-[0_0_80px_hsl(280_80%_55%/0.12)]"
    >
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full bg-purple-500/20 blur-3xl" />

      <div className="relative flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-400 to-fuchsia-500 flex items-center justify-center shadow-[0_0_30px_hsl(280_80%_55%/0.35)]">
            <GraduationCap className="h-5 w-5 text-zinc-950" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-300 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Pre-licensing · Bottleneck
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
              {counts.total} {counts.total === 1 ? "student" : "students"} stuck on XCEL
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5">
              These applicants paid for the course but aren't progressing.
              Every day idle is money on the floor.
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard/xcel-pipeline">
            Full pipeline <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </div>

      <div className="relative grid grid-cols-2 gap-2.5 mb-4">
        <BreakdownPill label="Stalled · 10d+ idle" value={counts.stalled} tone="rose" icon={Flame} />
        <BreakdownPill label="Never started course" value={counts.never} tone="amber" icon={Clock} />
      </div>

      <div className="relative space-y-2">
        {top.map(row => {
          const name = row.student_name
            || [row.app_first_name, row.app_last_name].filter(Boolean).join(" ")
            || row.student_email;
          const isStalled = row.xcel_state === "stalled";
          return (
            <div
              key={row.student_email}
              className="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 hover:border-purple-400/40 hover:bg-zinc-900/80 transition-colors"
            >
              <span className={cn(
                "h-2.5 w-2.5 rounded-full flex-shrink-0",
                isStalled ? "bg-rose-400" : "bg-amber-400",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm truncate">{name}</span>
                  <Badge variant="outline" className={cn(
                    "text-[10px] px-1.5 py-0 h-4",
                    isStalled
                      ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
                      : "border-amber-500/50 bg-amber-500/10 text-amber-200",
                  )}>
                    {isStalled ? `${row.days_since_login ?? "—"}d idle` : "never started"}
                  </Badge>
                  {row.manager_name && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      mgr: {row.manager_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                  {row.app_phone && (
                    <a href={`tel:${row.app_phone}`} className="flex items-center gap-1 hover:text-foreground" onClick={e => e.stopPropagation()}>
                      <Phone className="h-3 w-3" /> {row.app_phone}
                    </a>
                  )}
                  <a href={`mailto:${row.student_email}`} className="flex items-center gap-1 hover:text-foreground truncate" onClick={e => e.stopPropagation()}>
                    <Mail className="h-3 w-3" /> {row.student_email}
                  </a>
                  {row.action_label && (
                    <span className="italic text-purple-300">{row.action_label}</span>
                  )}
                </div>
              </div>
              {row.application_id && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/agent/${row.application_id}`}>
                    Open <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function BreakdownPill({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber";
  icon: React.ElementType;
}) {
  const toneClasses = {
    rose:  "border-rose-500/40 bg-rose-500/10 text-rose-200",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  } as const;
  return (
    <div className={cn("rounded-xl border px-3 py-2 flex items-center gap-2", toneClasses[tone])}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
        <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}
