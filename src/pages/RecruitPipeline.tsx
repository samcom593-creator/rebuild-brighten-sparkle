import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Download, Instagram, Mail, MessageSquare, Phone, Search, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { cn } from "@/lib/utils";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { formatTimeAgo } from "@/lib/dateUtils";

/**
 * Recruit Stages (2026-09-30). Sam: "fix the licensing tracking so I can see
 * where recruits are at ... make it way easier to change and edit stages on
 * that page, I shouldn't have to go to the agent's profile. Remove all
 * clutter ... make that page perfect."
 *
 * One list, every recruit, one stage each, on the Next Step Engine's 19-stage
 * ladder. Everything a recruiting day needs happens on the row: change the
 * stage (set_recruit_stage stamps or clears the evidence so it sticks), call or
 * text, set licensing on a hired-but-unlicensed agent, undo a slip. Bulk-select
 * moves or closes many at once (set_recruit_stage_bulk), because 700 of the 870
 * active recruits measured 60+ days in their stage when this shipped.
 *
 * "Stalled" from the engine fires at 24-48h and so tags ~97% of rows; the page
 * grades idle time instead (7d / 21d / 60d) so the flag means something.
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
  last_contacted_at: string | null;
  manual_stage_key: string | null;
  status: string;
  instagram: string | null;
};
type Stage = { stage_key: string; order_index: number; display_name: string; is_terminal: boolean | null; retired_at: string | null };
type IdleFilter = "all" | "7" | "21" | "60";

const HIRED_INDEX = 12;
// Stages the operator cannot know first-hand; Next skips them, the dropdown keeps them.
const DERIVED_ONLY = new Set(["watched_vsl", "completed_application"]);
const PAGE = 40;
const personKey = (r: Row) => r.application_id ?? r.agent_id ?? r.display_name;
const igUrl = (h: string) => `https://instagram.com/${encodeURIComponent(h)}`;

function heatClass(days: number) {
  if (days >= 60) return "text-rose-400 font-medium";
  if (days >= 21) return "text-rose-300";
  if (days >= 7) return "text-amber-300";
  if (days < 2) return "text-emerald-300";
  return "text-muted-foreground";
}

export default function RecruitPipeline() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [idle, setIdle] = useState<IdleFilter>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<string>("");
  const [igEditing, setIgEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const stagesQuery = useQuery({
    queryKey: ["next-step-stages"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("next_step_stages" as never)
        .select("stage_key, order_index, display_name, is_terminal, retired_at")
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

  // Retired stages (the seminar pair) stay in the table for history but are
  // never shown, offered, or derived.
  const stages = useMemo(() => (stagesQuery.data ?? []).filter((s) => !s.retired_at), [stagesQuery.data]);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const stageName = useCallback((key: string) => stages.find((s) => s.stage_key === key)?.display_name ?? key, [stages]);

  const managers = useMemo(
    () => Array.from(new Set(all.map((r) => r.manager_name).filter((m): m is string => !!m))).sort(),
    [all],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minDays = idle === "all" ? 0 : Number(idle);
    return all.filter((r) => {
      if (!showClosed && r.status !== "active") return false;
      if (r.days_in_stage < minDays) return false;
      if (stageFilter && r.stage_key !== stageFilter) return false;
      if (managerFilter === "none" ? !!r.manager_name : managerFilter !== "all" && r.manager_name !== managerFilter) return false;
      if (q && !`${r.display_name} ${r.manager_name ?? ""} ${r.phone ?? ""} ${r.email ?? ""} ${r.stage_name} ${r.instagram ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, idle, stageFilter, managerFilter, showClosed]);

  const counts = useMemo(() => {
    const m = new Map<string, { n: number; idle21: number }>();
    for (const r of all) {
      if (r.status !== "active") continue;
      const c = m.get(r.stage_key) ?? { n: 0, idle21: 0 };
      c.n += 1; if (r.days_in_stage >= 21) c.idle21 += 1;
      m.set(r.stage_key, c);
    }
    return m;
  }, [all]);

  const optionsFor = useCallback(
    (r: Row) =>
      stages.filter((s) =>
        r.person_type === "applicant"
          ? s.order_index < HIRED_INDEX || s.stage_key === "closed_lost"
          : s.order_index >= HIRED_INDEX && s.stage_key !== "closed_lost"),
    [stages],
  );
  const nextStageFor = useCallback(
    (r: Row) => {
      const ladder = optionsFor(r).filter((s) => s.stage_key !== "closed_lost");
      const i = ladder.findIndex((s) => s.stage_key === r.stage_key);
      if (i < 0) return null;
      return ladder.slice(i + 1).find((s) => !DERIVED_ONLY.has(s.stage_key)) ?? null;
    },
    [optionsFor],
  );

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["recruit-pipeline"] }), [qc]);

  const setStage = useCallback(
    async (r: Row, toStage: string, opts?: { silentUndo?: boolean }) => {
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
      if (res.ok === false) { toast.error(res.message ?? "Not changed."); return; }
      const finalName = stageName(res.final ?? toStage);
      if (res.matched === false) toast.warning(`${r.display_name}: ${res.message ?? `kept at ${finalName}`}`);
      else if (opts?.silentUndo) toast.success(`${r.display_name} back at ${finalName}`);
      else {
        const before = r.stage_key;
        toast.success(`${r.display_name} → ${finalName}`, {
          action: { label: "Undo", onClick: () => void setStage({ ...r, stage_key: res.final ?? toStage }, before, { silentUndo: true }) },
        });
      }
      await refresh();
    },
    [refresh, stageName],
  );

  const selectedRows = useMemo(() => visible.filter((r) => selected.has(personKey(r))), [visible, selected]);
  const bulkOptions = useMemo(() => {
    if (selectedRows.length === 0) return [] as Stage[];
    const hasApplicant = selectedRows.some((r) => r.person_type === "applicant");
    const hasAgent = selectedRows.some((r) => r.person_type === "agent");
    return stages.filter((s) => {
      if (s.stage_key === "closed_lost") return !hasAgent;
      if (hasApplicant && s.order_index >= HIRED_INDEX) return false;
      if (hasAgent && s.order_index < HIRED_INDEX) return false;
      return true;
    });
  }, [selectedRows, stages]);

  const bulkMove = useCallback(
    async (toStage: string) => {
      if (selectedRows.length === 0 || !toStage) return;
      setBusy("bulk");
      const people = selectedRows.map((r) => ({ application_id: r.application_id, agent_id: r.agent_id }));
      const { data, error } = await supabase.rpc("set_recruit_stage_bulk" as never, { p_people: people, p_to_stage: toStage, p_reason: null } as never);
      setBusy(null);
      if (error) { toast.error(`Bulk move failed: ${error.message}`); return; }
      const res = (data ?? {}) as { moved?: number; kept?: number; refused?: number; failed?: number; messages?: string[] };
      const name = stageName(toStage);
      const parts = [`${res.moved ?? 0} moved to ${name}`];
      if (res.kept) parts.push(`${res.kept} kept where evidence puts them`);
      if (res.refused) parts.push(`${res.refused} refused`);
      if (res.failed) parts.push(`${res.failed} failed`);
      ((res.refused ?? 0) + (res.failed ?? 0) > 0 ? toast.warning : toast.success)(parts.join(" · "), {
        description: res.messages?.slice(0, 2).join(" "),
      });
      setSelected(new Set()); setBulkStage("");
      await refresh();
    },
    [selectedRows, stageName, refresh],
  );

  const saveInstagram = useCallback(
    async (r: Row, handle: string) => {
      const { data, error } = await supabase.rpc("set_recruit_instagram" as never, {
        p_application_id: r.application_id, p_agent_id: r.agent_id, p_handle: handle,
      } as never);
      setIgEditing(null);
      if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
      const saved = (data as { instagram?: string | null } | null)?.instagram;
      toast.success(saved ? `${r.display_name}: Instagram @${saved}` : `${r.display_name}: Instagram cleared`);
      await refresh();
    },
    [refresh],
  );

  const toggle = (r: Row) =>
    setSelected((prev) => { const n = new Set(prev); const k = personKey(r); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleMany = (rows: Row[], on: boolean) =>
    setSelected((prev) => { const n = new Set(prev); for (const r of rows) { if (on) n.add(personKey(r)); else n.delete(personKey(r)); } return n; });

  const downloadCsv = () => {
    if (visible.length === 0) { toast.error("Nothing to download."); return; }
    const cols: [string, (r: Row) => string | number | null][] = [
      ["name", (r) => r.display_name], ["type", (r) => r.person_type], ["stage", (r) => r.stage_name],
      ["days_in_stage", (r) => Math.round(r.days_in_stage)], ["manager", (r) => r.manager_name],
      ["phone", (r) => formatPhoneDisplay(r.phone)], ["email", (r) => r.email], ["instagram", (r) => r.instagram], ["state", (r) => r.state],
      ["license_status", (r) => r.license_status], ["license_progress", (r) => r.license_progress], ["npn", (r) => r.npn],
      ["last_contact", (r) => r.last_contacted_at?.slice(0, 10) ?? null],
    ];
    const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => c[0]).join(","), ...visible.map((r) => cols.map((c) => cell(c[1](r))).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `recruits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast.success(`Downloaded ${visible.length} recruits.`);
  };

  const active = all.filter((r) => r.status === "active");
  const idle7 = active.filter((r) => r.days_in_stage >= 7).length;
  const idle60 = active.filter((r) => r.days_in_stage >= 60).length;

  const chip = (on: boolean) =>
    cn("rounded-full border px-3 py-1 text-xs transition", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground");

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-4 px-4 pb-28 sm:px-6">
      <PageHeader
        accent="cyan"
        eyebrow="Grow"
        title="Recruit Stages"
        subtitle={`${active.length} recruits · ${idle7} idle 7d+ · ${idle60} idle 60d+`}
      />

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setStageFilter(null)} className={chip(!stageFilter)}>
          All <span className="tabular-nums opacity-70">{active.length}</span>
        </button>
        {stages.filter((s) => s.stage_key !== "closed_lost" && (counts.get(s.stage_key)?.n ?? 0) > 0).map((s) => {
          const c = counts.get(s.stage_key);
          return (
            <button
              key={s.stage_key}
              type="button"
              onClick={() => setStageFilter(stageFilter === s.stage_key ? null : s.stage_key)}
              className={chip(stageFilter === s.stage_key)}
              title={c?.idle21 ? `${c.idle21} idle 21d+` : undefined}
            >
              {s.order_index}. {s.display_name} <span className="tabular-nums opacity-70">{c?.n ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, manager, phone, stage" className="h-9 pl-8" />
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {([["all", "Everyone"], ["7", "7d+"], ["21", "21d+"], ["60", "60d+"]] as [IdleFilter, string][]).map(([k, label]) => (
              <Button key={k} size="sm" variant={idle === k ? "default" : "ghost"} className="h-8 px-2.5 text-xs" onClick={() => setIdle(k)}>{label}</Button>
            ))}
          </div>
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="h-9 w-full text-xs sm:w-44" aria-label="Filter by manager"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All managers</SelectItem>
              <SelectItem value="none" className="text-xs">Unassigned</SelectItem>
              {managers.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant={showClosed ? "secondary" : "ghost"} className="h-9 text-xs" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
          <Button size="sm" variant="ghost" className="h-9 gap-1 text-xs" onClick={downloadCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">{visible.length} shown</span>
        </div>

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
            <span className="text-sm font-medium">{selectedRows.length} selected</span>
            <Select value={bulkStage} onValueChange={setBulkStage}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-56" aria-label="Move selected to stage"><SelectValue placeholder="Move to stage…" /></SelectTrigger>
              <SelectContent>
                {bulkOptions.map((o) => (
                  <SelectItem key={o.stage_key} value={o.stage_key} className="text-xs">
                    {o.stage_key === "closed_lost" ? "Closed / dropped" : `${o.order_index}. ${o.display_name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8" disabled={!bulkStage || busy === "bulk"} onClick={() => bulkMove(bulkStage)}>
              {busy === "bulk" ? "Moving…" : "Apply"}
            </Button>
            {bulkOptions.some((o) => o.stage_key === "closed_lost") && (
              <Button size="sm" variant="outline" className="h-8 text-rose-300" disabled={busy === "bulk"} onClick={() => bulkMove("closed_lost")}>
                Close all {selectedRows.length}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setSelected(new Set())}><X className="h-3.5 w-3.5" /> Clear</Button>
          </div>
        )}
      </div>

      {rowsQuery.isLoading || stagesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rowsQuery.isError || stagesQuery.isError ? (
        <p className="text-sm text-rose-400">
          {rowsQuery.isError ? "The recruit list" : "The stage ladder"} did not load. Nothing is being guessed at in its place; refresh to retry.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nobody matches these filters.</p>
      ) : (
        stages
          .filter((s) => visible.some((r) => r.stage_key === s.stage_key))
          .map((s) => {
            const full = visible.filter((r) => r.stage_key === s.stage_key).sort((a, b) => a.days_in_stage - b.days_in_stage);
            const open = expanded.has(s.stage_key) || !!search || !!stageFilter || idle !== "all";
            const list = open ? full : full.slice(0, PAGE);
            const allSelected = full.every((r) => selected.has(personKey(r)));
            const someSelected = !allSelected && full.some((r) => selected.has(personKey(r)));
            return (
              <section key={s.stage_key} className="space-y-1.5">
                <div className="flex items-center gap-2 pt-2">
                  <Checkbox
                    aria-label={`Select everyone at ${s.display_name}`}
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => toggleMany(full, v === true)}
                    className="h-5 w-5 !min-h-0"
                  />
                  <h2 className="text-sm font-semibold">{s.order_index}. {s.display_name}</h2>
                  <span className="text-xs text-muted-foreground">{full.length}</span>
                  {full[0]?.next_action_label && <span className="hidden text-xs text-muted-foreground sm:inline">· next: {full[0].next_action_label}</span>}
                </div>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {list.map((r) => {
                    const tel = phoneHref(r.phone);
                    const next = nextStageFor(r);
                    const isBusy = busy === personKey(r) || busy === "bulk";
                    const contact = r.person_type === "applicant" && r.last_contacted_at ? formatTimeAgo(r.last_contacted_at) : null;
                    const isSel = selected.has(personKey(r));
                    return (
                      <div
                        key={personKey(r)}
                        className={cn(
                          "grid items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]",
                          isSel && "bg-primary/[0.06]",
                        )}
                      >
                        {/* index.css gives every <button> min-height:44px under 640px; a 16px-wide
                            checkbox became a tall pill. Keep the box square, keep the tap area padded. */}
                        <div className="-m-2 flex items-center self-start p-2 sm:self-center">
                          <Checkbox aria-label={`Select ${r.display_name}`} checked={isSel} onCheckedChange={() => toggle(r)} className="h-5 w-5 !min-h-0" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">{r.display_name}</span>
                            <Badge variant="outline" className="text-[10px]">{r.person_type === "agent" ? "Agent" : "Applicant"}</Badge>
                            {r.person_type === "agent" && (r.license_status === "licensed" ? (
                              <Badge variant="outline" className="text-[10px] text-emerald-300">Licensed</Badge>
                            ) : (
                              <LicenseProgressSelector
                                agentId={r.agent_id ?? undefined}
                                currentProgress={(r.license_progress || "unlicensed") as never}
                                onProgressUpdated={() => void refresh()}
                                className="h-6 text-[10px]"
                              />
                            ))}
                            {r.manual_stage_key && <span className="text-[10px] text-muted-foreground" title="Stage set by hand">✎</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.manager_name ? `under ${r.manager_name}` : "unassigned"}
                            {r.state ? ` · ${r.state}` : ""}
                            {" · "}
                            <span className={heatClass(r.days_in_stage)}>{Math.round(r.days_in_stage)}d in stage</span>
                            {contact && <> · last contact {contact}</>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          {tel ? (
                            <>
                              <span className="font-mono text-xs tabular-nums">{formatPhoneDisplay(r.phone)}</span>
                              <Button asChild size="sm" variant="outline" className="h-7 px-2"><a href={tel} {...contactLinkProps(tel)} aria-label={`Call ${r.display_name}`}><Phone className="h-3.5 w-3.5" /></a></Button>
                              <Button asChild size="sm" variant="outline" className="h-7 px-2"><a href={smsHref(r.phone) ?? undefined} {...contactLinkProps(smsHref(r.phone))} aria-label={`Text ${r.display_name}`}><MessageSquare className="h-3.5 w-3.5" /></a></Button>
                            </>
                          ) : r.email ? (
                            <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground">
                              <Mail className="h-3.5 w-3.5 shrink-0" /> {r.email}
                            </a>
                          ) : (
                            <span className="text-xs text-rose-300">no phone or email</span>
                          )}
                          {r.instagram ? (
                            <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
                              <a href={igUrl(r.instagram)} target="_blank" rel="noopener noreferrer" aria-label={`Instagram ${r.display_name}`}>
                                <Instagram className="h-3.5 w-3.5" /> @{r.instagram}
                              </a>
                            </Button>
                          ) : igEditing === personKey(r) ? (
                            <Input
                              autoFocus
                              placeholder="@handle"
                              className="h-7 w-36 text-xs"
                              onBlur={(e) => { const v = e.target.value.trim(); if (v) void saveInstagram(r, v); else setIgEditing(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) void saveInstagram(r, v); else setIgEditing(null); }
                                if (e.key === "Escape") setIgEditing(null);
                              }}
                            />
                          ) : (
                            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setIgEditing(personKey(r))} aria-label={`Add Instagram for ${r.display_name}`}>
                              <Instagram className="h-3.5 w-3.5" /> add IG
                            </button>
                          )}
                        </div>
                        <Select value={r.stage_key} onValueChange={(v) => void setStage(r, v)} disabled={isBusy}>
                          <SelectTrigger className="h-8 w-full text-xs sm:w-[220px]" aria-label={`Stage for ${r.display_name}`}>
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
                        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" disabled={!next || isBusy} onClick={() => next && void setStage(r, next.stage_key)} title={next ? `Move to ${next.display_name}` : "Last stage"}>
                          {next ? next.display_name : "Done"} <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                  {full.length > list.length && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-center text-xs text-primary hover:underline"
                      onClick={() => setExpanded((prev) => new Set(prev).add(s.stage_key))}
                    >
                      Show all {full.length} in {s.display_name}
                    </button>
                  )}
                </div>
              </section>
            );
          })
      )}
    </div>
  );
}
