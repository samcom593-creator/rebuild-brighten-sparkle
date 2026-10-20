// Ayro Financial book of business (2026-10-20), arranged by carrier.
// Sam: "give me a book of business screen for Ayro Financial i need all info you can provide ...
// with all names carriers", then "arrange by carriers". Every policy Ayro's CRM lists, synced every
// 20 minutes by ayro-sales-sync.mjs, read through ayro_book() (admin only). Ayro's feed carries
// policy #, writing agent, carrier, annual premium, status and the time it was entered. It does
// not share client names or phones with this login, so the page says so instead of leaving blanks.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Phone, Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTimeAgo } from "@/lib/dateUtils";
import { contactLinkProps, formatPhoneDisplay, phoneHref } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  ALL, AYRO_BOOK_KEY, AYRO_CARRIER_CONTACTS, PERIODS, SORTS, agentRows, carrierChecks, dollars, groupByCarrier, inPeriod,
  matchesSearch, phoenixMoment, reconcile, totals,
  type AyroBookPayload, type AyroDeal, type CarrierGroup, type PeriodKey, type SortKey,
} from "@/lib/ayroBook";

type Rpc = (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;

async function fetchAyroBook(): Promise<AyroBookPayload> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)("ayro_book");
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as { deals?: AyroDeal[]; sync?: AyroBookPayload["sync"] };
  const deals = (raw.deals ?? []).map((d) => ({
    ...d,
    annual_premium: Number(d.annual_premium ?? 0),
    monthly_premium: d.monthly_premium == null ? null : Number(d.monthly_premium),
  }));
  return { deals, sync: raw.sync ?? null };
}

// The black+gold theme maps green shades to gold, so the carrier dots avoid green, teal and amber.
const CARRIER_TONES = [
  "bg-primary", "bg-sky-500", "bg-violet-500", "bg-rose-500", "bg-orange-500", "bg-fuchsia-500", "bg-indigo-400", "bg-cyan-300", "bg-slate-400",
];

export default function AyroBook() {
  const { isAdmin } = useAuth();
  usePageTitle("Ayro Financial Book");
  const q = useQuery({ queryKey: [AYRO_BOOK_KEY], queryFn: fetchAyroBook, staleTime: 60_000, refetchInterval: 5 * 60_000, enabled: !!isAdmin });

  const [period, setPeriod] = useState<PeriodKey>("all");
  const [carrier, setCarrier] = useState<string>(ALL);
  const [agent, setAgent] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");

  const all = useMemo(() => q.data?.deals ?? [], [q.data]);
  const checks = useMemo(() => carrierChecks(all), [all]);
  const recon = useMemo(() => reconcile(all, q.data?.sync ?? null), [all, q.data]);
  const inScope = useMemo(
    () => all.filter((d) => inPeriod(d, period) && (agent === ALL || d.agent_name === agent) && matchesSearch(d, search)),
    [all, period, agent, search],
  );
  const groupsInScope = useMemo(() => groupByCarrier(inScope, sort), [inScope, sort]);
  const shownGroups = carrier === ALL ? groupsInScope : groupsInScope.filter((g) => g.carrier === carrier);
  const shownDeals = useMemo(() => shownGroups.flatMap((g) => g.deals), [shownGroups]);
  const sum = totals(shownDeals);
  const agentList = useMemo(() => agentRows(shownDeals), [shownDeals]);
  const allAgents = useMemo(() => [...new Set(all.map((d) => d.agent_name))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [all]);
  const toneFor = useMemo(() => {
    const order = groupByCarrier(all).map((g) => g.carrier);
    return (c: string) => CARRIER_TONES[Math.max(0, order.indexOf(c)) % CARRIER_TONES.length];
  }, [all]);

  if (!isAdmin) {
    return <div className="mx-auto w-full max-w-md px-4 py-16 text-center text-sm text-muted-foreground">This page is restricted.</div>;
  }

  const sync = q.data?.sync ?? null;
  const filtered = period !== "all" || agent !== ALL || carrier !== ALL || search.trim() !== "";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6">
      <PageHeader
        eyebrow="My Business"
        title="Ayro Financial Book"
        subtitle="Every policy in Ayro's CRM, grouped by carrier. Synced from el.ayrofinancial.com every 20 minutes."
      />

      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          {Array.from({ length: 3 }, (_, n) => <Skeleton key={`ayro-sk-${n}`} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : q.isError ? (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Could not load the Ayro book" description={String((q.error as Error)?.message ?? "Unknown error")} />
      ) : (
        <>
          <SyncLine sync={sync} recon={recon} fetching={q.isFetching} />

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Annual premium" value={dollars(sum.premium)} />
            <Stat label="Counts in our production" value={dollars(sum.counted)} />
            <Stat label="Policies" value={String(sum.policies)} />
            <Stat label="Avg premium" value={dollars(sum.average)} />
            <Stat label="Agents" value={String(sum.agents)} />
            <Stat label="Carriers" value={String(sum.carriers)} />
          </div>

          {groupsInScope.length > 0 && (
            <CarrierMix groups={groupsInScope} active={carrier} onPick={setCarrier} toneFor={toneFor} />
          )}

          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search policy #, agent or carrier"
                aria-label="Search the Ayro book"
                className="h-10 pl-9"
              />
            </div>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="h-10 sm:w-48" aria-label="Writing agent"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All agents</SelectItem>
                {allAgents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-10 sm:w-44" aria-label="Sort policies"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {shownGroups.length === 0 ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No policies here"
              description={filtered ? "Nothing matches these filters. Try All time or All carriers." : "Ayro has not listed any policies yet."}
            />
          ) : (
            <div className="space-y-4">
              {shownGroups.map((g) => <CarrierSection key={g.carrier} group={g} checks={checks} tone={toneFor(g.carrier)} />)}
            </div>
          )}

          {agentList.length > 0 && <AgentTable rows={agentList} toneFor={toneFor} />}

          <p className="mt-6 text-xs text-muted-foreground">
            Ayro's feed lists policy #, writing agent, carrier, annual premium, status and the time each policy was entered.
            It does not share client names or phone numbers with this login, so they are not on this page.
            Monthly premium is annual premium divided by 12. "Counts" marks policies included in our production totals; the
            Ayro-only producers (Dom Yous, snow flake, Travis N, Nels r, David Agbebaku) are left out of those totals, so their
            policies show here as "Ayro only".
          </p>
        </>
      )}
    </div>
  );
}

function CountsChip({ counts }: { counts: boolean }) {
  return counts ? (
    <span className="ml-2 whitespace-nowrap rounded-full border border-primary/40 px-1.5 py-0.5 text-[11px] font-semibold text-primary">Counts</span>
  ) : (
    <span className="ml-2 whitespace-nowrap rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Ayro only</span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function SyncLine({ sync, recon, fetching }: { sync: AyroBookPayload["sync"]; recon: ReturnType<typeof reconcile>; fetching: boolean }) {
  const bad = !!sync && !sync.ok;
  return (
    <div className={cn(
      "mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm",
      bad || (recon && !recon.matches) ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-card",
    )}>
      {bad || (recon && !recon.matches)
        ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
      <span className="text-foreground">
        {sync?.at ? `Last synced ${formatTimeAgo(sync.at)}` : "Not synced yet"}
        {bad && sync?.error ? `. Last sync failed: ${sync.error}` : ""}
      </span>
      {recon && <span className="text-muted-foreground">{recon.text}</span>}
      {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing" />}
    </div>
  );
}

function CarrierMix({ groups, active, onPick, toneFor }: {
  groups: CarrierGroup[]; active: string; onPick: (c: string) => void; toneFor: (c: string) => string;
}) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-3">
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {groups.map((g) => <div key={g.carrier} className={toneFor(g.carrier)} style={{ width: `${Math.max(g.share * 100, 0.8)}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Carrier">
        <Button size="sm" variant={active === ALL ? "default" : "outline"} aria-pressed={active === ALL} onClick={() => onPick(ALL)}>
          All carriers
        </Button>
        {groups.map((g) => (
          <Button
            key={g.carrier}
            size="sm"
            variant={active === g.carrier ? "default" : "outline"}
            aria-pressed={active === g.carrier}
            onClick={() => onPick(active === g.carrier ? ALL : g.carrier)}
          >
            <span className={cn("mr-1.5 inline-block h-2.5 w-2.5 rounded-full", toneFor(g.carrier))} aria-hidden />
            {g.carrier}
            <span className="ml-1.5 text-xs tabular-nums opacity-80">{g.policies} · {Math.round(g.share * 100)}%</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function CarrierSection({ group, checks, tone }: { group: CarrierGroup; checks: Map<string, string>; tone: string }) {
  const contact = AYRO_CARRIER_CONTACTS[group.carrier];
  const tel = phoneHref(contact?.phone);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label={`${group.carrier} policies`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <span className={cn("inline-block h-3 w-3 rounded-full", tone)} aria-hidden />
            {group.carrier}
          </h2>
          <p className="text-sm text-muted-foreground">
            {group.policies} {group.policies === 1 ? "policy" : "policies"} · {dollars(group.premium)} · {Math.round(group.share * 100)}% of premium shown
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Written by {group.agents.join(", ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tel && contact?.phone && (
            <a href={tel} {...contactLinkProps(tel)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted">
              <Phone className="h-3.5 w-3.5" aria-hidden /> {formatPhoneDisplay(contact.phone)}
            </a>
          )}
          {contact?.portal && (
            <a href={contact.portal} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted">
              Agent portal <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Entered</th>
              <th className="px-4 py-2 font-semibold">Policy #</th>
              <th className="px-4 py-2 font-semibold">Writing agent</th>
              <th className="px-4 py-2 text-right font-semibold">Annual</th>
              <th className="px-4 py-2 text-right font-semibold">Monthly</th>
              <th className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {group.deals.map((d) => {
              const note = checks.get(d.id);
              const typed = d.carrier_entered && d.carrier_entered !== d.carrier ? d.carrier_entered : null;
              return (
                <tr key={d.id} className="border-b border-border/60 align-top last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{phoenixMoment(d.submitted_at)}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-foreground">{d.policy_number ?? "No policy # yet"}</span>
                    {typed && <p className="text-xs text-muted-foreground">Carrier typed as "{typed}"</p>}
                    {note && <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{note}</p>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-foreground">{d.agent_name}</span>
                    <CountsChip counts={d.counts_in_production} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">{dollars(d.annual_premium)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground">{d.monthly_premium == null ? "" : dollars(d.monthly_premium)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{d.ayro_status ?? (d.status === "lapsed" ? "Lapsed" : "Active")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AgentTable({ rows, toneFor }: { rows: ReturnType<typeof agentRows>; toneFor: (c: string) => string }) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card" aria-label="Writing agents">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-bold text-foreground">Writing agents</h2>
        <p className="text-sm text-muted-foreground">Who wrote the policies above, and with which carriers.</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Agent</th>
              <th className="px-4 py-2 text-right font-semibold">Policies</th>
              <th className="px-4 py-2 text-right font-semibold">Annual</th>
              <th className="px-4 py-2 text-right font-semibold">Avg</th>
              <th className="px-4 py-2 font-semibold">Carriers</th>
              <th className="px-4 py-2 font-semibold">First / latest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent} className="border-b border-border/60 align-top last:border-b-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-foreground">{r.agent}</span>
                  <CountsChip counts={r.counts} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.policies}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">{dollars(r.premium)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground">{dollars(r.premium / r.policies)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {r.carriers.map((c) => (
                      <span key={c.carrier} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                        <span className={cn("inline-block h-2 w-2 rounded-full", toneFor(c.carrier))} aria-hidden />
                        {c.carrier} {c.policies}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                  {phoenixMoment(r.first)}<br />{phoenixMoment(r.last)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
