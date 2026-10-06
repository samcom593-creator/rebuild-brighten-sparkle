/**
 * HomeOperationsSummary — the owner Home's middle band (brief §4: Overview -> Production ->
 * Contracting -> Recruiting & expected starts -> Immediate actions).
 *
 * Every number here is read from the workspace that owns it, through the same code that
 * workspace uses, so Home cannot disagree with the page it links to:
 *   contracting  -> contracting_exception_digest()       (counts are carrier cases, queues overlap)
 *   recruiting   -> useRecruitingWorklist + computeQueueCounts (the worklist's own query + math)
 *   onboarding   -> onboarding_exception_facts() + buildExceptionQueue (the NHLB queue's derivation)
 * A failed read says so; it never renders as zero.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, ListChecks, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useRecruitingWorklist } from "@/components/pipeline/worklist/useRecruitingWorklist";
import { computeQueueCounts, type QueueKey } from "@/lib/recruitingQueues";
import { buildExceptionQueue, daysWaiting, type OnboardingFacts } from "@/lib/onboardingExceptions";

type DigestQueue = {
  key: string;
  label: string;
  cases: number;
  people?: number;
  oldest?: Array<{ agent_id: string; agent_name: string | null; carrier: string; lifecycle: string; waiting_on: string | null; days_in_state: number | null }>;
};
type Digest = { queues?: DigestQueue[]; note?: string };

// Keys as contracting_exception_digest() returns them (measured: verified, ready_to_submit, staff_action,
// agent_action, carrier_review, follow_up_due, support).
const CONTRACT_KEYS = ["verified", "ready_to_submit", "staff_action", "agent_action", "carrier_review", "follow_up_due"];
const RECRUIT_KEYS: QueueKey[] = ["uncontacted", "due_today", "overdue", "unassigned"];

function Row({ to, label, value, tone }: { to: string; label: string; value: number | string | null; tone?: "attention" | "good" }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone === "attention" && Number(value) > 0 ? "font-semibold tabular-nums text-foreground" : tone === "good" ? "font-semibold tabular-nums text-primary" : "font-semibold tabular-nums"}>
        {value ?? "—"}
      </span>
    </Link>
  );
}

function Panel({ title, icon: Icon, to, cta, children }: { title: string; icon: typeof ListChecks; to: string; cta: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{title}</h2>
          <Link to={to} className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline">{cta}<ArrowRight className="h-3 w-3" aria-hidden /></Link>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function HomeOperationsSummary() {
  const { user, isAdmin } = useAuth();
  const enabled = Boolean(isAdmin);

  const digest = useQuery({
    enabled,
    queryKey: ["home-contracting-digest"],
    staleTime: 60_000,
    queryFn: async (): Promise<Digest> => {
      const { data, error } = await supabase.rpc("contracting_exception_digest" as never);
      if (error) throw new Error(error.message);
      return (data ?? {}) as Digest;
    },
  });

  const onboarding = useQuery({
    enabled,
    queryKey: ["home-onboarding-exceptions"],
    staleTime: 60_000,
    queryFn: async (): Promise<OnboardingFacts[]> => {
      const { data, error } = await supabase.rpc("onboarding_exception_facts" as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OnboardingFacts[];
    },
  });

  const worklist = useRecruitingWorklist(enabled);

  const recruitCounts = useMemo(
    () => (worklist.data ? computeQueueCounts(worklist.data.rows, { now: new Date(), userId: user?.id ?? null }) : null),
    [worklist.data, user?.id],
  );

  const exceptionQueue = useMemo(() => (onboarding.data ? buildExceptionQueue(onboarding.data) : []), [onboarding.data]);
  const startsThisWeek = useMemo(() => {
    const now = Date.now();
    return (onboarding.data ?? []).filter((f) => {
      if (!f.expected_start_on || f.expected_start_status === "not_attending") return false;
      const t = Date.parse(`${f.expected_start_on}T12:00:00Z`);
      return Number.isFinite(t) && t >= now - 86_400_000 && t <= now + 7 * 86_400_000;
    });
  }, [onboarding.data]);

  const queues = useMemo(() => {
    const map = new Map<string, DigestQueue>();
    for (const q of digest.data?.queues ?? []) map.set(q.key, q);
    return map;
  }, [digest.data]);

  const actions = useMemo(() => {
    const list: Array<{ key: string; to: string; text: string; detail: string }> = [];
    for (const r of exceptionQueue.filter((x) => x.primary?.blocking).slice(0, 3)) {
      const waited = daysWaiting(r.primary?.waitingSince ?? null);
      list.push({
        key: `onb-${r.facts.agent_id}`,
        to: "/dashboard/recruits",
        text: `${r.facts.agent_name ?? "New hire"}: ${r.primary?.label ?? "onboarding step missing"}`,
        detail: `${r.primary?.owner ?? "Unassigned"}${waited != null ? ` · waiting ${waited}d` : ""}`,
      });
    }
    for (const c of (queues.get("staff_action")?.oldest ?? []).slice(0, 2)) {
      list.push({
        key: `case-${c.agent_id}-${c.carrier}`,
        to: "/dashboard/contracting/cases",
        text: `${c.agent_name ?? "Agent"} · ${c.carrier}: staff action needed`,
        detail: c.days_in_state != null ? `${c.days_in_state}d in this state` : "age not recorded",
      });
    }
    return list;
  }, [exceptionQueue, queues]);

  if (!enabled) return null;

  const failed = (q: { isError: boolean }) => q.isError;
  return (
    <section className="grid gap-3 lg:grid-cols-3" aria-label="Contracting, recruiting and today's actions">
      <Panel title="Contracting" icon={BriefcaseBusiness} to="/dashboard/contracting/cases" cta="Open cases">
        {digest.isLoading ? <Skeleton className="h-28 w-full" /> : failed(digest) ? (
          <p className="text-sm text-destructive">Could not load contracting queues.</p>
        ) : (
          <>
            {CONTRACT_KEYS.map((k) => {
              const q = queues.get(k);
              if (!q) return null;
              return <Row key={k} to="/dashboard/contracting/cases" label={q.label} value={q.cases} tone={k === "verified" ? "good" : "attention"} />;
            })}
            <p className="px-2 text-[11px] text-muted-foreground">Carrier cases (one agent × one carrier); queues overlap.</p>
          </>
        )}
      </Panel>

      <Panel title="Recruiting & starts" icon={UserPlus} to="/dashboard/recruiting" cta="Open worklist">
        {worklist.isLoading ? <Skeleton className="h-28 w-full" /> : worklist.isError ? (
          <p className="text-sm text-destructive">Could not load the recruiting worklist.</p>
        ) : (
          <>
            {RECRUIT_KEYS.map((k) => (
              <Row key={k} to={`/dashboard/recruiting?queue=${k}`} label={{ uncontacted: "Uncontacted", due_today: "Due today", overdue: "Overdue", unassigned: "Unassigned" }[k as "uncontacted" | "due_today" | "overdue" | "unassigned"]} value={recruitCounts ? recruitCounts[k] : null} tone="attention" />
            ))}
            <Row to="/dashboard/recruits" label="Expected starts (next 7 days)" value={onboarding.isError ? null : startsThisWeek.length} />
          </>
        )}
      </Panel>

      <Panel title="Immediate actions" icon={ListChecks} to="/dashboard/recruits" cta="All exceptions">
        {onboarding.isLoading || digest.isLoading ? <Skeleton className="h-28 w-full" /> : actions.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">{failed(onboarding) || failed(digest) ? "Some queues did not load; nothing is assumed clear." : "Nothing blocking right now."}</p>
        ) : (
          <ul className="space-y-1">
            {actions.map((a) => (
              <li key={a.key}>
                <Link to={a.to} className="block rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <span className="block text-sm">{a.text}</span>
                  <span className="block text-[11px] text-muted-foreground">{a.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

export default HomeOperationsSummary;
