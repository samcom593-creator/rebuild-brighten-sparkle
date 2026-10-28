import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarCheck, ChevronDown, ClipboardList, Instagram, MessageSquare, Phone, RefreshCw, Route, Search, SlidersHorizontal, UserCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { RevealList } from "@/components/ui/delight/Reveal";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
import { StatusPill } from "@/components/recruiting/StatusPill";
import type { RowStatus } from "@/components/pipeline/worklist/worklistStatus";
import { formatDueShort, formatSince, formatTimeWithZone, plainSpan } from "@/components/pipeline/worklist/worklistFormat";
import { phoenixDayBounds } from "@/lib/recruitingQueues";
import { toast } from "sonner";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { openAgentProfile } from "@/stores/agentProfileDrawer";

// One unified operating view over applications + agents. Reads v_recruiting_pipeline,
// writes through rp_pipeline_action (existing columns only). No rebuild.
//
// Grow redesign (2026-10-28): each row carried up to nine small buttons, a coloured
// dot and an emoji; seven tiles and five dropdowns sat above the list. Now: four
// numbers, one search box and one Filters button with the active filters as chips,
// and per row the stage, Call, Text and one "Update" menu holding every other
// action. Every action still writes through rp_pipeline_action exactly as before.
//
// Grow review (2026-10-28, findings 2/3/4/25/26/38/34): every number is computed with
// the SAME predicate as the list its button opens, so "Expected Monday 1" can never
// open "3 of 24 people"; a failed load is dashes and a reason with Retry, never four
// zeros; the "Also" numbers are 44px chips; intent is a dropdown in words that writes
// once per choice; a late follow-up says "Late · 1 day" and a bad date says so.

const STAGES = [
  "New Lead", "Contacted", "Call Scheduled", "Interested", "Confirmed",
  "Expected Monday", "Showed", "No Show", "Onboarding", "Contract Sent",
  "Contracting In Progress", "Ready for Training", "Active Agent",
  "Inactive/No Longer With Us",
] as const;
const INACTIVE_STAGE = "Inactive/No Longer With Us";

// Two stages are "in contracting". One filter value opens both, so the Contracting
// number and the list behind it share one definition instead of counting two stages
// and filtering one.
const CONTRACTING_FILTER = "contracting";
const CONTRACTING_STAGES: readonly string[] = ["Contract Sent", "Contracting In Progress"];
const STAGE_FILTER_LABELS: Record<string, string> = { [CONTRACTING_FILTER]: "Contracting (sent or in progress)" };
const stageFilterLabel = (filter: string) => STAGE_FILTER_LABELS[filter] ?? filter;
const stageMatches = (stage: string, filter: string) =>
  filter === CONTRACTING_FILTER ? CONTRACTING_STAGES.includes(stage) : stage === filter;

interface Row {
  person_key: string; person_type: string; name: string;
  phone: string | null; email: string | null; instagram: string | null;
  lead_source: string | null; stage: string; monday_status: string | null;
  expected_start: string | null; last_contact: string | null; next_follow_up: string | null;
  next_action_display: string | null; notes: string | null;
  license_status: string | null; raw_status: string | null;
  intent_level: string | null;
}

// Words carry the meaning; the tint only helps. Tokens, not raw colours.
const INTENT_STYLE: Record<string, { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  warm: { label: "Warm", cls: "border-warning/40 bg-warning/10 text-warning" },
  cold: { label: "Cold", cls: "border-border bg-muted/40 text-muted-foreground" },
};
// The empty value is "Not set"; it writes "clear" through the same RPC as before.
const INTENT_OPTIONS = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
  { value: "", label: "Not set" },
] as const;
const intentLabel = (value: string | null | undefined) => INTENT_STYLE[value ?? ""]?.label ?? "Not set";

const MONDAY_LABELS: Record<string, string> = {
  expected: "Expected Monday",
  confirmed: "Confirmed",
  showed: "Showed",
  no_show: "No show",
};

const igHandle = (value: string) => value.replace(/^@/, "");

const WHO_LABELS: Record<string, string> = { applicant: "Prospects", agent: "Agents" };
const SHOW_LABELS: Record<string, string> = { open: "Open only", all: "Include inactive", inactive: "Inactive only" };

interface Filters {
  search: string;
  stage: string;
  type: string;
  monday: string;
  active: string; // open | all | inactive
  intent: string;
}

/** One predicate for the list AND for every number above it. */
function matchesFilters(r: Row, f: Filters): boolean {
  if (f.active === "open" && r.stage === INACTIVE_STAGE) return false;
  if (f.active === "inactive" && r.stage !== INACTIVE_STAGE) return false;
  if (f.stage && !stageMatches(r.stage, f.stage)) return false;
  if (f.type && r.person_type !== f.type) return false;
  if (f.monday && r.monday_status !== f.monday) return false;
  if (f.intent && r.intent_level !== f.intent) return false;
  const q = f.search.trim().toLowerCase();
  if (q) {
    const hay = `${r.name} ${r.phone ?? ""} ${r.email ?? ""} ${r.instagram ?? ""} ${r.lead_source ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Every number on this page is a list. A pick is the filter state the number's button
// sets; the number is counted with that same state, so a tile can never say 1 while
// the list under it shows 3. Monday numbers are prospects only, so their pick says so.
// The counts include inactive people, so the lists do too.
type ListKey = "expected" | "confirmed" | "showed" | "noshow" | "onboarding" | "contracting" | "active";
type ListPick = Pick<Filters, "monday" | "stage" | "type">;
const LISTS: Record<ListKey, ListPick> = {
  expected: { monday: "expected", stage: "", type: "applicant" },
  confirmed: { monday: "confirmed", stage: "", type: "applicant" },
  showed: { monday: "showed", stage: "", type: "applicant" },
  noshow: { monday: "no_show", stage: "", type: "applicant" },
  onboarding: { monday: "", stage: "Onboarding", type: "" },
  contracting: { monday: "", stage: CONTRACTING_FILTER, type: "" },
  active: { monday: "", stage: "Active Agent", type: "" },
};
const LIST_KEYS = Object.keys(LISTS) as ListKey[];
const listFilters = (pick: ListPick): Filters => ({ search: "", intent: "", active: "all", ...pick });

/**
 * The row's one due date in the Call list's words and rules: late and unreadable in
 * red, "today" by the Phoenix business day with the time's zone, a short future date
 * otherwise. Null when nothing is due. An unreadable date is said, never shown as a dash.
 */
function dueWords(iso: string | null, now: number): RowStatus | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return { label: "Unreadable date", tone: "danger" };
  if (due < now) return { label: `Late · ${plainSpan(now - due)}`, tone: "danger" };
  if (due < phoenixDayBounds(new Date(now)).end) return { label: `Today · ${formatTimeWithZone(iso)}`, tone: "warning" };
  return { label: formatDueShort(iso, now), tone: "neutral" };
}

function Segmented<T extends string>({ legend, value, options, onChange }: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            className="h-11 px-3"
            variant={value === o.value ? "secondary" : "ghost"}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

/** An active filter. The whole chip is the button that clears it (same as the Call list). */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label}`}
      className="inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-4 pr-3 text-sm font-medium text-foreground transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
    >
      {label}
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

/** A number that opens its list: the name and its count, the same chip as the Call list. A dash while the number is unknown. */
function CountChip({ label, count, active, onPick }: { label: string; count: number | null; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={count === null}
      onClick={onPick}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:opacity-60",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-card text-foreground hover:bg-muted/50",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "text-foreground" : "text-muted-foreground")}>{count === null ? "—" : count.toLocaleString()}</span>
    </button>
  );
}

export default function RecruitingPipeline() {
  usePageTitle("Recruiting Pipeline");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [mondayFilter, setMondayFilter] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("open"); // open | all | inactive
  const [intentFilter, setIntentFilter] = useState<string>("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery<Row[]>({
    queryKey: ["recruiting-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recruiting_pipeline" as never)
        .select("*")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  // Loading and a failed read both show a dash, never a zero; only the failed read says why.
  const unknown = isLoading || isError;
  const failReason = isError ? (error as { message?: unknown } | null)?.message : null;
  const failText = typeof failReason === "string" && failReason ? failReason : null;

  const action = useMutation({
    mutationFn: async (v: { person_key: string; action: string; value?: string | null }) => {
      const { error } = await supabase.rpc("rp_pipeline_action" as never, {
        p_person_key: v.person_key, p_action: v.action, p_value: v.value ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recruiting-pipeline"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const fire = (person_key: string, act: string, value?: string | null, msg?: string) => {
    action.mutate({ person_key, action: act, value }, { onSuccess: () => { if (msg) toast.success(msg); qc.invalidateQueries({ queryKey: ["recruiting-pipeline"] }); } });
  };

  // One write per choice, through the same RPC and value vocabulary as before
  // ("hot" | "warm" | "cold" | "clear"). Picking the current value writes nothing.
  const setIntent = (r: Row, value: string) => {
    if ((r.intent_level ?? "") === value) return;
    fire(r.person_key, "intent", value || "clear", value ? `Intent set to ${intentLabel(value)}` : "Intent cleared");
  };

  const counts = useMemo(() => {
    const out = {} as Record<ListKey, number>;
    for (const key of LIST_KEYS) out[key] = rows.filter((r) => matchesFilters(r, listFilters(LISTS[key]))).length;
    return out;
  }, [rows]);

  const current: Filters = { search, stage: stageFilter, type: typeFilter, monday: mondayFilter, active: activeFilter, intent: intentFilter };
  const openList = (key: ListKey) => {
    const want = listFilters(LISTS[key]);
    setSearch(want.search); setStageFilter(want.stage); setTypeFilter(want.type);
    setMondayFilter(want.monday); setActiveFilter(want.active); setIntentFilter(want.intent);
  };
  const listOn = (key: ListKey) => {
    const want = listFilters(LISTS[key]);
    return (Object.keys(want) as Array<keyof Filters>).every((f) => current[f] === want[f]);
  };

  // Relevance rank: who needs action now + active agents first, inactive last.
  const rank = (r: Row): number => {
    const byStage: Record<string, number> = {
      "Expected Monday": 0, "Confirmed": 0, "Showed": 1, "No Show": 1,
      "Contract Sent": 2, "Contracting In Progress": 2,
      "Onboarding": 3, "Ready for Training": 3,
      "Interested": 4, "Call Scheduled": 4,
      "Active Agent": 5, "Contacted": 6, "New Lead": 7,
      [INACTIVE_STAGE]: 99,
    };
    return byStage[r.stage] ?? 8;
  };

  const filtered = useMemo(() => {
    const f: Filters = { search, stage: stageFilter, type: typeFilter, monday: mondayFilter, active: activeFilter, intent: intentFilter };
    return rows.filter((r) => matchesFilters(r, f)).sort((a, b) => {
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      const at = a.last_contact ? Date.parse(a.last_contact) : 0;
      const bt = b.last_contact ? Date.parse(b.last_contact) : 0;
      return bt - at; // most recently touched first within a rank
    });
  }, [rows, search, stageFilter, typeFilter, mondayFilter, activeFilter, intentFilter]);

  const clearFilters = () => { setSearch(""); setStageFilter(""); setTypeFilter(""); setMondayFilter(""); setActiveFilter("open"); setIntentFilter(""); };
  const filterCount = [stageFilter, typeFilter, mondayFilter, intentFilter, activeFilter !== "open" ? activeFilter : ""].filter(Boolean).length;
  const now = Date.now();

  return (
    <div className="page-enter w-full space-y-5 pb-24">
      <RecruitingWorkspaceNav />
      <PageHeader
        title="Pipeline"
        subtitle="Everyone from first call to active agent."
        icon={<Route />}
        tone="gold"
      />

      <GrowScoreboard
        label="Pipeline numbers"
        notice={isError ? (
          <span className="text-destructive">The pipeline did not load, so the numbers are hidden rather than shown as 0.</span>
        ) : null}
        tiles={[
          { label: "Expected Monday", value: unknown ? null : counts.expected, hint: "Prospects due to start", onSelect: () => openList("expected"), active: listOn("expected"), emphasis: true, tone: "gold", icon: <CalendarCheck /> },
          { label: "Showed", value: unknown ? null : counts.showed, hint: "Prospects who came", onSelect: () => openList("showed"), active: listOn("showed"), tone: "good", icon: <UserCheck /> },
          { label: "Onboarding", value: unknown ? null : counts.onboarding, hint: "Getting set up", onSelect: () => openList("onboarding"), active: listOn("onboarding"), tone: "royal", icon: <ClipboardList /> },
          { label: "Active agents", value: unknown ? null : counts.active, hint: "Writing business", onSelect: () => openList("active"), active: listOn("active"), tone: "good", icon: <BadgeCheck /> },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Also:</span>
        <CountChip label="Confirmed" count={unknown ? null : counts.confirmed} active={listOn("confirmed")} onPick={() => openList("confirmed")} />
        <CountChip label="No shows" count={unknown ? null : counts.noshow} active={listOn("noshow")} onPick={() => openList("noshow")} />
        <CountChip label="Contracting" count={unknown ? null : counts.contracting} active={listOn("contracting")} onPick={() => openList("contracting")} />
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, email or Instagram"
            aria-label="Search the pipeline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 border-border bg-card pl-11 text-base"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-12 shrink-0 border-border bg-card px-4 text-base">
              <SlidersHorizontal className="h-5 w-5" /> Filters{filterCount > 0 ? ` (${filterCount})` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[22rem] space-y-5 p-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-foreground">Stage</span>
              <select
                aria-label="Filter by stage"
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
              >
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <Fragment key={s}>
                    <option value={s}>{s}</option>
                    {s === "Contracting In Progress" && <option value={CONTRACTING_FILTER}>{stageFilterLabel(CONTRACTING_FILTER)}</option>}
                  </Fragment>
                ))}
              </select>
            </label>
            <Segmented legend="Who" value={typeFilter} onChange={setTypeFilter}
              options={[{ value: "", label: "Everyone" }, { value: "applicant", label: "Prospects" }, { value: "agent", label: "Agents" }]} />
            <Segmented legend="Monday" value={mondayFilter} onChange={setMondayFilter}
              options={[{ value: "", label: "Any" }, { value: "expected", label: "Expected" }, { value: "confirmed", label: "Confirmed" }, { value: "showed", label: "Showed" }, { value: "no_show", label: "No show" }]} />
            <Segmented legend="Intent" value={intentFilter} onChange={setIntentFilter}
              options={[{ value: "", label: "Any" }, { value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]} />
            <Segmented legend="Show" value={activeFilter} onChange={setActiveFilter}
              options={[{ value: "open", label: "Open only" }, { value: "all", label: "Include inactive" }, { value: "inactive", label: "Inactive only" }]} />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          {isError ? "People did not load" : isLoading ? "Loading people…" : (
            <>
              <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span> of {rows.length.toLocaleString()} people
            </>
          )}
        </span>
        {stageFilter && <FilterChip label={`Stage: ${stageFilterLabel(stageFilter)}`} onClear={() => setStageFilter("")} />}
        {typeFilter && <FilterChip label={WHO_LABELS[typeFilter] ?? typeFilter} onClear={() => setTypeFilter("")} />}
        {mondayFilter && <FilterChip label={`Monday: ${MONDAY_LABELS[mondayFilter] ?? mondayFilter}`} onClear={() => setMondayFilter("")} />}
        {intentFilter && <FilterChip label={`Intent: ${intentLabel(intentFilter)}`} onClear={() => setIntentFilter("")} />}
        {activeFilter !== "open" && <FilterChip label={SHOW_LABELS[activeFilter] ?? activeFilter} onClear={() => setActiveFilter("open")} />}
        {(filterCount > 0 || search) && (
          <Button variant="ghost" className="h-11" onClick={clearFilters}>Clear all</Button>
        )}
      </div>

      {/* People */}
      <section aria-label="People" className="overflow-hidden rounded-xl border border-border bg-card">
        {isError ? (
          <div role="alert" className="p-10 text-center">
            <p className="text-base text-destructive">The pipeline did not load{failText ? `: ${failText}` : ""}.</p>
            <Button variant="outline" className="mt-4 h-11" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="p-10 text-center text-base text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-base text-muted-foreground">No one matches these filters.</div>
        ) : (
          <RevealList as="ul" className="divide-y divide-border/60">
            {filtered.slice(0, 400).map((r) => {
              const intent = r.intent_level ? INTENT_STYLE[r.intent_level] : null;
              const name = r.name || "Unknown";
              const lastNote = r.notes?.split("\n").filter(Boolean).pop();
              const due = dueWords(r.next_follow_up, now);
              return (
                <li key={r.person_key} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-11 flex-wrap items-center gap-2">
                      {r.person_type === "agent" ? (
                        <button
                          type="button"
                          className="max-w-full truncate py-2.5 text-left text-base font-semibold leading-6 text-foreground hover:text-primary hover:underline"
                          onClick={() => openAgentProfile(r.person_key.split(":")[1])}
                        >
                          {name}
                        </button>
                      ) : (
                        <span className="truncate text-base font-semibold text-foreground">{name}</span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            aria-label={`Intent: ${intentLabel(r.intent_level)}. Change intent for ${name}`}
                            className={cn(
                              "h-11 shrink-0 rounded-full px-4 text-sm",
                              intent ? intent.cls : "border-dashed border-border text-muted-foreground",
                            )}
                          >
                            Intent: {intentLabel(r.intent_level)} <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuLabel>Intent</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={r.intent_level ?? ""} onValueChange={(v) => setIntent(r, v)}>
                            {INTENT_OPTIONS.map((o) => (
                              <DropdownMenuRadioItem key={o.value || "none"} value={o.value} className="min-h-11">{o.label}</DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {r.phone ? formatPhoneDisplay(r.phone) : "No phone"}
                      {r.instagram ? ` · @${igHandle(r.instagram)}` : ""}
                      {r.lead_source ? ` · ${r.lead_source}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="text-foreground">Next: {r.next_action_display || "Follow up"}</span>
                      <span aria-hidden="true">·</span>
                      <span>Last contact {formatSince(r.last_contact, now)}</span>
                      <span aria-hidden="true">·</span>
                      {due === null ? (
                        <span>No due date</span>
                      ) : due.tone === "neutral" ? (
                        <span>Due {due.label}</span>
                      ) : (
                        <StatusPill status={due} />
                      )}
                    </p>
                    {lastNote && noteFor !== r.person_key && (
                      <p className="mt-1 max-w-full truncate text-sm italic text-muted-foreground">Note: {lastNote}</p>
                    )}
                    {noteFor === r.person_key && (
                      <div className="mt-2 flex items-center gap-2">
                        <Input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                          aria-label={`Note for ${r.name}`}
                          placeholder={`Note for ${r.name}…`} className="h-11 text-base"
                          onKeyDown={(e) => { if (e.key === "Enter" && noteDraft.trim()) { fire(r.person_key, "note", noteDraft.trim(), "Note added"); setNoteFor(null); } }} />
                        <Button className="h-11" disabled={!noteDraft.trim()}
                          onClick={() => { fire(r.person_key, "note", noteDraft.trim(), "Note added"); setNoteFor(null); }}>Save</Button>
                        <Button variant="ghost" className="h-11" onClick={() => setNoteFor(null)}>Cancel</Button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                    <select
                      aria-label={`Stage for ${name}`}
                      title="Changing a stage sets a manual override that sticks until you clear it"
                      className="h-11 max-w-[13rem] rounded-lg border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                      value={STAGES.includes(r.stage as typeof STAGES[number]) ? r.stage : ""}
                      onChange={(e) => fire(r.person_key, "stage", e.target.value, "Stage updated")}>
                      {!STAGES.includes(r.stage as typeof STAGES[number]) && <option value="">{r.stage}</option>}
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {r.phone && (
                      <Button asChild variant="outline" className="h-11 px-3">
                        <a href={phoneHref(r.phone) ?? `tel:${r.phone}`} {...contactLinkProps(phoneHref(r.phone))} aria-label={`Call ${r.name}`}>
                          <Phone className="h-4 w-4" /> Call
                        </a>
                      </Button>
                    )}
                    {r.phone && (
                      <Button asChild variant="outline" className="h-11 px-3">
                        <a href={smsHref(r.phone) ?? `sms:${r.phone}`} {...contactLinkProps(smsHref(r.phone))} aria-label={`Text ${r.name}`}>
                          <MessageSquare className="h-4 w-4" /> Text
                        </a>
                      </Button>
                    )}
                    {/* The profile link used to be the 17px handle inside the contact line; it is a
                        contact channel like Call and Text, so it sits with them at the same size. */}
                    {r.instagram && (
                      <Button asChild variant="outline" className="h-11 px-3">
                        <a href={`https://instagram.com/${igHandle(r.instagram)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open Instagram for ${name}`}>
                          <Instagram className="h-4 w-4" /> Instagram
                        </a>
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-11 px-3" aria-label={`Update ${name}`}>
                          Update <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(e) => { if (noteFor === r.person_key) e.preventDefault(); }}>
                        {r.person_type === "applicant" && (
                          <>
                            <DropdownMenuLabel>Monday</DropdownMenuLabel>
                            <DropdownMenuItem className="min-h-11" onSelect={() => fire(r.person_key, "monday", "expected", "Marked expected Monday")}>Expected Monday</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-11" onSelect={() => fire(r.person_key, "monday", "confirmed", "Confirmed")}>Confirmed for Monday</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-11" onSelect={() => fire(r.person_key, "monday", "showed", "Marked showed")}>Showed up</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-11" onSelect={() => fire(r.person_key, "monday", "no_show", "Marked no-show")}>Didn't show</DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem className="min-h-11" onSelect={() => fire(r.person_key, "contacted", null, "Marked contacted")}>Mark contacted</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11" onSelect={() => {
                          const d = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                          fire(r.person_key, "followup", d, "Follow-up set for tomorrow");
                        }}>Follow up tomorrow</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11" onSelect={() => { setNoteFor(r.person_key); setNoteDraft(""); }}>Add a note</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
            {filtered.length > 400 && (
              <li className="p-4 text-center text-sm text-muted-foreground">Showing the first 400 of {filtered.length}. Search or filter to narrow it.</li>
            )}
          </RevealList>
        )}
      </section>
    </div>
  );
}
