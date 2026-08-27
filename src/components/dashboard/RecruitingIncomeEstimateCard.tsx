import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Estimate {
  recruited_ap: number;
  recruited_policies: number;
  recruited_producers: number;
  effective_recruiter_comp_pct: number;
  estimated_override: number;
  qualified_bounties: number;
  estimated_total: number;
  basis: string;
}

function phoenixMonthBounds() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

const money = (value: number) =>
  Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function RecruitingIncomeEstimateCard({ agentId }: { agentId?: string | null }) {
  const bounds = phoenixMonthBounds();
  const query = useQuery({
    queryKey: ["recruiting-income-estimate", agentId, bounds.start, bounds.end],
    queryFn: async () => {
      if (!agentId) return null;
      const { data, error } = await (supabase as any).rpc("recruiting_income_estimate", {
        p_recruiter_id: agentId,
        p_start: bounds.start,
        p_end: bounds.end,
      });
      if (error) throw error;
      return data as Estimate;
    },
    enabled: Boolean(agentId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!agentId) return null;
  if (query.isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (query.isError || !query.data) {
    return (
      <Card className="border-rose-500/30">
        <CardContent className="p-4 text-sm text-rose-500">Recruiting income estimate is temporarily unavailable.</CardContent>
      </Card>
    );
  }

  const d = query.data;
  return (
    <Card className="border-primary/30 bg-card">
      <CardContent className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-2 text-primary"><BadgeDollarSign className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Estimated recruiting income · MTD</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-foreground">{money(d.estimated_total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Estimate only—carrier payment, chargebacks, advances, and final approvals can change it.</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-right">
            <p className="text-xs text-muted-foreground">Your recorded comp</p>
            <p className="text-xl font-bold tabular-nums">{Number(d.effective_recruiter_comp_pct).toLocaleString()}%</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
          <div><p className="text-lg font-bold tabular-nums">{money(d.estimated_override)}</p><p className="text-[11px] text-muted-foreground">Estimated overrides</p></div>
          <div><p className="text-lg font-bold tabular-nums">{money(d.qualified_bounties)}</p><p className="text-[11px] text-muted-foreground">Qualified bounties</p></div>
          <div><p className="text-lg font-bold tabular-nums">{money(d.recruited_ap)}</p><p className="text-[11px] text-muted-foreground">Recruited AP · {d.recruited_policies} policies</p></div>
          <div><p className="flex items-center gap-1 text-lg font-bold tabular-nums"><Users className="h-4 w-4 text-primary" />{d.recruited_producers}</p><p className="text-[11px] text-muted-foreground">Producing recruits</p></div>
        </div>
      </CardContent>
    </Card>
  );
}
