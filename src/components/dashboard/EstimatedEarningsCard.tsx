import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { DollarSign, TrendingUp, Clock, CalendarDays, Info, ShieldCheck } from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { DateRangePicker, useDateRange } from "@/components/ui/date-range-picker";
import { format, differenceInCalendarDays } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getTodayPST, getMonthStartPST, getWeekStartPST } from "@/lib/dateUtils";

interface Props {
  currentAgentId: string;
}

/**
 * Earnings formula constants — single source of truth
 * Personal: ALP × (9/12) × 1.2
 * Override: Team ALP × (9/12) × 0.5
 */
const ANNUITY_FACTOR = 9 / 12; // 75% — average annual persistency
const PERSONAL_COMP_RATE = 1.2;
const OVERRIDE_COMP_RATE = 0.5;

export function EstimatedEarningsCard({ currentAgentId }: Props) {
  const { period, setPeriod, range, setRange, startDate, endDate } = useDateRange("month");

  // Enforce PST date boundaries
  const pstStartDate = startDate || getMonthStartPST();
  const pstEndDate = endDate || getTodayPST();

  const { data } = useQuery({
    queryKey: ["estimated-earnings-v2", currentAgentId, pstStartDate, pstEndDate],
    queryFn: async () => {
      // Pulls real commission amounts from public.commission_ledger (which
      // itself uses fn_commission_rate — agent override → carrier contract).
      // Prior version multiplied daily_production.aop by a guessed 120%
      // and a 75% persistency factor, which produced inflated totals.
      const [personalRes, teamRes, hoursRes] = await Promise.all([
        supabase.from("commission_ledger" as any)
          .select("amount, status")
          .eq("agent_id", currentAgentId)
          .gte("created_at", pstStartDate + "T00:00:00Z")
          .lte("created_at", pstEndDate + "T23:59:59Z"),
        supabase.from("commission_ledger" as any)
          .select("amount")
          .neq("agent_id", currentAgentId)
          .gte("created_at", pstStartDate + "T00:00:00Z")
          .lte("created_at", pstEndDate + "T23:59:59Z"),
        supabase.from("daily_production")
          .select("hours_called, production_date, aop")
          .eq("agent_id", currentAgentId)
          .gte("production_date", pstStartDate)
          .lte("production_date", pstEndDate),
      ]);

      const personalEarnings = ((personalRes.data as any[]) ?? [])
        .reduce((s, r: any) => s + Number(r.amount || 0), 0);
      const paidEarnings = ((personalRes.data as any[]) ?? [])
        .filter((r: any) => r.status === "paid")
        .reduce((s, r: any) => s + Number(r.amount || 0), 0);
      const teamCommission = ((teamRes.data as any[]) ?? [])
        .reduce((s, r: any) => s + Number(r.amount || 0), 0);
      const overrideEarnings = teamCommission * OVERRIDE_COMP_RATE;
      const total = personalEarnings + overrideEarnings;

      let personalHours = 0;
      const activeDays = new Set<string>();
      for (const p of ((hoursRes.data as any[]) ?? [])) {
        personalHours += Number(p.hours_called) || 0;
        if ((Number(p.aop) || 0) > 0 || (Number(p.hours_called) || 0) > 0) {
          activeDays.add(p.production_date);
        }
      }

      if (total === 0) return null;

      return {
        personalALP: 0,
        teamALP: teamCommission,
        overrideEarnings,
        personalEarnings,
        paidEarnings,
        total,
        personalHours,
        activeDays: activeDays.size,
        dateRange: { start: pstStartDate, end: pstEndDate },
      };
    },
    staleTime: 120_000,
  });

  const daysInRange = useMemo(() => {
    if (!range.from || !range.to) return 1;
    return Math.max(1, differenceInCalendarDays(range.to, range.from) + 1);
  }, [range]);

  const perDay = data ? data.total / Math.max(1, data.activeDays) : 0;
  const perHour = data && data.personalHours > 0 ? data.total / data.personalHours : 0;
  const weeklyRate = perDay * 5; // 5 working days

  if (!data || data.total === 0) return null;

  return (
    <GlassCard className="relative overflow-hidden border-primary/20">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-emerald-500/8 pointer-events-none" />
      <div className="absolute -right-10 -bottom-10 h-36 w-36 rounded-full bg-gradient-to-br from-primary/15 to-emerald-500/10 blur-2xl pointer-events-none" />

      <div className="relative z-10 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/20 border border-primary/20">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-wide uppercase text-foreground">
                Estimated Earnings
              </h3>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-2.5 w-2.5" />
                PST-verified • {data.dateRange.start} → {data.dateRange.end}
              </p>
            </div>
          </div>
          <DateRangePicker value={range} onChange={setRange} period={period} onPeriodChange={setPeriod} />
        </div>

        {/* Total */}
        <div className="mb-4">
          <p className="text-4xl font-black bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent leading-tight">
            <AnimatedCounter value={Math.round(data.total)} prefix="$" formatOptions={{ maximumFractionDigits: 0 }} />
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <TrendingUp className="h-3 w-3 text-emerald-500" />
            <span className="text-xs text-emerald-500 font-medium">Total estimated</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/15 cursor-help transition-colors hover:bg-primary/15">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Personal</p>
                  <Info className="h-2.5 w-2.5 text-muted-foreground/50" />
                </div>
                <p className="text-lg font-bold text-foreground">${Math.round(data.personalEarnings).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">ALP: ${data.personalALP.toLocaleString()}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              ALP × {ANNUITY_FACTOR.toFixed(2)} × {PERSONAL_COMP_RATE} = ${Math.round(data.personalEarnings).toLocaleString()}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/15 cursor-help transition-colors hover:bg-emerald-500/15">
                <div className="flex items-center gap-1 mb-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Override</p>
                  <Info className="h-2.5 w-2.5 text-muted-foreground/50" />
                </div>
                <p className="text-lg font-bold text-foreground">${Math.round(data.overrideEarnings).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Team ALP: ${data.teamALP.toLocaleString()}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Team ALP × {ANNUITY_FACTOR.toFixed(2)} × {OVERRIDE_COMP_RATE} = ${Math.round(data.overrideEarnings).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Derived metrics */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <CalendarDays className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-muted-foreground font-medium">$/Day</span>
            </div>
            <p className="text-sm font-bold text-foreground">${Math.round(perDay).toLocaleString()}</p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <CalendarDays className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-muted-foreground font-medium">$/Week</span>
            </div>
            <p className="text-sm font-bold text-foreground">${Math.round(weeklyRate).toLocaleString()}</p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Clock className="h-3 w-3 text-emerald-500" />
              <span className="text-[10px] text-muted-foreground font-medium">$/Hour</span>
            </div>
            <p className="text-sm font-bold text-foreground">
              {perHour > 0 ? `$${Math.round(perHour).toLocaleString()}` : "—"}
            </p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Clock className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] text-muted-foreground font-medium">Hours</span>
            </div>
            <p className="text-sm font-bold text-foreground">
              {data.personalHours > 0 ? data.personalHours.toFixed(1) : "—"}
            </p>
          </div>
        </div>

        {/* Audit footer */}
        <p className="text-[9px] text-muted-foreground/50 text-center mt-3">
          {data.activeDays} active days • Rates: Personal {PERSONAL_COMP_RATE}x, Override {OVERRIDE_COMP_RATE}x • Persistency {Math.round(ANNUITY_FACTOR * 100)}%
        </p>
      </div>
    </GlassCard>
  );
}
