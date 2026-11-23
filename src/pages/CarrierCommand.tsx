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
        eyebrow={d?.as_of ? `Pulled ${formatTimeAgo(d.as_of)} · twice daily` : "twice daily"}
        title="Carrier Command"
        subtitle="Ethos + Chubb — live book, chargebacks, and production the site isn't counting yet"
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

      {/* unaccounted production — the point of the page */}
      <GlassCard className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <FileWarning className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <h2 className="text-lg font-semibold">Production the site isn't counting</h2>
            <p className="text-sm text-muted-foreground">
              {num(d?.unaccounted_count)} policies live in a carrier portal with no matching record in the site's feed.
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
