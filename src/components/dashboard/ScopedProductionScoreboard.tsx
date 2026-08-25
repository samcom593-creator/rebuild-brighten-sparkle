import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, CircleDollarSign, RefreshCw, TrendingUp, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { scoreboardWindow, type ScoreboardPeriod } from "@/lib/scoreboardPeriod";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ScoreboardData {
  as_of: string;
  has_producer_profile: boolean;
  scope_label: string;
  downline_agents: number;
  personal: { ap: number; policies: number };
  team: { ap: number; policies: number };
  earnings: {
    estimated: number;
    direct: number;
    override: number;
    team_estimated: number;
    basis: string;
  };
  last_synced_at: string | null;
  source: string;
}

const PHOENIX_TZ = "America/Phoenix";
const isoDate = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: PHOENIX_TZ });
const phoenixToday = () => isoDate(new Date());
const PERIODS: Array<{ key: ScoreboardPeriod; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week to date" },
  { key: "past_week", label: "Past 7 days" },
  { key: "month", label: "Month to date" },
  { key: "year", label: "Year to date" },
];

const money = (value: number | null | undefined) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}).format(Number(value ?? 0));

function ScoreTile({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className={accent ? "mt-2 truncate text-3xl font-bold tabular-nums text-primary" : "mt-2 truncate text-3xl font-bold tabular-nums text-foreground"}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ScopedProductionScoreboard() {
  const [period, setPeriod] = useState<ScoreboardPeriod>("day");
  const [throughDate, setThroughDate] = useState(phoenixToday);
  const window = useMemo(() => scoreboardWindow(period, throughDate), [period, throughDate]);

  const query = useQuery({
    queryKey: ["scoped-production-scoreboard", window.start, window.end],
    staleTime: 120_000,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("scoped_production_scoreboard" as never, {
        p_start: window.start,
        p_end: window.end,
      } as never);
      if (error) throw error;
      return data as unknown as ScoreboardData;
    },
  });

  return (
    <Card className="overflow-hidden border-primary/35 bg-primary/[0.035]">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">My production scoreboard</p>
              {query.data?.scope_label && <Badge variant="outline">{query.data.scope_label}</Badge>}
              <Badge variant="secondary">Live · Phoenix</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{window.label} · personal results and your signed-in hierarchy</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Scoreboard through date"
                className="h-9 w-[150px] pl-8 text-xs"
                max={phoenixToday()}
                type="date"
                value={throughDate}
                onChange={(event) => event.target.value && setThroughDate(event.target.value)}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9" size="sm" variant="outline">
                  {PERIODS.find((item) => item.key === period)?.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {PERIODS.map((item) => (
                  <DropdownMenuItem key={item.key} onSelect={() => setPeriod(item.key)}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              aria-label="Refresh production scoreboard"
              className="h-9 w-9 p-0"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCw className={query.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <div className="grid sm:grid-cols-3">
            {[0, 1, 2].map((item) => <Skeleton className="m-4 h-24" key={item} />)}
          </div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">Live production could not load. No totals were guessed.</p>
            <Button onClick={() => void query.refetch()} size="sm" variant="outline">Retry</Button>
          </div>
        ) : !query.data?.has_producer_profile ? (
          <div className="p-4 text-sm text-muted-foreground">Your login is not linked to a producer profile yet. Ask an administrator to connect it before production can be attributed.</div>
        ) : (
          <div className="grid sm:grid-cols-3">
            <ScoreTile
              detail={`${query.data.personal.policies.toLocaleString()} personal ${query.data.personal.policies === 1 ? "policy" : "policies"}`}
              icon={TrendingUp}
              label="My personal production"
              value={money(query.data.personal.ap)}
            />
            <ScoreTile
              detail={`${query.data.team.policies.toLocaleString()} total ${query.data.team.policies === 1 ? "policy" : "policies"} · ${query.data.scope_label}`}
              icon={Users}
              label="My team production"
              value={money(query.data.team.ap)}
            />
            <ScoreTile
              accent
              detail={`${money(query.data.earnings.direct)} direct + ${money(query.data.earnings.override)} override`}
              icon={CircleDollarSign}
              label="My estimated earnings"
              value={money(query.data.earnings.estimated)}
            />
          </div>
        )}

        {query.data?.has_producer_profile && (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Team estimated gross commission: <strong className="font-semibold text-foreground">{money(query.data.earnings.team_estimated)}</strong>
            </span>
            <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" to="/dashboard/finances">
              Commission breakdown <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
