import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Hand, MessageSquare, Phone, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { contactLinkProps, phoneHref, smsHref } from "@/lib/phone";

/**
 * Recruit Stages (2026-09-30). Sam: "fix the licensing tracking so I can see
 * where recruits are at ... make it way easier to change and edit stages on
 * that page, I shouldn't have to go to the agent's profile. Remove all clutter."
 *
 * One list, every recruit, one stage each, on the Next Step Engine's 19-stage
 * ladder (applied -> pre-license -> exam -> hired -> contracting -> training ->
 * first deal -> first $10K week). The stage dropdown on each row writes through
 * set_recruit_stage(), which stamps or clears the evidence the engine derives
 * from, so a hand-set stage sticks (a posted deal still outranks it).
 */
type Row = {
  person_type: "applicant" | "agent";
  application_id: string | null;
  agent_id: string | null;
  display_name: string;
  phone: string | null;
  email: string | null;
  state: string | null;
  stage_key: string;
  stage_name: string;
  order_index: number;
  entered_at: string;
  days_in_stage: number;
  is_stalled: boolean;
  next_action_label: string | null;
  manager_name: string | null;
  license_status: string | null;
  license_progress: string | null;
  npn: string | null;
  manual_stage_key: string | null;
  status: string;
};
type Stage = { stage_key: string; order_index: number; display_name: string; is_terminal: boolean | null };

const HIRED_INDEX = 12;
const personKey = (r: Row) => r.application_id ?? r.agent_id ?? r.display_name;

export default function RecruitPipeline() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [stalledOnly, setStalledOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const stagesQuery = useQuery({
    queryKey: ["next-step-stages"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("next_step_stages" as never)
        .select("stage_key, order_index, display_name, is_terminal")
        .order("order_index");
      if (error) throw error;
      return (data ?? []) as unknown as Stage[];
    },
  });
  const rowsQuery = useQuery({
    queryKey: ["recruit-pipeline"],
    staleTime: 30_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("recruit_pipeline_list" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const stages = stagesQuery.data ?? [];
  const all = rowsQuery.data ?? [];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (!showClosed && r.status !== "active") return false;
      if (stalledOnly && !r.is_stalled) return false;
      if (stageFilter && r.stage_key !== stageFilter) return false;
      if (q && !`${r.display_name} ${r.manager_name ?? ""} ${r.phone ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, stageFilter, stalledOnly, showClosed]);

  const counts = useMemo(() => {
    const m = new Map<string, { n: number; stalled: number }>();
    for (const r of all) {
      if (r.status !== "active") continue;
      const c = m.get(r.stage_key) ?? { n: 0, stalled: 0 };
      c.n += 1; if (r.is_stalled) c.stalled += 1;
      m.set(r.stage_key, c);
    }
    return m;
  }, [all]);

  const optionsFor = (r: Row) =>
    stages.filter((s) =>
      r.person_type === "applicant"
        ? s.order_index < HIRED_INDEX || s.stage_key === "closed_lost"
        : s.order_index >= HIRED_INDEX && s.stage_key !== "closed_lost");

  const nextStageFor = (r: Row) => {
    const ladder = optionsFor(r).filter((s) => s.stage_key !== "closed_lost");
    const i = ladder.findIndex((s) => s.stage_key === r.stage_key);
    return i >= 0 && i + 1 < ladder.length ? ladder[i + 1] : null;
  };

  const setStage = async (r: Row, toStage: string) => {
    if (toStage === r.stage_key) return;
    setBusy(personKey(r));
    const { data, error } = await supabase.rpc("set_recruit_stage" as never, {
      p_application_id: r.application_id,
      p_agent_id: r.agent_id,
      p_to_stage: toStage,
      p_reason: null,
    } as never);
    setBusy(null);
    if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
    const res = (data ?? {}) as { ok?: boolean; final?: string; matched?: boolean; message?: string | null };
    const finalName = stages.find((s) => s.stage_key === res.final)?.display_name ?? res.final;
    if (res.ok === false) toast.error(res.message ?? "Not changed.");
    else if (res.matched === false) toast.warning(`${r.display_name}: ${res.message ?? `kept at ${finalName}`}`);
    else toast.success(`${r.display_name} → ${finalName}`);
    await qc.invalidateQueries({ queryKey: ["recruit-pipeline"] });
  };

  const totalActive = all.filter((r) => r.status === "active").length;
  const totalStalled = all.filter((r) => r.status === "active" && r.is_stalled).length;

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="Grow"
        title="Recruit Stages"
        subtitle={`${totalActive} recruits · ${totalStalled} stalled. Change a stage right here; it sticks.`}
      />

      {/* Stage ladder — one chip per stage, click to filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setStageFilter(null)}
          className={cn("rounded-full border px-3 py-1 text-xs", !stageFilter ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground")}
        >
          All <span className="tabular-nums opacity-70">{totalActive}</span>
        </button>
        {stages.filter((s) => s.stage_key !== "closed_lost").map((s) => {
          const c = counts.get(s.stage_key);
          return (
            <button
              key={s.stage_key}
              type="button"
              onClick={() => setStageFilter(stageFilter === s.stage_key ? null : s.stage_key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                stageFilter === s.stage_key ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                !c && "opacity-50",
              )}
            >
              {s.order_index}. {s.display_name} <span className="tabular-nums opacity-70">{c?.n ?? 0}</span>
              {c?.stalled ? <span className="ml-1 text-rose-400">⚠{c.stalled}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, manager, phone" className="h-9 pl-8" />
        </div>
        <Button size="sm" variant={stalledOnly ? "destructive" : "outline"} className="h-9" onClick={() => setStalledOnly((v) => !v)}>
          <AlertTriangle className="mr-1.5 h-4 w-4" /> {stalledOnly ? "Stalled only" : "Stalled"}
        </Button>
        <Button size="sm" variant={showClosed ? "secondary" : "ghost"} className="h-9" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Hiding closed" : "Show closed"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} shown</span>
      </div>

      {rowsQuery.isLoading || stagesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rowsQuery.isError ? (
        <p className="text-sm text-rose-400">The recruit list did not load. Nothing is being guessed at in its place; refresh to retry.</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nobody matches.</p>
      ) : (
        stages
          .filter((s) => visible.some((r) => r.stage_key === s.stage_key))
          .map((s) => {
            const list = visible.filter((r) => r.stage_key === s.stage_key).sort((a, b) => b.days_in_stage - a.days_in_stage);
            return (
              <section key={s.stage_key} className="space-y-1.5">
                <div className="flex items-baseline gap-2 pt-2">
                  <h2 className="text-sm font-semibold">{s.order_index}. {s.display_name}</h2>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                  {list[0]?.next_action_label && <span className="text-xs text-muted-foreground">· next: {list[0].next_action_label}</span>}
                </div>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {list.map((r) => {
                    const tel = phoneHref(r.phone);
                    const next = nextStageFor(r);
                    const isBusy = busy === personKey(r);
                    return (
                      <div key={personKey(r)} className={cn("grid items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]", r.is_stalled && "bg-rose-500/[0.04]")}>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">{r.display_name}</span>
                            <Badge variant="outline" className="text-[10px]">{r.person_type === "agent" ? "Agent" : "Applicant"}</Badge>
                            {r.person_type === "agent" && (
                              <Badge variant="outline" className={cn("text-[10px]", r.license_status === "licensed" ? "text-emerald-300" : "text-amber-300")}>
                                {r.license_status === "licensed"
                                  ? "Licensed"
                                  : `Not licensed${r.license_progress && r.license_progress !== "unlicensed" ? ` · ${r.license_progress.replace(/_/g, " ")}` : ""}`}
                              </Badge>
                            )}
                            {r.manual_stage_key && <Hand className="h-3 w-3 text-muted-foreground" aria-label="Stage set by hand" />}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.manager_name ? `under ${r.manager_name}` : "no manager"}
                            {r.state ? ` · ${r.state}` : ""}
                            {" · "}
                            <span className={cn(r.is_stalled && "font-medium text-rose-400")}>
                              {Math.round(r.days_in_stage)}d in stage{r.is_stalled ? " · stalled" : ""}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {tel ? (
                            <>
                              <span className="font-mono text-xs tabular-nums">{r.phone}</span>
                              <Button asChild size="sm" variant="outline" className="h-7 px-2"><a {...contactLinkProps(tel)}><Phone className="h-3.5 w-3.5" /></a></Button>
                              <Button asChild size="sm" variant="outline" className="h-7 px-2"><a {...contactLinkProps(smsHref(r.phone))}><MessageSquare className="h-3.5 w-3.5" /></a></Button>
                            </>
                          ) : (
                            <span className="text-xs text-rose-300">no phone</span>
                          )}
                        </div>
                        <Select value={r.stage_key} onValueChange={(v) => setStage(r, v)} disabled={isBusy}>
                          <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={`Stage for ${r.display_name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {optionsFor(r).map((o) => (
                              <SelectItem key={o.stage_key} value={o.stage_key} className="text-xs">
                                {o.stage_key === "closed_lost" ? "Closed / dropped" : `${o.order_index}. ${o.display_name}`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={!next || isBusy} onClick={() => next && setStage(r, next.stage_key)} title={next ? `Move to ${next.display_name}` : "Last stage"}>
                          Next <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
      )}
    </div>
  );
}
