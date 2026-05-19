import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Compass, MessageSquare, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StuckRow = {
  person_type: "applicant" | "agent";
  application_id: string | null;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  derived_stage_key: string;
  stage_display_name: string;
  days_in_stage: number;
  sla_due_at: string | null;
  severity: "low" | "medium" | "high" | "critical";
  failure_label: string | null;
  next_action_label: string | null;
  next_action_url: string | null;
};

const SEVERITY_COLORS: Record<StuckRow["severity"], string> = {
  critical: "text-rose-400",
  high: "text-orange-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};

const SEVERITY_BG: Record<StuckRow["severity"], string> = {
  critical: "bg-rose-500/15 border-rose-500/40",
  high: "bg-orange-500/15 border-orange-500/40",
  medium: "bg-amber-500/15 border-amber-500/40",
  low: "bg-blue-500/15 border-blue-500/40",
};

export default function AdminStuckPool() {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: rows = [], isLoading, refetch } = useQuery<StuckRow[]>({
    queryKey: ["next-step-stuck-pool"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_next_step_stuck_pool")
        .select("*")
        .order("days_in_stage", { ascending: false });
      if (error) throw error;
      return (data as StuckRow[]) ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 } as Record<StuckRow["severity"], number>;
    for (const r of rows) c[r.severity]++;
    return c;
  }, [rows]);

  const stages = useMemo(() => {
    const set = new Set(rows.map((r) => r.derived_stage_key));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (stageFilter !== "all" && r.derived_stage_key !== stageFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase();
        if (!name.includes(s) && !r.stage_display_name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [rows, stageFilter, search]);

  async function nudge(row: StuckRow) {
    const dedupe = `${row.application_id ?? row.agent_id}:${row.derived_stage_key}:manual:${Date.now()}`;
    const { error } = await supabase.from("next_step_messages").insert({
      application_id: row.application_id,
      agent_id: row.agent_id,
      stage_key: row.derived_stage_key,
      channel: "telegram",
      template_key: `${row.derived_stage_key}:manual_admin_nudge`,
      dedupe_key: dedupe,
      metadata: { source: "admin_stuck_pool_button" },
    });
    if (error) {
      toast({ title: "Failed to queue nudge", description: error.message, variant: "destructive" });
      return;
    }
    // Fire the dispatcher
    const dispatch = await supabase.functions.invoke("next-step-dispatch", {
      body: { limit: 5 },
    });
    if (dispatch.error) {
      toast({ title: "Nudge queued, dispatcher errored", description: dispatch.error.message, variant: "destructive" });
    } else {
      toast({ title: "Nudge fired", description: `${row.first_name ?? "Person"} → ${row.derived_stage_key}` });
    }
    refetch();
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-7xl">
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
          <Compass className="h-3.5 w-3.5" /> Pipeline · Stuck Pool
        </div>
        <h1 className="text-3xl font-bold">Stuck Pool</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every applicant + agent past their stage SLA — across the whole org, ranked by how long they&apos;ve been stuck.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <Card key={sev} className={cn("border", SEVERITY_BG[sev])}>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{sev}</div>
              <div className={cn("text-3xl font-bold tabular-nums leading-none mt-1", SEVERITY_COLORS[sev])}>
                {counts[sev]}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {sev === "critical" && ">30d in stage"}
                {sev === "high" && ">14d in stage"}
                {sev === "medium" && ">7d in stage"}
                {sev === "low" && "past SLA"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="text-base">{filtered.length} stalled people</CardTitle>
            <div className="flex flex-1 items-center gap-2">
              <Input
                placeholder="Search name or stage..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <select
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
              >
                <option value="all">All stages</option>
                {stages.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Loading stuck pool...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-emerald-400">
              No stalled people match these filters. 🎉
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2">Name</th>
                    <th className="text-left py-2 px-2">Stage</th>
                    <th className="text-right py-2 px-2">Days</th>
                    <th className="text-left py-2 px-2">Severity</th>
                    <th className="text-right py-2 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((row) => {
                    const id = row.application_id ?? row.agent_id;
                    const href = row.application_id
                      ? `/dashboard/applicants?focus=${row.application_id}`
                      : `/dashboard/agents/${row.agent_id}`;
                    return (
                      <tr key={id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-2">
                          <Link to={href} className="hover:underline font-medium">
                            {row.first_name ?? "—"} {row.last_name ?? ""}
                          </Link>
                          <div className="text-[10px] text-muted-foreground capitalize">{row.person_type}</div>
                        </td>
                        <td className="py-2 px-2">{row.stage_display_name}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{Math.round(row.days_in_stage)}d</td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" className={cn("text-[10px]", SEVERITY_COLORS[row.severity], SEVERITY_BG[row.severity])}>
                            {row.severity}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => nudge(row)}>
                            <MessageSquare className="h-3.5 w-3.5 mr-1" />Nudge
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > 200 && (
                <div className="text-[11px] text-muted-foreground text-center mt-3">
                  Showing first 200 of {filtered.length}. Filter to narrow down.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-4 bg-muted/30 border-dashed">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="font-medium">Next Step Engine is live.</span>
          <span className="text-muted-foreground">
            Stall sweep runs every 15 min · Nudge sweep hourly · Dispatcher fans out Telegram → SMS → Email
          </span>
          <Link to="/dashboard/team/next-step" className="ml-auto text-sm hover:underline text-blue-300 inline-flex items-center gap-1">
            Manager board <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>
    </div>
  );
}
