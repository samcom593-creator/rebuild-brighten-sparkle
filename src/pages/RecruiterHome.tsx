import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  PhoneForwarded,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { RecruiterBountyCard } from "@/components/dashboard/RecruiterBountyCard";
import { FreeLeadsStatusCard } from "@/components/dashboard/FreeLeadsStatusCard";

/**
 * RecruiterHome — MP-332 (2026-08-27)
 *
 * The /dashboard home for account_mode = 'recruiter' ("Pure Recruiter": recruits
 * only, no production book, no sales team). Everything here is scoped to the
 * recruits attributed to this person (applications.recruiter_id = their agent
 * row — 806/806 rows carry it), so a recruiter sees their own funnel, never the
 * agency's. Counts never fake a zero: a failed read renders as a failure.
 * Independent of AgentLink/InsuraCloud by construction.
 */

interface RecruitRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  created_at: string;
  last_contacted_at: string | null;
}

const STATUS_TONE: Record<string, string> = {
  new: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  reviewing: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  interview: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  contracting: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  approved: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  onboarding: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  producing: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  no_pickup: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

function useMyAgent(userId: string | undefined) {
  return useQuery({
    queryKey: ["recruiter-home-agent", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("agents")
        .select("id, display_name")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

async function countWhere(agentId: string, apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>) {
  const { count, error } = await apply(baseQuery(agentId));
  if (error) throw new Error(error.message);
  return count ?? 0;
}
const baseQuery = (agentId: string) =>
  supabase.from("applications").select("id", { count: "exact", head: true }).eq("recruiter_id", agentId);

interface Tile {
  key: string;
  label: string;
  desc: string;
  href: string;
  icon: typeof Users;
  count: (agentId: string) => Promise<number>;
}

const sevenDaysAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const TILES: Tile[] = [
  {
    key: "new7",
    label: "New this week",
    desc: "Applied in the last 7 days",
    href: "/dashboard/recruiting",
    icon: UserPlus,
    count: (a) => countWhere(a, (q) => q.gte("created_at", sevenDaysAgo())),
  },
  {
    key: "contact",
    label: "In contact",
    desc: "New or reviewing — keep them warm",
    href: "/dashboard/recruiting",
    icon: PhoneForwarded,
    count: (a) => countWhere(a, (q) => q.in("status", ["new", "reviewing"])),
  },
  {
    key: "interview",
    label: "Interview stage",
    desc: "Booked or being scheduled",
    href: "/dashboard/recruiting/interviews",
    icon: CalendarClock,
    count: (a) => countWhere(a, (q) => q.eq("status", "interview")),
  },
  {
    key: "contracting",
    label: "Contracting",
    desc: "Approved and getting contracted",
    href: "/dashboard/recruiting",
    icon: Briefcase,
    count: (a) => countWhere(a, (q) => q.in("status", ["contracting", "approved"])),
  },
  {
    key: "hired",
    label: "Onboarding / live",
    desc: "Your recruits who made it through",
    href: "/dashboard/recruiting/hires",
    icon: Users,
    count: (a) => countWhere(a, (q) => q.in("status", ["onboarding", "producing", "paid"])),
  },
  {
    key: "followup",
    label: "Needs follow-up",
    desc: "In contact, silent 7+ days",
    href: "/dashboard/recruiting/follow-ups",
    icon: ArrowRight,
    count: (a) =>
      countWhere(a, (q) =>
        q.in("status", ["new", "reviewing"]).or(`last_contacted_at.lt.${sevenDaysAgo()},last_contacted_at.is.null`),
      ),
  },
];

function TileCard({ tile, agentId }: { tile: Tile; agentId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["recruiter-home-tile", tile.key, agentId],
    queryFn: () => tile.count(agentId),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
  const Icon = tile.icon;
  return (
    <Link to={tile.href} className="group block">
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex h-full flex-col justify-between gap-4 p-4">
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted/40">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <div>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : isError ? (
              <p className="text-sm font-medium text-rose-500">count failed</p>
            ) : (
              <p className="text-3xl font-bold tabular-nums">{(data ?? 0).toLocaleString()}</p>
            )}
            <p className="mt-1 text-sm font-semibold">{tile.label}</p>
            <p className="text-xs text-muted-foreground">{tile.desc}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function RecruiterHome() {
  const brand = useBrand();
  usePageTitle(`Recruiter Command · ${brand.shortName}`);
  const { user } = useAuth();
  const agent = useMyAgent(user?.id);
  const agentId = agent.data?.id;

  const recent = useQuery({
    queryKey: ["recruiter-home-recent", agentId],
    queryFn: async (): Promise<RecruitRow[]> => {
      if (!agentId) return [];
      const { data, error } = await supabase
        .from("applications")
        .select("id, first_name, last_name, status, created_at, last_contacted_at")
        .eq("recruiter_id", agentId)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as RecruitRow[];
    },
    enabled: Boolean(agentId),
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  if (agent.isLoading) {
    return (
      <div className="page-enter space-y-4 px-4 pb-24 sm:px-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Recruiter · Command Center"
        eyebrowIcon={<Briefcase className="h-3 w-3" />}
        title="My recruits"
        subtitle={agentId ? "Your funnel, your follow-ups, your link. Nothing here depends on production." : "No recruiter record is linked to this login yet — ask an admin to set your account mode."}
        actions={(
          <Button asChild size="sm">
            <Link to="/dashboard/recruiting">Open pipeline</Link>
          </Button>
        )}
      />

      {/* Recruiting link + $500 Producer Bounty (live progress) */}
      <RecruiterBountyCard agentId={agentId} />
      {agentId ? <FreeLeadsStatusCard agentId={agentId} /> : null}

      {/* Funnel tiles */}
      {agentId ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((tile) => <TileCard key={tile.key} tile={tile} agentId={agentId} />)}
        </div>
      ) : null}

      {/* Recent recruits */}
      {agentId ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Recent recruits</CardTitle>
            <Button asChild size="sm" variant="ghost" className="gap-1">
              <Link to="/dashboard/recruiting">All <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : recent.isError ? (
              <p className="text-sm text-rose-500">Could not load your recruits.</p>
            ) : (recent.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No recruits attributed to you yet. Share your link to start.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.data!.map((r) => {
                  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
                  const status = r.status ?? "new";
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          Applied {shortDate(r.created_at)} · Last contact {shortDate(r.last_contacted_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className={STATUS_TONE[status] ?? ""}>{status.replace(/_/g, " ")}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/recruiting/interviews">Interviews</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/recruiting/follow-ups">Follow-ups</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/admin/invite-links">Invite an agent</Link></Button>
        <Button asChild size="sm" variant="outline"><Link to="/dashboard/recruiter">Recruiter cockpit</Link></Button>
      </div>
    </div>
  );
}
