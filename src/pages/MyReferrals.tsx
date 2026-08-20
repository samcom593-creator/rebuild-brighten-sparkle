import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Plus, DollarSign, Trophy, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { format } from "date-fns";

interface AgentReferralRow {
  referral_id: string;
  referrer_agent_id: string;
  referred_name: string;
  referred_email: string | null;
  referred_phone: string | null;
  status: string;
  created_at: string;
  bonus_owed_cents: number | null;
  bonus_paid_cents: number | null;
  lifecycle: "open" | "closed_won" | "closed_dead";
}

// PL-093: per-agent earnings rollup from v_referral_earnings_pending.
interface ReferralEarningsRow {
  agent_id: string;
  agent_name: string | null;
  total_referrals: number;
  open_count: number;
  won_count: number;
  dead_count: number;
  bonus_owed_cents: number;
  bonus_paid_cents: number;
  bonus_pending_cents: number;
  last_referral_at: string | null;
}

const LIFECYCLE_LABEL: Record<string, string> = {
  open: "In progress",
  closed_won: "Closed · won",
  closed_dead: "Closed · dead",
};

export default function MyReferrals() {
  usePageTitle("My referrals · APEX");
  const { user } = useAuth();

  const { data: myAgentId } = useQuery({
    queryKey: ["my-agent-id", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.id as string | undefined;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["my-referrals", myAgentId],
    enabled: !!myAgentId,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_referrals" as any).select("referral_id,referrer_agent_id,referred_name,referred_email,referred_phone,status,created_at,bonus_owed_cents,bonus_paid_cents,lifecycle")
        .eq("referrer_agent_id", myAgentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AgentReferralRow[];
    },
  });

  // PL-093: pull this agent's earnings rollup so we can show pending bonus
  // up top before they scroll through individual referrals.
  const { data: earnings } = useQuery({
    queryKey: ["my-referral-earnings", myAgentId],
    enabled: !!myAgentId,
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_referral_earnings_pending" as any).select("agent_id,total_referrals,open_count,won_count,bonus_owed_cents,bonus_paid_cents,bonus_pending_cents")
        .eq("agent_id", myAgentId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ReferralEarningsRow | null;
    },
  });

  if (isLoading) return <PageLoadingSkeleton />;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <PageHeader
        accent="blue"
        eyebrow="Referrals"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="My Referrals"
        subtitle={`${data?.length ?? 0} referral${(data?.length ?? 0) === 1 ? "" : "s"} sent across your career.`}
        actions={
          <Button asChild size="sm">
            <Link to="/dashboard/referrals/new"><Plus className="h-4 w-4 mr-1" /> Submit referral</Link>
          </Button>
        }
      />

      {/* PL-093: earnings summary tiles — pending bonus visible above the fold */}
      {earnings && earnings.total_referrals > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                Pending
              </div>
              <p className="text-2xl font-bold tabular-nums text-emerald-400 mt-1">
                ${(earnings.bonus_pending_cents / 100).toFixed(0)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Owed, not paid yet</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                Paid out
              </div>
              <p className="text-2xl font-bold tabular-nums mt-1">
                ${(earnings.bonus_paid_cents / 100).toFixed(0)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Lifetime</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Sent
              </div>
              <p className="text-2xl font-bold tabular-nums mt-1">{earnings.total_referrals}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{earnings.won_count} won · {earnings.open_count} open</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Win rate
              </div>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {earnings.total_referrals - earnings.open_count > 0
                  ? Math.round((earnings.won_count / (earnings.total_referrals - earnings.open_count)) * 100)
                  : 0}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Closed-won / closed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {(["open", "closed_won", "closed_dead"] as const).map((bucket) => {
        const rows = (data ?? []).filter((r) => r.lifecycle === bucket);
        if (rows.length === 0) return null;
        return (
          <Card key={bucket}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {LIFECYCLE_LABEL[bucket]}
                <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border/50 p-0">
              {rows.map((r) => (
                <div key={r.referral_id} className="flex items-center justify-between gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{r.referred_name}</span>
                      <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.referred_email ?? r.referred_phone ?? ""} · {format(new Date(r.created_at), "MMM d")}
                    </div>
                  </div>
                  {r.bonus_owed_cents != null && r.bonus_owed_cents > 0 && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Bonus </span>
                      <span className="font-medium tabular-nums">${(r.bonus_owed_cents / 100).toFixed(0)}</span>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {data && data.length === 0 && (
        <Card>
          <CardContent className="text-center py-12 text-sm text-muted-foreground">
            You haven't sent any referrals yet.
            <div className="mt-3">
              <Button asChild size="sm"><Link to="/dashboard/referrals/new">Submit your first</Link></Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
