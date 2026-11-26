// PL-040: two cards that turn the agent dashboard from a stat clone into a
// command center.
//
// RegionPeerCard — top 5 producers MTD whose license_states overlap with the
// current agent's licensed footprint. Highlights the current agent's row so
// they know where they stand in their actual market, not just agency-wide.
//
// UpcomingChargebackCard — the agent's CARRIER chargebacks from
// carrier_book_chargebacks (imported carrier statements; RLS lets an agent read
// their own rows and their downline's). MP-PROJ-INP-TRUTH (2026-11-25) moved it
// here from v_agent_charge_rollup, which (a) was Stripe lead/card CHARGES billed
// to the agent, not chargebacks, and (b) is gated WHERE is_owner(), so for every
// non-owner it returned zero rows and the card printed "Clean — no flags" while
// 10 agents carried 57 chargebacks / $15,699 in the carrier table, five of them
// at Foresters' FINAL collection stage. A card that could only ever be green was
// the 465-row fake-success disease on a money surface.

import { useQuery } from "@tanstack/react-query";
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
      // Throw on a dead read so React Query surfaces me.isError. Swallowing the
      // error (the old `const { data } = await …`) made a failed agents read
      // succeed with null → myStates null → the card told the agent to "add your
      // licensed states" when the feed had merely died.
      const { data, error } = await supabase
        .from("agents")
        .select("id, license_states")
        .eq("id", agentId!)
        .maybeSingle();
      if (error) throw error;
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
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
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
      ) : me.isError ? (
        <p className="text-sm text-rose-400/90 py-3 text-center">
          Couldn't load your region right now — feed error, not an empty market.
          <button type="button" onClick={() => me.refetch()} className="underline underline-offset-2 ml-1 hover:text-foreground">Retry</button>
        </p>
      ) : !myStates || myStates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">
          Add your licensed states to your agent profile to see who you're up against in your market.
        </p>
      ) : peers.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton /* stable-key-allow:skeleton */ key={i} className="h-10 w-full" />)}</div>
      ) : peers.isError ? (
        <p className="text-sm text-rose-400/90 py-3 text-center">
          Couldn't load peers right now — feed error, not an empty region.
          <button type="button" onClick={() => peers.refetch()} className="underline underline-offset-2 ml-1 hover:text-foreground">Retry</button>
        </p>
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
                    <p className="text-[12px] text-muted-foreground">
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

interface CarrierChargebackRow {
  carrier: string | null;
  policy_number: string | null;
  amount: number | string | null;
  chargeback_on: string | null;
  status: string | null;
  reason: string | null;
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

/** "paid_to:Samuel James" is how the import records a chargeback applied to a statement. */
const chargebackStatusLabel = (status: string | null) => {
  if (!status) return "status not on file";
  if (status.startsWith("paid_to:")) return `applied to ${status.slice("paid_to:".length).trim() || "a statement"}`;
  return status;
};

export function UpcomingChargebackCard({ agentId }: { agentId: string | null }) {
  const { data, isLoading, isError, refetch } = useQuery<CarrierChargebackRow[]>({
    queryKey: ["agent-carrier-chargebacks", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carrier_book_chargebacks" as any)
        .select("carrier, policy_number, amount, chargeback_on, status, reason")
        .eq("agent_id", agentId!)
        .order("chargeback_on", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as CarrierChargebackRow[];
    },
    staleTime: 5 * 60_000,
  });

  // A dead read makes `data` undefined, which an "empty means clean" branch would
  // render as a confident green card. That is a money lie: carrier chargebacks hit
  // commissions, and a dead feed is NOT a clean record. Gate on isError FIRST.
  if (isError) {
    return (
      <GlassCard className="p-4 border-l-2 border-rose-500/60">
        <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
          <ShieldAlert className="h-3 w-3 text-rose-400" /> Carrier chargebacks
        </p>
        <h3 className="text-lg font-bold mt-1">Chargebacks didn't load</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Your carrier chargebacks couldn't be read right now. This is a feed error — not a clean record. Don't read it as "no chargebacks."
          <button type="button" onClick={() => refetch()} className="underline underline-offset-2 ml-1 hover:text-foreground">
            Retry
          </button>
        </p>
      </GlassCard>
    );
  }

  const rows = data ?? [];
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const outstanding = rows.filter((r) => (r.status ?? "").toLowerCase() === "outstanding");
  const carriers = Array.from(new Set(rows.map((r) => r.carrier).filter((c): c is string => Boolean(c))));
  const hasRows = rows.length > 0;

  return (
    <GlassCard className={cn(
      "p-4 border-l-2",
      isLoading ? "border-border" : !hasRows ? "border-emerald-500/60" : outstanding.length > 0 ? "border-rose-500/60" : "border-amber-500/60",
    )}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
            {!isLoading && !hasRows ? <ShieldCheck className="h-3 w-3 text-emerald-400" /> : <ShieldAlert className="h-3 w-3 text-rose-400" />}
            Carrier chargebacks
          </p>
          <h3 className="text-lg font-bold">
            {isLoading ? "Reading carrier statements…" : !hasRows ? "None on file" : `${rows.length} chargeback${rows.length === 1 ? "" : "s"} · ${fmtUsdCompact(total)}`}
          </h3>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      ) : !hasRows ? (
        <p className="text-sm text-muted-foreground">
          No carrier chargebacks are recorded against your agent record in the carrier statements on file. This reads the imported statements, not a live carrier feed; a chargeback a carrier has not yet reported, or one filed under a different agent record, will not show here.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-[11px] uppercase text-muted-foreground">Charged back</dt>
            <dd className="font-semibold tabular-nums">{fmtUsdCompact(total)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase text-muted-foreground">Carriers</dt>
            <dd className="font-semibold">{carriers.length ? carriers.join(", ") : "not on file"}</dd>
          </div>
          {outstanding.length > 0 && (
            <div className="col-span-2 rounded border border-rose-500/30 bg-rose-500/5 p-2">
              <dt className="text-[11px] uppercase text-rose-400">Outstanding</dt>
              <dd className="font-semibold tabular-nums text-rose-300">
                {outstanding.length} · {fmtUsdCompact(outstanding.reduce((s, r) => s + (Number(r.amount) || 0), 0))} · settle with the carrier or your manager
              </dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-[11px] uppercase text-muted-foreground">Most recent</dt>
            <dd className="text-sm text-muted-foreground tabular-nums">
              {fmtDate(rows[0]?.chargeback_on)}{rows[0]?.carrier ? ` · ${rows[0].carrier}` : ""}{rows[0]?.policy_number ? ` · #${rows[0].policy_number}` : ""} · {chargebackStatusLabel(rows[0]?.status ?? null)}
            </dd>
          </div>
        </dl>
      )}
    </GlassCard>
  );
}
