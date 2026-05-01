import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone, Mail, MessageSquare, MoreVertical, RefreshCw, AlertTriangle,
  Download, Search, XCircle, CheckCircle2, GripVertical,
  Star, PhoneOff, Voicemail, PhoneCall, Flame, Target, Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { differenceInDays, format } from "date-fns";
import { toast } from "sonner";

/**
 * Hiring Pipeline — drag-drop kanban + row actions on every card.
 * Every number is a button. Every card does something.
 */

const STAGES = [
  { key: "new",              label: "Applied",        color: "border-t-slate-500",  bg: "bg-slate-500/5" },
  { key: "contacted",        label: "Contacted",      color: "border-t-sky-500",    bg: "bg-sky-500/5" },
  { key: "contracted",       label: "Contracted",     color: "border-t-indigo-500", bg: "bg-indigo-500/5" },
  { key: "course_purchased", label: "In Course",      color: "border-t-amber-500",  bg: "bg-amber-500/5" },
  { key: "finished_course",  label: "Course Done",    color: "border-t-blue-500",   bg: "bg-blue-500/5" },
  { key: "passed_test",      label: "Exam Passed",    color: "border-t-violet-500", bg: "bg-violet-500/5" },
  { key: "licensed",         label: "Licensed",       color: "border-t-emerald-500",bg: "bg-emerald-500/5" },
] as const;

type StageKey = typeof STAGES[number]["key"];

function classifyStage(a: any): StageKey {
  if (a.license_status === "licensed" || a.license_progress === "licensed") return "licensed";
  if (a.license_progress === "passed_test" || a.license_progress === "fingerprints_done" || a.license_progress === "waiting_on_license") return "passed_test";
  if (a.license_progress === "finished_course" || a.license_progress === "test_scheduled") return "finished_course";
  if (a.license_progress === "course_purchased") return "course_purchased";
  if (a.contracted_at) return "contracted";
  if (a.contacted_at || a.first_contact_attempt_at) return "contacted";
  return "new";
}

// One-line CTA for every card, based on their stage + stage-age. Tells
// the caller exactly what to say without having to open notes or guess.
function nextAction(a: any): { text: string; urgency: "cold" | "warm" | "hot" } {
  const stageDate = a.course_purchased_at || a.contracted_at || a.contacted_at || a.created_at;
  const days = differenceInDays(new Date(), new Date(stageDate));
  const prog = a.license_progress;

  if (a.license_status === "licensed" || prog === "licensed")
    return { text: "Provision first lead + portal login", urgency: "hot" };
  if (prog === "fingerprints_done" || prog === "waiting_on_license")
    return { text: "State processing — stay warm, plan first deal", urgency: "cold" };
  if (prog === "passed_test")
    return { text: "Push fingerprints — send NIPR link today", urgency: "hot" };
  if (prog === "test_scheduled") {
    const testDate = a.test_scheduled_date ? new Date(a.test_scheduled_date) : null;
    const untilExam = testDate ? differenceInDays(testDate, new Date()) : null;
    if (untilExam !== null && untilExam <= 2) return { text: `Exam in ${untilExam}d — confidence + sleep`, urgency: "hot" };
    return { text: "Study tips · build confidence", urgency: "warm" };
  }
  if (prog === "finished_course") {
    if (days >= 7) return { text: `${days}d since finish — SCHEDULE exam now`, urgency: "hot" };
    return { text: "Book exam date this week", urgency: "warm" };
  }
  if (prog === "course_purchased") {
    if (days >= 14) return { text: `${days}d in course — losing steam, call today`, urgency: "hot" };
    if (days >= 7) return { text: "Check progress · push for exam date", urgency: "warm" };
    return { text: "Check-in: how's the studying going?", urgency: "cold" };
  }
  if (a.contracted_at) return { text: "Push into licensing course — offer to pay", urgency: "warm" };
  if (a.contacted_at || a.first_contact_attempt_at) {
    if (days >= 3) return { text: `${days}d since contact — close or release`, urgency: "hot" };
    return { text: "Confirm decision · get onto contract", urgency: "warm" };
  }
  if (days >= 2) return { text: `Applied ${days}d ago — CALL NOW`, urgency: "hot" };
  return { text: "First contact · qualify fast", urgency: "warm" };
}

type Filter = "stalled" | "has_phone" | "top_tier" | "in_licensing" | "no_contact_7d";

export default function HiringPipeline() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<Filter>>(new Set());
  const [stateFilter, setStateFilter] = useState<string>("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<StageKey | null>(null);
  // Mobile stage picker — one column visible at a time under md breakpoint
  const [mobileStage, setMobileStage] = useState<StageKey>("new");
  // View mode: "kanban" = full board, "zoom" = stage counts + top 3 hottest each
  const [viewMode, setViewMode] = useState<"kanban" | "zoom">("kanban");

  // Live updates: when ANY applications row changes, invalidate the query.
  // Means the board refreshes in real-time as agents mark progress,
  // dealers move stages, etc. No F5 required.
  useEffect(() => {
    const channel = supabase
      .channel("hiring-pipeline-live")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const { data: apps = [], isLoading, refetch } = useQuery({
    queryKey: ["hiring-pipeline-v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .is("terminated_at", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isAdmin,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Group by stage, apply search + filter pills. Within each column,
  // sort so most urgent cards float to the top.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const st = stateFilter.trim().toUpperCase();
    const out: Record<StageKey, any[]> = {
      new: [], contacted: [], contracted: [], course_purchased: [],
      finished_course: [], passed_test: [], licensed: [],
    };
    const passesFilters = (a: any): boolean => {
      if (activeFilters.has("has_phone") && !a.phone) return false;
      if (activeFilters.has("top_tier") && !["A", "B"].includes(String(a.ai_score_tier || "").toUpperCase())) return false;
      if (activeFilters.has("in_licensing") &&
          !["course_purchased", "finished_course", "test_scheduled", "passed_test"].includes(a.license_progress || ""))
        return false;
      const last = a.last_response_at || a.updated_at || a.created_at;
      const stalledDays = differenceInDays(new Date(), new Date(last));
      if (activeFilters.has("stalled") && stalledDays < 7) return false;
      if (activeFilters.has("no_contact_7d") && (a.last_contacted_at && differenceInDays(new Date(), new Date(a.last_contacted_at)) < 7)) return false;
      if (st && !String(a.state || "").toUpperCase().startsWith(st)) return false;
      return true;
    };
    apps.forEach((a: any) => {
      if (q) {
        const hay = `${a.first_name} ${a.last_name} ${a.email} ${a.phone || ""} ${a.state || ""}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      if (!passesFilters(a)) return;
      const key = classifyStage(a);
      out[key].push(a);
    });

    const priority = (a: any) => {
      const last = a.last_response_at || a.updated_at || a.created_at;
      const stalledDays = Math.max(0, differenceInDays(new Date(), new Date(last)));
      const tier = a.ai_score_tier
        ? { A: 4, B: 3, C: 2, D: 1 }[String(a.ai_score_tier).toUpperCase()] ?? 0
        : 0;
      // Tall score pushes the applicant higher. Stalled agents are most urgent.
      return stalledDays * 100 + tier * 10;
    };
    (Object.keys(out) as StageKey[]).forEach(k => {
      out[k].sort((a, b) => priority(b) - priority(a));
    });
    return out;
  }, [apps, search, activeFilters, stateFilter]);

  // Top metrics — click to scroll/filter
  const totalApps = apps.length;
  const stalled = apps.filter((a: any) => {
    const last = a.last_response_at || a.updated_at || a.created_at;
    return differenceInDays(new Date(), new Date(last)) >= 7;
  }).length;
  const waiting24h = apps.filter((a: any) => {
    if (a.first_contact_attempt_at) return false;
    return differenceInDays(new Date(), new Date(a.created_at)) >= 1;
  }).length;
  const thisWeek = apps.filter((a: any) =>
    differenceInDays(new Date(), new Date(a.created_at)) <= 7,
  ).length;

  async function moveToStage(id: string, target: StageKey) {
    const app = apps.find((a: any) => a.id === id);
    if (!app) return;
    const patch: any = { updated_at: new Date().toISOString() };
    const now = new Date().toISOString();

    switch (target) {
      case "new":
        patch.contacted_at = null; patch.first_contact_attempt_at = null;
        patch.contracted_at = null; patch.license_progress = "unlicensed";
        break;
      case "contacted":
        if (!app.contacted_at) patch.contacted_at = now;
        if (!app.first_contact_attempt_at) patch.first_contact_attempt_at = now;
        patch.last_response_at = now;
        break;
      case "contracted":
        if (!app.contracted_at) patch.contracted_at = now;
        break;
      case "course_purchased":
        patch.license_progress = "course_purchased";
        if (!app.course_purchased_at) patch.course_purchased_at = now;
        break;
      case "finished_course":
        patch.license_progress = "finished_course";
        break;
      case "passed_test":
        patch.license_progress = "passed_test";
        if (!app.exam_passed_at) patch.exam_passed_at = now;
        break;
      case "licensed":
        patch.license_progress = "licensed";
        patch.license_status = "licensed";
        if (!app.licensed_at) patch.licensed_at = now;
        break;
    }

    const { error } = await supabase.from("applications").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Moved to ${STAGES.find(s => s.key === target)?.label}`);
    qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
  }

  async function markFailedTest(id: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("applications").update({
      license_progress: "failed_test",
      updated_at: now,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked failed test — applicant can retake");
    qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
  }

  async function rejectApplicant(id: string, reason: string) {
    const { error } = await supabase.from("applications").update({
      terminated_at: new Date().toISOString(),
      termination_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Applicant rejected");
    qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
  }

  async function markContacted(id: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("applications").update({
      contacted_at: now, first_contact_attempt_at: now,
      last_contacted_at: now, last_response_at: now, updated_at: now,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked contacted");
    qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
  }

  type CallOutcome = "connected" | "voicemail" | "no_answer" | "not_interested";

  async function logCallOutcome(id: string, outcome: CallOutcome) {
    const now = new Date().toISOString();
    const patch: any = {
      first_contact_attempt_at: now,
      updated_at: now,
    };
    if (outcome === "connected") {
      patch.contacted_at = now;
      patch.last_contacted_at = now;
      patch.last_response_at = now;
    } else if (outcome === "voicemail") {
      patch.last_contacted_at = now;
    } else if (outcome === "not_interested") {
      patch.terminated_at = now;
      patch.termination_reason = "not_interested";
    }
    // "no_answer" just bumps the attempt timestamp so stalled-ring recomputes
    const { error } = await supabase.from("applications").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    const label: Record<CallOutcome, string> = {
      connected: "Got through — marked contacted",
      voicemail: "Voicemail logged",
      no_answer: "No answer logged",
      not_interested: "Released (not interested)",
    };
    toast.success(label[outcome]);
    qc.invalidateQueries({ queryKey: ["hiring-pipeline-v2"] });
  }

  function exportCSV() {
    const rows = apps.map((a: any) => ({
      name: `${a.first_name} ${a.last_name}`,
      email: a.email, phone: a.phone || "",
      state: a.state || "", stage: classifyStage(a),
      applied: format(new Date(a.created_at), "yyyy-MM-dd"),
      days_in_pipeline: differenceInDays(new Date(), new Date(a.created_at)),
      source: a.referral_source || "direct",
    }));
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    const header = Object.keys(rows[0]).join(",");
    const body = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hiring-pipeline-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Loading pipeline…</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hiring Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Drag candidates between stages · click any card to call/text/email
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center bg-muted rounded-md p-0.5 text-xs">
            <button
              onClick={() => setViewMode("kanban")}
              className={cn("px-3 py-1 rounded font-medium transition", viewMode === "kanban" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode("zoom")}
              className={cn("px-3 py-1 rounded font-medium transition", viewMode === "zoom" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              Zoom Out
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Actionable metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile
          label="Total in Pipeline" value={totalApps}
          onClick={() => setSearch("")}
        />
        <MetricTile
          label="New This Week" value={thisWeek}
          hint="Applied in last 7 days"
          onClick={() => setSearch("")}
        />
        <MetricTile
          label="Uncalled 24h+" value={waiting24h}
          danger={waiting24h > 0}
          hint="Call these now"
          onClick={() => {
            document.getElementById("col-new")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
        <MetricTile
          label="Stalled 7+ Days" value={stalled}
          danger={stalled > 0}
          hint="No response in a week"
          onClick={() => {
            toast.info("Sort by last response — stalled bubble to top of each column");
          }}
        />
      </div>

      {/* Search + filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <FilterPill
          active={activeFilters.has("stalled")}
          onToggle={() => setActiveFilters(prev => {
            const n = new Set(prev); n.has("stalled") ? n.delete("stalled") : n.add("stalled"); return n;
          })}
          icon={<AlertTriangle className="h-3 w-3" />} label="Stalled 7d+" danger
        />
        <FilterPill
          active={activeFilters.has("has_phone")}
          onToggle={() => setActiveFilters(prev => {
            const n = new Set(prev); n.has("has_phone") ? n.delete("has_phone") : n.add("has_phone"); return n;
          })}
          icon={<Phone className="h-3 w-3" />} label="Has phone"
        />
        <FilterPill
          active={activeFilters.has("top_tier")}
          onToggle={() => setActiveFilters(prev => {
            const n = new Set(prev); n.has("top_tier") ? n.delete("top_tier") : n.add("top_tier"); return n;
          })}
          icon={<Star className="h-3 w-3" />} label="Tier A+B"
        />
        <FilterPill
          active={activeFilters.has("in_licensing")}
          onToggle={() => setActiveFilters(prev => {
            const n = new Set(prev); n.has("in_licensing") ? n.delete("in_licensing") : n.add("in_licensing"); return n;
          })}
          icon={<Target className="h-3 w-3" />} label="In licensing"
        />
        <FilterPill
          active={activeFilters.has("no_contact_7d")}
          onToggle={() => setActiveFilters(prev => {
            const n = new Set(prev); n.has("no_contact_7d") ? n.delete("no_contact_7d") : n.add("no_contact_7d"); return n;
          })}
          icon={<PhoneOff className="h-3 w-3" />} label="No contact 7d+" danger
        />
        <Input
          placeholder="State (e.g. TX)"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          className="w-28 h-8 text-xs uppercase"
          maxLength={2}
        />
        {(activeFilters.size > 0 || stateFilter) && (
          <button
            onClick={() => { setActiveFilters(new Set()); setStateFilter(""); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Mobile stage picker — pill row, tap to switch the visible column. */}
      <div className="md:hidden overflow-x-auto -mx-4 px-4 pb-1">
        <div className="flex gap-1.5 min-w-max">
          {STAGES.map(stage => (
            <button
              key={stage.key}
              onClick={() => setMobileStage(stage.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition",
                mobileStage === stage.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/50 text-muted-foreground bg-card hover:text-foreground",
              )}
            >
              <span>{stage.label}</span>
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                mobileStage === stage.key ? "bg-primary-foreground/20" : "bg-muted",
              )}>
                {grouped[stage.key].length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Zoom-out view — every stage as a tile w/ top 3 hottest names */}
      {viewMode === "zoom" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {STAGES.map(stage => {
            const items = grouped[stage.key];
            const top3 = items.slice(0, 3);
            return (
              <div key={stage.key} className={cn("rounded-lg border-t-4 p-3 bg-card", stage.color)}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{stage.label}</span>
                  <Badge variant="outline" className="text-xs">{items.length}</Badge>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">empty</p>
                ) : (
                  <ul className="space-y-1">
                    {top3.map((a: any) => {
                      const days = differenceInDays(new Date(), new Date(a.last_response_at || a.updated_at || a.created_at));
                      return (
                        <li key={a.id} className="flex items-center justify-between text-xs">
                          <span className="font-medium truncate">{a.first_name} {a.last_name}</span>
                          <span className={cn("text-[10px] tabular-nums shrink-0 ml-2", days >= 7 ? "text-destructive" : "text-muted-foreground")}>
                            {days}d
                          </span>
                        </li>
                      );
                    })}
                    {items.length > 3 && (
                      <li className="text-[10px] text-muted-foreground/70 pt-1">
                        +{items.length - 3} more
                      </li>
                    )}
                  </ul>
                )}
                <button
                  onClick={() => setViewMode("kanban")}
                  className="mt-2 text-[10px] text-primary hover:underline"
                >
                  open stage →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Kanban — horizontal scroll on md+, mobile shows one column full width */}
      {viewMode === "kanban" && (
      <div className="md:overflow-x-auto pb-2 md:-mx-4 md:px-4 md:mx-0">
        <div className="flex flex-col md:grid md:grid-flow-col md:auto-cols-[300px] gap-3">
        {STAGES.map(stage => {
          const items = grouped[stage.key];
          const isDragTarget = dragOver === stage.key;
          const hiddenOnMobile = mobileStage !== stage.key;
          return (
            <div
              key={stage.key}
              id={`col-${stage.key}`}
              className={cn(
                "rounded-lg border-t-4 flex flex-col min-h-[400px]",
                hiddenOnMobile && "hidden md:flex",
                stage.color,
                isDragTarget ? "bg-primary/10 ring-2 ring-primary" : stage.bg,
              )}
              onDragOver={e => { e.preventDefault(); setDragOver(stage.key); }}
              onDragLeave={() => setDragOver(prev => prev === stage.key ? null : prev)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(null);
                if (dragId) moveToStage(dragId, stage.key);
                setDragId(null);
              }}
            >
              <div className="p-3 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{stage.label}</span>
                  <Badge variant="outline" className="text-xs">{items.length}</Badge>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
                {items.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    Drag cards here
                  </div>
                ) : (
                  items.map((a: any) => (
                    <ApplicantCard
                      key={a.id}
                      app={a}
                      dragging={dragId === a.id}
                      onDragStart={() => setDragId(a.id)}
                      onDragEnd={() => setDragId(null)}
                      onMoveToStage={(s) => moveToStage(a.id, s)}
                      onMarkContacted={() => markContacted(a.id)}
                      onReject={(reason) => rejectApplicant(a.id, reason)}
                      onMarkFailed={() => markFailedTest(a.id)}
                      onLogCall={(outcome) => logCallOutcome(a.id, outcome)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      )}
    </div>
  );
}

/* ---------- Small components ---------- */

function FilterPill({
  active, onToggle, icon, label, danger,
}: { active: boolean; onToggle: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-medium transition",
        active
          ? (danger
              ? "bg-destructive/15 border-destructive/40 text-destructive"
              : "bg-primary/15 border-primary/40 text-primary")
          : "border-border/40 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function MetricTile({
  label, value, danger, hint, onClick,
}: { label: string; value: number; danger?: boolean; hint?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left p-3 rounded-lg border transition",
        danger
          ? "border-destructive/40 bg-destructive/5 hover:border-destructive"
          : "border-border/40 bg-card/50 hover:border-border",
      )}
    >
      <div className="flex items-center gap-2">
        {danger && <AlertTriangle className="h-4 w-4 text-destructive" />}
        <span className={cn("text-2xl font-bold", danger ? "text-destructive" : "text-foreground")}>
          {value}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</div>}
    </button>
  );
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = String(raw).replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (d.length !== 10) return raw;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function ApplicantCard({
  app, dragging, onDragStart, onDragEnd, onMoveToStage, onMarkContacted, onReject, onLogCall, onMarkFailed,
}: {
  app: any;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveToStage: (s: StageKey) => void;
  onMarkContacted: () => void;
  onReject: (reason: string) => void;
  onLogCall: (outcome: "connected" | "voicemail" | "no_answer" | "not_interested") => void;
  onMarkFailed?: () => void;
}) {
  const lastActivity = app.last_response_at || app.updated_at || app.created_at;
  const days = differenceInDays(new Date(), new Date(lastActivity));
  const stalled = days >= 7;
  const veryStalled = days >= 14;
  const cta = nextAction(app);

  const tierColor =
    app.ai_score_tier === "A" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    app.ai_score_tier === "B" ? "bg-sky-500/15 text-sky-400 border-sky-500/30" :
    app.ai_score_tier === "C" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    app.ai_score_tier === "D" ? "bg-slate-500/15 text-slate-400 border-slate-500/30" : "";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg bg-card border p-3 cursor-grab active:cursor-grabbing transition",
        "hover:border-primary/50 hover:shadow-lg",
        "border-border/50",
        dragging && "opacity-40",
        veryStalled && "ring-2 ring-destructive/50 border-destructive/30",
        stalled && !veryStalled && "ring-1 ring-amber-500/40 border-amber-500/30",
      )}
    >
      {/* Name + tier (always visible, bigger) */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-foreground truncate leading-tight">
            {app.first_name} {app.last_name}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span>{app.state || "??"}</span>
            <span>·</span>
            <span>applied {format(new Date(app.created_at), "MMM d")}</span>
          </div>
        </div>
        {app.ai_score_tier && (
          <span className={cn("shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border", tierColor)}>
            {app.ai_score_tier}
          </span>
        )}
      </div>

      {/* Stalled badge - always visible when >= 7 days */}
      {stalled && (
        <div className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded mb-2 inline-block",
          veryStalled ? "bg-destructive/20 text-destructive" : "bg-amber-500/20 text-amber-500"
        )}>
          {veryStalled ? "🔴" : "⚠️"} Stalled {days}d
        </div>
      )}

      {/* Phone (prominent, click-to-call) — always visible */}
      {app.phone && (
        <a
          href={`tel:${app.phone}`}
          onClick={(e) => e.stopPropagation()}
          className="block bg-primary/10 hover:bg-primary/20 text-primary rounded-md px-2 py-1.5 mb-1.5 text-sm font-mono font-semibold tracking-tight transition"
        >
          📞 {formatPhone(app.phone)}
        </a>
      )}

      {/* Email (smaller, click-to-mail) — always visible */}
      {app.email && (
        <a
          href={`mailto:${app.email}`}
          onClick={(e) => e.stopPropagation()}
          className="block text-[11px] text-muted-foreground hover:text-primary truncate mb-2"
          title={app.email}
        >
          ✉ {app.email}
        </a>
      )}

      {/* Next-action badge — tells the caller exactly what to say */}
      <div
        className={cn(
          "flex items-start gap-1.5 rounded-md px-2 py-1.5 mb-2 text-[11px] leading-snug",
          cta.urgency === "hot"  && "bg-destructive/10 text-destructive border border-destructive/30",
          cta.urgency === "warm" && "bg-amber-500/10 text-amber-500 border border-amber-500/30",
          cta.urgency === "cold" && "bg-muted text-muted-foreground border border-border/40",
        )}
      >
        {cta.urgency === "hot" ? <Flame className="h-3 w-3 mt-0.5 shrink-0" /> :
         cta.urgency === "warm" ? <Zap className="h-3 w-3 mt-0.5 shrink-0" /> :
         <Target className="h-3 w-3 mt-0.5 shrink-0" />}
        <span className="font-medium">{cta.text}</span>
      </div>

      {/* Always-visible action row: Call (with outcome logger) + Text + More */}
      <div className="flex items-center gap-1 pt-2 border-t border-border/30">
        {app.phone && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm" variant="default"
                className="flex-1 h-7 text-[11px]"
                onClick={(e) => e.stopPropagation()}
              >
                <PhoneCall className="h-3 w-3 mr-1" /> Call
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem asChild>
                <a href={`tel:${app.phone}`} className="cursor-pointer">
                  <Phone className="h-3.5 w-3.5 mr-2" /> Dial now ({formatPhone(app.phone)})
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onLogCall("connected")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-500" /> Got through
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onLogCall("voicemail")}>
                <Voicemail className="h-3.5 w-3.5 mr-2 text-sky-500" /> Left voicemail
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onLogCall("no_answer")}>
                <PhoneOff className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> No answer
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onLogCall("not_interested")}
              >
                <XCircle className="h-3.5 w-3.5 mr-2" /> Not interested · release
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {app.phone && (
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-[11px]"
            asChild
            onClick={(e) => e.stopPropagation()}
            title="Text"
          >
            <a href={`sms:${app.phone}`}><MessageSquare className="h-3 w-3" /></a>
          </Button>
        )}
        <Button
          size="sm" variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={(e) => { e.stopPropagation(); onMarkContacted(); }}
          title="Mark contacted"
        >
          <CheckCircle2 className="h-3 w-3" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm" variant="outline"
              className="h-7 px-2"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onMarkContacted}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Mark Contacted
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {STAGES.map(s => (
              <DropdownMenuItem key={s.key} onClick={() => onMoveToStage(s.key)}>
                Move to {s.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onReject("not_qualified")}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" /> Reject · Not Qualified
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onReject("ghosted")}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" /> Reject · Ghosted
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onReject("not_interested")}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" /> Reject · Not Interested
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-amber-500"
              onClick={() => onMarkFailed?.()}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" /> Failed Test (retake)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onReject("fired")}
            >
              <XCircle className="h-3.5 w-3.5 mr-2" /> Fire · Terminate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
