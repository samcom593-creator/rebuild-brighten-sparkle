import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  GraduationCap, Clock, CheckCircle2, XCircle, AlertOctagon, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ---- types ---- */
type Stage =
  | "enrolled" | "not_responding" | "waiting_to_schedule" | "calendar_sent"
  | "booked" | "exam_passed" | "exam_failed" | "quit";

type StudentRow = {
  id: string;
  application_id: string | null;
  current_stage: Stage;
  state: string | null;
  line: string | null;
  enrolled_at: string;
  stage_changed_at: string;
  days_in_stage: number;
  days_since_enroll: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

type StalledRow = StudentRow & { stall_reason: string };

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "enrolled",             label: "Enrolled",       color: "border-slate-500/40 text-slate-300 bg-slate-500/5" },
  { key: "not_responding",       label: "Not responding", color: "border-amber-500/40 text-amber-300 bg-amber-500/5" },
  { key: "waiting_to_schedule",  label: "Waiting → Sched", color: "border-cyan-500/40 text-cyan-300 bg-cyan-500/5" },
  { key: "calendar_sent",        label: "Calendar sent",  color: "border-blue-500/40 text-blue-300 bg-blue-500/5" },
  { key: "booked",               label: "Booked",         color: "border-violet-500/40 text-violet-300 bg-violet-500/5" },
  { key: "exam_passed",          label: "Exam passed",    color: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5" },
  { key: "exam_failed",          label: "Exam failed",    color: "border-rose-500/40 text-rose-300 bg-rose-500/5" },
  { key: "quit",                 label: "Quit",           color: "border-stone-500/40 text-stone-400 bg-stone-500/5" },
];

/* ============================================================ */
function KanbanTab() {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["licensing_kanban"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_licensing_kanban")
        .select("*")
        .order("days_in_stage", { ascending: false });
      if (error) throw error;
      return data as StudentRow[];
    },
    refetchInterval: 60_000,
  });

  const moveStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      const { error } = await supabase.from("licensing_students").update({ current_stage: stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stage updated");
      qc.invalidateQueries({ queryKey: ["licensing_kanban"] });
      qc.invalidateQueries({ queryKey: ["licensing_stalled"] });
    },
    onError: (e) => toast.error(`Failed: ${String(e)}`),
  });

  const byStage = useMemo(() => {
    const map: Record<Stage, StudentRow[]> = {
      enrolled: [], not_responding: [], waiting_to_schedule: [], calendar_sent: [],
      booked: [], exam_passed: [], exam_failed: [], quit: [],
    };
    (rows ?? []).forEach(r => { map[r.current_stage]?.push(r); });
    return map;
  }, [rows]);

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>;

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-max">
        {STAGES.map(s => {
          const students = byStage[s.key];
          return (
            <Card key={s.key} className={cn("min-w-[260px] flex-shrink-0", s.color)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{s.label}</span>
                  <Badge variant="outline" className="ml-2">{students.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-1.5 max-h-[60vh] overflow-y-auto">
                {students.length === 0 && <div className="text-xs text-slate-500 italic p-2">—</div>}
                {students.map(st => (
                  <div key={st.id} className="rounded-md border border-white/10 bg-white/[0.03] p-2.5 text-xs">
                    <div className="font-medium">{[st.first_name, st.last_name].filter(Boolean).join(" ") || "Unknown"}</div>
                    <div className="text-slate-500 mt-0.5">{st.state ?? "—"} · {Math.round(st.days_in_stage)}d in stage</div>
                    <div className="mt-2">
                      <Select value={st.current_stage} onValueChange={(v) => moveStage.mutate({ id: st.id, stage: v as Stage })}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STAGES.map(opt => (
                            <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================ */
function StalledTab() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["licensing_stalled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_licensing_stalled")
        .select("*")
        .order("days_in_stage", { ascending: false });
      if (error) throw error;
      return data as StalledRow[];
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-amber-400" /> Stalled students ({(rows ?? []).length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!rows?.length ? (
          <div className="p-6 text-sm text-slate-500">No stalled students. Either the pipeline is clean or no students have crossed SLA thresholds yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-400 text-xs">
              <tr>
                <th className="text-left p-3">Student</th>
                <th className="text-left p-3">State</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Days in stage</th>
                <th className="text-left p-3">Reason</th>
                <th className="text-left p-3">Contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="p-3">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown"}</td>
                  <td className="p-3">{r.state ?? "—"}</td>
                  <td className="p-3"><Badge variant="secondary">{r.current_stage}</Badge></td>
                  <td className="p-3 tabular-nums">{Math.round(r.days_in_stage)}d</td>
                  <td className="p-3 text-amber-300">{r.stall_reason}</td>
                  <td className="p-3 text-xs text-slate-500">{r.email ?? r.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
export default function LicensingTracker() {
  return (
    <div className="min-h-screen p-4 lg:p-6 max-w-[1600px] mx-auto space-y-4 ops-surface">
      <PageHeader
        title="Licensing Tracker"
        subtitle="8-stage pipeline from Enrolled → Quit. Auto-enrolls on application paid. Per-student exam-readiness rollup lights up Monday when the course player ships (see /business-ops/apex-os-week/specs/PRELICENSING-NEXT-WEEK.md)."
        icon={<GraduationCap className="w-6 h-6 text-[#22d3a5]" />}
      />

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3 text-xs flex items-start gap-2">
          <AlertOctagon className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            MVP: 8-stage kanban + auto-enroll trigger + stalled-detection. Practice exam tracking + study-minute capture + per-state video requirements arrive Monday 2026-05-26 with the course player.
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="kanban">
        <TabsList className="grid grid-cols-2 w-full max-w-sm">
          <TabsTrigger value="kanban">8-stage kanban</TabsTrigger>
          <TabsTrigger value="stalled">Stalled (SLA breach)</TabsTrigger>
        </TabsList>
        <TabsContent value="kanban" className="mt-4"><KanbanTab /></TabsContent>
        <TabsContent value="stalled" className="mt-4"><StalledTab /></TabsContent>
      </Tabs>

      <div className="text-center text-xs text-slate-600 pt-4 pb-8 italic">Hold the Standard. Average is the disease.</div>
    </div>
  );
}
