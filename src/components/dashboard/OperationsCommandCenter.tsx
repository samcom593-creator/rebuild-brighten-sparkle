import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, FileCheck2, HelpCircle,
  PhoneCall, RefreshCw, UserCheck2, UserRoundSearch, UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { useAuth } from "@/hooks/useAuth";
import { contactLinkProps, phoneHref } from "@/lib/phone";
import { useRecruitingWorklist } from "@/components/pipeline/worklist/useRecruitingWorklist";
import { computeQueueCounts } from "@/lib/recruitingQueues";

interface OperationsData {
  as_of: string;
  recruiting: { active: number; new: number; uncontacted: number; uncontacted_48h: number; interview: number; contracting: number; hired: number };
  onboarding: { stalled: number; intake_missing: number; npn_comp_missing: number; carrier_contracting: number; training_missing: number; complete: number };
  contracting: { total: number; active: number; pending: number; issues: number };
  sales: {
    expected_to_sell: number;
    sold_today: number;
    not_selling: number;
    people: Array<{
      agent_id: string; agent_name: string; leg: string; pulse: string;
      business_days_quiet: number; last_sale: string | null; deals_mtd: number;
      ap_mtd: number; phone: string; email: string;
    }>;
  };
  readymode: { status?: string; last_ingest_at?: string | null; ingest_24h?: number; sync_enabled?: boolean };
  support: { open: number; urgent: number };
}

// contracting_exception_digest() is the carrier-case truth (one agent x one carrier). The legacy
// apex_admin_operations_snapshot contracting block reads apex_carrier_contracts, which is empty, so
// the tile reads the digest instead. Same query key as HomeOperationsSummary so Home shares one read.
type DigestQueue = { key: string; label: string; cases: number };
type ContractingDigest = { queues?: DigestQueue[] };

const money = (value: number) => `$${Math.round(Number(value || 0)).toLocaleString()}`;
function MetricLink({
  to, icon: Icon, label, value, detail, danger = false,
}: {
  to: string; icon: typeof UsersRound; label: string; value: string | number; detail: string; danger?: boolean;
}) {
  return (
    <Link to={to} className="group min-w-0">
      <Card className={cn("h-full transition-colors group-hover:border-primary/50", danger && "border-rose-500/35 bg-rose-500/[0.04]")}> 
        <CardContent className="p-3.5">
          <div className="flex items-center justify-between gap-2">
            <Icon className={cn("h-4 w-4 text-muted-foreground", danger && "text-rose-400")} />
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", danger && "text-rose-400")}>{value}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function OperationsCommandCenter() {
  const { user, isAdmin } = useAuth();
  const query = useQuery({
    queryKey: ["admin-operations-command-center"],
    enabled: isAdmin,
    staleTime: 60_000,
    refetchInterval: 180_000,
    retry: 1,
    retryDelay: 4_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_admin_operations_snapshot" as never);
      if (error) throw error;
      return data as unknown as OperationsData;
    },
  });

  const digest = useQuery({
    queryKey: ["home-contracting-digest"],
    enabled: isAdmin,
    staleTime: 60_000,
    queryFn: async (): Promise<ContractingDigest> => {
      const { data, error } = await supabase.rpc("contracting_exception_digest" as never);
      if (error) throw new Error(error.message);
      return (data ?? {}) as ContractingDigest;
    },
  });

  // Recruiting counts come from the worklist's own query + math (shared cache with
  // HomeOperationsSummary), so Home never shows two different "uncontacted" numbers.
  const worklist = useRecruitingWorklist(isAdmin);
  const recruitCounts = useMemo(
    () => (worklist.data ? computeQueueCounts(worklist.data.rows, { now: new Date(), userId: user?.id ?? null }) : null),
    [worklist.data, user?.id],
  );

  const contractingCases = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const q of digest.data?.queues ?? []) byKey.set(q.key, Number(q.cases ?? 0));
    return byKey;
  }, [digest.data]);

  if (!isAdmin) return null;

  if (query.isLoading) {
    return <Skeleton className="h-[360px] rounded-lg" />;
  }
  if (query.isError || !query.data) {
    return (
      <Card className="border-rose-500/35">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-5 w-5 text-rose-400" />
          <div><p className="font-semibold">Operations view could not load</p><p className="text-xs text-muted-foreground">No counts are being guessed.</p></div>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const d = query.data;

  const recruitTile = worklist.isError
    ? { value: "Unavailable", detail: "Could not load the recruiting worklist", danger: true }
    : !recruitCounts
      ? { value: "…", detail: "Loading the recruiting worklist", danger: false }
      : { value: recruitCounts.new, detail: `${recruitCounts.uncontacted} uncontacted`, danger: false };

  const staffAction = contractingCases.get("staff_action");
  const verified = contractingCases.get("verified");
  const support = contractingCases.get("support");
  const contractingTile = digest.isError
    ? { value: "Unavailable", detail: "Could not load carrier cases", danger: true }
    : digest.isLoading || !digest.data
      ? { value: "…", detail: "Loading carrier cases", danger: false }
      : staffAction == null
        ? { value: "Unavailable", detail: "Carrier case queues not reported", danger: true }
        : {
            value: staffAction,
            detail: `staff action · ${verified ?? 0} verified · ${support ?? 0} support`,
            danger: (support ?? 0) > 0,
          };

  return (
    <section className="space-y-3" aria-labelledby="operations-command-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="operations-command-title" className="text-sm font-semibold">Run the business</h2>
            <Badge variant="outline" className="text-[10px]">Live workflow</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Recruit, onboard, contract, sell, and fix problems from one truthful queue.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><Link to="/dashboard/help?tab=desk"><HelpCircle className="mr-1.5 h-3.5 w-3.5" />Ask a question</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricLink to="/dashboard/recruiting?queue=new" icon={UserRoundSearch} label="New recruits" value={recruitTile.value} detail={recruitTile.detail} danger={recruitTile.danger} />
        <MetricLink to="/dashboard/recruiting/pipeline" icon={CalendarCheck2} label="Interviews" value={d.recruiting.interview} detail="live hiring pipeline" />
        <MetricLink to="/dashboard/team" icon={UserCheck2} label="Hired" value={d.recruiting.hired} detail={`${d.recruiting.contracting} at contracting`} />
        <MetricLink to={TRAINING_ROUTES.teamProgress} icon={UsersRound} label="Onboarding" value={d.onboarding.stalled} detail={`${d.onboarding.carrier_contracting} at contracting`} danger={d.onboarding.stalled > 0} />
        <MetricLink
          to="/dashboard/contracting/cases"
          icon={FileCheck2}
          label="Contracting"
          value={contractingTile.value}
          detail={contractingTile.detail}
          danger={contractingTile.danger}
        />
        <MetricLink to="/dashboard/production" icon={PhoneCall} label="Sold today" value={d.sales.sold_today} detail={`${d.sales.expected_to_sell} expected producers`} />
        <MetricLink to="/dashboard/help?tab=desk" icon={HelpCircle} label="Support" value={d.support.open} detail={d.support.urgent ? `${d.support.urgent} urgent` : "open requests"} danger={d.support.urgent > 0} />
      </div>

    </section>
  );
}
