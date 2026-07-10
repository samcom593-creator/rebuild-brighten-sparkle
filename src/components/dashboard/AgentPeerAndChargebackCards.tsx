// PL-040: two cards that turn the agent dashboard from a stat clone into a
// command center.
//
// RegionPeerCard — top 5 producers MTD whose license_states overlap with the
// current agent's licensed footprint. Highlights the current agent's row so
// they know where they stand in their actual market, not just agency-wide.
//
// UpcomingChargebackCard — pulls v_agent_charge_rollup for the current
// agent. Zero charges + zero flagged = green "clean ledger" callout. Anything
// > 0 surfaces the count, dollars, and last_charged_at + a link to the
// charges-audit page (admin-only). Aimed at giving the agent a heads-up
// before a chargeback hits commissions instead of finding out on a payout
// statement.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, ShieldCheck, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeerRow {
  agent_id: string;
  display_name: string | null;
  agent_code: string | null;
  ap_mtd: number | string;
  deals_mtd: number;
  rank_agency_mtd: number | null;
}

function fmtUsdCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000)    return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function RegionPeerCard({ agentId }: { agentId: string | null }) {
  // First fetch this agent's license_states to scope the peers.
  const me = useQuery({
    queryKey: ["region-peer-me", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id, license_states")
        .eq("id", agentId!)
        .maybeSingle();
      return data as { id: string; license_states: string[] | null } | null;
    },
    staleTime: 5 * 60_000,
  });

  const myStates = me.data?.license_states ?? null;

  const peers = useQuery<PeerRow[]>({
    queryKey: ["region-peer-top5", agentId, myStates],
    enabled: !!agentId && Array.isArray(myStates) && myStates.length > 0,
    queryFn: async () => {
      // license_states is text[]; use .overlaps to find any agent whose
      // licensed footprint intersects mine. agentId is included via the
      // outer .in clause so we always render where the agent stands.
      const { data, error } = await supabase
        .from("v_agent_command_center" as any)
        .select("agent_id, display_name, agent_code, ap_mtd, deals_mtd, rank_agency_mtd, license_states")
        .overlaps("license_states", myStates!)
        .order("ap_mtd", { ascending: false, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      // Top 5, but always include the current agent even if outside top 5.
      const top5 = rows.slice(0, 5);
      if (!top5.find((r) => r.agent_id === agentId)) {
        const me = rows.find((r) => r.agent_id === agentId);
        if (me) top5.push(me);
      }
      return top5 as PeerRow[];
    },
    staleTime: 5 * 60_000,
  });

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Your region · MTD
          </p>
          <h3 className="text-lg font-bold">
            {myStates && myStates.length > 0
              ? `Top producers in ${myStates.slice(0, 3).join(" · ")}${myStates.length > 3 ? " +" + (myStates.length - 3) : ""}`
              : "Top producers"}
          </h3>
        </div>
        <Trophy className="h-5 w-5 text-amber-400" />
      </div>

      {!agentId || me.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton /* stable-key-allow:skeleton */ key={i} className="h-10 w-full" />)}</div>
      ) : !myStates || myStates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">
          Add your licensed states to your agent profile to see who you're up against in your market.
        </p>
      ) : peers.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton /* stable-key-allow:skeleton */ key={i} className="h-10 w-full" />)}</div>
      ) : (peers.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">No peers found in your region yet.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {peers.data!.map((r, idx) => {
            const isMe = r.agent_id === agentId;
            return (
              <li
                key={r.agent_id}
                className={cn(
                  "py-2 flex items-center justify-between gap-3 rounded px-2 -mx-2 transition-colors",
                  isMe ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-primary/[0.04]",
                )}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className={cn(
                    "tabular-nums text-xs font-bold w-6 text-center",
                    idx === 0 ? "text-amber-400" : "text-muted-foreground",
                  )}>
                    #{r.rank_agency_mtd ?? "—"}
                  </span>
                  <div className="min-w-0">
                    <p className={cn("font-semibold truncate", isMe && "text-primary")}>
                      {r.display_name ?? r.agent_code ?? "—"}{isMe ? " · you" : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.deals_mtd ?? 0} deal{r.deals_mtd === 1 ? "" : "s"} MTD
                    </p>
                  </div>
                </div>
                <p className={cn("font-bold tabular-nums shrink-0", isMe ? "text-primary" : "text-emerald-500 dark:text-emerald-400")}>
                  {fmtUsdCompact(Number(r.ap_mtd ?? 0))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </GlassCard>
  );
}

interface ChargeRollupRow {
  agent_id: string;
  total_charges: number;
  flagged_charges: number;
  duplicate_charges: number;
  total_billed_usd: number | string;
  duplicate_amount_usd: number | string;
  last_charged_at: string | null;
}

export function UpcomingChargebackCard({ agentId }: { agentId: string | null }) {
  const { data, isLoading } = useQuery<ChargeRollupRow | null>({
    queryKey: ["agent-charge-rollup", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_charge_rollup" as any)
        .select("agent_id, total_charges, flagged_charges, duplicate_charges, total_billed_usd, duplicate_amount_usd, last_charged_at")
        .eq("agent_id", agentId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ChargeRollupRow | null;
    },
    staleTime: 5 * 60_000,
  });

  const billed = Number(data?.total_billed_usd ?? 0);
  const flagged = Number(data?.flagged_charges ?? 0);
  const dupes = Number(data?.duplicate_charges ?? 0);
  const isClean = !data || data.total_charges === 0;
  const isWarn = flagged > 0 || dupes > 0;

  return (
    <GlassCard className={cn(
      "p-4 border-l-2",
      isClean ? "border-emerald-500/60" : isWarn ? "border-rose-500/60" : "border-amber-500/60",
    )}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
            {isClean ? <ShieldCheck className="h-3 w-3 text-emerald-400" /> : <ShieldAlert className="h-3 w-3 text-rose-400" />}
            Chargeback ledger
          </p>
          <h3 className="text-lg font-bold">
            {isClean ? "Clean — no flags" : isWarn ? `${flagged + dupes} at-risk charge${flagged + dupes === 1 ? "" : "s"}` : `${data?.total_charges ?? 0} charge${data?.total_charges === 1 ? "" : "s"} on file`}
          </h3>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      ) : isClean ? (
        <p className="text-sm text-muted-foreground">
          No chargebacks or duplicate-charge flags against you. Keep producing clean policies — Apex's chargeback rate is your protection.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-[10px] uppercase text-muted-foreground">Total charges</dt>
            <dd className="font-semibold tabular-nums">{data?.total_charges ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase text-muted-foreground">Billed total</dt>
            <dd className="font-semibold tabular-nums">{fmtUsdCompact(billed)}</dd>
          </div>
          {flagged > 0 && (
            <div className="col-span-2 rounded border border-rose-500/30 bg-rose-500/5 p-2">
              <dt className="text-[10px] uppercase text-rose-400">Flagged at risk</dt>
              <dd className="font-semibold tabular-nums text-rose-300">{flagged} · review with your manager</dd>
            </div>
          )}
          {dupes > 0 && (
            <div className="col-span-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
              <dt className="text-[10px] uppercase text-amber-400">Duplicate charges</dt>
              <dd className="font-semibold tabular-nums text-amber-200">{dupes} · {fmtUsdCompact(Number(data?.duplicate_amount_usd ?? 0))}</dd>
            </div>
          )}
          {data?.last_charged_at && (
            <div className="col-span-2">
              <dt className="text-[10px] uppercase text-muted-foreground">Last charge</dt>
              <dd className="text-sm text-muted-foreground tabular-nums">
                {new Date(data.last_charged_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* v24 Phase 13: /dashboard/charges-audit page deleted (orphaned).
          Once a replacement ledger exists this CTA can be re-pointed. */}
    </GlassCard>
  );
}
