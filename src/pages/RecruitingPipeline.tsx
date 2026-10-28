import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageSquare, Phone, Search, SlidersHorizontal, X } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";
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

const STAGES = [
  "New Lead", "Contacted", "Call Scheduled", "Interested", "Confirmed",
  "Expected Monday", "Showed", "No Show", "Onboarding", "Contract Sent",
  "Contracting In Progress", "Ready for Training", "Active Agent",
  "Inactive/No Longer With Us",
] as const;

interface Row {
  person_key: string; person_type: string; name: string;
  phone: string | null; email: string | null; instagram: string | null;
  lead_source: string | null; stage: string; monday_status: string | null;
  expected_start: string | null; last_contact: string | null; next_follow_up: string | null;
  next_action_display: string | null; notes: string | null;
  license_status: string | null; raw_status: string | null;
  intent_level: string | null;
}

const INTENT_ORDER = [null, "hot", "warm", "cold"] as const;
// Words carry the meaning; the tint only helps. Tokens, not raw colours.
const INTENT_STYLE: Record<string, { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  warm: { label: "Warm", cls: "border-warning/40 bg-warning/10 text-warning" },
  cold: { label: "Cold", cls: "border-border bg-muted/40 text-muted-foreground" },
};

const MONDAY_LABELS: Record<string, string> = {
  expected: "Expected Monday",
  confirmed: "Confirmed",
  showed: "Showed",
  no_show: "No show",
};

const WHO_LABELS: Record<string, string> = { applicant: "Prospects", agent: "Agents" };
const SHOW_LABELS: Record<string, string> = { open: "Open only", all: "Include inactive", inactive: "Inactive only" };

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
            size="sm"
            className="h-10"
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

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-3 pr-1 text-[13px] font-medium text-foreground">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="grid h-6 w-6 place-items-center rounded-full hover:bg-primary/20 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
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

  const { data: rows = [], isLoading } = useQuery<Row[]>({
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

  const cycleIntent = (r: Row) => {
    const idx = INTENT_ORDER.indexOf((r.intent_level ?? null) as (typeof INTENT_ORDER)[number]);
    const next = INTENT_ORDER[(idx + 1) % INTENT_ORDER.length];
    fire(r.person_key, "intent", next ?? "clear", next ? `Intent: ${next}` : "Intent cleared");
  };

  // Monday / Start numbers. Each one filters the list to exactly the people it counts.
  const counts = useMemo(() => {
    const apps = rows.filter((r) => r.person_type === "applicant");
    const count = (p: (r: Row) => boolean) => rows.filter(p).length;
    return {
      expected: apps.filter((r) => r.monday_status === "expected").length,
      confirmed: apps.filter((r) => r.monday_status === "confirmed").length,
      showed: apps.filter((r) => r.monday_status === "showed").length,
      noshow: apps.filter((r) => r.monday_status === "no_show").length,
      onboarding: count((r) => r.stage === "Onboarding"),
      contracting: count((r) => r.stage === "Contract Sent" || r.stage === "Contracting In Progress"),
      active: count((r) => r.stage === "Active Agent"),
    };
  }, [rows]);

  const pickMonday = (v: string) => { setMondayFilter(v); setStageFilter(""); };
  const pickStage = (v: string) => { setStageFilter(v); setMondayFilter(""); };

  // Relevance rank: who needs action now + active agents first, inactive last.
  const rank = (r: Row): number => {
    const byStage: Record<string, number> = {
      "Expected Monday": 0, "Confirmed": 0, "Showed": 1, "No Show": 1,
      "Contract Sent": 2, "Contracting In Progress": 2,
      "Onboarding": 3, "Ready for Training": 3,
      "Interested": 4, "Call Scheduled": 4,
      "Active Agent": 5, "Contacted": 6, "New Lead": 7,
      "Inactive/No Longer With Us": 99,
    };
    return byStage[r.stage] ?? 8;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (activeFilter === "open" && r.stage === "Inactive/No Longer With Us") return false;
      if (activeFilter === "inactive" && r.stage !== "Inactive/No Longer With Us") return false;
      if (stageFilter && r.stage !== stageFilter) return false;
      if (typeFilter && r.person_type !== typeFilter) return false;
      if (mondayFilter && r.monday_status !== mondayFilter) return false;
      if (intentFilter && r.intent_level !== intentFilter) return false;
      if (q) {
        const hay = `${r.name} ${r.phone ?? ""} ${r.email ?? ""} ${r.instagram ?? ""} ${r.lead_source ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      const at = a.last_contact ? Date.parse(a.last_contact) : 0;
      const bt = b.last_contact ? Date.parse(b.last_contact) : 0;
      return bt - at; // most recently touched first within a rank
    });
  }, [rows, search, stageFilter, typeFilter, mondayFilter, activeFilter, intentFilter]);

  const clearFilters = () => { setSearch(""); setStageFilter(""); setTypeFilter(""); setMondayFilter(""); setActiveFilter("open"); setIntentFilter(""); };
  const filterCount = [stageFilter, typeFilter, mondayFilter, intentFilter, activeFilter !== "open" ? activeFilter : ""].filter(Boolean).length;

  return (
    <div className="page-enter w-full space-y-5 pb-24">
      <RecruitingWorkspaceNav />
      <PageHeader
        title="Pipeline"
        subtitle="Everyone from first call to active agent, and who starts Monday."
      />

      <GrowScoreboard
        label="Pipeline numbers"
        tiles={[
          { label: "Expected Monday", value: isLoading ? null : counts.expected, hint: "Prospects due to start", onSelect: () => pickMonday("expected"), active: mondayFilter === "expected", emphasis: true },
          { label: "Showed", value: isLoading ? null : counts.showed, hint: "Prospects who came", onSelect: () => pickMonday("showed"), active: mondayFilter === "showed" },
          { label: "Onboarding", value: isLoading ? null : counts.onboarding, hint: "Getting set up", onSelect: () => pickStage("Onboarding"), active: stageFilter === "Onboarding" },
          { label: "Active agents", value: isLoading ? null : counts.active, hint: "Writing business", onSelect: () => pickStage("Active Agent"), active: stageFilter === "Active Agent" },
        ]}
      />
      {!isLoading && (
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          <span>Also:</span>
          <Button variant="link" className="h-9 px-1 text-sm text-foreground" onClick={() => pickMonday("confirmed")}>Confirmed {counts.confirmed}</Button>
          <span aria-hidden="true">·</span>
          <Button variant="link" className="h-9 px-1 text-sm text-foreground" onClick={() => pickMonday("no_show")}>No shows {counts.noshow}</Button>
          <span aria-hidden="true">·</span>
          <Button variant="link" className="h-9 px-1 text-sm text-foreground" onClick={() => pickStage("Contracting In Progress")}>Contracting {counts.contracting}</Button>
        </p>
      )}

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
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span> of {rows.length.toLocaleString()} people
        </span>
        {stageFilter && <Chip label={`Stage: ${stageFilter}`} onClear={() => setStageFilter("")} />}
        {typeFilter && <Chip label={WHO_LABELS[typeFilter] ?? typeFilter} onClear={() => setTypeFilter("")} />}
        {mondayFilter && <Chip label={`Monday: ${MONDAY_LABELS[mondayFilter] ?? mondayFilter}`} onClear={() => setMondayFilter("")} />}
        {intentFilter && <Chip label={`Intent: ${INTENT_STYLE[intentFilter]?.label ?? intentFilter}`} onClear={() => setIntentFilter("")} />}
        {activeFilter !== "open" && <Chip label={SHOW_LABELS[activeFilter] ?? activeFilter} onClear={() => setActiveFilter("open")} />}
        {(filterCount > 0 || search) && (
          <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>Clear all</Button>
        )}
      </div>

      {/* People */}
      <section aria-label="People" className="overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="p-10 text-center text-base text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-base text-muted-foreground">No one matches these filters.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.slice(0, 400).map((r) => {
              const intent = r.intent_level ? INTENT_STYLE[r.intent_level] : null;
              const lastNote = r.notes?.split("\n").filter(Boolean).pop();
              return (
                <li key={r.person_key} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.person_type === "agent" ? (
                        <button className="truncate text-left text-base font-semibold text-foreground hover:text-primary hover:underline" onClick={() => openAgentProfile(r.person_key.split(":")[1])}>{r.name || "Unknown"}</button>
                      ) : (
                        <span className="truncate text-base font-semibold text-foreground">{r.name || "Unknown"}</span>
                      )}
                      <button
                        type="button"
                        title="Tap to change intent: hot, warm, cold, none"
                        aria-label={`Intent for ${r.name || "this person"}: ${intent?.label ?? "not set"}. Tap to change.`}
                        onClick={() => cycleIntent(r)}
                        className={cn(
                          "inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[13px] font-medium",
                          intent ? intent.cls : "border-dashed border-border text-muted-foreground",
                        )}
                      >
                        {intent?.label ?? "Set intent"}
                      </button>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {r.phone ? formatPhoneDisplay(r.phone) : "No phone"}
                      {r.instagram && <> · <a href={`https://instagram.com/${r.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@{r.instagram.replace(/^@/, "")}</a></>}
                      {r.lead_source ? ` · ${r.lead_source}` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <span className="text-foreground">Next: {r.next_action_display || "Follow up"}</span>
                      {" · "}Last contact {fmt(r.last_contact)}{" · "}Due {fmt(r.next_follow_up)}
                    </p>
                    {lastNote && noteFor !== r.person_key && (
                      <button onClick={() => { setNoteFor(r.person_key); setNoteDraft(""); }}
                        className="mt-1 block max-w-full truncate text-left text-sm italic text-muted-foreground hover:text-foreground">
                        Note: {lastNote}
                      </button>
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
                      aria-label={`Stage for ${r.name || "this person"}`}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-11 px-3" aria-label={`Update ${r.name || "this person"}`}>
                          Update <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {r.person_type === "applicant" && (
                          <>
                            <DropdownMenuLabel>Monday</DropdownMenuLabel>
                            <DropdownMenuItem className="min-h-10" onSelect={() => fire(r.person_key, "monday", "expected", "Marked expected Monday")}>Expected Monday</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-10" onSelect={() => fire(r.person_key, "monday", "confirmed", "Confirmed")}>Confirmed for Monday</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-10" onSelect={() => fire(r.person_key, "monday", "showed", "Marked showed")}>Showed up</DropdownMenuItem>
                            <DropdownMenuItem className="min-h-10" onSelect={() => fire(r.person_key, "monday", "no_show", "Marked no-show")}>Didn't show</DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem className="min-h-10" onSelect={() => fire(r.person_key, "contacted", null, "Marked contacted")}>Mark contacted</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-10" onSelect={() => {
                          const d = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                          fire(r.person_key, "followup", d, "Follow-up set for tomorrow");
                        }}>Follow up tomorrow</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-10" onSelect={() => { setNoteFor(r.person_key); setNoteDraft(""); }}>Add a note</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
            {filtered.length > 400 && (
              <li className="p-4 text-center text-sm text-muted-foreground">Showing the first 400 of {filtered.length}. Search or filter to narrow it.</li>
            )}
          </ul>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        Changing a stage here sets a manual override that sticks until you clear it. Everything writes to your existing records — no data is duplicated.
      </p>
    </div>
  );
}
