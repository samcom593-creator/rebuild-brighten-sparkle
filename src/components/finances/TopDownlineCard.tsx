import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInsuraCloud } from "@/hooks/useInsuraCloud";
import { Trophy } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export function TopDownlineCard({ agentId }: { agentId?: string | null }) {
  const { downline } = useInsuraCloud(agentId);
  const rows = (downline.data ?? []).slice(0, 5);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Trophy className="h-4 w-4 text-primary" /> Top Downline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No downline data yet.</div>
        ) : (
          <ol className="space-y-2">
            {rows.map((d, i) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-primary tabular-nums">#{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium">{d.downline_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {d.policy_count ?? 0} policies
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {fmt(Number(d.total_commission))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
