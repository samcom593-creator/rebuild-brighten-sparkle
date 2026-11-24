import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  FileWarning,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatTimeAgo } from "@/lib/dateUtils";

/**
 * /dashboard/carrier-command (MP-CARRIER-DAILY, 2026-11-23)
 *
 * Sam runs two carriers now — Ethos and Chubb. Both books are pulled from his live
 * session twice a day (5:30a before the dial day, 8:30p after it) into
 * ethos_live_* / chubb_live_policies / carrier_live_metrics. This page is the one
 * place that shows the two-carrier roll-up, the chargebacks, the downline
 * production, and — the point of it — the policies that are in a carrier portal
 * but that the site's production feed never recorded (v_carrier_unaccounted).
 *
 * Everything comes from the owner-only carrier_command() RPC (is_owner() in the
 * body; a non-owner call raises 42501 and lands on the owner-only empty state).
 */

type CarrierMetric = {
  carrier: string;
  issued_premium: number | null;
  inforce_premium: number | null;
  last_30d_premium: number | null;
  policies_total: number | null;
  policies_30d: number | null;
  chargeback_total: number | null;
  chargeback_count: number | null;
  at_risk_count: number | null;
  downline_count: number | null;
  raw: { active_policies?: number | null } | null;
};
type Unaccounted = {
  policy_number: string;
  carrier: string;
  region: string | null;
  agent: string | null;
  ref_date: string | null;
  comp_amount: number | null;
  status: string | null;
};
type Chargeback = { policy_number: string | null; agent: string | null; amount: number | null; reason: string | null; date: string | null };
type Production = { agent: string | null; npn: string | null; issued: number | null; inforce: number | null; p13: number | null; chargeback: number | null };
type CarrierCommandPayload = {
  as_of: string | null;
  carriers: CarrierMetric[];
  unaccounted: Unaccounted[];
  unaccounted_count: number;
  unaccounted_by_carrier: Record<string, number>;
  chargebacks: Chargeback[];
  production: Production[];
  // MP-CARRIER-BOOK-TRUTH (2026-11-24): the policy-level book the whole site now counts from.
  book?: Array<{ carrier: string; written: number; written_ap: number; submitted: number; in_force: number; at_risk: number; lapsed: number; not_placed: number; retention_pct: number | null }>;
  unmapped_agents?: Array<{ carrier: string; agent: string | null; npn: string | null; policies: number }>;
  freshness?: Array<{ carrier: string; last_ok_at: string | null; hours_stale: number | null; last_error: string | null; last_error_at: string | null; policies: number }>;
  site_not_in_portal?: Array<{ agent: string | null; carrier: string; deals: number; ap: number; oldest_days: number; agent_has_portal_policies: boolean; typed_numbers: number }>;
  recent_changes?: Array<{ carrier: string; policy: string; from: string | null; to: string; on: string; agent: string | null }>;
};

const BUCKET_WORD: Record<string, string> = {
  pending: "submitted", active: "in force", claim: "in force (claim)", at_risk: "at risk", lapsed: "lapsed",
  not_taken: "not taken", declined: "declined", abandoned: "abandoned", started: "app started", quote: "quote", unknown: "unknown",
};

const QUERY_KEY = ["carrier-command"] as const;
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const shortDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function CarrierCommand() {
  usePageTitle("Carrier Command");
  const qc = useQueryClient();

  const q = useQuery<CarrierCommandPayload>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("carrier_command" as never);
      if (error) throw error;
      return data as unknown as CarrierCommandPayload;
    },
    staleTime: 60_000,
  });

  const d = q.data;
  const carriers = useMemo(() => d?.carriers ?? [], [d]);
  const unaccounted = useMemo(() => d?.unaccounted ?? [], [d]);
  const chargebacks = useMemo(() => d?.chargebacks ?? [], [d]);
  const production = useMemo(() => (d?.production ?? []).filter((p) => (p.issued ?? 0) > 0 || (p.chargeback ?? 0) > 0), [d]);

  if (q.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (q.error) {
    const msg = String((q.error as { message?: string })?.message ?? q.error);
    const ownerOnly = /owner only|42501|permission/i.test(msg);
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={ownerOnly ? "Owner only" : "Couldn't load the carrier data"}
          description={ownerOnly ? "The two-carrier command view is limited to the account owner." : msg}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      <PageHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        eyebrow={d?.as_of ? `Pulled ${formatTimeAgo(d.as_of)} · 4× daily` : "4× daily"}
        title="Carrier Command"
        subtitle="Ethos + Combined (Chubb) — the live book the whole site counts from: production, chargebacks, retention"
        primaryAction={
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: QUERY_KEY })}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {/* two-carrier roll-up */}
      <div className="grid gap-4 sm:grid-cols-2">
        {carriers.map((c) => (
          <GlassCard key={c.carrier} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{c.carrier}</h2>
              <span className="text-xs text-muted-foreground">
                {num(c.policies_total)} policies{c.raw?.active_policies != null ? ` · ${num(c.raw.active_policies)} active` : ""}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Issued premium</dt>
                <dd className="font-semibold">{money(c.issued_premium)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last 30 days</dt>
                <dd className="font-semibold">{money(c.last_30d_premium)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Chargebacks</dt>
                <dd className="font-semibold">
                  {money(c.chargeback_total)}{c.chargeback_count != null ? ` · ${c.chargeback_count}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Writing agents</dt>
                <dd className="font-semibold">{num(c.downline_count)}</dd>
              </div>
            </dl>
          </GlassCard>
        ))}
        {carriers.length === 0 && (
          <GlassCard className="p-5 text-sm text-muted-foreground">No carrier snapshot yet. The next scheduled pull will fill this in.</GlassCard>
        )}
      </div>

      {/* the live policy book — what production, chargebacks and retention read site-wide */}
      {(d?.book?.length ?? 0) > 0 && (
        <GlassCard className="p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Live book · policy by policy</h2>
            <span className="text-xs text-muted-foreground">
              {(d?.freshness ?? []).map((f) => `${f.carrier}: ${f.last_ok_at ? `pulled ${formatTimeAgo(f.last_ok_at)}` : "never pulled"}`).join(" · ")}
            </span>
          </div>
          {(d?.freshness ?? []).filter((f) => f.last_error_at && (!f.last_ok_at || f.last_error_at > f.last_ok_at)).map((f) => (
            <p key={f.carrier} role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {f.carrier} pull is failing ({f.last_error ?? "unknown error"}). Its numbers below are as of the last good pull. A signed-out portal is fixed by signing in to it in Chrome.
            </p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2 pr-3">Carrier</th><th className="py-2 pr-3 text-right">Written</th><th className="py-2 pr-3 text-right">Annual premium</th><th className="py-2 pr-3 text-right">Submitted</th><th className="py-2 pr-3 text-right">In force</th><th className="py-2 pr-3 text-right">At risk</th><th className="py-2 pr-3 text-right">Lapsed</th><th className="py-2 pr-3 text-right">Never placed</th><th className="py-2 text-right">Retention</th></tr>
              </thead>
              <tbody>
                {(d?.book ?? []).map((b) => (
                  <tr key={b.carrier} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{b.carrier}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.written)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.written_ap ? money(b.written_ap) : "not shown by portal"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.submitted)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.in_force)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.at_risk)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.lapsed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(b.not_placed)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{b.retention_pct == null ? "—" : `${b.retention_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Retention = in force ÷ every policy that was issued. Tap any agent anywhere on the site to see their book policy by policy.</p>
        </GlassCard>
      )}

      {(d?.unmapped_agents?.length ?? 0) > 0 && (
        <GlassCard className="p-5">
          <div className="mb-3 flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <h2 className="text-lg font-semibold">Writing agents the site can't match</h2>
              <p className="text-sm text-muted-foreground">These names write in a carrier portal but have no agent record (or no NPN / name match). Their policies are in the book but credited to no one until they are.</p>
            </div>
          </div>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {d!.unmapped_agents!.map((u) => (
              <li key={`${u.carrier}-${u.agent}-${u.npn}`} className="flex justify-between gap-3 border-b border-border py-1">
                <span>{u.agent ?? "—"} <span className="text-muted-foreground">· {u.carrier}{u.npn ? ` · NPN ${u.npn}` : ""}</span></span>
                <span className="tabular-nums text-muted-foreground">{u.policies}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {(d?.site_not_in_portal?.length ?? 0) > 0 && (
        <GlassCard className="p-5">
          <div className="mb-3 flex items-start gap-3">
            <TrendingDown className="mt-0.5 h-5 w-5 text-red-500" />
            <div>
              <h2 className="text-lg font-semibold">Posted on the site, not in the carrier portal</h2>
              <p className="text-sm text-muted-foreground">
                Ethos / Combined deals 14+ days old that the portal has no record of — a typed policy number, an app written under another upline, or a deal that never happened.
                They still count until you decide; open the agent to see each one.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2 pr-3">Agent</th><th className="py-2 pr-3">Carrier</th><th className="py-2 pr-3 text-right">Deals</th><th className="py-2 pr-3 text-right">Annual premium</th><th className="py-2 pr-3 text-right">Oldest</th><th className="py-2">Signal</th></tr>
              </thead>
              <tbody>
                {d!.site_not_in_portal!.map((g) => (
                  <tr key={`${g.agent}-${g.carrier}`} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{g.agent ?? "—"}</td>
                    <td className="py-2 pr-3">{g.carrier}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(g.deals)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(g.ap)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{g.oldest_days}d</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {!g.agent_has_portal_policies ? "No policies at all under this agent in your portal" : "Agent writes in your portal; these deals don't match"}
                      {g.typed_numbers ? ` · ${g.typed_numbers} placeholder policy #` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {(d?.recent_changes?.length ?? 0) > 0 && (
        <GlassCard className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Status changes the carriers reported</h2>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {d!.recent_changes!.slice(0, 60).map((c, i) => (
              <li key={`${c.carrier}-${c.policy}-${i}`} className="flex flex-wrap justify-between gap-2 border-b border-border py-1">
                <span>{c.agent ?? "Unmatched agent"} <span className="text-muted-foreground">· {c.carrier} {c.policy}</span></span>
                <span className="text-muted-foreground">{BUCKET_WORD[c.from ?? ""] ?? c.from} → <span className="font-medium text-foreground">{BUCKET_WORD[c.to] ?? c.to}</span> · {shortDate(c.on)}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      {/* unaccounted production — the point of the page */}
      <GlassCard className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <FileWarning className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <h2 className="text-lg font-semibold">Written in a portal, never posted on the site</h2>
            <p className="text-sm text-muted-foreground">
              {num(d?.unaccounted_count)} policies were written in a carrier portal but never posted on the site. They now count toward production from the carrier book (Combined counts once the portal shows its premium).
              {d?.unaccounted_by_carrier
                ? " " + Object.entries(d.unaccounted_by_carrier).map(([k, v]) => `${k}: ${v}`).join(" · ")
                : ""}
            </p>
          </div>
        </div>
        {unaccounted.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Everything reconciles" description="Every carrier-portal policy has a matching site record." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Policy</th>
                  <th className="py-2 pr-4 font-medium">Carrier</th>
                  <th className="py-2 pr-4 font-medium">Writing agent</th>
                  <th className="py-2 pr-4 font-medium">Status / region</th>
                  <th className="py-2 pr-4 font-medium">Dated</th>
                </tr>
              </thead>
              <tbody>
                {unaccounted.map((u) => (
                  <tr key={`${u.carrier}-${u.policy_number}`} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-xs">{u.policy_number}</td>
                    <td className="py-2 pr-4">{u.carrier}</td>
                    <td className="py-2 pr-4">{u.agent ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{u.status ?? u.region ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{shortDate(u.ref_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* chargebacks */}
      {chargebacks.length > 0 && (
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <TrendingDown className="h-5 w-5 text-rose-500" />
            <h2 className="text-lg font-semibold">Chargebacks</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Policy</th>
                  <th className="py-2 pr-4 font-medium">Agent</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {chargebacks.map((c, i) => (
                  <tr key={`${c.policy_number ?? "cb"}-${i}`} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-xs">{c.policy_number ?? "—"}</td>
                    <td className="py-2 pr-4">{c.agent ?? "—"}</td>
                    <td className="py-2 pr-4 font-semibold">{money(c.amount)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* downline production */}
      {production.length > 0 && (
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Production by agent (Ethos)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Agent</th>
                  <th className="py-2 pr-4 font-medium">Issued</th>
                  <th className="py-2 pr-4 font-medium">In-force</th>
                  <th className="py-2 pr-4 font-medium">13-mo persistency</th>
                  <th className="py-2 pr-4 font-medium">Chargeback</th>
                </tr>
              </thead>
              <tbody>
                {production.map((p, i) => (
                  <tr key={p.npn ?? `prod-${p.agent ?? ""}-${i}`} className="border-b border-border/50">
                    <td className="py-2 pr-4">{p.agent ?? "—"}</td>
                    <td className="py-2 pr-4 font-semibold">{money(p.issued)}</td>
                    <td className="py-2 pr-4">{money(p.inforce)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{pct(p.p13)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{money(p.chargeback)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
