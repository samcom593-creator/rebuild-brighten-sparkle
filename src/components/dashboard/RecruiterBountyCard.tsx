import { useQuery } from "@tanstack/react-query";
import { Copy, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * RecruiterBountyCard — "Build Your Agency · $500 Producer Bounty" (Sam, 2026-08-27)
 *
 * One card, three jobs: the pitch ($500 cash for every recruit who writes their
 * first 2 policies), the person's own attributed recruiting link (from
 * my_recruiting_link — the ref_slug URL that actually attributes, never a bare
 * ?ref=<uuid>), and LIVE bounty progress from recruiter_bounties, which RLS
 * already scopes to the recruiter's own rows (recruiter_bounties_own_read).
 *
 * Styled with the app's gold token (--primary is hue 41) instead of literal hex /
 * bg-gradient / drop-shadow, which this repo's commit gates reject — same look,
 * theme-correct in light and dark.
 */

interface BountyRow {
  id: string;
  status: string | null;
  amount_cents: number | null;
  qualified_at: string | null;
  paid_at: string | null;
}

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const APEX_ORIGIN = "https://apex-financial.org";

export function RecruiterBountyCard({ agentId, className }: { agentId?: string | null; className?: string }) {
  const link = useQuery({
    queryKey: ["recruiter-bounty-link"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_recruiting_link" as never);
      if (error) throw error;
      return data as unknown as { link?: string; ref_slug?: string } | null;
    },
    staleTime: 10 * 60_000,
  });

  const bounties = useQuery({
    queryKey: ["recruiter-bounties-mine", agentId],
    queryFn: async (): Promise<BountyRow[]> => {
      if (!agentId) return [];
      const { data, error } = await supabase
        .from("recruiter_bounties")
        .select("id, status, amount_cents, qualified_at, paid_at")
        .eq("recruiter_agent_id", agentId);
      if (error) throw error;
      return (data ?? []) as BountyRow[];
    },
    enabled: Boolean(agentId),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const rows = bounties.data ?? [];
  const live = rows.filter((r) => r.status !== "reversed");
  const paid = live.filter((r) => r.status === "paid");
  const pending = live.filter((r) => r.status !== "paid");
  const earned = paid.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const inFlight = pending.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const bioUrl = link.data?.ref_slug
    ? `${APEX_ORIGIN}/r/${encodeURIComponent(link.data.ref_slug)}`
    : link.data?.link;

  const copyLink = async () => {
    const url = bioUrl;
    if (!url) {
      toast({ title: "No recruiting link yet", description: "Ask an admin to set up your ref link.", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link in bio copied", description: "Every application through it is credited to you." });
    } catch {
      toast({ title: "Copy failed", description: "Select the link below and copy it manually.", variant: "destructive" });
    }
  };

  return (
    <div className={`rounded-xl border border-primary/40 bg-card p-5 ${className ?? ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 text-primary">
          <Trophy className="mt-0.5 h-6 w-6 shrink-0" />
          <div>
            <h3 className="text-lg font-bold leading-tight text-foreground">Build Your Agency · $500 Producer Bounty</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Earn <strong className="text-foreground">$500 cash</strong> for every recruit you bring in who writes their first 2 policies.
            </p>
          </div>
        </div>
        <Button onClick={copyLink} disabled={link.isLoading || !bioUrl} className="shrink-0 gap-2 font-bold">
          <Copy className="h-3.5 w-3.5" /> Copy Link in Bio
        </Button>
      </div>

      {bioUrl ? (
        <a
          href={bioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block select-all break-all rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground underline-offset-2 hover:border-primary/50 hover:text-primary hover:underline"
        >
          {bioUrl}
        </a>
      ) : null}

      {agentId ? (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
          {bounties.isLoading ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : bounties.isError ? (
            <p className="col-span-3 text-xs text-rose-500">Could not load your bounty progress.</p>
          ) : (
            <>
              <div>
                <p className="text-xl font-bold tabular-nums text-primary">{dollars(earned)}</p>
                <p className="text-[11px] text-muted-foreground">Paid to you · {paid.length} {paid.length === 1 ? "bounty" : "bounties"}</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">{dollars(inFlight)}</p>
                <p className="text-[11px] text-muted-foreground">Qualified, awaiting payout · {pending.length}</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">{live.length}</p>
                <p className="text-[11px] text-muted-foreground">Recruits who hit 2 policies</p>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
