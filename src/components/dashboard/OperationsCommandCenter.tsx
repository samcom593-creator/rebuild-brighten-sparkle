import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, FileCheck2, HelpCircle,
  PhoneCall, RefreshCw, UserCheck2, UserRoundSearch, UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TRAINING_ROUTES } from "@/lib/trainingRoutes";
import { useAuth } from "@/hooks/useAuth";

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
  const { isAdmin } = useAuth();
  const query = useQuery({
    queryKey: ["admin-operations-command-center"],
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_admin_operations_snapshot" as never);
      if (error) throw error;
      return data as unknown as OperationsData;
    },
  });

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
          <AddAgentModal trigger={<Button size="sm" variant="outline">Add licensed / unlicensed</Button>} />
          <SubmitDealDialog trigger={<Button size="sm">Post a deal</Button>} />
          <Button asChild size="sm" variant="outline"><Link to="/dashboard/help?tab=desk"><HelpCircle className="mr-1.5 h-3.5 w-3.5" />Ask a question</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <MetricLink to="/dashboard/recruiting" icon={UserRoundSearch} label="New recruits" value={d.recruiting.new} detail={`${d.recruiting.uncontacted} need a call`} danger={d.recruiting.uncontacted_48h > 0} />
        <MetricLink to="/dashboard/interviews" icon={CalendarCheck2} label="Interviews" value={d.recruiting.interview} detail="live hiring pipeline" />
        <MetricLink to="/dashboard/team" icon={UserCheck2} label="Hired" value={d.recruiting.hired} detail={`${d.recruiting.contracting} at contracting`} />
        <MetricLink to={TRAINING_ROUTES.teamProgress} icon={UsersRound} label="Onboarding" value={d.onboarding.stalled} detail={`${d.onboarding.carrier_contracting} at contracting`} danger={d.onboarding.stalled > 0} />
        <MetricLink
          to={isAdmin ? "/dashboard/contracting" : "/start-contracting"}
          icon={FileCheck2}
          label={isAdmin ? "Contracting" : "OneLink contracting"}
          value={d.contracting.active}
          detail={isAdmin ? `${d.contracting.pending} pending · ${d.contracting.issues} issues` : "Submit one secure intake"}
          danger={d.contracting.issues > 0}
        />
        <MetricLink to="/dashboard/production" icon={PhoneCall} label="Sold today" value={d.sales.sold_today} detail={`${d.sales.expected_to_sell} expected producers`} />
        <MetricLink to="/dashboard/team" icon={PhoneCall} label="Not selling" value={d.sales.not_selling} detail={`${d.sales.sold_today}/${d.sales.expected_to_sell} sold today`} danger={d.sales.not_selling > 0} />
        <MetricLink to="/dashboard/help?tab=desk" icon={HelpCircle} label="Support" value={d.support.open} detail={d.support.urgent ? `${d.support.urgent} urgent` : "open requests"} danger={d.support.urgent > 0} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Who is not selling</p>
              <p className="text-xs text-muted-foreground">Only active producers expected to write business. Weekends do not count as quiet days.</p>
            </div>
            <Button asChild size="sm" variant="ghost"><Link to="/dashboard/team">Open team <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
          </div>
          {d.sales.people.length === 0 ? (
            <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">Every expected producer has sold today.</p>
          ) : (
            <div className="divide-y divide-border">
              {d.sales.people.slice(0, 8).map((person) => (
                <div key={person.agent_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_110px_90px_auto]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{person.agent_name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{person.leg}{person.phone ? ` · ${person.phone}` : ""}</p>
                  </div>
                  <Badge variant="outline" className={cn("hidden w-fit capitalize sm:inline-flex", person.pulse === "cold" && "border-rose-500/40 text-rose-400", person.pulse === "slipping" && "border-amber-500/40 text-amber-500")}>{person.pulse.replace("_", " ")}</Badge>
                  <div className="hidden text-right sm:block"><p className="text-xs font-semibold tabular-nums">{money(person.ap_mtd)}</p><p className="text-[10px] text-muted-foreground">{person.deals_mtd} MTD deals</p></div>
                  {person.phone ? <Button asChild size="sm" variant="outline"><a href={`tel:${person.phone}`}><PhoneCall className="mr-1.5 h-3.5 w-3.5" />Call</a></Button> : <Button asChild size="sm" variant="outline"><Link to={`/dashboard/team?focusAgentId=${person.agent_id}`}>Open</Link></Button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
