import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarClock, Users, Search, ExternalLink, RefreshCw, Building2, Phone, Instagram } from "lucide-react";
import { format, formatDistanceToNowStrict, isPast } from "date-fns";

type Applicant = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  company: string | null;
  appointment_at: string | null;
  stage: string;
  interview_result: string | null;
  unqualified_reason: string | null;
  notes: string | null;
  reschedule_count: number | null;
  va_name: string | null;
  recruiter_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type PipelineResponse = {
  applicants: Applicant[];
  counts: Record<string, number>;
  total: number;
  role: string | null;
  generatedAt: string;
};

// The live hh_stage enum, in pipeline order, with the APEX Control-Tower
// language (label, semantic tone, and the one obvious next action per stage —
// the diagram's rule: every row has a stage, owner, next action, deadline).
const STAGES: { key: string; label: string; tone: "info" | "warning" | "success" | "destructive" | "muted"; nextAction: string }[] = [
  { key: "appointment_set", label: "Appointment set", tone: "info", nextAction: "Confirm the interview" },
  { key: "confirmed", label: "Confirmed", tone: "info", nextAction: "Run the interview" },
  { key: "rescheduled", label: "Rescheduled", tone: "warning", nextAction: "Re-confirm the new time" },
  { key: "no_show", label: "No-show", tone: "warning", nextAction: "Follow up / reschedule" },
  { key: "interview_complete", label: "Interview complete", tone: "info", nextAction: "Record the decision" },
  { key: "hired", label: "Hired", tone: "success", nextAction: "Hand off to onboarding" },
  { key: "not_hired", label: "Not hired", tone: "muted", nextAction: "Archived — no action" },
  { key: "unqualified", label: "Unqualified", tone: "muted", nextAction: "Archived — no action" },
  { key: "canceled", label: "Canceled", tone: "destructive", nextAction: "Follow up / reschedule" },
];
const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.key, s]));

const toneClasses: Record<string, string> = {
  info: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  success: "bg-success/15 text-success border-success/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  muted: "bg-muted text-muted-foreground border-border",
};

function stageBadge(stage: string) {
  const m = STAGE_META[stage];
  return <Badge variant="outline" className={toneClasses[m?.tone ?? "muted"]}>{m?.label ?? stage}</Badge>;
}

const HEADHUNTER_ORIGIN = (import.meta.env.VITE_HEADHUNTER_URL || "https://headhunter-sand.vercel.app").replace(/\/$/, "");

export default function Interviews() {
  const [stageFilter, setStageFilter] = useState<string>("open");
  const [q, setQ] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PipelineResponse>({
    queryKey: ["interviews-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("interviews-pipeline");
      if (error) throw error;
      return data as PipelineResponse;
    },
    staleTime: 60_000,
  });

  const applicants = data?.applicants ?? [];
  const counts = data?.counts ?? {};

  // "Open" = everything still in motion; the terminal outcomes are hidden by
  // default so the working board is the appointments that need action.
  const OPEN = ["appointment_set", "confirmed", "rescheduled", "no_show", "interview_complete"];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return applicants.filter((a) => {
      const inStage =
        stageFilter === "all" ? true :
        stageFilter === "open" ? OPEN.includes(a.stage) :
        a.stage === stageFilter;
      if (!inStage) return false;
      if (!term) return true;
      return [a.name, a.company, a.email, a.phone, a.instagram].some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [applicants, stageFilter, q]);

  const openCount = applicants.filter((a) => OPEN.includes(a.stage)).length;

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-6xl">
      <PageHeader
        eyebrow="Recruiting · Interviews"
        eyebrowIcon={<CalendarClock className="h-3 w-3" />}
        title="Interviews"
        subtitle={
          <>
            Every interview in the pipeline — stage, owner and next action, native to APEX.
            {data && <> · {data.total.toLocaleString()} in pipeline · {openCount} open</>}
          </>
        }
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={`${HEADHUNTER_ORIGIN}`} target="_blank" rel="noopener noreferrer" title="Legacy Headhunter board">
                Legacy board <ExternalLink className="h-3 w-3 ml-1.5" />
              </a>
            </Button>
          </div>
        }
      />

      {/* Stage summary — the Control Tower's "where is everyone" read at a glance. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { key: "open", label: "Open pipeline", tone: "info" as const, n: openCount },
          ...STAGES.filter((s) => (counts[s.key] ?? 0) > 0 && s.key !== "not_hired").map((s) => ({ key: s.key, label: s.label, tone: s.tone, n: counts[s.key] ?? 0 })),
        ].slice(0, 10).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setStageFilter(c.key)}
            className={`text-left rounded-md border p-3 transition-colors ${stageFilter === c.key ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/30"}`}
          >
            <p className="text-2xl font-bold tabular-nums">{c.n.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{c.label}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, contact…" className="h-9 w-64 pl-8" />
              </div>
              <div className="flex gap-1">
                {[{ key: "open", label: "Open" }, { key: "all", label: "All" }].map((t) => (
                  <Button key={t.key} size="sm" variant={stageFilter === t.key ? "default" : "outline"} onClick={() => setStageFilter(t.key)}>{t.label}</Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {filtered.length.toLocaleString()} shown{data && <> · synced {formatDistanceToNowStrict(new Date(data.generatedAt), { addSuffix: true })}</>}
            </p>
          </div>

          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2"><div className="h-3 w-40 rounded bg-muted animate-pulse" /><div className="h-2.5 w-64 rounded bg-muted/70 animate-pulse" /></div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center text-sm text-destructive">
              Couldn't load the interview pipeline. <button className="underline" onClick={() => refetch()}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No interviews match this view. An appointment moves here the moment it's booked.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((a) => {
                const meta = STAGE_META[a.stage];
                const owner = a.va_name || a.recruiter_name;
                const appt = a.appointment_at ? new Date(a.appointment_at) : null;
                const overdue = appt && isPast(appt) && OPEN.includes(a.stage) && a.stage !== "interview_complete";
                return (
                  <div key={a.id} className="grid grid-cols-1 gap-3 p-3 hover:bg-muted/10 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{a.name || "Unnamed applicant"}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {a.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{a.company}</span>}
                        {a.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{a.phone}</span>}
                        {a.instagram && <span className="inline-flex items-center gap-1"><Instagram className="h-3 w-3" />{a.instagram.replace(/^@?/, "@")}</span>}
                      </div>
                    </div>
                    <div className="text-xs">
                      <p className={`inline-flex items-center gap-1 ${overdue ? "text-warning font-medium" : "text-muted-foreground"}`}>
                        <CalendarClock className="h-3 w-3" />
                        {appt ? format(appt, "EEE MMM d · h:mma") : "No time set"}
                        {overdue && " · overdue"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 md:items-end">
                      {stageBadge(a.stage)}
                      <span className="text-[11px] text-muted-foreground">{meta?.nextAction ?? "—"}</span>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-muted-foreground uppercase tracking-wider text-[10px]">Owner</p>
                      <p className="font-medium">{owner || "Unassigned"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
