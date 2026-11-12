// Performance bot (MP-PERF-BOT, 2026-11-12). Sam's goal: every licensed agent at $20,000 a month in
// production, $25,000 as the target. This page is the bot's read-out: who is on pace, who is silent, which
// lead types and lead lists actually yield, which agents past 90 days have no downline and why, and which
// deals never got a real policy number. One admin-gated function, perf_bot_summary(), supplies all of it;
// the same numbers feed the daily digest the bot pushes to Sam's phone. No model is called anywhere.
// Agency figures are production (annual premium), never income.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Gauge, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { formatTimeAgo } from "@/lib/dateUtils";
import { LEAD_TYPE_LABEL } from "@/lib/leadTypes";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

interface AgentRow {
  id: string; name: string; segment: "producing" | "licensed_silent" | "unlicensed"; mtd: number; projected: number; d30: number;
  deals_30d: number; ticket: number | null; gap_to_floor: number; deals_to_floor: number | null; last_deal: string | null; tenure_days: number;
}
interface Summary {
  generated_at: string;
  goal: {
    floor: number; target: number; month_start: string; day: number; days_in_month: number; active_agents: number; licensed_active: number;
    producing_30d: number; licensed_silent: number; at_floor_mtd: number; at_target_mtd: number; on_pace_floor: number; mtd_total: number;
    projected_total: number; floor_potential: number; avg_per_producer_30d: number;
  };
  agents: AgentRow[];
  lead_types: { lead_type: string; deals: number; ap: number; avg_ticket: number | null; from_form: number }[];
  lead_lists: { list: string; lead_type: string; leads_in_file: number; deals: number; ap: number; deals_per_1000: number; ap_per_lead: number }[];
  downline: {
    agents_90d_plus: number; no_downline: number; by_reason: { not_producing: number; no_applicants: number; applicants_not_hired: number };
    rows: { id: string; name: string; tenure_days: number; d90: number; applicants_90d: number; reason: string }[];
  };
  policy: {
    native_flagged: number; native_flagged_ap: number; native_short: number; import_placeholder: number; import_placeholder_ap: number;
    returned: number; returned_ap: number; grace_days: number;
    recent: { deal_id: string; agent: string | null; policy_number: string; grade: string; ap: number; posted: string; returned: boolean }[];
  };
  freshness: { origin: string; days_dark: number; verdict: string }[];
  findings: { kind: string; severity: "info" | "warn" | "high"; headline: string; dollars: number | null }[];
  findings_date: string | null;
  last_run: { ran_at: string; ok: boolean; error: string | null } | null;
  alerts_on: boolean;
}

const usd = (n: number | null | undefined): string => (n == null ? "–" : `$${Math.round(n).toLocaleString("en-US")}`);
const num = (n: number | null | undefined): string => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const SEG: Record<AgentRow["segment"], { label: string; tone: Tone }> = {
  producing: { label: "Producing", tone: "good" },
  licensed_silent: { label: "Licensed, no deals in 30 days", tone: "hot" },
  unlicensed: { label: "Not licensed", tone: "slate" },
};
const SEV: Record<string, Tone> = { high: "hot", warn: "warm", info: "slate" };
const REASON: Record<string, string> = {
  not_producing: "Not producing", no_applicants: "Never referred an applicant", applicants_not_hired: "Referred applicants, none hired",
};
const GRADE: Record<string, string> = { blank: "Blank", placeholder: "Placeholder number", short: "Very short number" };

async function fetchSummary(): Promise<Summary> {
  const { data, error } = await supabase.rpc("perf_bot_summary");
  if (error) throw error;
  if (!data) throw new Error("The performance bot is for the owner's login.");
  return data as unknown as Summary;
}

function Tile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", TONE_CLASS[tone].border)}>
      <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ id, title, children, note }: { id: string; title: string; children: React.ReactNode; note?: string }) {
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="mb-2 text-lg font-bold tracking-tight">{title}</h2>
      {children}
      {note && <p className="mt-2 text-[13px] text-muted-foreground">{note}</p>}
    </section>
  );
}

export default function PerformanceBot() {
  usePageTitle("Performance bot");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["perf-bot"], queryFn: fetchSummary, staleTime: 5 * 60_000 });
  const [view, setView] = useState<"producing" | "silent" | "all">("producing");
  const [showAll, setShowAll] = useState(false);
  const s = q.data;

  const agents = useMemo(() => {
    const rows = s?.agents ?? [];
    const f = view === "producing" ? rows.filter((a) => a.segment === "producing") : view === "silent" ? rows.filter((a) => a.segment === "licensed_silent") : rows;
    return showAll ? f : f.slice(0, 12);
  }, [s, view, showAll]);
  const agentTotal = useMemo(() => {
    const rows = s?.agents ?? [];
    return view === "producing" ? rows.filter((a) => a.segment === "producing").length : view === "silent" ? rows.filter((a) => a.segment === "licensed_silent").length : rows.length;
  }, [s, view]);

  const stale = (s?.freshness ?? []).some((f) => f.origin === "apex_native" && (f.verdict === "DARK" || f.verdict === "DYING"));
  const g = s?.goal;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="Owner"
        icon={<Gauge />}
        tone="gold"
        title="Performance bot"
        subtitle="Every licensed agent at $20,000 a month in production. The target is $25,000."
        secondaryActions={<Button variant="outline" className="h-11" onClick={() => void qc.invalidateQueries({ queryKey: ["perf-bot"] })} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>}
      />

      {q.isError && (
        <EmptyState variant="warning" icon={<AlertTriangle />} title="The numbers did not load" description={(q.error as Error)?.message ?? "Try again."}
          actions={<Button variant="outline" className="h-11" onClick={() => void q.refetch()}>Try again</Button>} />
      )}
      {q.isLoading && <Skeleton className="h-64 w-full" />}

      {s && g && (
        <>
          {stale && (
            <p role="status" className="mb-4 rounded-xl border border-tone-hot/35 bg-tone-hot/10 p-3 text-[15px] font-semibold">
              Native production has stopped posting, so every number here may read low until it resumes.
            </p>
          )}

          <Section id="pb-goal" title="This month" note={`Production is annual premium posted since ${g.month_start}, Arizona time. Pace is the month so far scaled to ${g.days_in_month} days. It is production, not income.`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label={`On pace for ${usd(g.floor)}`} value={`${g.on_pace_floor} of ${g.licensed_active}`} sub="licensed agents" tone={g.on_pace_floor * 2 >= g.licensed_active ? "good" : "hot"} />
              <Tile label="Producing, last 30 days" value={num(g.producing_30d)} sub={`of ${g.active_agents} active agents`} tone="warm" />
              <Tile label="Licensed, no deals in 30 days" value={num(g.licensed_silent)} sub="the biggest lever" tone={g.licensed_silent > 0 ? "hot" : "good"} />
              <Tile label="Average per producer, 30 days" value={usd(g.avg_per_producer_30d)} sub={`goal ${usd(g.floor)}`} tone="gold" />
              <Tile label="Month so far" value={usd(g.mtd_total)} sub={`day ${g.day} of ${g.days_in_month}`} />
              <Tile label="Projected month" value={usd(g.projected_total)} sub="at the current pace" />
              <Tile label={`If every licensed agent hit ${usd(g.floor)}`} value={usd(g.floor_potential)} sub="the size of the gap" tone="gold" />
              <Tile label={`At ${usd(g.target)} target`} value={num(g.at_target_mtd)} sub="agents so far this month" />
            </div>
          </Section>

          <Section id="pb-find" title="What the bot found" note={s.last_run ? `Last run ${formatTimeAgo(s.last_run.ran_at)}${s.last_run.ok ? "" : ", and it failed: " + (s.last_run.error ?? "no reason recorded")}. It runs daily at 8:30 AM Arizona time and pushes the top three to your phone${s.alerts_on ? "" : " (pushes are off)"}.` : "The bot has not run yet. It runs daily at 8:30 AM Arizona time."}>
            {s.findings.length === 0 ? (
              <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">No findings yet. They appear after the first run.</p>
            ) : (
              <ul className="space-y-2">
                {s.findings.map((f, i) => (
                  <li key={`${f.kind}-${i}`} className="flex items-start gap-2 rounded-xl border border-border/60 bg-card p-3">
                    <TonePill tone={SEV[f.severity] ?? "slate"}>{f.severity === "high" ? "Big" : f.severity === "warn" ? "Watch" : "Note"}</TonePill>
                    <p className="text-[15px]">{f.headline}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="pb-agents" title="Agents against the floor" note="Deals to floor is how many more deals at the agent's own average ticket reach the floor at the current pace.">
            <div className="mb-2 flex flex-wrap gap-2">
              {([["producing", "Producing"], ["silent", "Licensed, silent"], ["all", "All active"]] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setShowAll(false); }}
                  className={cn("h-11 rounded-full border px-4 text-[15px] font-semibold", view === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>{label}</button>
              ))}
            </div>
            {agents.length === 0 ? <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">No agents in this view.</p> : (
              <ul className="space-y-2">
                {agents.map((a) => (
                  <li key={a.id} className="rounded-xl border border-border/60 bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[15px] font-bold">{a.name}</p>
                      <TonePill tone={SEG[a.segment].tone}>{SEG[a.segment].label}</TonePill>
                    </div>
                    <p className="mt-1 text-[15px] tabular-nums">
                      {usd(a.mtd)} so far · {usd(a.projected)} projected · {a.deals_30d} deal{a.deals_30d === 1 ? "" : "s"} in 30 days
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      {a.segment === "licensed_silent"
                        ? `${a.tenure_days} days in${a.last_deal ? `, last deal ${a.last_deal}` : ", no deal in 90 days"}.`
                        : a.projected >= g.floor ? `On pace for ${usd(g.floor)}.` : a.deals_to_floor != null ? `About ${a.deals_to_floor} more deals at ${usd(a.ticket)} each reaches ${usd(g.floor)}.` : `No average ticket yet.`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {agentTotal > 12 && <Button variant="ghost" className="mt-2 h-11 w-full" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${agentTotal}`}</Button>}
          </Section>

          <Section id="pb-types" title="Lead types" note="From the lead-type tap on each deal since it became required today; older deals are typed by matching the client's phone to the lead warehouse. Unknown means neither. Last 180 days.">
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
              <table className="w-full min-w-[460px] text-left text-[15px]">
                <thead className="text-[13px] text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Deals</th><th className="px-3 py-2 font-semibold">Production</th><th className="px-3 py-2 font-semibold">Avg ticket</th><th className="px-3 py-2 font-semibold">Tapped</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {s.lead_types.map((t) => (
                    <tr key={t.lead_type}>
                      <td className="px-3 py-2 font-semibold">{t.lead_type === "unknown" ? "Unknown" : LEAD_TYPE_LABEL[t.lead_type] ?? t.lead_type}</td>
                      <td className="px-3 py-2 tabular-nums">{num(t.deals)}</td><td className="px-3 py-2 tabular-nums">{usd(t.ap)}</td>
                      <td className="px-3 py-2 tabular-nums">{usd(t.avg_ticket)}</td><td className="px-3 py-2 tabular-nums">{num(t.from_form)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="pb-lists" title="Which lead lists yield" note="Deals that share a phone number with a lead in that list. It is yield per 1,000 leads, not a close rate: the warehouse has no dial counts, and a match can also be an existing client who was on the list.">
            {s.lead_lists.length === 0 ? <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">No data yet.</p> : (
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
                <table className="w-full min-w-[560px] text-left text-[15px]">
                  <thead className="text-[13px] text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">List</th><th className="px-3 py-2 font-semibold">Leads</th><th className="px-3 py-2 font-semibold">Deals</th><th className="px-3 py-2 font-semibold">Per 1,000</th><th className="px-3 py-2 font-semibold">Production per lead</th></tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {s.lead_lists.map((l) => (
                      <tr key={l.list}>
                        <td className="px-3 py-2 font-semibold">{l.list} <span className="font-normal text-muted-foreground">· {LEAD_TYPE_LABEL[l.lead_type] ?? l.lead_type}</span></td>
                        <td className="px-3 py-2 tabular-nums">{num(l.leads_in_file)}</td><td className="px-3 py-2 tabular-nums">{num(l.deals)}</td>
                        <td className="px-3 py-2 font-bold tabular-nums">{l.deals_per_1000}</td><td className="px-3 py-2 tabular-nums">${l.ap_per_lead}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="pb-down" title="Downline after 90 days" note="Agents active at least 90 days with no one under them, and why. Referred means an applicant who named them in the last 90 days.">
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Agents past 90 days" value={num(s.downline.agents_90d_plus)} />
              <Tile label="With no downline" value={num(s.downline.no_downline)} tone={s.downline.no_downline > 0 ? "warm" : "good"} />
              <Tile label="Not producing" value={num(s.downline.by_reason.not_producing)} />
              <Tile label="Never referred anyone" value={num(s.downline.by_reason.no_applicants)} />
            </div>
            {s.downline.rows.length > 0 && (
              <ul className="space-y-2">
                {s.downline.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card p-3">
                    <div><p className="text-[15px] font-bold">{r.name}</p><p className="text-[13px] text-muted-foreground">{r.tenure_days} days in · {usd(r.d90)} in 90 days · {r.applicants_90d} referred</p></div>
                    <TonePill tone={r.reason === "not_producing" ? "hot" : "warm"}>{REASON[r.reason] ?? r.reason}</TonePill>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="pb-policy" title="Deals without a real policy number" note={`Agent-posted deals with a blank or made-up number go back to the agent's leads after ${s.policy.grace_days} days so they get chased. The deal itself is never deleted or changed. ${s.policy.import_placeholder} AgentLink imports (${usd(s.policy.import_placeholder_ap)}) also carry placeholder numbers; they are historical sales, so they are flagged here and left alone.`}>
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Agent-posted, no real number" value={num(s.policy.native_flagged)} sub={usd(s.policy.native_flagged_ap)} tone={s.policy.native_flagged > 0 ? "warm" : "good"} />
              <Tile label="Back in the agent's leads" value={num(s.policy.returned)} sub={usd(s.policy.returned_ap)} />
              <Tile label="Very short numbers" value={num(s.policy.native_short)} sub="worth a look" />
              <Tile label="AgentLink imports" value={num(s.policy.import_placeholder)} sub="flagged only" />
            </div>
            {s.policy.recent.length > 0 && (
              <ul className="space-y-2">
                {s.policy.recent.map((r) => (
                  <li key={r.deal_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card p-3">
                    <div><p className="text-[15px] font-bold">{r.agent ?? "Unknown agent"}</p><p className="text-[13px] text-muted-foreground">{usd(r.ap)} · posted {r.posted} · number “{r.policy_number}”</p></div>
                    <div className="flex gap-2"><TonePill tone="warm">{GRADE[r.grade] ?? r.grade}</TonePill>{r.returned && <TonePill tone="good">In their leads</TonePill>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
