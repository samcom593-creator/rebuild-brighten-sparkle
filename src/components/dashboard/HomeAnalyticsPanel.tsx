import { LineChart as LineChartIcon, Shield } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { money, monthShort, type HomeData } from "@/lib/homeDashboard";

// F24 (2026-10-14 Galaxy OS map): the production trend chart and the policy
// status card used to sit inline in AgentCloudHome under a closed <details>,
// which hides them but still imports Recharts with the page and mounts the
// chart on first paint. This file is the only Recharts consumer on the Home
// route and AgentCloudHome imports it with React.lazy from inside the
// disclosure, so neither the chart nor the vendor-charts chunk is requested
// or mounted until a viewer opens "Trend and policy status". Keep every
// import here one the Home page would not otherwise load.

// Order and copy follow the AC reference exactly. status_not_reported is APEX's
// own honest bucket: AgentLink returns policyStatus=None for 1,304 of 1,731
// deals upstream, and folding that into "Carrier N/A" would dress a data gap as
// a carrier problem.
const STATUS_TILES: Array<{ key: string; label: string; tone: string }> = [
  { key: "active", label: "Active", tone: "text-emerald-500" },
  { key: "issued_not_paid", label: "Issued, Not Paid", tone: "text-emerald-400" },
  { key: "in_review", label: "In Review", tone: "text-sky-400" },
  { key: "lapse_pending", label: "Lapse Pending", tone: "text-amber-400" },
  { key: "lapsed", label: "Lapsed", tone: "text-rose-400" },
  { key: "cancelled", label: "Cancelled", tone: "text-rose-500" },
  { key: "withdrawn", label: "Withdrawn", tone: "text-muted-foreground" },
  { key: "not_taken", label: "Not Taken", tone: "text-amber-500" },
  { key: "postponed", label: "Postponed", tone: "text-muted-foreground" },
  { key: "status_not_reported", label: "Status not reported", tone: "text-muted-foreground" },
];

export interface HomeAnalyticsPanelProps {
  trend: HomeData["trend"];
  lifetime: HomeData["lifetime"];
  policyStatus: HomeData["policy_status"];
}

export function HomeAnalyticsPanel({ trend, lifetime, policyStatus }: HomeAnalyticsPanelProps) {
  const rows = (trend ?? []).map((t) => ({ ...t, name: monthShort(t.m) }));

  return (
    <div className="space-y-5">
      {/* PRODUCTION TREND */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <LineChartIcon className="h-3 w-3" />Production trend · 12 months
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56}
                  domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.2) / 5000) * 5000]}
                  tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <ChartTooltip formatter={(v: number) => money(v)}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="ap" name="ALP" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.16} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* POLICY STATUS */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Shield className="h-3 w-3" />Policy status
            </p>
            <span className="text-[12px] text-muted-foreground">{lifetime.policies.toLocaleString()} policies · {money(lifetime.ap)} book</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {STATUS_TILES.map((t) => (
              <div key={t.key} className="rounded-lg border border-border bg-background/40 p-3">
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
                <p className={cn("mt-1 text-xl font-bold tabular-nums", t.tone)}>{(policyStatus?.[t.key] ?? 0).toLocaleString()}</p>
              </div>
            ))}
          </div>
          {(policyStatus?.status_not_reported ?? 0) > 0 && (
            // A div, not a p: Badge renders a div, and a div cannot sit inside a paragraph.
            <div className="mt-3 text-[12px] text-muted-foreground">
              <Badge variant="outline" className="mr-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">Upstream gap</Badge>
              The legacy book does not report a policy status for {(policyStatus.status_not_reported).toLocaleString()} of these historical policies, so lapse and chargeback tracking is blind on them.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
