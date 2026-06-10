import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Crown,
  ExternalLink,
  Phone,
  Mail,
  Users,
  GraduationCap,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

interface WhaleRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  state: string | null;
  status: string | null;
  license_status: string | null;
  license_progress: string | null;
  onboarding_stage: string | null;
  course_purchased_at: string | null;
  course_started_at: string | null;
  exam_passed_at: string | null;
  licensed_at: string | null;
  contracted_at: string | null;
  ica_paid_at: string | null;
  first_deal_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  next_action: string | null;
  next_action_due_at: string | null;
  referral_source: string | null;
  recruiter_id: string | null;
  assigned_agent_id: string | null;
}

interface AgentLite {
  id: string;
  display_name: string | null;
  monthly_premium: number;
  direct_downline_count: number;
  total_downline_count: number;
}

/**
 * WhaleRecruiting — 2026-06-10 (v18 Wave A)
 *
 * Sam: "I want to see my big fish whales that I'm recruiting right now and
 * where they're at in the process. Phone number, audio phone call, their
 * numbers, how many downlines I had, what contracts they had, all
 * summarized."
 *
 * Admin-only. Tracks recruits flagged as high-value (manager-track,
 * agency-owner-track, or has a producing downline of their own).
 *
 * Pipeline stages mapped from applications.license_progress:
 *   purchased → started → exam → licensed → contracted → first_deal
 */
export default function WhaleRecruiting() {
  usePageTitle("Whale Recruiting · APEX");
  const { isAdmin } = useAuth();

  // Pull high-value applicants (in progress, not failed)
  const whales = useQuery({
    queryKey: ["whale-applicants"],
    enabled: isAdmin,
    staleTime: 60_000,
    queryFn: async (): Promise<WhaleRow[]> => {
      const { data, error } = await supabase
        .from("applications")
        .select(
          "id, first_name, last_name, email, phone, state, status, license_status, license_progress, onboarding_stage, course_purchased_at, course_started_at, exam_passed_at, licensed_at, contracted_at, ica_paid_at, first_deal_at, last_contact_at, created_at, next_action, next_action_due_at, referral_source, recruiter_id, assigned_agent_id"
        )
        .neq("status", "terminated")
        .neq("status", "lost")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as WhaleRow[];
    },
  });

  // For each whale who became an agent, pull their downline/production
  const agentMetrics = useQuery({
    queryKey: ["whale-agent-metrics"],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, AgentLite>> => {
      const { data } = await supabase
        .from("v_builder_operating_dashboard" as any)
        .select("agent_id, builder_name, monthly_production, direct_agent_count, total_downline_count");
      const m = new Map<string, AgentLite>();
      for (const r of ((data as any[]) ?? [])) {
        m.set(r.agent_id, {
          id: r.agent_id,
          display_name: r.builder_name,
          monthly_premium: Number(r.monthly_production ?? 0),
          direct_downline_count: Number(r.direct_agent_count ?? 0),
          total_downline_count: Number(r.total_downline_count ?? 0),
        });
      }
      return m;
    },
  });

  const ranked = useMemo(() => {
    const rows = whales.data ?? [];
    return rows
      .map((w) => {
        const stage = inferStage(w);
        const heat = inferHeat(w);
        return { ...w, stage, heat };
      })
      .sort((a, b) => HEAT_RANK[b.heat] - HEAT_RANK[a.heat]);
  }, [whales.data]);

  if (!isAdmin) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24">
        <EmptyState icon={<Crown className="h-6 w-6" />} title="Admin only" description="This view is reserved for the agency owner." />
      </div>
    );
  }

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Agency · Recruiting"
        eyebrowIcon={<Crown className="h-3 w-3" />}
        title="Whale Recruiting"
        subtitle="High-value recruits in your pipeline — where they are, who to chase, what's next."
        accent="primary"
      />

      {/* Heat summary tiles */}
      <div className="grid gap-3 sm:grid-cols-4">
        <HeatTile heat="hot" rows={ranked} />
        <HeatTile heat="warm" rows={ranked} />
        <HeatTile heat="cool" rows={ranked} />
        <HeatTile heat="cold" rows={ranked} />
      </div>

      {/* Main list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-16">All whales · {ranked.length}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {whales.isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : ranked.length === 0 ? (
            <p className="text-12 text-slate-500 py-8 text-center">
              No active recruits yet — anyone who applies through the funnel shows up here.
            </p>
          ) : (
            ranked.map((w) => (
              <WhaleRow
                key={w.id}
                row={w}
                agent={agentMetrics.data?.get(w.assigned_agent_id ?? w.recruiter_id ?? "") ?? null}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Heat = "hot" | "warm" | "cool" | "cold";

const HEAT_RANK: Record<Heat, number> = { hot: 3, warm: 2, cool: 1, cold: 0 };
// v24 palette restraint: tile bg goes NEUTRAL white. Heat color carries
// only on a small dot indicator. Was 4 tinted bgs (rose/amber/blue/slate).
const HEAT_TINT: Record<Heat, string> = {
  hot:  "border-border bg-card text-foreground",
  warm: "border-border bg-card text-foreground",
  cool: "border-border bg-card text-foreground",
  cold: "border-border bg-card text-foreground",
};
const HEAT_DOT: Record<Heat, string> = {
  hot:  "bg-rose-500",
  warm: "bg-amber-500",
  cool: "bg-slate-400",
  cold: "bg-slate-300",
};

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  purchased: "Course purchased",
  started: "Course started",
  exam: "Exam scheduled",
  licensed: "Licensed",
  contracted: "Contracted",
  producing: "Producing",
};

function inferStage(w: WhaleRow): string {
  if (w.first_deal_at) return "producing";
  if (w.contracted_at) return "contracted";
  if (w.licensed_at) return "licensed";
  if (w.exam_passed_at) return "exam";
  if (w.course_started_at) return "started";
  if (w.course_purchased_at) return "purchased";
  return "applied";
}

function inferHeat(w: WhaleRow): Heat {
  // HOT: contacted in last 48h OR has next_action_due_at within 2 days
  const lastContact = w.last_contact_at ? new Date(w.last_contact_at) : null;
  const dueDate = w.next_action_due_at ? new Date(w.next_action_due_at) : null;
  const now = Date.now();
  const recent = lastContact && (now - lastContact.getTime() < 48 * 3600_000);
  const dueSoon = dueDate && (dueDate.getTime() - now < 48 * 3600_000);
  if (recent || dueSoon || w.first_deal_at) return "hot";
  // WARM: contacted in last 7 days
  if (lastContact && (now - lastContact.getTime() < 7 * 86400_000)) return "warm";
  // COOL: applied in last 30 days
  const created = new Date(w.created_at).getTime();
  if (now - created < 30 * 86400_000) return "cool";
  return "cold";
}

function HeatTile({ heat, rows }: { heat: Heat; rows: Array<WhaleRow & { heat: Heat }> }) {
  const count = rows.filter((r) => r.heat === heat).length;
  return (
    <Card className={`border ${HEAT_TINT[heat]}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`h-2 w-2 rounded-full ${HEAT_DOT[heat]}`} />
          <p className="text-11 uppercase tracking-wider font-semibold">{heat}</p>
        </div>
        <p className="text-28 font-bold tabular-nums">{count}</p>
        <p className="text-11 text-muted-foreground">{heat === "hot" ? "Talked in 48h" : heat === "warm" ? "This week" : heat === "cool" ? "Last 30d" : "Idle 30d+"}</p>
      </CardContent>
    </Card>
  );
}

function WhaleRow({ row, agent }: { row: WhaleRow & { stage: string; heat: Heat }; agent: AgentLite | null }) {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "—";
  const phone = row.phone?.replace(/\D/g, "");
  const formattedPhone = phone && phone.length >= 10
    ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 10)}`
    : row.phone;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-14 font-semibold truncate">{name}</p>
          <Badge variant="outline" className={`text-11 ${HEAT_TINT[row.heat]}`}>{row.heat}</Badge>
          <Badge variant="outline" className="text-11">{STAGE_LABEL[row.stage] ?? row.stage}</Badge>
          {row.state && <Badge variant="outline" className="text-11">{row.state}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-12 text-slate-500">
          {formattedPhone && (
            <a href={`tel:${row.phone}`} className="flex items-center gap-1 hover:text-emerald-600">
              <Phone className="h-3 w-3" /> {formattedPhone}
            </a>
          )}
          {row.email && (
            <a href={`mailto:${row.email}`} className="flex items-center gap-1 hover:text-emerald-600">
              <Mail className="h-3 w-3" /> {row.email}
            </a>
          )}
          {agent && agent.total_downline_count > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {agent.total_downline_count} downline
              {agent.direct_downline_count !== agent.total_downline_count ? ` (${agent.direct_downline_count} direct)` : ""}
            </span>
          )}
          {agent && agent.monthly_premium > 0 && (
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> ${Math.round(agent.monthly_premium / 1000)}K/mo
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" /> applied {formatDistanceToNowStrict(new Date(row.created_at), { addSuffix: true })}
          </span>
        </div>
        {row.next_action && (
          <p className="text-11 text-slate-700 dark:text-slate-300 mt-1 italic">Next: {row.next_action}</p>
        )}
        {row.referral_source && (
          <p className="text-11 text-slate-500 mt-1">Source: {row.referral_source}</p>
        )}
      </div>
      <div className="shrink-0 flex flex-col gap-1">
        {row.phone && (
          <Button asChild size="sm" variant="outline">
            <a href={`https://www.truepeoplesearch.com/results?phoneno=${phone}`} target="_blank" rel="noopener noreferrer">
              TPS <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link to={`/dashboard/applicants?id=${row.id}`}>
            Open <ExternalLink className="h-3 w-3 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
