import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { CalendarClock, Search, RefreshCw, Phone, MessageSquare, Mail, ExternalLink, Building2, Instagram } from "lucide-react";
import { format, formatDistanceToNowStrict, isPast, differenceInCalendarDays } from "date-fns";

type Applicant = {
  id: string; name: string | null; phone: string | null; email: string | null;
  instagram: string | null; company: string | null; appointment_at: string | null;
  stage: string; interview_result: string | null; unqualified_reason: string | null;
  notes: string | null; reschedule_count: number | null; va_name: string | null;
  recruiter_name: string | null; created_at: string | null; updated_at: string | null;
};
type PipelineResponse = { applicants: Applicant[]; counts: Record<string, number>; total: number; role: string | null; generatedAt: string };

const STAGE_META: Record<string, { label: string }> = {
  appointment_set: { label: "Appointment set" }, confirmed: { label: "Confirmed" },
  rescheduled: { label: "Rescheduled" }, no_show: { label: "No-show" },
  interview_complete: { label: "Interview complete" }, hired: { label: "Hired" },
  not_hired: { label: "Not hired" }, unqualified: { label: "Unqualified" }, canceled: { label: "Canceled" },
};
const OPEN = ["appointment_set", "confirmed", "rescheduled", "no_show", "interview_complete"];
const HEADHUNTER_ORIGIN = (import.meta.env.VITE_HEADHUNTER_URL || "https://headhunter-sand.vercel.app").replace(/\/$/, "");

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// The queue's status pill for one applicant — dot color + label + timing line,
// exactly like the APEX Shell queue template (Overdue red · Up next amber ·
// Confirmed green · Callback amber).
function statusOf(a: Applicant, now: Date): { tone: string; dot: string; label: string; timing: string } {
  const appt = a.appointment_at ? new Date(a.appointment_at) : null;
  if (a.stage === "hired") return { tone: "text-success", dot: "bg-success", label: "Hired", timing: "handed to onboarding" };
  if (a.stage === "interview_complete") return { tone: "text-primary", dot: "bg-primary", label: "Interviewed", timing: "record the decision" };
  if (a.stage === "no_show") return { tone: "text-warning", dot: "bg-warning", label: "No-show", timing: "follow up / reschedule" };
  if (a.stage === "rescheduled") return { tone: "text-warning", dot: "bg-warning", label: "Rescheduled", timing: appt ? format(appt, "EEE MMM d · h:mma") : "re-confirm time" };
  if (appt && isPast(appt) && OPEN.includes(a.stage)) {
    const days = Math.abs(differenceInCalendarDays(now, appt));
    return { tone: "text-destructive", dot: "bg-destructive", label: "Overdue", timing: `${days} day${days === 1 ? "" : "s"} · ${a.reschedule_count ? `${a.reschedule_count} reschedule${a.reschedule_count === 1 ? "" : "s"}` : "no follow-up"}` };
  }
  if (appt) return { tone: "text-primary", dot: "bg-primary", label: a.stage === "confirmed" ? "Confirmed" : "Up next", timing: format(appt, "EEE MMM d · h:mma") };
  return { tone: "text-muted-foreground", dot: "bg-muted-foreground", label: STAGE_META[a.stage]?.label ?? a.stage, timing: "no time set" };
}

export default function Interviews() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"open" | "overdue" | "upcoming" | "all">("open");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PipelineResponse>({
    queryKey: ["interviews-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("interviews-pipeline");
      if (error) throw error;
      return data as PipelineResponse;
    },
    staleTime: 60_000,
  });

  const now = useMemo(() => new Date(), []);
  const applicants = data?.applicants ?? [];
  const counts = data?.counts ?? {};

  const overdue = applicants.filter((a) => a.appointment_at && isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage) && a.stage !== "interview_complete");
  const upcoming = applicants.filter((a) => a.appointment_at && !isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage));
  const openAll = applicants.filter((a) => OPEN.includes(a.stage));

  const kpis = [
    { label: "In pipeline", value: data?.total ?? 0, tone: "" },
    { label: "Open", value: openAll.length, tone: "text-primary" },
    { label: "Overdue", value: overdue.length, tone: "text-destructive" },
    { label: "Upcoming", value: upcoming.length, tone: "text-primary" },
    { label: "Interviewed", value: counts["interview_complete"] ?? 0, tone: "" },
    { label: "Hired", value: counts["hired"] ?? 0, tone: "text-success" },
  ];

  const source = (tab === "overdue" ? overdue : tab === "upcoming" ? upcoming : tab === "all" ? applicants : openAll);
  const term = q.trim().toLowerCase();
  const filtered = term
    ? source.filter((a) => [a.name, a.company, a.email, a.phone, a.instagram].some((v) => (v ?? "").toLowerCase().includes(term)))
    : source;

  // Group into the template's sections.
  const groups: { key: string; title: string; sub: string; rows: Applicant[]; danger?: boolean }[] = [
    { key: "overdue", title: "Overdue", sub: "appointment passed, still open", rows: filtered.filter((a) => a.appointment_at && isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage) && a.stage !== "interview_complete"), danger: true },
    { key: "upcoming", title: "Upcoming", sub: "confirmed & scheduled", rows: filtered.filter((a) => a.appointment_at && !isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage)) },
    { key: "other", title: "Needs a decision / no time", sub: "interviewed or unscheduled", rows: filtered.filter((a) => !((a.appointment_at && isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage) && a.stage !== "interview_complete") || (a.appointment_at && !isPast(new Date(a.appointment_at)) && OPEN.includes(a.stage)))) },
  ].filter((g) => g.rows.length > 0);

  const tel = (p: string | null) => p ? `tel:${p.replace(/[^\d+]/g, "")}` : undefined;
  const sms = (p: string | null) => p ? `sms:${p.replace(/[^\d+]/g, "")}` : undefined;

  return (
    <div className="space-y-5 p-4 md:p-6 page-enter max-w-6xl">
      <PageHeader
        eyebrow="Recruiting · Interviews"
        eyebrowIcon={<CalendarClock className="h-3 w-3" />}
        title="Interviews"
        subtitle={<>Live queue{data && <> · as of {format(now, "h:mm a")} · {data.total.toLocaleString()} in pipeline</>}</>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
            <Button asChild size="sm" variant="ghost"><a href={HEADHUNTER_ORIGIN} target="_blank" rel="noopener noreferrer">Legacy board <ExternalLink className="h-3 w-3 ml-1.5" /></a></Button>
          </div>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-md border border-border bg-card p-3">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value.toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the queue…" className="h-9 w-72 pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([["open", "Open"], ["overdue", "Overdue"], ["upcoming", "Upcoming"], ["all", "All"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tab === k ? (k === "overdue" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground") : "border border-border text-muted-foreground hover:bg-muted/40"}`}>
              {l}{k === "overdue" && overdue.length > 0 ? ` ${overdue.length}` : ""}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-lg border border-border bg-muted/20 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-destructive">Couldn't load the queue. <button className="underline" onClick={() => refetch()}>Retry</button></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">Nothing in this view. An appointment moves here the moment it's booked.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className={`text-sm font-bold ${g.danger ? "text-destructive" : "text-foreground"}`}>{g.title}</h3>
                <span className="text-xs text-muted-foreground">{g.sub}</span>
                <Badge variant="outline" className={g.danger ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-muted text-muted-foreground border-border"}>{g.rows.length} waiting</Badge>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                {g.rows.map((a, i) => {
                  const s = statusOf(a, now);
                  return (
                    <div key={a.id} className={`grid grid-cols-[190px_1fr_auto] items-center gap-4 p-3 ${i > 0 ? "border-t border-border" : ""} hover:bg-muted/10`}>
                      <div className="text-xs">
                        <p className={`inline-flex items-center gap-1.5 font-medium ${s.tone}`}><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</p>
                        <p className="mt-0.5 text-muted-foreground">{s.timing}</p>
                      </div>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">{initials(a.name)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{a.name || "Unnamed"}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {a.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{a.company}</span>}
                            {a.instagram && <span className="inline-flex items-center gap-1"><Instagram className="h-3 w-3" />{a.instagram.replace(/^@?/, "@")}</span>}
                            {a.va_name && <span>· {a.va_name}</span>}
                            <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px]">{STAGE_META[a.stage]?.label ?? a.stage}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button asChild size="icon" className="h-9 w-9" disabled={!a.phone}><a href={tel(a.phone)} aria-label="Call"><Phone className="h-4 w-4" /></a></Button>
                        <Button asChild size="icon" variant="outline" className="h-9 w-9" disabled={!a.phone}><a href={sms(a.phone)} aria-label="Text"><MessageSquare className="h-4 w-4" /></a></Button>
                        <Button asChild size="icon" variant="outline" className="h-9 w-9" disabled={!a.email}><a href={a.email ? `mailto:${a.email}` : undefined} aria-label="Email"><Mail className="h-4 w-4" /></a></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
