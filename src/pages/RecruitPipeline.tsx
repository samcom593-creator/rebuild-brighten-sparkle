import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Download, Instagram, Mail, MessageSquare, Phone, Search, SlidersHorizontal, UserX, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LicenseProgressSelector } from "@/components/dashboard/LicenseProgressSelector";
import { cn } from "@/lib/utils";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { markNoLongerWithUs } from "@/lib/noLongerWithUs";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { formatTimeAgo } from "@/lib/dateUtils";
import { buildExceptionQueue, type OnboardingFacts } from "@/lib/onboardingExceptions";
import { ExpectedStartControl } from "@/components/onboarding/ExpectedStartControl";
import { useOnboardingExceptionFacts } from "@/components/onboarding/useOnboardingExceptionFacts";

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
  link_sent_at: string | null;
  link_used_at: string | null;
  last_sign_in_at: string | null;
  resident_state: string | null;
};
type Stage = { stage_key: string; order_index: number; display_name: string; is_terminal: boolean | null; retired_at: string | null };
type IdleFilter = "all" | "7" | "21" | "60";
type LinkFilter = "all" | "not_sent" | "sent" | "clicked";

// Stages the operator cannot know first-hand; Next skips them, the dropdown keeps them.
const DERIVED_ONLY = new Set(["watched_vsl", "completed_application"]);
const PAGE = 40;
const personKey = (r: Row) => r.application_id ?? r.agent_id ?? r.display_name;
const igUrl = (h: string) => `https://instagram.com/${encodeURIComponent(h)}`;

function heatClass(days: number) {
  if (days >= 60) return "text-destructive font-medium";
  if (days >= 21) return "text-destructive";
  if (days >= 7) return "text-foreground font-medium";
  return "text-muted-foreground";
}

export default function RecruitPipeline() {
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const { isAdmin, isManager } = useAuth();
  const canRemove = !!(isAdmin || isManager);
  const [searchParams] = useSearchParams();
  // ?q= deep link (the onboarding queue's "Update license" button lands here).
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [idle, setIdle] = useState<IdleFilter>("all");
  const [link, setLink] = useState<LinkFilter>("all");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<string>("");
  const [igEditing, setIgEditing] = useState<string | null>(null);
  const [stateEditing, setStateEditing] = useState<string | null>(null);
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

  // Expected start + open onboarding items per hired agent, from the same
  // facts the No Hire Left Behind queue reads. A failure here never hides the
  // recruit list; the agent rows say "unknown" instead of zero.
  const factsQuery = useOnboardingExceptionFacts({ realtime: false });
  const factsByAgent = useMemo(() => {
    const m = new Map<string, { facts: OnboardingFacts; open: number; blocking: number }>();
    for (const f of factsQuery.data ?? []) m.set(f.agent_id, { facts: f, open: 0, blocking: 0 });
    for (const q of buildExceptionQueue(factsQuery.data ?? [])) {
      const cur = m.get(q.facts.agent_id);
      if (cur) { cur.open = q.exceptions.length; cur.blocking = q.exceptions.filter((e) => e.blocking).length; }
    }
    return m;
  }, [factsQuery.data]);
  const hiresWithOpenItems = useMemo(() => Array.from(factsByAgent.values()).filter((v) => v.open > 0).length, [factsByAgent]);

  // Retired stages (the seminar pair) stay in the table for history but are
  // never shown, offered, or derived.
  const stages = useMemo(() => (stagesQuery.data ?? []).filter((s) => !s.retired_at), [stagesQuery.data]);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const stageName = useCallback((key: string) => stages.find((s) => s.stage_key === key)?.display_name ?? key, [stages]);
  // First agent stage; everything below it is applicant territory.
  // Contracting flags per hired agent, from the same server calculation as My Team. The server only answers managers
  // and staff; for everyone else this is empty and nothing is drawn.
  const { isAdmin: rpAdmin, isManager: rpManager, isVaManager: rpVaManager, isVa: rpVa } = useAuth();
  const agentFloor = useMemo(() => stages.find((s) => s.stage_key === "hired_unlicensed")?.order_index ?? stages.find((s) => s.stage_key === "hired")?.order_index ?? 12, [stages]);
  const linkState = (r: Row): LinkFilter => (r.link_used_at || r.last_sign_in_at ? "clicked" : r.link_sent_at ? "sent" : "not_sent");

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
      if (link !== "all" && (r.person_type !== "agent" || linkState(r) !== link)) return false;
      if (stageFilter && r.stage_key !== stageFilter) return false;
      if (managerFilter === "none" ? !!r.manager_name : managerFilter !== "all" && r.manager_name !== managerFilter) return false;
      if (q && !`${r.display_name} ${r.manager_name ?? ""} ${r.phone ?? ""} ${r.email ?? ""} ${r.stage_name} ${r.instagram ?? ""} ${r.resident_state ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, idle, link, stageFilter, managerFilter, showClosed]);

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
          ? s.order_index < agentFloor || s.stage_key === "closed_lost"
          : s.order_index >= agentFloor && s.stage_key !== "closed_lost"),
    [stages, agentFloor],
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
      if (hasApplicant && s.order_index >= agentFloor) return false;
      if (hasAgent && s.order_index < agentFloor) return false;
      return true;
    });
  }, [selectedRows, stages, agentFloor]);

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

  // "No longer with us" for an agent: confirm, deactivate (they leave the roster
  // and this page on the next derive), log it, send the door-is-open email.
  const removeAgent = useCallback(
    async (r: Row) => {
      if (!r.agent_id) return;
      const ok = await askConfirm({
        title: `${r.display_name} is no longer with us?`,
        description: "They'll be set inactive and removed from your roster and this page, which also ends their team access. We'll email them that the door is still open.",
        confirmText: "Remove and send email",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(personKey(r));
      const out = await markNoLongerWithUs({ agentId: r.agent_id, displayName: r.display_name });
      setBusy(null);
      if (!out.ok || out.emailFailed) toast.error(out.message);
      else toast.success(out.message);
      await refresh();
    },
    [askConfirm, refresh],
  );

  const saveState = useCallback(
    async (r: Row, state: string) => {
      const { data, error } = await supabase.rpc("set_recruit_state" as never, {
        p_application_id: r.application_id, p_agent_id: r.agent_id, p_state: state,
      } as never);
      setStateEditing(null);
      if (error) { toast.error(`${r.display_name}: ${error.message}`); return; }
      toast.success(`${r.display_name}: state ${(data as { state?: string } | null)?.state ?? "cleared"}`);
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
      ["phone", (r) => formatPhoneDisplay(r.phone)], ["email", (r) => r.email], ["instagram", (r) => r.instagram], ["state", (r) => r.resident_state],
      ["license_status", (r) => r.license_status], ["license_progress", (r) => r.license_progress], ["npn", (r) => r.npn],
      ["last_contact", (r) => r.last_contacted_at?.slice(0, 10) ?? null],
      ["link_sent", (r) => r.link_sent_at?.slice(0, 10) ?? null], ["link_clicked", (r) => (r.link_used_at ?? r.last_sign_in_at)?.slice(0, 10) ?? null],
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

  if (rowsQuery.isLoading || stagesQuery.isLoading) return <PageSkeleton />;

  const chip = (on: boolean) =>
    cn(
      "inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
      on ? "border-primary/60 bg-primary/15 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/50",
    );
  const IDLE_LABELS: Record<IdleFilter, string> = { all: "Any", "7": "7+ days", "21": "21+ days", "60": "60+ days" };
  const LINK_LABELS: Record<LinkFilter, string> = { all: "Any", not_sent: "Not sent", sent: "Sent, not clicked", clicked: "Clicked" };
  const filterCount = [idle !== "all", link !== "all", managerFilter !== "all", showClosed].filter(Boolean).length;
  // A number opens exactly the people it counts (active recruits by idle time): every other filter clears.
  const onlyIdle = (k: IdleFilter) => {
    setIdle(k); setStageFilter(null); setLink("all"); setManagerFilter("all"); setShowClosed(false); setSearch("");
  };
  const tileOn = (k: IdleFilter) => idle === k && !stageFilter && link === "all" && managerFilter === "all" && !showClosed && !search;
  const filterChip = (label: string, onClear: () => void) => (
    <span key={label} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-3 pr-1 text-[13px] font-medium text-foreground">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="grid h-6 w-6 place-items-center rounded-full hover:bg-primary/20 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]">
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );

  // Grow redesign (2026-10-28): the subtitle's sentence of counts became four numbers,
  // the strip of segmented toggles became one Filters button with removable chips, and
  // the CSV export moved to the header. Rows keep every action they had.
  return (
    <div className="page-enter w-full space-y-5 pb-28">
      <RecruitingWorkspaceNav />
      <PageHeader
        title="New hires"
        subtitle="From hire to first deal. Move each person forward one step at a time."
        secondaryActions={
          <Button variant="outline" className="h-11 gap-1.5" onClick={downloadCsv}>
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        }
      />

      <GrowScoreboard
        label="New hire numbers"
        tiles={[
          { label: "In progress", value: active.length, hint: "Hired, not yet producing", onSelect: () => onlyIdle("all"), active: tileOn("all") },
          { label: "Stuck 7+ days", value: idle7, hint: "Same step a week or more", onSelect: () => onlyIdle("7"), active: tileOn("7"), emphasis: true },
          { label: "Stuck 60+ days", value: idle60, hint: "Same step two months", onSelect: () => onlyIdle("60"), active: tileOn("60") },
          { label: "Open onboarding", value: factsQuery.isSuccess ? hiresWithOpenItems : null, hint: "Hires with an open step", definition: "Hires with at least one open onboarding requirement (No Hire Left Behind)" },
        ]}
      />

      <nav aria-label="Stages" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStageFilter(null)} className={chip(!stageFilter)} aria-pressed={!stageFilter}>
          All <span className="tabular-nums text-muted-foreground">{active.length}</span>
        </button>
        {stages.filter((s) => s.stage_key !== "closed_lost" && (counts.get(s.stage_key)?.n ?? 0) > 0).map((s) => {
          const c = counts.get(s.stage_key);
          return (
            <button
              key={s.stage_key}
              type="button"
              aria-pressed={stageFilter === s.stage_key}
              onClick={() => setStageFilter(stageFilter === s.stage_key ? null : s.stage_key)}
              className={chip(stageFilter === s.stage_key)}
              title={c?.idle21 ? `${c.idle21} idle 21d+` : undefined}
            >
              {s.order_index}. {s.display_name} <span className="tabular-nums text-muted-foreground">{c?.n ?? 0}</span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, manager, phone or stage" aria-label="Search new hires" className="h-12 border-border bg-card pl-11 text-base" />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-12 shrink-0 border-border bg-card px-4 text-base">
                <SlidersHorizontal className="h-5 w-5" /> Filters{filterCount > 0 ? ` (${filterCount})` : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[22rem] space-y-5 p-4">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Time on the same step</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "7", "21", "60"] as IdleFilter[]).map((k) => (
                    <Button key={k} size="sm" className="h-10" variant={idle === k ? "secondary" : "ghost"} aria-pressed={idle === k} onClick={() => setIdle(k)}>{IDLE_LABELS[k]}</Button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Portal login link <span className="font-normal text-muted-foreground">(hired agents)</span></legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "not_sent", "sent", "clicked"] as LinkFilter[]).map((k) => (
                    <Button key={k} size="sm" className="h-10" variant={link === k ? "secondary" : "ghost"} aria-pressed={link === k} onClick={() => setLink(k)}>{LINK_LABELS[k]}</Button>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-foreground">Manager</span>
                <select
                  aria-label="Filter by manager"
                  value={managerFilter}
                  onChange={(e) => setManagerFilter(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                >
                  <option value="all">All managers</option>
                  <option value="none">Unassigned</option>
                  {managers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <Button variant={showClosed ? "secondary" : "outline"} className="h-10" aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Showing closed people" : "Show closed people too"}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span><span className="font-medium text-foreground">{visible.length.toLocaleString()}</span> shown</span>
          {idle !== "all" && filterChip(`Stuck ${IDLE_LABELS[idle]}`, () => setIdle("all"))}
          {link !== "all" && filterChip(`Link: ${LINK_LABELS[link]}`, () => setLink("all"))}
          {managerFilter !== "all" && filterChip(`Manager: ${managerFilter === "none" ? "Unassigned" : managerFilter}`, () => setManagerFilter("all"))}
          {showClosed && filterChip("Including closed", () => setShowClosed(false))}
        </div>

        {selectedRows.length > 0 && (
          // Sticky so it stays in reach after ticking people far down the page.
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card px-4 py-3">
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
              <Button size="sm" variant="outline" className="h-8 text-destructive" disabled={busy === "bulk"} onClick={() => bulkMove("closed_lost")}>
                Close all {selectedRows.length}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setSelected(new Set())}><X className="h-3.5 w-3.5" /> Clear</Button>
          </div>
        )}
      </div>

      {rowsQuery.isError || stagesQuery.isError ? (
        <p className="text-sm text-destructive">
          {rowsQuery.isError ? "The recruit list" : "The stage ladder"} did not load. Nothing is being guessed at in its place; refresh to retry.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nobody matches these filters.</p>
      ) : (
        stages
          .filter((s) => visible.some((r) => r.stage_key === s.stage_key))
          .map((s) => {
            const full = visible.filter((r) => r.stage_key === s.stage_key).sort((a, b) => a.days_in_stage - b.days_in_stage);
            const open = expanded.has(s.stage_key) || !!search || !!stageFilter || idle !== "all" || link !== "all";
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
                  <h2 className="text-base font-semibold">{s.order_index}. {s.display_name}</h2>
                  <span className="text-sm text-muted-foreground">{full.length}</span>
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
                          "grid items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.3fr)_auto_auto]",
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
                            <span className="line-clamp-2 text-base font-semibold">{r.display_name}</span>
                            {r.person_type === "agent" && (r.license_status === "licensed" ? (
                              <Badge variant="outline" className="text-[11px] text-primary">Licensed</Badge>
                            ) : (
                              <LicenseProgressSelector
                                agentId={r.agent_id ?? undefined}
                                currentProgress={(r.license_progress || "unlicensed") as never}
                                onProgressUpdated={() => void refresh()}
                                className="h-6 text-[11px]"
                              />
                            ))}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {r.manager_name ? `under ${r.manager_name}` : "unassigned"}
                            {" · "}
                            {r.resident_state ? (
                              <button type="button" className="font-medium text-foreground hover:underline" title="Resident state (click to change)" onClick={() => setStateEditing(personKey(r))}>{r.resident_state}</button>
                            ) : stateEditing === personKey(r) ? null : (
                              <button type="button" className="text-destructive hover:underline" onClick={() => setStateEditing(personKey(r))} aria-label={`Add state for ${r.display_name}`}>add state</button>
                            )}
                            {stateEditing === personKey(r) && (
                              <Input
                                autoFocus
                                maxLength={2}
                                placeholder="WI"
                                className="ml-1 inline-block h-6 w-12 px-1 text-center text-xs uppercase"
                                onBlur={(e) => { const v = e.target.value.trim(); if (v) void saveState(r, v); else setStateEditing(null); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) void saveState(r, v); else setStateEditing(null); }
                                  if (e.key === "Escape") setStateEditing(null);
                                }}
                              />
                            )}
                            {" · "}
                            <span className={heatClass(r.days_in_stage)}>{Math.round(r.days_in_stage)} {Math.round(r.days_in_stage) === 1 ? "day" : "days"} on this step</span>
                            {contact && <> · last contact {contact}</>}
                            {r.person_type === "agent" && (
                              <>
                                {" · "}
                                {linkState(r) === "clicked" ? (
                                  <span className="text-foreground">link clicked {formatTimeAgo(r.link_used_at ?? r.last_sign_in_at)}</span>
                                ) : linkState(r) === "sent" ? (
                                  <span className="font-medium text-foreground">link sent {formatTimeAgo(r.link_sent_at)}, not clicked</span>
                                ) : (
                                  <span className="text-destructive">link not sent</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          {tel ? (
                            <>
                              <span className="whitespace-nowrap text-sm tabular-nums">{formatPhoneDisplay(r.phone)}</span>
                              <Button asChild size="sm" variant="outline" className="h-10 w-10 px-0"><a href={tel} {...contactLinkProps(tel)} aria-label={`Call ${r.display_name}`}><Phone className="h-4 w-4" /></a></Button>
                              <Button asChild size="sm" variant="outline" className="h-10 w-10 px-0"><a href={smsHref(r.phone) ?? undefined} {...contactLinkProps(smsHref(r.phone))} aria-label={`Text ${r.display_name}`}><MessageSquare className="h-4 w-4" /></a></Button>
                            </>
                          ) : r.email ? (
                            <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground">
                              <Mail className="h-3.5 w-3.5 shrink-0" /> {r.email}
                            </a>
                          ) : (
                            <span className="text-xs text-destructive">no phone or email</span>
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
                          {r.person_type === "agent" && r.agent_id && (() => {
                            const info = factsByAgent.get(r.agent_id);
                            if (!info) {
                              // Outside the live onboarding population (paused,
                              // departed, placeholder) or the facts did not load.
                              return factsQuery.isError ? <span className="text-xs text-muted-foreground">start unknown</span> : null;
                            }
                            return (
                              <>
                                <ExpectedStartControl facts={info.facts} />
                                {info.open > 0 && (
                                  <Link
                                    to={`/dashboard/onboarding-ladder`}
                                    className={cn("text-xs hover:underline", info.blocking > 0 ? "font-medium text-destructive" : "text-muted-foreground")}
                                    title="Open the onboarding queue"
                                  >
                                    {info.open} open item{info.open === 1 ? "" : "s"}
                                  </Link>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        <Select value={r.stage_key} onValueChange={(v) => void setStage(r, v)} disabled={isBusy}>
                          <SelectTrigger className="h-10 w-full text-sm sm:w-[220px]" aria-label={`Stage for ${r.display_name}`}>
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
                        <Button size="sm" variant="outline" className="h-10 gap-1 text-sm" disabled={!next || isBusy} onClick={() => next && void setStage(r, next.stage_key)} title={next ? `Move to ${next.display_name}` : "Last stage"}>
                          {next ? next.display_name : "Done"} <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                        {canRemove && r.person_type === "agent" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1 text-xs text-destructive hover:text-destructive/80 sm:col-start-5 sm:justify-self-end"
                            disabled={isBusy}
                            aria-label={`No longer with us: ${r.display_name}`}
                            onClick={() => void removeAgent(r)}
                          >
                            <UserX className="h-3.5 w-3.5" /> No longer with us
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {full.length > list.length && (
                    <button
                      type="button"
                      className="min-h-11 w-full px-4 py-2 text-center text-sm font-medium text-primary hover:underline"
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
