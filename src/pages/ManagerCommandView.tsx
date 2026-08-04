import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarCheck,
  GraduationCap,
  PhoneIncoming,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyDownline } from "@/hooks/useMyDownline";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ManagerPostCounter } from "@/components/dashboard/ManagerPostCounter";

interface AgentRow {
  id: string;
  display_name: string | null;
  al_user_id: number | null;
  monthly_premium: number;
  monthly_deals: number;
}

function money(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * ManagerCommandView — v13 Wave B (2026-06-10)
 *
 * Sam: "Manager dashboards should be custom to them too."
 *
 * Renders for users with role=manager. Shows their downline's production,
 * top producers, hiring funnel, and today's calls. Reads from
 * agentlink_deals_snapshot (truth view) for $ — falls back to a clear empty
 * state if their agents don't have al_user_id mapped yet.
 */
export default function ManagerCommandView() {
  usePageTitle("Manager Command · APEX");
  const { user } = useAuth();
  const { data: downlineIds = [] } = useMyDownline();

  // Downline production this month (from AgentLink truth)
  const downlineProd = useQuery({
    queryKey: ["mgr-downline-prod", downlineIds.join(",")],
    staleTime: 5 * 60_000,
    enabled: downlineIds.length > 0,
    queryFn: async () => {
      // Resolve agentlink user_ids for downline
      const { data: agents } = await supabase
        .from("agents")
        .select("id, display_name, al_user_id")
        .in("id", downlineIds);
      const alIds = (agents ?? []).map((a) => a.al_user_id).filter(Boolean) as number[];
      if (alIds.length === 0) return { agents: agents ?? [], rows: [] as Array<{ user_id: number; premium: number; count: number }> };

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { data: deals } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("user_id, annual_premium, effective_date")
        .in("user_id", alIds)
        .gte("effective_date", monthStart.toISOString().slice(0, 10));

      const byUser = new Map<number, { user_id: number; premium: number; count: number }>();
      for (const d of (deals as Array<{ user_id: number; annual_premium: number }>) ?? []) {
        if (d.user_id == null) continue;
        const r = byUser.get(d.user_id) ?? { user_id: d.user_id, premium: 0, count: 0 };
        r.premium += Number(d.annual_premium ?? 0);
        r.count += 1;
        byUser.set(d.user_id, r);
      }
      return { agents: agents ?? [], rows: Array.from(byUser.values()) };
    },
  });

  // Stuck applicants in downline (no contact 7d+)
  const stuck = useQuery({
    queryKey: ["mgr-stuck", downlineIds.join(",")],
    staleTime: 5 * 60_000,
    enabled: downlineIds.length > 0,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase
        .from("applications")
        .select("id, first_name, last_name, last_contacted_at")
        .in("assigned_agent_id", downlineIds)
        .or(`last_contacted_at.lt.${since},last_contacted_at.is.null`)
        .limit(20);
      return data ?? [];
    },
  });

  // Upcoming calls scoped to manager
  const calls = useQuery({
    queryKey: ["mgr-upcoming-calls"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("v_upcoming_calls" as any)
        .select("id, prospect_name, prospect_phone, start_at, call_type")
        .limit(5);
      return data ?? [];
    },
  });

  const agentRows: AgentRow[] = useMemo(() => {
    const agents = downlineProd.data?.agents ?? [];
    const rows = downlineProd.data?.rows ?? [];
    const prodByUser = new Map(rows.map((r) => [r.user_id, r]));
    return agents.map((a) => {
      const r = a.al_user_id ? prodByUser.get(a.al_user_id as number) : null;
      return {
        id: a.id,
        display_name: a.display_name,
        al_user_id: a.al_user_id as number | null,
        monthly_premium: r?.premium ?? 0,
        monthly_deals: r?.count ?? 0,
      };
    });
  }, [downlineProd.data]);

  const monthlyTotal = useMemo(
    () => agentRows.reduce((s, a) => s + a.monthly_premium, 0),
    [agentRows],
  );

  const topProducers = useMemo(
    () => [...agentRows].sort((a, b) => b.monthly_premium - a.monthly_premium).slice(0, 3),
    [agentRows],
  );

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Manager · Command Center"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="My downline"
        subtitle={
          downlineIds.length === 0
            ? "No agents in your downline yet."
            : `${downlineIds.length} agents · live production from AgentLink`
        }
              />

      <ManagerPostCounter />

      {/* Top tile row — production / top producers / stuck */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-12 text-slate-500 uppercase tracking-wider">Downline production · This month</p>
            <p className="text-28 font-bold tabular-nums mt-1">{money(monthlyTotal)}</p>
            <p className="text-12 text-slate-500 mt-1">
              {agentRows.reduce((s, a) => s + a.monthly_deals, 0)} deals across {agentRows.length} agents
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-12 text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Trophy className="h-3 w-3 text-amber-500" /> Top 3 this month
            </p>
            {downlineProd.isLoading ? (
              <Skeleton className="h-20 w-full mt-2" />
            ) : topProducers.length === 0 || topProducers[0].monthly_premium === 0 ? (
              <p className="text-12 text-slate-500 mt-3">No deals logged this month yet.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {topProducers.map((a, i) => (
                  <div key={a.id} className="flex items-center justify-between text-12">
                    <span className="font-medium truncate">{i + 1}. {a.display_name ?? "Unnamed"}</span>
                    <span className="tabular-nums font-semibold">{money(a.monthly_premium)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-12 text-slate-500 uppercase tracking-wider">Stuck applicants · 7d+ silent</p>
            {stuck.isLoading ? (
              <Skeleton className="h-9 w-20 mt-1" />
            ) : (
              <p className="text-28 font-bold tabular-nums mt-1">{stuck.data?.length ?? 0}</p>
            )}
            <Button asChild variant="link" className="p-0 h-auto text-12 mt-1">
              <Link to="/dashboard/applicants">Open applicants <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Calls today */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-16 flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-emerald-600" />
            Upcoming calls
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {calls.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : (calls.data?.length ?? 0) === 0 ? (
            <p className="text-12 text-slate-500 py-4 text-center">No calls scheduled yet. Your assistant can add events via Google Calendar.</p>
          ) : (
            calls.data?.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800">
                <div>
                  <p className="text-14 font-medium">{c.prospect_name ?? "Untitled"}</p>
                  <p className="text-11 text-slate-500">
                    {formatDistanceToNowStrict(new Date(c.start_at), { addSuffix: true })}
                    {c.prospect_phone ? ` · ${c.prospect_phone}` : ""}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/dashboard/calls-today">View <ArrowRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Agents grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-16 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-blue-500" />
            My agents · {agentRows.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {downlineProd.isLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {/* stable-key-allow:skeleton */}
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : agentRows.length === 0 ? (
            <p className="text-12 text-slate-500 py-4 text-center">No agents in your downline yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {agentRows.map((a) => (
                <Link
                  key={a.id}
                  to={`/dashboard/agent-management?agent=${a.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-base"
                >
                  <div className="min-w-0">
                    <p className="text-14 font-medium truncate">{a.display_name ?? "Unnamed"}</p>
                    <p className="text-11 text-slate-500">
                      {a.al_user_id == null ? "AgentLink mapping pending" : `${a.monthly_deals} deals this month`}
                    </p>
                  </div>
                  <span className="tabular-nums text-14 font-semibold whitespace-nowrap">{money(a.monthly_premium)}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/inbound-leads">
            <span className="flex items-center gap-2"><PhoneIncoming className="h-4 w-4" /> Inbound leads</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="justify-between">
          <Link to="/dashboard/applicants">
            <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Applicants</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="justify-between">
          <Link to="/course-catalog">
            <span className="flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Apex Course</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
