import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInsuraCloud } from "@/hooks/useInsuraCloud";
import { Building2 } from "lucide-react";
import { useMemo } from "react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export function CarrierBreakdownCard({ agentId }: { agentId?: string | null }) {
  const { policies } = useInsuraCloud(agentId);

  const breakdown = useMemo(() => {
    const map = new Map<string, { premium: number; commission: number; count: number }>();
    for (const p of policies.data ?? []) {
      const key = p.carrier ?? "Unknown";
      const cur = map.get(key) ?? { premium: 0, commission: 0, count: 0 };
      cur.premium += Number(p.premium ?? 0);
      cur.commission += Number(p.commission ?? 0);
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([carrier, v]) => ({ carrier, ...v }))
      .sort((a, b) => b.commission - a.commission)
      .slice(0, 8);
  }, [policies.data]);

  const max = breakdown[0]?.commission || 1;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="h-4 w-4 text-primary" /> Carrier Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        {breakdown.length === 0 ? (
          <div className="text-sm text-muted-foreground">No policy data yet.</div>
        ) : (
          <div className="space-y-2">
            {breakdown.map((b) => (
              <div key={b.carrier}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{b.carrier}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmt(b.commission)} · {b.count}p
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.max(4, (b.commission / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
