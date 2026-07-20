import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Compass, Filter } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type PersonRef = {
  application_id: string | null;
  agent_id: string | null;
  first_name: string;
  last_name: string;
  days_in_stage: number;
  is_stalled: boolean;
  sla_due_at: string | null;
};

type BoardRow = {
  manager_user_id: string | null;
  stage_key: string;
  stage_display_name: string;
  order_index: number;
  color_hex: string;
  person_count: number;
  stalled_count: number;
  over_week_count: number;
  avg_days_in_stage: number | null;
  max_days_in_stage: number | null;
  persons: PersonRef[];
};

export default function ManagerNextStepBoard() {
  const { user, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const overrideManager = params.get("manager");
  const managerId = isAdmin && overrideManager ? overrideManager : user?.id ?? null;
  const [stalledOnly, setStalledOnly] = useState(false);

  const { data: rows = [], isLoading } = useQuery<BoardRow[]>({
    queryKey: ["next-step-manager-board", managerId],
    enabled: !!managerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_next_step_manager_board")
        .select("*")
        .eq("manager_user_id", managerId)
        .order("order_index");
      if (error) throw error;
      return (data as BoardRow[]) ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 2 * 60_000,
  });

  const totals = useMemo(() => {
    const totalPeople = rows.reduce((a, r) => a + r.person_count, 0);
    const totalStalled = rows.reduce((a, r) => a + r.stalled_count, 0);
    const totalOverWeek = rows.reduce((a, r) => a + r.over_week_count, 0);
    return { totalPeople, totalStalled, totalOverWeek };
  }, [rows]);

  const visibleRows = stalledOnly ? rows.filter((r) => r.stalled_count > 0) : rows;

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
            <Compass className="h-3.5 w-3.5" /> Next-step board
          </div>
          <h1 className="text-3xl font-bold">My Team — Next Step Board</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totals.totalPeople} people · {totals.totalStalled} stalled · {totals.totalOverWeek} idle &gt; 7d
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={stalledOnly ? "destructive" : "outline"} size="sm" onClick={() => setStalledOnly((v) => !v)}>
            <Filter className="h-3.5 w-3.5 mr-1" />
            {stalledOnly ? "Showing stalled only" : "Stalled only"}
          </Button>
          {isAdmin && overrideManager && (
            <Button variant="ghost" size="sm" onClick={() => setParams({})}>
              Back to my board
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            /* stable-key-allow:skeleton */
            <Card key={i} className="h-48 animate-pulse" />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          No active people in your downline. New applicants will appear here automatically.
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleRows.map((r) => (
            <Card key={r.stage_key} className="overflow-hidden">
              <div className="h-1" style={{ backgroundColor: r.color_hex }} />
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="truncate">{r.order_index}. {r.stage_display_name}</span>
                  {r.stalled_count > 0 && (
                    <Badge variant="destructive" className="text-[10px] shrink-0">
                      <AlertTriangle className="h-3 w-3 mr-1" />{r.stalled_count}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">{r.person_count}</span>
                  <span className="text-[11px] text-muted-foreground">
                    avg {Math.round(r.avg_days_in_stage ?? 0)}d · max {Math.round(r.max_days_in_stage ?? 0)}d
                  </span>
                </div>
                <ul className="space-y-1 max-h-52 overflow-y-auto text-sm border-t border-border/40 pt-2">
                  {r.persons.slice(0, 12).map((p) => {
                    const id = p.application_id ?? p.agent_id ?? "";
                    const href = p.application_id
                      ? `/dashboard/applicants?focus=${p.application_id}`
                      : `/dashboard/agents/${p.agent_id}`;
                    return (
                      <li
                        key={id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded px-1.5 py-1",
                          p.is_stalled ? "bg-rose-500/10" : "hover:bg-muted/40",
                        )}
                      >
                        <Link to={href} className="hover:underline truncate text-sm">
                          {p.first_name} {p.last_name}
                        </Link>
                        <span
                          className={cn(
                            "text-[10px] tabular-nums shrink-0",
                            p.is_stalled ? "text-rose-300" : "text-muted-foreground",
                          )}
                        >
                          {Math.round(p.days_in_stage)}d
                        </span>
                      </li>
                    );
                  })}
                  {r.persons.length > 12 && (
                    <li className="text-[10px] text-muted-foreground italic">
                      + {r.persons.length - 12} more
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
