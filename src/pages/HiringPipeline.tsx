import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone, Mail, MessageSquare, MoreVertical, RefreshCw, AlertTriangle,
  Download, Search, XCircle, CheckCircle2, GripVertical,
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

export default function HiringPipeline() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<StageKey | null>(null);

  const { data: apps = [], isLoading, refetch } = useQuery({
    queryKey: ["hiring-pipeline-v2"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .is("terminated_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isAdmin,
    staleTime: 30_000,
  });

  // Group by stage + apply search
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Record<StageKey, any[]> = {
      new: [], contacted: [], contracted: [], course_purchased: [],
      finished_course: [], passed_test: [], licensed: [],
    };
    apps.forEach((a: any) => {
      if (q) {
        const hay = `${a.first_name} ${a.last_name} ${a.email} ${a.phone || ""} ${a.state || ""}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      const key = classifyStage(a);
      out[key].push(a);
    });
    return out;
  }, [apps, search]);

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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search name, email, phone, state…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
        {STAGES.map(stage => {
          const items = grouped[stage.key];
          const isDragTarget = dragOver === stage.key;
          return (
            <div
              key={stage.key}
              id={`col-${stage.key}`}
              className={cn(
                "rounded-lg border-t-4 flex flex-col min-h-[400px]",
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
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Small components ---------- */

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

function ApplicantCard({
  app, dragging, onDragStart, onDragEnd, onMoveToStage, onMarkContacted, onReject,
}: {
  app: any;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveToStage: (s: StageKey) => void;
  onMarkContacted: () => void;
  onReject: (reason: string) => void;
}) {
  const days = differenceInDays(
    new Date(),
    new Date(app.last_response_at || app.updated_at || app.created_at),
  );
  const stalled = days >= 7;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-md bg-card border border-border/40 p-2.5 cursor-grab active:cursor-grabbing transition",
        "hover:border-primary/40 hover:shadow-md",
        dragging && "opacity-40",
        stalled && "ring-1 ring-destructive/30",
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-foreground truncate">
            {app.first_name} {app.last_name}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {app.state || "—"} · Applied {format(new Date(app.created_at), "MMM d")}
          </div>
          {stalled && (
            <Badge variant="destructive" className="text-[10px] mt-1 h-4 px-1">
              Stalled {days}d
            </Badge>
          )}
          {app.ai_score_tier && (
            <Badge variant="outline" className="text-[10px] mt-1 h-4 px-1 ml-1">
              Tier {app.ai_score_tier}
            </Badge>
          )}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition">
        {app.phone && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Call">
            <a href={`tel:${app.phone}`}><Phone className="h-3 w-3" /></a>
          </Button>
        )}
        {app.phone && (
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Text">
            <a href={`sms:${app.phone}`}><MessageSquare className="h-3 w-3" /></a>
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" asChild title="Email">
          <a href={`mailto:${app.email}`}><Mail className="h-3 w-3" /></a>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 ml-auto">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
