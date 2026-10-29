// CallTraining — My Business → Call Training (MP-310, 2026-10-28).
//
// Every transcribed ReadyMode call (sold, objections, appointments, give-ups, Spanish) graded on one
// rubric (opening / discovery / presentation / objection handling / close / compliance), with the
// objection moments, the lines a trainer would play, the tactics worth teaching and a coaching note.
// Sam asked for the outliers: the great calls, highlighted, as a training metric. Great calls come
// first; "Needs coaching" lists the compliance and weak-close flags. Sam + Aisha only, like Sold Calls:
// v_call_training and v_call_training_agents are security_invoker over tables gated by
// can_view_sold_calls(), so anyone else reads zero rows. Grades are written by
// ~/business-ops/readymode-bot/scripts/grade-calls.py on the hourly bot (readymode_call_analysis, model grade-v1).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Search, Star, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { looseSupabase } from "@/lib/looseSupabase";
import { useAuth } from "@/hooks/useAuth";
import { SOLD_CALL_EXTRA_UID } from "@/hooks/useSoldCallKeys";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CallAudioPlayer } from "@/components/calls/CallAudioPlayer";
import { TrainingLibrary } from "@/components/calltraining/TrainingLibrary";
import { momentsFrom } from "@/lib/callAudio";
import { cn } from "@/lib/utils";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { DialerActivityCard } from "@/components/calltraining/DialerActivityCard";

interface ObjectionMoment { t: string; objection: string; response: string; technique: string; worked: boolean }
interface KeyQuote { t: string; who: "agent" | "client"; quote: string }
interface GradedCall {
  analysis_id: string;
  call_id: string;
  external_call_id: string | null;
  call_started_at: string | null;
  disposition: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  lead_first_name: string | null;
  overall_score: number | null;
  scores: Record<string, number> | null;
  stage_reached: string | null;
  outcome_quality: string | null;
  great_call: boolean;
  training_tags: string[] | null;
  tactics: string[] | null;
  strengths: string[] | null;
  improvements: string[] | null;
  objection_moments: ObjectionMoment[] | null;
  key_quotes: KeyQuote[] | null;
  coaching_priority: string | null;
  coaching_notes: string | null;
  compliance_flags: string[] | null;
  sentiment: string | null;
  summary: string | null;
  has_packet: boolean;
}
interface AgentRow {
  agent_name: string | null;
  calls_total: number;
  sold: number;
  graded: number;
  avg_score: number | null;
  great_calls: number;
  avg_objection_handling: number | null;
  avg_close: number | null;
  urgent_flags: number;
}

const VIEWS: Array<{ key: string; label: string }> = [
  { key: "great", label: "Great calls" },
  { key: "objections", label: "Objections turned" },
  { key: "coaching", label: "Needs coaching" },
  { key: "sold", label: "Sold calls" },
  { key: "all", label: "All graded" },
];
const RUBRIC: Array<{ key: string; label: string }> = [
  { key: "opening", label: "Opening" },
  { key: "discovery", label: "Discovery" },
  { key: "presentation", label: "Presentation" },
  { key: "objection_handling", label: "Objections" },
  { key: "close", label: "Close" },
  { key: "compliance", label: "Compliance" },
];
const mmss = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const isTalk = (c: GradedCall) => c.stage_reached !== "voicemail" && c.stage_reached !== "no_contact";
const scoreTone = (n: number | null) =>
  n == null ? "text-muted-foreground" : n >= 80 ? "text-emerald-700 dark:text-emerald-300" : n >= 60 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";

/** ReadyMode appends " (deleted)" to removed users; it is not part of anyone's name. */
const cleanAgentName = (name: string | null) => (name ? name.replace(/\s*\(deleted\)\s*$/i, "").trim() || name : name);
/** A leaderboard place needs a real sample: one great call should not outrank eleven graded ones. */
const MIN_RANKED = 3;

async function fetchGraded(): Promise<GradedCall[]> {
  const { data, error } = await (looseSupabase
    .from("v_call_training")
    .select("*")
    .order("overall_score", { ascending: false, nullsFirst: false })
    .limit(600) as unknown as Promise<{ data: GradedCall[] | null; error: Error | null }>);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, agent_name: cleanAgentName(r.agent_name) }));
}
async function fetchAgents(): Promise<AgentRow[]> {
  const { data, error } = await (looseSupabase
    .from("v_call_training_agents")
    .select("*")
    .order("avg_score", { ascending: false, nullsFirst: false }) as unknown as Promise<{ data: AgentRow[] | null; error: Error | null }>);
  if (error) throw error;
  return (data ?? [])
    .filter((a) => a.graded > 0)
    .map((a) => ({ ...a, agent_name: cleanAgentName(a.agent_name) }))
    .sort((x, y) => Number(y.graded >= MIN_RANKED) - Number(x.graded >= MIN_RANKED) || (y.avg_score ?? -1) - (x.avg_score ?? -1) || y.graded - x.graded);
}

export default function CallTraining() {
  const { isAdmin, user } = useAuth();
  const canView = !!isAdmin || user?.id === SOLD_CALL_EXTRA_UID;
  usePageTitle("Call Training");
  const q = useQuery({ queryKey: ["call-training"], queryFn: fetchGraded, staleTime: 60_000, enabled: canView });
  const agentsQ = useQuery({ queryKey: ["call-training-agents"], queryFn: fetchAgents, staleTime: 60_000, enabled: canView });
  const [view, setView] = useState("great");
  const [agent, setAgent] = useState("all");
  const [tag, setTag] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);

  const rows = useMemo(() => q.data ?? [], [q.data]);
  const talk = useMemo(() => rows.filter(isTalk), [rows]);
  const agentNames = useMemo(() => Array.from(new Set(rows.map((r) => r.agent_name).filter(Boolean) as string[])).sort(), [rows]);
  const tags = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.training_tags ?? []))).sort(), [rows]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (view === "great") return r.great_call;
        if (view === "objections") return (r.objection_moments ?? []).some((m) => m.worked);
        if (view === "coaching") return r.coaching_priority === "urgent" || r.coaching_priority === "high";
        if (view === "sold") return r.disposition === "Completed Sale";
        return isTalk(r);
      })
      .filter((r) => agent === "all" || r.agent_name === agent)
      .filter((r) => tag === "all" || (r.training_tags ?? []).includes(tag))
      .filter((r) => !s || [r.agent_name, r.summary, r.coaching_notes, r.lead_first_name, ...(r.tactics ?? [])].some((v) => (v ?? "").toLowerCase().includes(s)));
  }, [rows, view, agent, tag, search]);
  const avg = talk.length ? Math.round(talk.reduce((a, r) => a + (r.overall_score ?? 0), 0) / talk.length) : null;
  const great = rows.filter((r) => r.great_call).length;
  const urgent = rows.filter((r) => r.coaching_priority === "urgent").length;

  // Agents and managers get the team library: training calls with muted audio, no client data, no coaching notes.
  if (!canView) return <TrainingLibrary />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call Training"
        subtitle="Every transcribed dialer call graded on one rubric. Great calls first; play them for the team."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Graded calls" value={talk.length} />
        <Stat label="Great calls" value={great} tone="text-amber-700 dark:text-amber-300" />
        <Stat label="Average score" value={avg == null ? "—" : `${avg}/100`} />
        <Stat label="Urgent flags" value={urgent} tone={urgent ? "text-rose-700 dark:text-rose-300" : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((f) => (
          <Button key={f.key} size="sm" variant={view === f.key ? "default" : "outline"} onClick={() => setView(f.key)}>{f.label}</Button>
        ))}
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent" className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="all">Every agent</option>
          {agentNames.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Training tag" className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="all">Every tag</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agent, tactic, note" className="h-9 pl-8" />
        </div>
      </div>

      <GlassCard className="p-0">
        <button type="button" onClick={() => setShowAgents((v) => !v)} aria-expanded={showAgents} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
          <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Agent scorecard · last 90 days</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", showAgents && "rotate-180")} />
        </button>
        {showAgents && (
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Agent</th><th className="px-2 py-2 text-right">Calls</th><th className="px-2 py-2 text-right">Sold</th>
                  <th className="px-2 py-2 text-right">Graded</th><th className="px-2 py-2 text-right">Avg</th><th className="px-2 py-2 text-right">Great</th>
                  <th className="px-2 py-2 text-right">Objections</th><th className="px-2 py-2 text-right">Close</th><th className="px-2 py-2 text-right">Urgent</th>
                </tr>
              </thead>
              <tbody>
                {(agentsQ.data ?? []).map((a) => (
                  <tr key={a.agent_name ?? "unknown"} className="border-t border-border/40">
                    <td className="px-4 py-2 font-medium">{a.agent_name ?? "Unknown"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.calls_total}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.sold}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.graded}</td>
                    <td className={cn("px-2 py-2 text-right font-semibold tabular-nums", scoreTone(a.avg_score))}>{a.avg_score ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.great_calls}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.avg_objection_handling ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{a.avg_close ?? "—"}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums", a.urgent_flags ? "text-rose-700 dark:text-rose-300" : "")}>{a.urgent_flags}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <DialerActivityCard />

      {q.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={`sk-${i}`} className="h-20 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Grades did not load" description={(q.error as Error).message} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Star className="h-6 w-6" />} title="Nothing here yet" description={rows.length === 0 ? "The grader runs on the hourly ReadyMode bot. Grades appear as transcripts land." : "No graded call matches this view."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const open = openId === r.call_id;
            const moments = r.objection_moments ?? [];
            return (
              <GlassCard key={r.call_id} className={cn("p-0", r.great_call && "border-amber-500/40")}>
                <button type="button" onClick={() => setOpenId(open ? null : r.call_id)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
                  <span className={cn("w-14 text-2xl font-bold tabular-nums", scoreTone(r.overall_score))}>{r.overall_score ?? "—"}</span>
                  {r.great_call && <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-200"><Star className="mr-1 h-3 w-3" /> Great call</Badge>}
                  <span className="font-medium">{r.agent_name || "Unknown agent"}</span>
                  <span className="text-sm text-muted-foreground">{shortDate(r.call_started_at)} · {dispositionLabel(r.disposition)}{r.duration_seconds ? ` · ${mmss(r.duration_seconds)}` : ""}{r.lead_first_name ? ` · ${r.lead_first_name}` : ""}</span>
                  {r.coaching_priority === "urgent" && <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-300">Urgent</Badge>}
                  {moments.some((m) => m.worked) && <Badge variant="outline">Objection turned</Badge>}
                  <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
                  {r.summary && <p className="w-full text-sm text-muted-foreground">{r.summary}</p>}
                </button>
                {open && (
                  <div className="space-y-4 border-t border-border/60 px-4 py-3 text-sm">
                    <CallAudioPlayer callId={r.call_id} moments={[...moments.map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(r.key_quotes)]} />
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {RUBRIC.map((k) => (
                        <span key={k.key} className="text-muted-foreground">{k.label} <span className={cn("font-semibold", scoreTone(r.scores?.[k.key] == null ? null : r.scores[k.key] * 10))}>{r.scores?.[k.key] ?? "—"}</span>/10</span>
                      ))}
                      <span className="text-muted-foreground">Reached <span className="font-semibold text-foreground">{(r.stage_reached ?? "").replace("_", " ")}</span></span>
                      {r.sentiment && <span className="text-muted-foreground">Client ended <span className="font-semibold text-foreground">{r.sentiment}</span></span>}
                    </div>
                    {(r.training_tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">{(r.training_tags ?? []).map((t) => <Badge key={t} variant="outline" className="font-normal">{t}</Badge>)}</div>
                    )}
                    {moments.length > 0 && (
                      <Section title="Objection moments">
                        <ul className="space-y-2">
                          {moments.map((m) => (
                            <li key={`${m.t}-${m.objection}`} className="rounded-md border border-border/60 bg-background/40 p-2">
                              <p><span className="font-mono text-xs text-muted-foreground">[{m.t}]</span> <span className="font-medium">Client:</span> {m.objection}</p>
                              <p className="mt-1"><span className="font-medium">Agent:</span> {m.response}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{m.technique} · {m.worked ? <span className="text-emerald-700 dark:text-emerald-300">moved forward</span> : <span className="text-rose-700 dark:text-rose-300">did not land</span>}</p>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {(r.key_quotes ?? []).length > 0 && (
                      <Section title="Play these lines">
                        <ul className="space-y-1">
                          {(r.key_quotes ?? []).map((k) => (
                            <li key={`${k.t}-${k.quote}`}><span className="font-mono text-xs text-muted-foreground">[{k.t}]</span> <span className="font-medium capitalize">{k.who}:</span> “{k.quote}”</li>
                          ))}
                        </ul>
                      </Section>
                    )}
                    {(r.tactics ?? []).length > 0 && <Section title="Worth teaching"><p>{(r.tactics ?? []).join(" · ")}</p></Section>}
                    {(r.improvements ?? []).length > 0 && (
                      <Section title="Would have made it better"><ul className="list-disc space-y-0.5 pl-5">{(r.improvements ?? []).map((s) => <li key={s}>{s}</li>)}</ul></Section>
                    )}
                    {(r.compliance_flags ?? []).length > 0 && (
                      <Section title="Compliance"><ul className="list-disc space-y-0.5 pl-5 text-rose-700 dark:text-rose-300">{(r.compliance_flags ?? []).map((s) => <li key={s}>{s}</li>)}</ul></Section>
                    )}
                    {r.coaching_notes && <Section title="Coaching note"><p>{r.coaching_notes}</p></Section>}
                    <div className="flex flex-wrap items-center gap-4">
                      {r.disposition === "Completed Sale" && r.has_packet && <Link to="/dashboard/sold-calls" className="text-primary hover:underline">Open in Sold Calls</Link>}
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <GlassCard className="p-4">
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
    </GlassCard>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}
