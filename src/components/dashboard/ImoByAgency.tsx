import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// TOTAL IMO BY AGENCY — Agent Cloud's home-dashboard block. APEX (your direct
// book) vs each sub-agency (Vantage = KJ Vaughn's team), rolled up from the real
// hierarchy via v_imo_by_agency. Shared by the Home dashboard and Production.
type Row = { agency: string; is_primary: boolean; policies: number; alp: number; alp_mtd: number };

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ImoByAgency() {
  const { data: imo = [] } = useQuery({
    queryKey: ["imo-by-agency"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_imo_by_agency")
        .select("agency, is_primary, policies, alp, alp_mtd")
        .order("alp", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  if (imo.length === 0) return null;
  const max = Math.max(1, ...imo.map((a) => a.alp));
  const mtdTotal = imo.reduce((s, a) => s + (a.alp_mtd || 0), 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Total IMO by Agency</p>
        <p className="text-xs text-muted-foreground">This month · {fmt(mtdTotal)} ALP</p>
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
              <p className="mt-0.5 text-[11px] text-muted-foreground">{a.policies.toLocaleString()} policies · {fmt(a.alp_mtd)} this month</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
