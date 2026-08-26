import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Loader2, MessageSquarePlus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";

type GoalRow = {
  id: string;
  monthly_income_goal: number | string;
  daily_dial_target: number;
  weekly_presentation_target: number;
  target_first_deal_date: string | null;
  target_full_time_date: string | null;
  why_statement: string | null;
};

type NoteRow = {
  id: string;
  author_name: string;
  note_type: string;
  content: string;
  created_at: string;
};

type GoalDraft = {
  monthlyIncome: string;
  dailyDials: string;
  weeklyPresentations: string;
  firstDealDate: string;
  fullTimeDate: string;
  why: string;
};

const defaultDraft: GoalDraft = {
  monthlyIncome: "10000",
  dailyDials: "200",
  weeklyPresentations: "15",
  firstDealDate: "",
  fullTimeDate: "",
  why: "",
};

export function CandidateGoalsNotesPanel({
  agentId,
  applicationId,
}: {
  agentId?: string | null;
  applicationId?: string | null;
}) {
  const { isAdmin, isManager, isVa, isVaManager } = useAuth();
  const brand = resolveBrand();
  const canWriteNotes = isAdmin || isManager || isVa || isVaManager;
  const queryClient = useQueryClient();
  const subjectKey = agentId ? `agent:${agentId}` : `application:${applicationId ?? "none"}`;
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(defaultDraft);
  const [savingGoal, setSavingGoal] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const goalQuery = useQuery({
    queryKey: ["candidate-smart-goal", subjectKey],
    enabled: Boolean(agentId || applicationId),
    queryFn: async () => {
      let query = supabase.from("candidate_smart_goals" as never).select("*");
      query = agentId
        ? query.eq("agent_id", agentId)
        : query.eq("application_id", applicationId!);
      const { data, error } = await query.limit(1).maybeSingle();
      if (error) throw error;
      return (data as unknown as GoalRow | null) ?? null;
    },
  });

  const notesQuery = useQuery({
    queryKey: ["candidate-notes", subjectKey],
    enabled: Boolean((agentId || applicationId) && canWriteNotes),
    queryFn: async () => {
      let query = supabase.from("candidate_notes" as never)
        .select("id, author_name, note_type, content, created_at");
      query = agentId
        ? query.eq("agent_id", agentId)
        : query.eq("application_id", applicationId!);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(12);
      if (error) throw error;
      return (data as unknown as NoteRow[]) ?? [];
    },
  });

  useEffect(() => {
    const goal = goalQuery.data;
    setGoalDraft(goal ? {
      monthlyIncome: String(goal.monthly_income_goal ?? 10000),
      dailyDials: String(goal.daily_dial_target ?? 200),
      weeklyPresentations: String(goal.weekly_presentation_target ?? 15),
      firstDealDate: goal.target_first_deal_date ?? "",
      fullTimeDate: goal.target_full_time_date ?? "",
      why: goal.why_statement ?? "",
    } : defaultDraft);
  }, [goalQuery.data, subjectKey]);

  const saveGoal = async () => {
    if (!agentId && !applicationId) return;
    setSavingGoal(true);
    const payload = {
      agent_id: agentId ?? null,
      application_id: applicationId ?? null,
      monthly_income_goal: Math.max(0, Number(goalDraft.monthlyIncome) || 0),
      daily_dial_target: Math.max(0, Number(goalDraft.dailyDials) || 0),
      weekly_presentation_target: Math.max(0, Number(goalDraft.weeklyPresentations) || 0),
      target_first_deal_date: goalDraft.firstDealDate || null,
      target_full_time_date: goalDraft.fullTimeDate || null,
      why_statement: goalDraft.why.trim() || null,
    };
    const result = goalQuery.data?.id
      ? await supabase.from("candidate_smart_goals" as never).update(payload as never).eq("id", goalQuery.data.id)
      : await supabase.from("candidate_smart_goals" as never).insert(payload as never);
    setSavingGoal(false);
    if (result.error) {
      toast.error(`Goal save failed: ${result.error.message}`);
      return;
    }
    toast.success("SMART goals saved");
    queryClient.invalidateQueries({ queryKey: ["candidate-smart-goal", subjectKey] });
  };

  const addNote = async () => {
    if ((!agentId && !applicationId) || !note.trim()) return;
    setSavingNote(true);
    const { error } = await supabase.from("candidate_notes" as never).insert({
      agent_id: agentId ?? null,
      application_id: applicationId ?? null,
      author_name: `${brand.shortName} staff`,
      author_role: "manager",
      note_type: "general",
      content: note.trim(),
    } as never);
    setSavingNote(false);
    if (error) {
      toast.error(`Note save failed: ${error.message}`);
      return;
    }
    setNote("");
    toast.success("Shared note added");
    queryClient.invalidateQueries({ queryKey: ["candidate-notes", subjectKey] });
  };

  return (
    <details className="group rounded-xl border border-border bg-card/50" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold">
        <Flag className="h-4 w-4 text-primary" /> SMART goals &amp; shared notes
        <span className="ml-auto text-xs font-normal text-muted-foreground">Sam · managers · VAs</span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <GoalInput label="Monthly income goal" value={goalDraft.monthlyIncome} onChange={(value) => setGoalDraft((old) => ({ ...old, monthlyIncome: value }))} type="number" />
          <GoalInput label="Daily dials" value={goalDraft.dailyDials} onChange={(value) => setGoalDraft((old) => ({ ...old, dailyDials: value }))} type="number" />
          <GoalInput label="Weekly presentations" value={goalDraft.weeklyPresentations} onChange={(value) => setGoalDraft((old) => ({ ...old, weeklyPresentations: value }))} type="number" />
          <GoalInput label="Target first deal" value={goalDraft.firstDealDate} onChange={(value) => setGoalDraft((old) => ({ ...old, firstDealDate: value }))} type="date" />
          <div className="col-span-2">
            <GoalInput label="Target full-time date" value={goalDraft.fullTimeDate} onChange={(value) => setGoalDraft((old) => ({ ...old, fullTimeDate: value }))} type="date" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Why this goal matters</Label>
            <Textarea value={goalDraft.why} onChange={(event) => setGoalDraft((old) => ({ ...old, why: event.target.value }))} rows={3} placeholder="The personal reason behind the target…" />
          </div>
        </div>
        <Button size="sm" className="w-full gap-2" onClick={saveGoal} disabled={savingGoal}>
          {savingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save goals
        </Button>

        {canWriteNotes && (
          <div className="space-y-2 border-t border-border pt-4">
            <Label className="text-xs text-muted-foreground">Shared operating note</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Call result, objection, blocker, or next move…" />
            <Button size="sm" variant="outline" className="gap-2" onClick={addNote} disabled={savingNote || !note.trim()}>
              {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />} Add note
            </Button>
            {(notesQuery.data?.length ?? 0) > 0 && (
              <ul className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {notesQuery.data!.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs">
                    <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{row.author_name} · {row.note_type.replaceAll("_", " ")}</span>
                      <span>{new Date(row.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{row.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function GoalInput({ label, value, onChange, type }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: "number" | "date";
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
