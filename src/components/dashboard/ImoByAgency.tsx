import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

// TOTAL IMO BY AGENCY — Agent Cloud's home-dashboard block. APEX (your direct
// book) vs each sub-agency (Vantage = KJ Vaughn's team), rolled up from the real
// hierarchy via v_imo_by_agency. Shared by the Home dashboard and Production.
type Row = {
  agency: string;
  is_primary: boolean;
  policies: number;
  alp: number;
  alp_mtd?: number;
  policies_mtd?: number;
  policies_30d?: number;
  alp_30d?: number;
  // Your (IMO owner) estimated override on each sub-agency's production —
  // owner comp minus that agency's head comp (Vantage: 120−105 = 15%). 0 on
  // your own APEX book, whose direct+team earnings live in the scoreboard.
  owner_override_pct?: number;
  est_owner_override_alp?: number;
  est_owner_override_mtd?: number;
  est_owner_override_30d?: number;
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ImoByAgency({
  start,
  end,
  windowLabel,
}: { start?: string; end?: string; windowLabel?: string } = {}) {
  const queryClient = useQueryClient();
  const exactWindow = Boolean(start && end);
  const { data: imo = [] } = useQuery({
    queryKey: ["imo-by-agency", start ?? "summary", end ?? "summary"],
    staleTime: 60_000,
    queryFn: async () => {
      if (start && end) {
        const { data, error } = await supabase.rpc("imo_by_agency_period" as never, {
          p_start: start,
          p_end: end,
        } as never);
        if (error) throw error;
        return (data ?? []) as unknown as Row[];
      }
      const { data, error } = await supabase
        .from("v_imo_by_agency")
        .select("agency, is_primary, policies, alp, alp_mtd, policies_mtd, policies_30d, alp_30d, owner_override_pct, est_owner_override_alp, est_owner_override_mtd, est_owner_override_30d")
        .order("alp", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const invalidateProduction = () => {
    queryClient.invalidateQueries({ queryKey: ["imo-by-agency"] });
    queryClient.invalidateQueries({ queryKey: ["crm-today-production"] });
    queryClient.invalidateQueries({ queryKey: ["apex-home-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["scoped-production-scoreboard"] });
  };
  useRealtimeTable({ table: "deals", channelSuffix: "imo-agency" }, invalidateProduction);
  useRealtimeTable({ table: "agentlink_book", channelSuffix: "imo-agency" }, invalidateProduction);
  useRealtimeTable(
    { table: "production_external_daily_snapshots", channelSuffix: "imo-agency" },
    invalidateProduction,
  );
  useRealtimeTable(
    { table: "production_external_deals", channelSuffix: "imo-agency" },
    invalidateProduction,
  );

  if (imo.length === 0) return null;
  const max = Math.max(1, ...imo.map((a) => a.alp));
  const periodTotal = imo.reduce((sum, agency) => sum + (exactWindow ? agency.alp : agency.alp_mtd ?? 0), 0);
  const periodLabel = exactWindow ? (windowLabel ?? "Selected period") : "Calendar MTD";
  const ovrOf = (a: Row) => (exactWindow ? a.est_owner_override_alp : a.est_owner_override_mtd) ?? 0;
  const overrideTotal = imo.reduce((sum, a) => sum + ovrOf(a), 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Total IMO by Agency</p>
        <p className="text-xs text-muted-foreground">
          {periodLabel} · {fmt(periodTotal)} ALP
          {overrideTotal > 0 && <span className="ml-1 text-primary">· {fmt(overrideTotal)} your override</span>}
        </p>
      </div>
      <Card>
        <CardContent className="space-y-3 p-4">
          {imo.map((a) => (
            <div key={a.agency}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  {a.agency}
                  {a.is_primary && <Badge variant="outline" className="border-primary/30 bg-primary/15 text-primary text-[10px]">MINE</Badge>}
                </span>
                <span className="font-semibold tabular-nums">{fmt(a.alp)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(a.alp / max) * 100}%` }} />
              </div>
              {exactWindow ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {a.policies.toLocaleString()} policies · {(windowLabel ?? "selected period").toLowerCase()}
                </p>
              ) : (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <p>{(a.policies_30d ?? 0).toLocaleString()} policies · {fmt(a.alp_30d)} last 30 days</p>
                  <p>{(a.policies_mtd ?? 0).toLocaleString()} policies · {fmt(a.alp_mtd)} calendar MTD</p>
                </div>
              )}
              {(a.owner_override_pct ?? 0) > 0 && (
                <p className="mt-0.5 text-[11px] font-medium text-primary">
                  Your override: {a.owner_override_pct}% · {fmt(ovrOf(a))} {exactWindow ? "this window" : "MTD"}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
