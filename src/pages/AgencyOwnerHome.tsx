import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  GraduationCap,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyDownline } from "@/hooks/useMyDownline";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { RecruiterBountyCard } from "@/components/dashboard/RecruiterBountyCard";
import { FreeLeadsStatusCard } from "@/components/dashboard/FreeLeadsStatusCard";

/**
 * AgencyOwnerHome — MP-332 (2026-08-27)
 *
 * The /dashboard home for account_mode = 'agency_owner': someone who runs their
 * own sub-agency under Sam (e.g. KJ Vaughn / Vantage). Rendered BELOW
 * ScopedProductionScoreboard in Dashboard.tsx, which already scopes money to
 * "You + downline" off v_production_unified (proven for KJ: 17 downline,
 * $44,559 at his 105% comp). So this cockpit deliberately carries NO money of
 * its own — a second dollar figure from a second source is how the home
 * dashboard and the board drifted apart in the first place.
 *
 * What it owns: the owner's roster (who is live / licensed / still onboarding),
 * hires in the last 30 days and who they route to, and the recruiting funnel
 * feeding their agency. Every read is bounded to the owner's hierarchy via
 * my_downline_agent_ids (self + all descendants). Never reads AgentLink or
 * InsuraCloud.
 */

interface RosterAgent {
  id: string;
  display_name: string | null;
  status: string | null;
  license_status: string | null;
  onboarding_stage: string | null;
  created_at: string;
  invited_by_manager_id: string | null;
  manager_id: string | null;
}

interface RecruitRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  created_at: string;
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

// PostgREST URL-length: keep .in() lists to 100 ids per request.
const chunk = <T,>(arr: T[], size = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const daysAgoIso = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

function Tile({ icon: Icon, label, value, desc, href, tone }: {
  icon: typeof Users; label: string; value: string | number; desc: string; href: string; tone?: string;
}) {
  return (
    <Link to={href} className="group block">
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <div>
            <p className={`text-3xl font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
            <p className="mt-1 text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function AgencyOwnerHome() {
  const brand = useBrand();
  usePageTitle(`Agency Owner · ${brand.shortName}`);
  const { user } = useAuth();
  const downline = useMyDownline();
  const downlineIds = downline.data ?? [];

  const me = useQuery({
    queryKey: ["agency-owner-me", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
  });

  const roster = useQuery({
    queryKey: ["agency-owner-roster", [...downlineIds].sort()],
    queryFn: async (): Promise<RosterAgent[]> => {
      const rows: RosterAgent[] = [];
      for (const ids of chunk(downlineIds)) {
        const { data, error } = await supabase
          .from("agents")
          .select("id, display_name, status, license_status, onboarding_stage, created_at, invited_by_manager_id, manager_id")
          .in("id", ids);
        if (error) throw error;
        rows.push(...((data ?? []) as RosterAgent[]));
      }
      return rows;
    },
    enabled: downlineIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const recruits = useQuery({
    queryKey: ["agency-owner-recruits", [...downlineIds].sort()],
    queryFn: async (): Promise<RecruitRow[]> => {
      const rows: RecruitRow[] = [];
      for (const ids of chunk(downlineIds)) {
        const { data, error } = await supabase
          .from("applications")
          .select("id, first_name, last_name, status, created_at")
          .in("recruiter_id", ids)
          .gte("created_at", daysAgoIso(30))
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        rows.push(...((data ?? []) as RecruitRow[]));
      }
      return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    enabled: downlineIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const stats = useMemo(() => {
    const rows = roster.data ?? [];
    const nameById = new Map(rows.map((r) => [r.id, r.display_name ?? "—"]));
    const active = rows.filter((r) => r.status === "active");
    const licensed = active.filter((r) => r.license_status === "licensed");
    const onboarding = active.filter((r) => r.onboarding_stage !== "live");
    const cutoff = daysAgoIso(30);
    const hires30 = rows
      .filter((r) => r.created_at >= cutoff)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((r) => ({
        ...r,
        routed_to: nameById.get(r.invited_by_manager_id ?? r.manager_id ?? "") ?? (me.data?.display_name ?? "you"),
      }));
    return { total: rows.length, active: active.length, licensed: licensed.length, onboarding: onboarding.length, hires30 };
  }, [roster.data, me.data?.display_name]);

  const funnel = useMemo(() => {
    const rows = recruits.data ?? [];
    const inStatus = (s: string[]) => rows.filter((r) => r.status && s.includes(r.status)).length;
    return {
      new7: rows.filter((r) => r.created_at >= daysAgoIso(7)).length,
      interview: inStatus(["interview"]),
      contracting: inStatus(["contracting", "approved"]),
      total30: rows.length,
    };
  }, [recruits.data]);

  const ownerName = me.data?.display_name ?? "—";
  const loadingRoster = downline.isLoading || (downlineIds.length > 0 && roster.isLoading);

  return (
    <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Agency Owner · Command Center"
        eyebrowIcon={<Building2 className="h-3 w-3" />}
        title={`${ownerName}'s agency`}
        subtitle={
          downline.isLoading
            ? "Loading your hierarchy…"
            : downlineIds.length <= 1
              ? "No agents in your hierarchy yet. Invite your first agent to start building."
              : `${downlineIds.length - 1} agents in your hierarchy · production above is scoped to you + your downline`
        }
        actions={(
          <Button asChild size="sm">
            <Link to="/dashboard/team">Open my team</Link>
          </Button>
        )}
      />

      {/* Roster tiles */}
      {loadingRoster ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-32 w-full" />)}
        </div>
      ) : roster.isError ? (
        <Card><CardContent className="p-4 text-sm text-rose-500">Could not load your roster.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile icon={Users} label="Active agents" value={stats.active} desc={`${stats.total} total in hierarchy`} href="/dashboard/team" />
          <Tile icon={UserCheck} label="Licensed" value={stats.licensed} desc="Active and licensed" href="/dashboard/team" tone="text-emerald-500" />
          <Tile icon={GraduationCap} label="Still onboarding" value={stats.onboarding} desc="Active, not yet live" href="/dashboard/team" tone="text-amber-500" />
          <Tile icon={UserPlus} label="Hired · 30 days" value={stats.hires30.length} desc="New agents in your agency" href="/dashboard/recruiting/hires" />
        </div>
      )}

      {/* Owner's own recruiting link + $500 Producer Bounty progress */}
      <RecruiterBountyCard agentId={me.data?.id} />
      {me.data?.id ? <FreeLeadsStatusCard agentId={me.data.id} /> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Just hired in my agency */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Just hired · your agency</CardTitle>
            <Button asChild size="sm" variant="ghost" className="gap-1">
              <Link to="/dashboard/team">Team <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingRoster ? (
              <Skeleton className="h-24 w-full" />
            ) : stats.hires30.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hires in the last 30 days.</p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.hires30.slice(0, 8).map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{h.display_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Routed to {h.routed_to} · {shortDate(h.created_at)}</p>
                    </div>
                    <Badge variant="outline" className={h.license_status === "licensed" ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                      {h.license_status === "licensed" ? "licensed" : "unlicensed"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recruiting funnel feeding my agency */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Recruiting · last 30 days</CardTitle>
            <Button asChild size="sm" variant="ghost" className="gap-1">
              <Link to="/dashboard/recruiting">Pipeline <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recruits.isLoading && downlineIds.length > 0 ? (
              <Skeleton className="h-24 w-full" />
            ) : recruits.isError ? (
              <p className="text-sm text-rose-500">Could not load recruiting.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><p className="text-2xl font-bold tabular-nums">{funnel.total30}</p><p className="text-xs text-muted-foreground">Applied</p></div>
                <div><p className="text-2xl font-bold tabular-nums">{funnel.new7}</p><p className="text-xs text-muted-foreground">This week</p></div>
                <div><p className="text-2xl font-bold tabular-nums text-amber-500">{funnel.interview}</p><p className="text-xs text-muted-foreground">Interviewing</p></div>
                <div><p className="text-2xl font-bold tabular-nums text-emerald-500">{funnel.contracting}</p><p className="text-xs text-muted-foreground">Contracting</p></div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/recruiting/interviews"><CalendarClock className="mr-1.5 h-3.5 w-3.5" />Interviews</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/leaderboard"><Trophy className="mr-1.5 h-3.5 w-3.5" />Leaderboard</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/admin/invite-links"><UserPlus className="mr-1.5 h-3.5 w-3.5" />Invite an agent</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/analytics">Reports</Link></Button>
      </div>
    </div>
  );
}
