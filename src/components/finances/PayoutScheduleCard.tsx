import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useInsuraCloud } from "@/hooks/useInsuraCloud";
import { CalendarClock } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const isToday = (d: string) => d === new Date().toISOString().slice(0, 10);

export function PayoutScheduleCard({ agentId }: { agentId?: string | null }) {
  const { payouts } = useInsuraCloud(agentId);
  const rows = (payouts.data ?? []).slice(0, 10);
  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4 text-primary" /> Payout Schedule
          </CardTitle>
          <span className="text-xs tabular-nums text-muted-foreground">
            Next 10: {fmt(total)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No upcoming payouts.</div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((p) => (
              <li
                key={p.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${
                  isToday(p.payout_date) ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30"
                }`}
              >
                <div>
                  <div className="text-sm font-medium">
                    {new Date(p.payout_date).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                    {isToday(p.payout_date) && (
                      <span className="ml-2 text-[10px] font-semibold uppercase text-primary">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.policy_count ?? 0} policies
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">{fmt(Number(p.amount))}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
