// CallReviewBoard: the call review at the top of Call Training (MP-310, 2026-10-28).
//
// Sam: "rating best closers, make it easier to review calls and data without having to go through hours of call log
// myself, highlighting drop off and chargeback risk, agents who are leaving a lot of deals on the table, deals that
// could be easily closed by more experienced agents, deals where more coverage is left on the table." Each list reads
// one security_invoker view and loads when opened: Sam and Aisha see the agency, an upline sees their own team (RLS
// through my_downline_agent_ids). Do-not-call numbers are left out of the call lists or shown without a Call link.
import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ChevronDown, Phone } from "lucide-react";
import { looseSupabase } from "@/lib/looseSupabase";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { dispositionLabel } from "@/lib/readymodeDispositions";
import { cn } from "@/lib/utils";

type Key = "closers" | "table" | "slump" | "easy" | "coverage" | "risk";
const SECTIONS: Array<{ key: Key; title: string; blurb: string }> = [
  { key: "closers", title: "Best closers", blurb: "Close rate on calls that reached someone, adjusted for how many of their sales stuck. Tap a name for their coaching." },
  { key: "table", title: "Deals left on the table", blurb: "Warm leads each agent reached (stopped at bank or SSN, booked an appointment, or gave up) that never bought." },
  { key: "slump", title: "Agents in a slump", blurb: "Each agent's last 2 weeks against their own prior 6: closing half as often, or objections climbing. Tap a name for their coaching." },
  { key: "easy", title: "Easy closes for a stronger closer", blurb: "People who got to bank or SSN, or booked an appointment, and never bought. Newest first." },
  { key: "coverage", title: "More coverage left on the table", blurb: "Buyers who also wanted a spouse, mortgage, children or more coverage covered." },
  { key: "risk", title: "Drop-off and chargeback risk", blurb: "Sales that fell off, are lapsing, were declined after SSN and bank, carry a compliance flag, sit pending, or never reached the book." },
];

function rows<T>(p: Promise<unknown>): Promise<T[]> {
  return (p as Promise<{ data: T[] | null; error: Error | null }>).then(({ data, error }) => {
    if (error) throw error;
    return data ?? [];
  });
}
const view = (key: string, fn: () => Promise<unknown[]>) => ({ queryKey: ["call-review", key], queryFn: fn, staleTime: 5 * 60_000 });

function State<T>({ q, empty, children }: { q: UseQueryResult<T[]>; empty: string; children: (rows: T[]) => ReactNode }) {
  if (q.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-rose-700 dark:text-rose-300">This list did not load: {(q.error as Error).message}</p>;
  if (!q.data || q.data.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return <>{children(q.data)}</>;
}
function CallLink({ phone, dnc }: { phone: string | null; dnc?: boolean | null }) {
  if (!phone) return null;
  const href = dnc ? null : phoneHref(phone);
  return href ? (
    <a href={href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{formatPhoneDisplay(phone)}</a>
  ) : (
    <span className="text-muted-foreground">{formatPhoneDisplay(phone)} · asked not to be called</span>
  );
}
const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

interface Closer { agent_name: string | null; reached_all: number | null; sold_all: number | null; close_pct_all: number | null; close_pct_30d: number | null; sold_30d: number | null; fall_off_pct: number | null; sticky_close_score: number | null; avg_grade: number | null; great_calls: number | null }
function Closers({ onPickAgent }: { onPickAgent: (n: string) => void }) {
  const q = useQuery(view("closers", () => rows<Closer>(looseSupabase.from("v_best_closers").select("agent_name, reached_all, sold_all, close_pct_all, close_pct_30d, sold_30d, fall_off_pct, sticky_close_score, avg_grade, great_calls").order("sticky_close_score", { ascending: false, nullsFirst: false }).limit(25)))) as UseQueryResult<Closer[]>;
  return (
    <State q={q} empty="No agent has 50 reached calls yet.">
      {(list) => (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1 pr-2">Agent</th><th className="px-2 text-right">Close rate</th><th className="px-2 text-right">Last 30 days</th><th className="px-2 text-right">Sales that stuck</th><th className="px-2 text-right">Avg grade</th><th className="px-2 text-right">Great calls</th></tr>
          </thead>
          <tbody>
            {list.filter((r) => r.sticky_close_score != null).map((r) => (
              <tr key={r.agent_name ?? "unknown"} className="border-t border-border/40">
                <td className="py-1.5 pr-2"><button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => r.agent_name && onPickAgent(r.agent_name)}>{r.agent_name}</button></td>
                <td className="px-2 text-right tabular-nums">{r.close_pct_all ?? ""}% <span className="text-xs text-muted-foreground">{r.sold_all}/{r.reached_all}</span></td>
                <td className="px-2 text-right tabular-nums">{r.close_pct_30d == null ? "" : `${r.close_pct_30d}%`} <span className="text-xs text-muted-foreground">{r.sold_30d ?? 0} sold</span></td>
                <td className="px-2 text-right tabular-nums">{r.fall_off_pct == null ? "" : `${Math.round(100 - Number(r.fall_off_pct))}%`}</td>
                <td className="px-2 text-right tabular-nums">{r.avg_grade ?? ""}</td>
                <td className="px-2 text-right tabular-nums">{r.great_calls ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </State>
  );
}

interface LeftRow { agent_name: string | null; warm_not_sold: number | null; stopped_at_bank: number | null; stopped_at_ssn: number | null; gave_up: number | null; appointment_not_sold: number | null; last_30d: number | null }
function LeftOnTable({ onPickAgent }: { onPickAgent: (n: string) => void }) {
  const q = useQuery(view("table", () => rows<LeftRow>(looseSupabase.from("v_deals_left_on_table").select("agent_name, warm_not_sold, stopped_at_bank, stopped_at_ssn, gave_up, appointment_not_sold, last_30d").order("warm_not_sold", { ascending: false }).limit(25)))) as UseQueryResult<LeftRow[]>;
  return (
    <State q={q} empty="No warm leads left unsold.">
      {(list) => (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1 pr-2">Agent</th><th className="px-2 text-right">Warm, never bought</th><th className="px-2 text-right">At bank</th><th className="px-2 text-right">At SSN</th><th className="px-2 text-right">Gave up</th><th className="px-2 text-right">Appointment</th><th className="px-2 text-right">Last 30 days</th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.agent_name ?? "unknown"} className="border-t border-border/40">
                <td className="py-1.5 pr-2"><button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => r.agent_name && onPickAgent(r.agent_name)}>{r.agent_name}</button></td>
                <td className="px-2 text-right font-semibold tabular-nums">{r.warm_not_sold}</td>
                <td className="px-2 text-right tabular-nums">{r.stopped_at_bank}</td>
                <td className="px-2 text-right tabular-nums">{r.stopped_at_ssn}</td>
                <td className="px-2 text-right tabular-nums">{r.gave_up}</td>
                <td className="px-2 text-right tabular-nums">{r.appointment_not_sold}</td>
                <td className="px-2 text-right tabular-nums">{r.last_30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </State>
  );
}

interface SlumpRow { agent_name: string | null; verdict: string | null; recent_contacts: number | null; recent_close_pct: number | null; base_close_pct: number | null; recent_objection_pct: number | null; base_objection_pct: number | null; top_objection: string | null }
const VERDICT: Record<string, string> = {
  slump_objections: "Closing half as often, and objections are up",
  slump: "Closing half as often",
  objections_rising: "Objections rising",
  steady: "Steady",
  new: "New: not enough history",
  too_few_calls: "Under 20 conversations in 2 weeks",
};
const TOP: Record<string, string> = { bank: "bank details", ssn: "SSN", gave_up: "agent gave up" };
const RANK: Record<string, number> = { slump_objections: 0, slump: 1, objections_rising: 2, steady: 3, new: 4, too_few_calls: 5 };
function Slumps({ onPickAgent }: { onPickAgent: (n: string) => void }) {
  const q = useQuery(view("slump", () => rows<SlumpRow>(looseSupabase.from("v_agent_slump").select("agent_name, verdict, recent_contacts, recent_close_pct, base_close_pct, recent_objection_pct, base_objection_pct, top_objection").order("recent_contacts", { ascending: false }).limit(80)))) as UseQueryResult<SlumpRow[]>;
  return (
    <State q={q} empty="No dialer activity in the last 8 weeks.">
      {(list) => (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1 pr-2">Agent</th><th className="px-2">Trend</th><th className="px-2 text-right">Close, last 2 weeks</th><th className="px-2 text-right">Before</th><th className="px-2 text-right">Objections now / before</th><th className="px-2">Top objection</th></tr>
          </thead>
          <tbody>
            {[...list].sort((a, b) => (RANK[a.verdict ?? ""] ?? 9) - (RANK[b.verdict ?? ""] ?? 9)).map((r) => (
              <tr key={r.agent_name ?? "unknown"} className="border-t border-border/40">
                <td className="py-1.5 pr-2"><button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => r.agent_name && onPickAgent(r.agent_name)}>{r.agent_name}</button></td>
                <td className={cn("px-2", (RANK[r.verdict ?? ""] ?? 9) <= 2 ? "font-semibold text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>{VERDICT[r.verdict ?? ""] ?? r.verdict}</td>
                <td className="px-2 text-right tabular-nums">{r.recent_close_pct == null ? "" : `${r.recent_close_pct}%`} <span className="text-xs text-muted-foreground">{r.recent_contacts ?? 0} reached</span></td>
                <td className="px-2 text-right tabular-nums">{r.base_close_pct == null ? "" : `${r.base_close_pct}%`}</td>
                <td className="px-2 text-right tabular-nums">{r.recent_objection_pct ?? ""}% / {r.base_objection_pct ?? ""}%</td>
                <td className="px-2">{r.top_objection ? TOP[r.top_objection] ?? r.top_objection : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </State>
  );
}

interface EasyRow { phone10: string | null; first_name: string | null; last_name: string | null; call_id: string; disposition: string | null; call_started_at: string | null; agent_name: string | null; what_happened: string | null; call_grade: number | null }
function EasyCloses() {
  const q = useQuery(view("easy", () => rows<EasyRow>(looseSupabase.from("v_easy_closes").select("phone10, first_name, last_name, call_id, disposition, call_started_at, agent_name, what_happened, call_grade").eq("in_a_bundle", false).order("call_started_at", { ascending: false }).limit(60)))) as UseQueryResult<EasyRow[]>;
  return (
    <State q={q} empty="No warm leads waiting.">
      {(list) => (
        <ul className="divide-y divide-border/40">
          {list.map((r) => (
            <li key={r.call_id} className="space-y-0.5 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                <CallLink phone={r.phone10} />
                <span className="text-muted-foreground">{dispositionLabel(r.disposition)} · {ago(r.call_started_at)} · {r.agent_name}{r.call_grade != null ? ` · call graded ${r.call_grade}` : ""}</span>
              </div>
              {r.what_happened && <p className="text-muted-foreground">{r.what_happened}</p>}
            </li>
          ))}
        </ul>
      )}
    </State>
  );
}

interface CoverageRow { call_id: string; call_started_at: string | null; agent_name: string | null; first_name: string | null; last_name: string | null; phone10: string | null; book_status: string | null; packet_carrier: string | null; packet_monthly_premium: number | null; spouse_coverage: boolean | null; mortgage_protection: boolean | null; opportunities: string | null }
function MoreCoverage() {
  const q = useQuery(view("coverage", () => rows<CoverageRow>(looseSupabase.from("v_more_coverage").select("call_id, call_started_at, agent_name, first_name, last_name, phone10, book_status, packet_carrier, packet_monthly_premium, spouse_coverage, mortgage_protection, opportunities").order("call_started_at", { ascending: false }).limit(60)))) as UseQueryResult<CoverageRow[]>;
  return (
    <State q={q} empty="No buyer asked about more coverage.">
      {(list) => (
        <ul className="divide-y divide-border/40">
          {list.map((r) => (
            <li key={r.call_id} className="space-y-0.5 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                <CallLink phone={r.phone10} />
                <span className="text-muted-foreground">bought {ago(r.call_started_at)} from {r.agent_name}{r.packet_carrier ? ` · ${r.packet_carrier}` : ""}{r.book_status ? ` · ${r.book_status}` : ""}</span>
              </div>
              <p><span className="font-semibold">Also wanted:</span> {[r.spouse_coverage ? "spouse coverage" : "", r.mortgage_protection ? "mortgage protection" : "", r.opportunities ?? ""].filter(Boolean).join("; ")}</p>
            </li>
          ))}
        </ul>
      )}
    </State>
  );
}

interface RiskRow { call_id: string; call_started_at: string | null; agent_name: string | null; first_name: string | null; last_name: string | null; phone10: string | null; book_status: string | null; book_carrier: string | null; risk: string | null; what_happened: string | null; do_not_call: boolean | null }
function DropoffRisk() {
  const [only, setOnly] = useState<string>("all");
  const q = useQuery(view("risk", () => rows<RiskRow>(looseSupabase.from("v_dropoff_risk").select("call_id, call_started_at, agent_name, first_name, last_name, phone10, book_status, book_carrier, risk, what_happened, do_not_call").order("call_started_at", { ascending: false }).limit(200)))) as UseQueryResult<RiskRow[]>;
  return (
    <State q={q} empty="No sale is at risk right now.">
      {(list) => {
        const kinds = Array.from(new Set(list.map((r) => r.risk ?? "Review")));
        const shown = only === "all" ? list : list.filter((r) => (r.risk ?? "Review") === only);
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant={only === "all" ? "default" : "outline"} className="h-8 px-2 text-xs" onClick={() => setOnly("all")}>All {list.length}</Button>
              {kinds.map((k) => (
                <Button key={k} type="button" size="sm" variant={only === k ? "default" : "outline"} className="h-8 px-2 text-xs" onClick={() => setOnly(k)}>
                  {k.split(":")[0]} {list.filter((r) => (r.risk ?? "Review") === k).length}
                </Button>
              ))}
            </div>
            <ul className="divide-y divide-border/40">
              {shown.map((r) => (
                <li key={r.call_id} className="space-y-0.5 py-2">
                  <p className="font-semibold text-amber-700 dark:text-amber-300">{r.risk}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "Name not on file"}</span>
                    <CallLink phone={r.phone10} dnc={r.do_not_call} />
                    <span className="text-muted-foreground">sold {ago(r.call_started_at)} by {r.agent_name}{r.book_carrier ? ` · ${r.book_carrier}` : ""}{r.book_status ? ` · ${r.book_status}` : ""}</span>
                  </div>
                  {r.what_happened && <p className="text-muted-foreground">{r.what_happened}</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </State>
  );
}

export function CallReviewBoard({ onPickAgent }: { onPickAgent: (name: string) => void }) {
  const [open, setOpen] = useState<Key | null>(null);
  return (
    <GlassCard className="p-0">
      <p className="px-4 pt-3 text-sm font-semibold">Call review</p>
      <div className="divide-y divide-border/60">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <button type="button" onClick={() => setOpen(open === s.key ? null : s.key)} aria-expanded={open === s.key} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
              <span>
                <span className="block text-sm font-semibold">{s.title}</span>
                <span className="block text-xs text-muted-foreground">{s.blurb}</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open === s.key && "rotate-180")} />
            </button>
            {open === s.key && (
              <div className="overflow-x-auto border-t border-border/60 px-4 py-3 text-sm">
                {s.key === "closers" ? <Closers onPickAgent={onPickAgent} />
                  : s.key === "table" ? <LeftOnTable onPickAgent={onPickAgent} />
                  : s.key === "slump" ? <Slumps onPickAgent={onPickAgent} />
                  : s.key === "easy" ? <EasyCloses />
                  : s.key === "coverage" ? <MoreCoverage />
                  : <DropoffRisk />}
              </div>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
