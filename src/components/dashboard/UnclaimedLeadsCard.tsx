import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { supabase } from "@/integrations/supabase/client";
import { AlertOctagon, ArrowRight, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface SampleRow {
  id: string;
  first_name: string | null;
  created_at: string;
  age_hours: number;
}

interface Summary {
  total: number;
  urgent_72h: number;
  newest_first: number;
  oldest_age_days: number;
  sample: SampleRow[];
}

/**
 * UnclaimedLeadsCard — surfaces the lead pool that has NO agent assigned.
 *
 * Powered by landing_unclaimed_summary() RPC over the v_unclaimed_new_apps
 * view (shipped 2026-05-19 in the OS audit Tier-1). Currently surfaces ~309
 * invisible leads, 285 urgent. Each one represents a recruit who applied and
 * got dropped on the floor.
 *
 * Renders at the top of /dashboard/command so it's the FIRST thing Sam sees.
 * Click-through goes to /dashboard/leads where claims can be made.
 */
export function UnclaimedLeadsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["landing_unclaimed_summary"],
    queryFn: async (): Promise<Summary | null> => {
      const { data, error } = await supabase.rpc("landing_unclaimed_summary");
      if (error) throw error;
      return data as unknown as Summary;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Card className="p-5 border border-rose-500/30 bg-rose-500/5 animate-pulse">
        <div className="h-6 w-48 bg-rose-500/10 rounded" />
      </Card>
    );
  }

  if (!data || data.total === 0) {
    return null;
  }

  const tone = data.urgent_72h > 50 ? "alert" : data.urgent_72h > 0 ? "warn" : "neutral";
  const borderClass: Record<typeof tone, string> = {
    alert:   "border-rose-500/40 bg-rose-500/[0.06]",
    warn:    "border-amber-500/30 bg-amber-500/[0.06]",
    neutral: "border-border bg-card",
  } as const;
  const valueClass: Record<typeof tone, string> = {
    alert:   "text-rose-300",
    warn:    "text-amber-300",
    neutral: "text-foreground",
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className={cn("p-5 sm:p-6 transition-colors", borderClass[tone])}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-rose-500/15 p-3 border border-rose-500/30 shrink-0">
              <AlertOctagon className="h-6 w-6 text-rose-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-rose-400/80">
                Money on the floor · auto-detected
              </p>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight mt-0.5">
                Unclaimed applicants
              </h2>
              <p className="text-[12px] text-muted-foreground leading-snug mt-1 max-w-xl">
                Applicants who applied but have no manager / agent owning them. Every hour they sit cold is recruiting revenue walking away.
              </p>
            </div>
          </div>
          <Link
            to="/dashboard/leads"
            className="text-xs inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 px-3 py-2 transition-colors shrink-0 font-medium"
          >
            Claim → Lead Center <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Stat
            icon={Users}
            label="Total unclaimed"
            value={data.total}
            tone="alert"
            valueClass={valueClass.alert}
          />
          <Stat
            icon={Clock}
            label="Urgent (>72h cold)"
            value={data.urgent_72h}
            tone={tone}
            valueClass={valueClass[tone]}
          />
          <Stat
            icon={Users}
            label="New (<24h)"
            value={data.newest_first}
            tone="neutral"
            valueClass="text-emerald-300"
          />
          <Stat
            icon={Clock}
            label="Oldest (days)"
            value={data.oldest_age_days}
            tone={tone}
            valueClass={valueClass[tone]}
          />
        </div>

        {data.sample.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground uppercase tracking-[0.18em] mb-2">
              Oldest 5 · longest waiting first
            </p>
            <ul className="space-y-1.5">
              {data.sample.map((row) => (
                <li key={row.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {(row.first_name || "Unknown").toString()}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {row.age_hours < 48
                      ? `${row.age_hours}h cold`
                      : `${Math.round(row.age_hours / 24)}d cold`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

interface StatProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "alert" | "warn" | "neutral";
  valueClass: string;
}

function Stat({ icon: Icon, label, value, valueClass }: StatProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums leading-none", valueClass)}>
        <AnimatedCounter value={value} duration={1200} />
      </div>
    </div>
  );
}
