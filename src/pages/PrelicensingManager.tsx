import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GraduationCap, Phone, Mail, MessageSquare, MoreVertical, CheckCircle2,
  Clock, AlertTriangle, RefreshCw, Download, Search, XCircle,
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Pre-Licensing Manager
 * Every agent in pre-licensing, their stage, last update, and one-click actions.
 * Managers see their recruits; admins see everyone.
 */

const STAGES = [
  { key: "unlicensed", label: "Not Started", color: "bg-slate-500" },
  { key: "course_purchased", label: "Course Purchased", color: "bg-amber-500" },
  { key: "finished_course", label: "Course Finished", color: "bg-blue-500" },
  { key: "test_scheduled", label: "Exam Scheduled", color: "bg-indigo-500" },
  { key: "passed_test", label: "Exam Passed", color: "bg-violet-500" },
  { key: "fingerprints_done", label: "Fingerprints Done", color: "bg-purple-500" },
  { key: "waiting_on_license", label: "Waiting on License", color: "bg-fuchsia-500" },
  { key: "licensed", label: "Licensed ✅", color: "bg-emerald-500" },
] as const;

type StageKey = typeof STAGES[number]["key"];

export default function PrelicensingManager() {
  const { user, isAdmin, isManager } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | StageKey>("all");
  const [stuckOnly, setStuckOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: apps = [], isLoading, refetch } = useQuery({
    queryKey: ["prelicensing-apps", user?.id, isAdmin, isManager],
    queryFn: async () => {
      let q = supabase
        .from("applications")
        .select("*")
        .is("terminated_at", null)
        .neq("license_status", "licensed")
        .order("created_at", { ascending: false });

      if (!isAdmin && isManager) {
        q = q.eq("assigned_agent_id", user!.id);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && (isAdmin || isManager),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a: any) => {
      if (stageFilter !== "all" && (a.license_progress || "unlicensed") !== stageFilter) return false;
      if (q) {
        const hay = `${a.first_name} ${a.last_name} ${a.email} ${a.phone || ""} ${a.state || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (stuckOnly) {
        const last = a.last_response_at || a.updated_at || a.created_at;
        if (differenceInDays(new Date(), new Date(last)) < 7) return false;
      }
      return true;
    });
  }, [apps, search, stageFilter, stuckOnly]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STAGES.forEach(s => { counts[s.key] = 0; });
    apps.forEach((a: any) => {
      const key = a.license_progress || "unlicensed";
      if (key in counts) counts[key]++;
    });
    return counts;
  }, [apps]);

  const allChecked = filtered.length > 0 && filtered.every(a => selected.has(a.id));

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(filtered.map(a => a.id)));
  }

  async function updateStage(id: string, newStage: StageKey) {
    const patch: any = { license_progress: newStage, updated_at: new Date().toISOString() };
    if (newStage === "course_purchased" && !apps.find((a: any) => a.id === id)?.course_purchased_at) {
      patch.course_purchased_at = new Date().toISOString();
    }
    if (newStage === "test_scheduled") patch.exam_scheduled_at = new Date().toISOString();
    if (newStage === "passed_test") patch.exam_passed_at = new Date().toISOString();
    if (newStage === "fingerprints_done") {
      patch.fingerprints_submitted_at = new Date().toISOString();
      patch.fingerprint_done = true;
    }
    if (newStage === "licensed") {
      patch.license_status = "licensed";
      patch.licensed_at = new Date().toISOString();
    }

    const { error } = await supabase.from("applications").update(patch).eq("id", id);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    toast.success("Stage updated");
    qc.invalidateQueries({ queryKey: ["prelicensing-apps"] });
  }

  async function markContacted(id: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("applications").update({
      last_contacted_at: now, last_response_at: now, updated_at: now,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Marked contacted");
    qc.invalidateQueries({ queryKey: ["prelicensing-apps"] });
  }

  async function bulkSMS() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.functions.invoke("send-bulk-unlicensed-outreach", {
      body: { application_ids: ids, channel: "sms" },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`SMS queued for ${ids.length}`);
    setSelected(new Set());
  }

  async function bulkEmail() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.functions.invoke("send-licensing-instructions", {
      body: { application_ids: ids },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Licensing email sent to ${ids.length}`);
    setSelected(new Set());
  }

  async function bulkSetStage(stage: StageKey) {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("applications").update({
      license_progress: stage, updated_at: new Date().toISOString(),
    }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} moved to ${STAGES.find(s => s.key === stage)?.label}`);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["prelicensing-apps"] });
  }

  function exportCSV() {
    const rows = filtered.map((a: any) => ({
      name: `${a.first_name} ${a.last_name}`,
      email: a.email, phone: a.phone || "",
      state: a.state || "", stage: a.license_progress || "unlicensed",
      days_since_start: differenceInDays(new Date(), new Date(a.created_at)),
      last_update: a.last_response_at || a.updated_at,
    }));
    const header = Object.keys(rows[0] || {}).join(",");
    const body = rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `prelicensing-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!isAdmin && !isManager) {
    return <div className="p-6 text-center text-muted-foreground">Managers and admins only.</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary" /> Pre-Licensing
          </h1>
          <p className="text-sm text-muted-foreground">
            {apps.length} agent{apps.length === 1 ? "" : "s"} in the pipeline — track, nudge, advance
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Stage buckets — click to filter */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <button
          onClick={() => setStageFilter("all")}
          className={cn(
            "p-3 rounded-lg border text-left transition",
            stageFilter === "all"
              ? "border-primary bg-primary/10"
              : "border-border/40 bg-card/50 hover:border-border",
          )}
        >
          <div className="text-2xl font-bold text-foreground">{apps.length}</div>
          <div className="text-xs text-muted-foreground">All</div>
        </button>
        {STAGES.filter(s => stageCounts[s.key] > 0).map(stage => (
          <button
            key={stage.key}
            onClick={() => setStageFilter(stage.key)}
            className={cn(
              "p-3 rounded-lg border text-left transition",
              stageFilter === stage.key
                ? "border-primary bg-primary/10"
                : "border-border/40 bg-card/50 hover:border-border",
            )}
          >
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", stage.color)} />
              <div className="text-2xl font-bold text-foreground">{stageCounts[stage.key]}</div>
            </div>
            <div className="text-xs text-muted-foreground truncate">{stage.label}</div>
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone, state…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={stuckOnly} onCheckedChange={v => setStuckOnly(!!v)} />
          Stuck 7+ days only
        </label>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <GlassCard className="p-3 flex flex-wrap items-center gap-2 border-primary/40">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="h-4 w-px bg-border mx-1" />
          <Button size="sm" variant="outline" onClick={bulkSMS}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> SMS All
          </Button>
          <Button size="sm" variant="outline" onClick={bulkEmail}>
            <Mail className="h-3.5 w-3.5 mr-1" /> Send Licensing Instructions
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Set Stage <MoreVertical className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STAGES.map(s => (
                <DropdownMenuItem key={s.key} onClick={() => bulkSetStage(s.key)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </GlassCard>
      )}

      {/* List */}
      {isLoading ? (
        <GlassCard className="p-8 text-center text-muted-foreground">Loading…</GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
          <p className="text-muted-foreground">No applicants match these filters.</p>
        </GlassCard>
      ) : (
        <GlassCard className="p-0 overflow-hidden">
          <div className="p-3 border-b border-border/40 bg-muted/30 flex items-center gap-3">
            <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
            <span className="text-xs text-muted-foreground font-medium">
              {filtered.length} applicant{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {filtered.map((a: any) => {
              const stageKey = (a.license_progress || "unlicensed") as StageKey;
              const stage = STAGES.find(s => s.key === stageKey) || STAGES[0];
              const daysSinceUpdate = differenceInDays(
                new Date(),
                new Date(a.last_response_at || a.updated_at || a.created_at),
              );
              const stuck = daysSinceUpdate >= 7;

              return (
                <div key={a.id} className="p-3 flex items-center gap-3 hover:bg-muted/20 transition">
                  <Checkbox
                    checked={selected.has(a.id)}
                    onCheckedChange={() => toggleOne(a.id)}
                  />

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground truncate">
                        {a.first_name} {a.last_name}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        <div className={cn("w-1.5 h-1.5 rounded-full mr-1", stage.color)} />
                        {stage.label}
                      </Badge>
                      {stuck && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="h-3 w-3 mr-0.5" /> Stuck {daysSinceUpdate}d
                        </Badge>
                      )}
                      {a.state && (
                        <span className="text-xs text-muted-foreground">{a.state}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {a.email}{a.phone ? ` · ${a.phone}` : ""} · Applied {format(new Date(a.created_at), "MMM d")}
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1">
                    {a.phone && (
                      <Button
                        size="sm" variant="ghost"
                        asChild
                        title="Call"
                      >
                        <a href={`tel:${a.phone}`}>
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    {a.phone && (
                      <Button size="sm" variant="ghost" asChild title="Text">
                        <a href={`sms:${a.phone}`}>
                          <MessageSquare className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" asChild title="Email">
                      <a href={`mailto:${a.email}`}>
                        <Mail className="h-3.5 w-3.5" />
                      </a>
                    </Button>

                    {/* Stage picker */}
                    <Select
                      value={stageKey}
                      onValueChange={(v) => updateStage(a.id, v as StageKey)}
                    >
                      <SelectTrigger className="h-8 w-[160px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => (
                          <SelectItem key={s.key} value={s.key} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => markContacted(a.id)}>
                          <Clock className="h-3.5 w-3.5 mr-2" /> Mark Contacted Today
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            const { error } = await supabase
                              .from("applications")
                              .update({ is_ghosted: true, terminated_at: new Date().toISOString(), termination_reason: "ghosted" })
                              .eq("id", a.id);
                            if (error) toast.error(error.message);
                            else { toast.success("Marked ghosted"); qc.invalidateQueries({ queryKey: ["prelicensing-apps"] }); }
                          }}
                          className="text-destructive"
                        >
                          <XCircle className="h-3.5 w-3.5 mr-2" /> Mark Ghosted / Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
