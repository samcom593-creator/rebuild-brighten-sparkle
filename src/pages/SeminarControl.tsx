import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarClock, CheckCircle2, AlertTriangle, Trophy, GraduationCap, FileCheck2, UserPlus, Crown, Mail, MessageSquare, Bell, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { format } from "date-fns";

type SeminarStage =
  | "upcoming"
  | "no_show"
  | "attended_unpaid"
  | "paid_pre_licensing"
  | "in_licensing"
  | "licensed_pre_contract"
  | "contracted_no_deal"
  | "active_producer"
  | "unknown";

interface SeminarRow {
  registration_id: string;
  application_id: string | null;
  attendee_name: string;
  email: string | null;
  phone: string | null;
  license_status: string | null;
  source: string | null;
  seminar_date: string | null;
  registered_at: string;
  attended: boolean | null;
  reminder_opt_in: boolean | null;
  confirmation_email_queued_at: string | null;
  manager_alert_queued_at: string | null;
  discord_alert_queued_at: string | null;
  paid_after: boolean | null;
  paid_at: string | null;
  app_status: string | null;
  ica_paid: boolean | null;
  ica_paid_at: string | null;
  app_license_progress: string | null;
  converted_agent_id: string | null;
  agent_status: string | null;
  onboarding_stage: string | null;
  agent_contracted_at: string | null;
  first_deal_at: string | null;
  stage: SeminarStage;
  days_since_registered: number | null;
}

interface SeminarMetrics {
  as_of: string;
  upcoming_total: number;
  next_seminar_date: string | null;
  no_shows_30d: number;
  attended_30d: number;
  attended_unpaid: number;
  paid_pre_licensing: number;
  in_licensing: number;
  licensed_pre_contract: number;
  contracted_no_deal: number;
  active_producers: number;
  conversion_funnel: {
    registered: number;
    attended: number;
    paid: number;
    licensed: number;
    contracted: number;
    producing: number;
  };
}

const STAGE_META: Record<
  SeminarStage,
  { label: string; tone: "neutral" | "warn" | "success" | "danger"; icon: typeof CalendarClock }
> = {
  upcoming: { label: "Upcoming", tone: "neutral", icon: CalendarClock },
  no_show: { label: "No-show", tone: "danger", icon: AlertTriangle },
  attended_unpaid: { label: "Attended · unpaid", tone: "warn", icon: AlertTriangle },
  paid_pre_licensing: { label: "Paid · pre-licensing", tone: "success", icon: FileCheck2 },
  in_licensing: { label: "In licensing", tone: "neutral", icon: GraduationCap },
  licensed_pre_contract: { label: "Licensed · pre-contract", tone: "warn", icon: GraduationCap },
  contracted_no_deal: { label: "Contracted · no deal yet", tone: "warn", icon: UserPlus },
  active_producer: { label: "Active producer", tone: "success", icon: Trophy },
  unknown: { label: "Unknown", tone: "neutral", icon: CalendarClock },
};

const TONE_CLS: Record<"neutral" | "warn" | "success" | "danger", string> = {
  neutral: "bg-secondary text-secondary-foreground",
  warn: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function SeminarControl() {
  usePageTitle("Seminar Control · APEX");
  const { user, isAdmin, isManager } = useAuth();

  // Component-level guard. Admins and managers always allowed. Other users
  // (plain agents) are admitted only when their agent row is flagged
  // is_presenting — e.g. KJ. Defense-in-depth on top of the route's
  // ProtectedRoute(requireAdmin allowManagers) gate.
  const presenterQuery = useQuery({
    queryKey: ["am-i-presenter", user?.id],
    enabled: !!user?.id && !isAdmin && !isManager,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("is_presenting")
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data?.is_presenting;
    },
  });
  const isPresenter = presenterQuery.data === true;
  const isAuthorized = isAdmin || isManager || isPresenter;

  const metricsQuery = useQuery({
    queryKey: ["seminar-metrics"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("kj_seminar_metrics");
      if (error) throw error;
      return data as unknown as SeminarMetrics;
    },
  });

  const rosterQuery = useQuery({
    queryKey: ["seminar-roster"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_kj_seminar_control" as any)
        .select("*")
        .order("seminar_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as SeminarRow[];
    },
  });

  const metrics = metricsQuery.data;
  const roster = rosterQuery.data ?? [];

  const groupedByDate = useMemo(() => {
    const map = new Map<string, SeminarRow[]>();
    for (const r of roster) {
      const key = r.seminar_date ?? "unscheduled";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [roster]);

  async function markAttended(id: string, value: boolean) {
    const { error } = await supabase
      .from("seminar_registrations")
      .update({ attended: value, follow_up_sent_at: value ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(value ? "Marked attended" : "Marked no-show");
      rosterQuery.refetch();

      metricsQuery.refetch();
    }
  }

  if (!user) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">Sign in to view seminar control.</CardContent>
        </Card>
      </div>
    );
  }

  // Component-level guard: if the route was somehow reached by a plain agent
  // who isn't flagged as a presenter, show an Unauthorized state instead of
  // leaking seminar data.
  if (!presenterQuery.isLoading && !isAuthorized) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <h2 className="text-xl font-bold">Not your room</h2>
            <p className="text-sm text-muted-foreground">
              Seminar control is for admins, managers, and presenters. If you should have
              access, ask Sam to flag you as a presenter on your agent profile.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (metricsQuery.isLoading || rosterQuery.isLoading || presenterQuery.isLoading) return <PageLoadingSkeleton variant="dashboard" />;

  const Stat = ({ icon: Icon, label, value, tone = "neutral" as const }: any) => (
    <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }}>
      <Card className={`border shadow-sm ${TONE_CLS[tone as keyof typeof TONE_CLS]} backdrop-blur`}>
        <CardContent className="p-4 flex items-center gap-3 min-h-[92px]">
          <Icon className="h-5 w-5" />
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
            <div className="text-2xl font-bold tabular-nums">{value ?? 0}</div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );

  const funnel = metrics?.conversion_funnel;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 space-y-6">
      <PageHeader
        accent="amber"
        eyebrow="Seminar command"
        eyebrowIcon={<Crown className="h-3 w-3" />}
        title="Group interview pipeline"
        subtitle={metrics?.next_seminar_date
          ? `Next seminar: ${format(new Date(metrics.next_seminar_date), "EEE, MMM d")} · track each registrant from attendance to production.`
          : "Track every registrant from group interview attendance to production."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-background/80 text-xs">
              As of {metrics?.as_of ? format(new Date(metrics.as_of), "p") : ""}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80"
              onClick={() => {
                metricsQuery.refetch();
                rosterQuery.refetch();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-amber-500/25 bg-gradient-to-r from-amber-500/10 via-card to-card shadow-sm"
      >
        <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500">
              Live roster
            </Badge>
            <span className="text-muted-foreground">
              {roster.length} registrants grouped by seminar date
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            60 second auto-refresh
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat icon={CalendarClock} label="Upcoming" value={metrics?.upcoming_total} />
        <Stat icon={AlertTriangle} label="No-shows 30d" value={metrics?.no_shows_30d} tone="danger" />
        <Stat icon={CheckCircle2} label="Attended 30d" value={metrics?.attended_30d} tone="success" />
        <Stat icon={AlertTriangle} label="Attended · unpaid" value={metrics?.attended_unpaid} tone="warn" />
        <Stat icon={FileCheck2} label="Paid · pre-licensing" value={metrics?.paid_pre_licensing} tone="success" />
        <Stat icon={GraduationCap} label="In licensing" value={metrics?.in_licensing} />
        <Stat icon={GraduationCap} label="Licensed · pre-contract" value={metrics?.licensed_pre_contract} tone="warn" />
        <Stat icon={UserPlus} label="Contracted · no deal" value={metrics?.contracted_no_deal} tone="warn" />
        <Stat icon={Trophy} label="Active producers" value={metrics?.active_producers} tone="success" />
      </div>

      {funnel && (
        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">Conversion funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                ["Registered", funnel.registered],
                ["Attended", funnel.attended],
                ["Paid", funnel.paid],
                ["Licensed", funnel.licensed],
                ["Contracted", funnel.contracted],
                ["Producing", funnel.producing],
              ].map(([label, n]) => (
                <div key={label as string} className="rounded-lg border border-border/60 bg-background p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="text-xl font-bold tabular-nums">{n as number}</div>
                  {funnel.registered ? (
                    <div className="mt-2 space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${Math.min(100, (((n as number) / funnel.registered) * 100) || 0)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {((((n as number) / funnel.registered) * 100) || 0).toFixed(0)}%
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/60 bg-card shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/50">
          <CardTitle className="text-base">Roster</CardTitle>
          <div className="text-xs text-muted-foreground">{roster.length} registrants</div>
        </CardHeader>
        <CardContent className="space-y-6">
          {groupedByDate.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/70 px-4 py-12 text-center text-sm text-muted-foreground">
              <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
              <div className="font-medium text-foreground">No seminar registrations yet</div>
              <div className="mt-1">
                Drive traffic to <a href="/seminar" className="underline">/seminar</a> to start collecting registrations.
              </div>
            </div>
          )}
          {groupedByDate.map(([date, rows]) => (
            <motion.div key={date} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                <h3 className="font-semibold">
                  {date === "unscheduled" ? "Unscheduled" : format(new Date(date), "EEE, MMM d")}
                </h3>
                <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-background divide-y divide-border/50">
                {rows.map((r) => {
                  const meta = STAGE_META[r.stage] || STAGE_META.unknown;
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={r.registration_id}
                      layout
                      className="flex flex-col justify-between gap-3 p-3 transition hover:bg-muted/35 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{r.attendee_name}</span>
                          <Badge className={`text-[10px] border ${TONE_CLS[meta.tone]}`} variant="outline">
                            <Icon className="h-3 w-3 mr-1" />
                            {meta.label}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.email ?? "No email"} · {r.phone ?? "No phone"} · {r.license_status ?? "License unknown"}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge variant="outline" className={r.reminder_opt_in ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-amber-500/30 text-amber-500"}>
                            <MessageSquare className="mr-1 h-3 w-3" />
                            {r.reminder_opt_in ? "Opted in" : "No SMS opt-in"}
                          </Badge>
                          <Badge variant="outline" className={r.confirmation_email_queued_at ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-amber-500/30 text-amber-500"}>
                            <Mail className="mr-1 h-3 w-3" />
                            {r.confirmation_email_queued_at ? "Email queued" : "Email missing"}
                          </Badge>
                          <Badge variant="outline" className={r.manager_alert_queued_at ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-amber-500/30 text-amber-500"}>
                            <Bell className="mr-1 h-3 w-3" />
                            {r.manager_alert_queued_at ? "Manager alerted" : "Manager alert missing"}
                          </Badge>
                          <Badge variant="outline" className={r.discord_alert_queued_at ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-amber-500/30 text-amber-500"}>
                            Discord {r.discord_alert_queued_at ? "queued" : "missing"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          App: {r.app_status ?? "none"} · Licensing: {r.app_license_progress ?? r.license_status ?? "unknown"} · Source: {r.source ?? "unknown"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {r.stage === "upcoming" || r.stage === "no_show" ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => markAttended(r.registration_id, true)}
                            >
                              Mark attended
                            </Button>
                            {r.stage !== "no_show" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => markAttended(r.registration_id, false)}
                              >
                                No-show
                              </Button>
                            )}
                          </>
                        ) : null}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      {!isAdmin && (
        <p className="text-[11px] text-muted-foreground text-center">
          You see this page because you're flagged as a seminar presenter or manager.
        </p>
      )}
    </div>
  );
}
