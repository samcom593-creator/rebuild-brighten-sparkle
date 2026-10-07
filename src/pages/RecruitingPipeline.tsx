import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { contactLinkProps, phoneHref, smsHref } from "@/lib/phone";
import { openAgentProfile } from "@/stores/agentProfileDrawer";

// One unified operating view over applications + agents. Reads v_recruiting_pipeline,
// writes through rp_pipeline_action (existing columns only). No rebuild.

const STAGES = [
  "New Lead", "Contacted", "Call Scheduled", "Interested", "Confirmed",
  "Expected Monday", "Showed", "No Show", "Onboarding", "Contract Sent",
  "Contracting In Progress", "Ready for Training", "Active Agent",
  "Inactive/No Longer With Us",
] as const;

const STAGE_COLOR: Record<string, string> = {
  "New Lead": "bg-slate-500", "Contacted": "bg-sky-600", "Call Scheduled": "bg-indigo-600",
  "Interested": "bg-violet-600", "Confirmed": "bg-purple-600", "Expected Monday": "bg-amber-600",
  "Showed": "bg-emerald-600", "No Show": "bg-red-600", "Onboarding": "bg-teal-600",
  "Contract Sent": "bg-cyan-600", "Contracting In Progress": "bg-blue-600",
  "Ready for Training": "bg-lime-600", "Active Agent": "bg-green-700",
  "Inactive/No Longer With Us": "bg-zinc-600",
};

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
const INTENT_STYLE: Record<string, { label: string; cls: string }> = {
  hot: { label: "🔥 Hot", cls: "bg-red-500 text-white border-red-500" },
  warm: { label: "Warm", cls: "bg-amber-500 text-white border-amber-500" },
  cold: { label: "Cold", cls: "bg-sky-500 text-white border-sky-500" },
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  // Monday / Start operating tiles.
  const tiles = useMemo(() => {
    const apps = rows.filter((r) => r.person_type === "applicant");
    const count = (p: (r: Row) => boolean) => rows.filter(p).length;
    return [
      { key: "expected", label: "Expected Monday", n: apps.filter((r) => r.monday_status === "expected").length, filter: () => { setMondayFilter("expected"); setStageFilter(""); } },
      { key: "confirmed", label: "Confirmed", n: apps.filter((r) => r.monday_status === "confirmed").length, filter: () => { setMondayFilter("confirmed"); setStageFilter(""); } },
      { key: "showed", label: "Showed", n: apps.filter((r) => r.monday_status === "showed").length, filter: () => { setMondayFilter("showed"); setStageFilter(""); } },
      { key: "noshow", label: "No Shows", n: apps.filter((r) => r.monday_status === "no_show").length, filter: () => { setMondayFilter("no_show"); setStageFilter(""); } },
      { key: "onboarding", label: "Onboarding", n: count((r) => r.stage === "Onboarding"), filter: () => { setStageFilter("Onboarding"); setMondayFilter(""); } },
      { key: "contracting", label: "Contracting", n: count((r) => r.stage === "Contract Sent" || r.stage === "Contracting In Progress"), filter: () => { setStageFilter("Contracting In Progress"); setMondayFilter(""); } },
      { key: "active", label: "Active Agents", n: count((r) => r.stage === "Active Agent"), filter: () => { setStageFilter("Active Agent"); setMondayFilter(""); } },
    ];
  }, [rows]);

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

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Recruiting Pipeline</h1>
          <p className="text-sm text-muted-foreground">{rows.length} people · one place for who's next</p>
        </div>
      </div>

      {/* Monday / Start tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {tiles.map((t) => (
          <button key={t.key} onClick={t.filter}
            className="rounded-lg border bg-card p-3 text-left hover:border-primary transition-colors">
            <div className="text-2xl font-bold">{t.n}</div>
            <div className="text-xs text-muted-foreground leading-tight">{t.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, phone, email, IG…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" />
        <Select value={stageFilter || "all"} onValueChange={(v) => setStageFilter(v === "all" ? "" : v)}>
          <SelectTrigger aria-label="Filter by stage" className="h-9 w-auto min-w-[9rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter || "everyone"} onValueChange={(v) => setTypeFilter(v === "everyone" ? "" : v)}>
          <SelectTrigger aria-label="Filter by prospect or agent" className="h-9 w-auto min-w-[8rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="everyone">Everyone</SelectItem>
            <SelectItem value="applicant">Prospects</SelectItem>
            <SelectItem value="agent">Agents</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mondayFilter || "any"} onValueChange={(v) => setMondayFilter(v === "any" ? "" : v)}>
          <SelectTrigger aria-label="Filter by Monday status" className="h-9 w-auto min-w-[8rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any Monday</SelectItem>
            <SelectItem value="expected">Expected</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="showed">Showed</SelectItem>
            <SelectItem value="no_show">No Show</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger aria-label="Filter by active status" className="h-9 w-auto min-w-[8rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open only</SelectItem>
            <SelectItem value="all">Include inactive</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={intentFilter || "anyintent"} onValueChange={(v) => setIntentFilter(v === "anyintent" ? "" : v)}>
          <SelectTrigger aria-label="Filter by intent" className="h-9 w-auto min-w-[7rem] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="anyintent">Any intent</SelectItem>
            <SelectItem value="hot">🔥 Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
      </div>

      {/* People */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No one matches these filters.</div>
        ) : (
          <div className="divide-y">
            {filtered.slice(0, 400).map((r) => (
              <div key={r.person_key} className="p-3 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-2">
                <div className="min-w-0 lg:w-60">
                  <div className="flex items-center gap-1.5">
                    <button
                      title="Click to set intent (hot → warm → cold → none)"
                      onClick={() => cycleIntent(r)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold border ${r.intent_level && INTENT_STYLE[r.intent_level] ? INTENT_STYLE[r.intent_level].cls : "text-muted-foreground border-dashed"}`}>
                      {r.intent_level && INTENT_STYLE[r.intent_level] ? INTENT_STYLE[r.intent_level].label : "Intent"}
                    </button>
                    {r.person_type === "agent" ? (
                      <button className="font-semibold truncate text-left hover:text-primary hover:underline" onClick={() => openAgentProfile(r.person_key.split(":")[1])}>{r.name || "Unknown"}</button>
                    ) : (
                      <div className="font-semibold truncate">{r.name || "Unknown"}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.phone || "no phone"}
                    {r.instagram && <> · <a href={`https://instagram.com/${r.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@{r.instagram.replace(/^@/, "")}</a></>}
                    {r.lead_source ? ` · ${r.lead_source}` : ""}
                  </div>
                </div>
                <div className="lg:w-48 flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${STAGE_COLOR[r.stage] ?? "bg-slate-500"}`} />
                  <select
                    className="h-8 rounded-md border bg-background px-1 text-xs max-w-[11rem]"
                    value={STAGES.includes(r.stage as typeof STAGES[number]) ? r.stage : ""}
                    onChange={(e) => fire(r.person_key, "stage", e.target.value, "Status updated")}>
                    {!STAGES.includes(r.stage as typeof STAGES[number]) && <option value="">{r.stage}</option>}
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="lg:flex-1 text-xs text-muted-foreground min-w-0">
                  <span className="font-medium text-foreground">Next: </span>{r.next_action_display || "Follow up"}
                  <span className="mx-2">·</span>Last: {fmt(r.last_contact)}
                  <span className="mx-2">·</span>Due: {fmt(r.next_follow_up)}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {r.phone && <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs"><a href={phoneHref(r.phone) ?? `tel:${r.phone}`} {...contactLinkProps(phoneHref(r.phone))}>Call</a></Button>}
                  {r.phone && <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs"><a href={smsHref(r.phone) ?? `sms:${r.phone}`} {...contactLinkProps(smsHref(r.phone))}>Text</a></Button>}
                  {r.person_type === "applicant" && <>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fire(r.person_key, "monday", "expected", "Marked expected Monday")}>Exp Mon</Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fire(r.person_key, "monday", "confirmed", "Confirmed")}>Confirm</Button>
                    <Button size="sm" className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => fire(r.person_key, "monday", "showed", "Marked showed")}>Showed</Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fire(r.person_key, "monday", "no_show", "Marked no-show")}>No-show</Button>
                  </>}
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fire(r.person_key, "contacted", null, "Marked contacted")}>Contacted</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => {
                    const d = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                    fire(r.person_key, "followup", d, "Follow-up set for tomorrow");
                  }}>+1d</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setNoteFor(noteFor === r.person_key ? null : r.person_key); setNoteDraft(""); }}>Note</Button>
                </div>
                {r.notes && noteFor !== r.person_key && (
                  <button onClick={() => { setNoteFor(r.person_key); setNoteDraft(""); }}
                    className="w-full lg:basis-full text-left text-xs text-muted-foreground italic truncate mt-0.5 hover:text-foreground">
                    📝 {r.notes.split("\n").filter(Boolean).pop()}
                  </button>
                )}
                {noteFor === r.person_key && (
                  <div className="flex items-center gap-1 w-full lg:basis-full mt-1">
                    <Input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder={`Note for ${r.name}…`} className="h-8 text-xs"
                      onKeyDown={(e) => { if (e.key === "Enter" && noteDraft.trim()) { fire(r.person_key, "note", noteDraft.trim(), "Note added"); setNoteFor(null); } }} />
                    <Button size="sm" className="h-8 px-3 text-xs" disabled={!noteDraft.trim()}
                      onClick={() => { fire(r.person_key, "note", noteDraft.trim(), "Note added"); setNoteFor(null); }}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setNoteFor(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            ))}
            {filtered.length > 400 && (
              <div className="p-3 text-center text-xs text-muted-foreground">Showing first 400 of {filtered.length}. Narrow with filters.</div>
            )}
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">Note</Badge>
        Changing a status here sets a manual override that sticks until you clear it. Everything writes to your existing records — no data is duplicated.
      </p>
    </div>
  );
}
