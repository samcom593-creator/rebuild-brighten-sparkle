// Agencies — every agency under the IMO owner and every producer inside it,
// whether or not that producer ever logs into this site.
//
// Sam, 2026-09-07: "make me able to see my agencies under me with a better
// view — I can't see them on leaderboards or anything; they're still under me,
// just not using our main website." Sub-agency producers (Vantage) sync from
// AgentLink into the production truth table without ever creating a login, so
// every login-keyed view drops them. This page keys on production, not logins:
// one card per agency (v_imo_by_agency totals + your override) and the roster
// of who produced it (agency_roster_production), with the agency's reported-
// but-unattributed daily gap shown as its own labelled line, never mixed in.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Period = "mtd" | "30d" | "last_month";

interface AgencyTotals {
  agency: string;
  is_primary: boolean;
  policies: number;
  alp: number;
  alp_mtd: number;
  policies_mtd: number;
  policies_30d: number;
  alp_30d: number;
  owner_override_pct: number | null;
  est_owner_override_mtd: number | null;
  est_owner_override_30d: number | null;
}

interface RosterRow {
  agency: string;
  is_gap: boolean;
  agent_id: string | null;
  agent_name: string | null;
  policies: number;
  ap: number;
  last_sale: string | null;
  contract_pct: number | null;
  contract_provenance: string | null;
  has_login: boolean;
  first_hop_name: string | null;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function windowFor(period: Period): { start: string; end: string; label: string } {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const tomorrow = new Date(utc); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (period === "30d") {
    const start = new Date(utc); start.setUTCDate(start.getUTCDate() - 30);
    return { start: ymd(start), end: ymd(tomorrow), label: "Last 30 days" };
  }
  if (period === "last_month") {
    const start = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1));
    return { start: ymd(start), end: ymd(end), label: "Last month" };
  }
  const start = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1));
  return { start: ymd(start), end: ymd(tomorrow), label: "Month to date" };
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "mtd", label: "Month to date" },
  { key: "30d", label: "Last 30 days" },
  { key: "last_month", label: "Last month" },
];

export default function Agencies() {
  usePageTitle("Agencies");
  const [period, setPeriod] = useState<Period>("mtd");
  const window = useMemo(() => windowFor(period), [period]);

  const totals = useQuery({
    queryKey: ["agencies-totals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_imo_by_agency" as never)
        .select("agency, is_primary, policies, alp, alp_mtd, policies_mtd, policies_30d, alp_30d, owner_override_pct, est_owner_override_mtd, est_owner_override_30d");
      if (error) throw error;
      return (data ?? []) as unknown as AgencyTotals[];
    },
  });

  const roster = useQuery({
    queryKey: ["agencies-roster", window.start, window.end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("agency_roster_production", { p_start: window.start, p_end: window.end });
      if (error) throw error;
      return (data ?? []) as RosterRow[];
    },
  });

  const agencies = useMemo(() => {
    const names = new Set<string>();
    (totals.data ?? []).forEach((t) => names.add(t.agency));
    (roster.data ?? []).forEach((r) => names.add(r.agency));
    const list = Array.from(names);
    const primary = (totals.data ?? []).find((t) => t.is_primary)?.agency;
    return list.sort((a, b) => (a === primary ? -1 : b === primary ? 1 : a.localeCompare(b)));
  }, [totals.data, roster.data]);

  const loading = totals.isLoading || roster.isLoading;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24">
      <PageHeader
        eyebrow="Owner" eyebrowIcon={<Crown className="h-3 w-3" />}
        title="Agencies under you"
        subtitle="Every agency in your IMO and every producer inside it — keyed on production, so agents who never log in here still show. Unattributed agency totals are listed on their own line, never mixed into a producer."
        accent="primary"
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)}
            className={period === p.key ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}>
            {p.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">{window.start} → {window.end} (exclusive)</span>
      </div>

      {loading && (
        <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>
      )}
      {(totals.isError || roster.isError) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          Couldn't load agencies: {String((totals.error ?? roster.error) as Error | null)?.slice(0, 160)}
        </p>
      )}

      <div className="space-y-6">
        {agencies.map((name) => {
          const t = (totals.data ?? []).find((x) => x.agency === name);
          const rows = (roster.data ?? []).filter((r) => r.agency === name);
          const producers = rows.filter((r) => !r.is_gap);
          const gap = rows.find((r) => r.is_gap) ?? null;
          const windowAp = rows.reduce((s, r) => s + Number(r.ap || 0), 0);
          const windowPolicies = rows.reduce((s, r) => s + Number(r.policies || 0), 0);
          const noLogin = producers.filter((r) => !r.has_login).length;
          const ovr = t ? (period === "30d" ? t.est_owner_override_30d : t.est_owner_override_mtd) : null;
          return (
            <section key={name} className="rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                <div>
                  <div className="flex items-center gap-2 text-lg font-bold text-foreground">
                    <Building2 className="h-4 w-4 text-primary" /> {name}
                    {t?.is_primary && <Badge variant="outline" className="border-primary/30 bg-primary/15 text-[10px] text-primary">MINE</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {producers.length} {producers.length === 1 ? "producer" : "producers"} in this window
                    {noLogin > 0 && <> · <span className="text-foreground">{noLogin} never log in here</span></>}
                    {gap && <> · unattributed reported production on its own line</>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-right">
                  <div>
                    <div className="text-xl font-extrabold tabular-nums text-foreground">{money(windowAp)}</div>
                    <div className="text-[10.5px] uppercase tracking-[0.09em] text-muted-foreground">{window.label} · {windowPolicies} policies</div>
                  </div>
                  {(t?.owner_override_pct ?? 0) > 0 && (
                    <div>
                      <div className="text-xl font-extrabold tabular-nums text-primary">{money(Number(ovr ?? 0))}</div>
                      <div className="text-[10.5px] uppercase tracking-[0.09em] text-muted-foreground">your override · {t?.owner_override_pct}%</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producer</TableHead>
                      <TableHead className="text-right">Policies</TableHead>
                      <TableHead className="text-right">AP</TableHead>
                      <TableHead>Last sale</TableHead>
                      <TableHead className="text-right">Comp</TableHead>
                      <TableHead>Reports through</TableHead>
                      <TableHead>Login</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {producers.length === 0 && !gap && (
                      <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No production in this window.</TableCell></TableRow>
                    )}
                    {producers.map((r) => (
                      <TableRow key={r.agent_id ?? `${name}:${r.agent_name}`}>
                        <TableCell className="font-medium text-foreground">{r.agent_name ?? "Unnamed producer"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.policies}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(r.ap))}</TableCell>
                        <TableCell className="text-muted-foreground">{r.last_sale ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.contract_pct != null ? `${r.contract_pct}%` : <span className="text-muted-foreground">unknown</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.first_hop_name ?? "—"}</TableCell>
                        <TableCell>
                          {r.has_login
                            ? <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">has login</Badge>
                            : <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-300">never logs in</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {gap && (
                      <TableRow key={`${name}:gap`} className="bg-muted/30">
                        <TableCell className="text-sm text-muted-foreground">{gap.agent_name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{gap.policies}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{money(Number(gap.ap))}</TableCell>
                        <TableCell className="text-muted-foreground">{gap.last_sale ?? "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
