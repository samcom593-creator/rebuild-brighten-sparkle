import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Send, Users, MessageSquare, AlertTriangle, RefreshCw, Activity,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";

type Dashboard = {
  total_users: number; dau: number; wau: number;
  lobby: number; applied_unpaid: number; applied_paid: number;
  call_scheduled: number; post_seminar: number; studying: number;
  exam_scheduled: number; licensed_unhired: number; hired: number;
  onboarding: number; active_agents: number;
  stale_7d: number; open_escalations: number;
  upcoming_nudges_24h: number; inbound_24h: number; outbound_24h: number;
};

type FunnelRow = { stage: string; count: number; pct: number };

type StuckUser = {
  chat_id: string; first_name: string | null; username: string | null;
  stage: string; last_active_at: string; days_stale: number;
  applicant_id: string | null; agent_id: string | null;
  already_escalated: boolean;
};

type Escalation = {
  id: number; chat_id: string; reason: string;
  acknowledged_at: string | null; resolved_at: string | null;
  manager_handle: string | null; created_at: string;
};

type Group = {
  chat_id: string; title: string; type: string;
  is_active: boolean; invite_link: string | null;
  created_at: string;
};

type Template = {
  key: string; description: string | null; body: string;
  version: number; active: boolean; updated_at: string;
};

const STAGE_LABEL: Record<string, string> = {
  lobby: "Lobby",
  applied_unpaid: "Applied, ICA unpaid",
  applied_paid: "Applied, ICA paid",
  manager_call_scheduled: "Call scheduled",
  manager_call_done: "Call done",
  seminar_rsvp: "Seminar RSVP",
  seminar_attended: "Seminar attended",
  pre_license_studying: "Pre-license studying",
  exam_scheduled: "Exam scheduled",
  licensed: "Licensed",
  hired: "Hired",
  onboarding_d1: "Onboarding D1",
  onboarding_d3: "Onboarding D3",
  onboarding_d7: "Onboarding D7",
  onboarding_d14: "Onboarding D14",
  active_agent: "Active agent (Discord)",
  opt_out: "Opted out",
  escalated_to_manager: "Escalated",
};

const GROUP_TYPE_LABEL: Record<string, string> = {
  lobby: "Lobby",
  licensing: "Licensing Help",
  seminar: "Seminar Channel",
  onboarding: "New Agent Onboarding",
  training: "Training Library",
  wins: "Wins Channel",
  ai_dm: "Ask Apex AI (DM)",
  manager_alerts: "Manager Alerts (internal)",
};

export default function TelegramBot() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");

  const { data: dash, isLoading: loadingDash } = useQuery<Dashboard | null>({
    queryKey: ["telegram-dashboard"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_telegram_dashboard").select("*").maybeSingle();
      if (error) throw error;
      return data as Dashboard | null;
    },
  });

  const { data: funnel } = useQuery<FunnelRow[]>({
    queryKey: ["telegram-funnel"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_telegram_funnel").select("*");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const { data: stuck } = useQuery<StuckUser[]>({
    queryKey: ["telegram-stuck"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_telegram_stuck_users").select("*").limit(50);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const { data: escalations } = useQuery<Escalation[]>({
    queryKey: ["telegram-escalations"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_escalations")
        .select("id, chat_id::text, reason, acknowledged_at, resolved_at, manager_handle, created_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        // chat_id::text cast may not be supported — refetch without cast
        const r = await supabase
          .from("telegram_escalations")
          .select("id, chat_id, reason, acknowledged_at, resolved_at, manager_handle, created_at")
          .is("resolved_at", null)
          .order("created_at", { ascending: false })
          .limit(50);
        return ((r.data as any[]) ?? []).map((row) => ({ ...row, chat_id: String(row.chat_id) }));
      }
      return (data as any[]) ?? [];
    },
  });

  const { data: groups } = useQuery<Group[]>({
    queryKey: ["telegram-groups"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_groups")
        .select("chat_id, title, type, is_active, invite_link, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as any[]) ?? []).map((row) => ({ ...row, chat_id: String(row.chat_id) }));
    },
  });

  const { data: templates } = useQuery<Template[]>({
    queryKey: ["telegram-templates"],
    refetchInterval: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_templates")
        .select("key, description, body, version, active, updated_at")
        .order("key", { ascending: true });
      if (error) throw error;
      return (data as Template[]) ?? [];
    },
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["telegram-dashboard"] });
    qc.invalidateQueries({ queryKey: ["telegram-funnel"] });
    qc.invalidateQueries({ queryKey: ["telegram-stuck"] });
    qc.invalidateQueries({ queryKey: ["telegram-escalations"] });
    qc.invalidateQueries({ queryKey: ["telegram-groups"] });
    qc.invalidateQueries({ queryKey: ["telegram-templates"] });
  };

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          icon={Send}
          title="APEX Telegram Bot"
          description="Pre-hire + onboarding + licensing operating layer. Discord owns active production; this owns everything before it."
          right={
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          }
        />

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Total users" value={dash?.total_users ?? 0} loading={loadingDash} />
          <Stat label="DAU" value={dash?.dau ?? 0} loading={loadingDash} />
          <Stat label="WAU" value={dash?.wau ?? 0} loading={loadingDash} />
          <Stat label="Open escalations" value={dash?.open_escalations ?? 0} loading={loadingDash} tone={dash?.open_escalations ? "warn" : "ok"} />
          <Stat label="Stale > 7d" value={dash?.stale_7d ?? 0} loading={loadingDash} tone={dash?.stale_7d ? "warn" : "ok"} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview"><Activity className="h-4 w-4 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="funnel"><Users className="h-4 w-4 mr-1.5" />Funnel</TabsTrigger>
            <TabsTrigger value="escalations">
              <AlertTriangle className="h-4 w-4 mr-1.5" />Escalations
              {dash?.open_escalations ? <Badge variant="destructive" className="ml-2 px-1.5 py-0">{dash.open_escalations}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="stuck"><Clock className="h-4 w-4 mr-1.5" />Stuck users</TabsTrigger>
            <TabsTrigger value="groups"><MessageSquare className="h-4 w-4 mr-1.5" />Groups</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-4">
            <GlassCard className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Lobby" value={dash?.lobby ?? 0} loading={loadingDash} />
                <Stat label="Applied (unpaid)" value={dash?.applied_unpaid ?? 0} loading={loadingDash} />
                <Stat label="Applied (paid)" value={dash?.applied_paid ?? 0} loading={loadingDash} tone="ok" />
                <Stat label="Call scheduled" value={dash?.call_scheduled ?? 0} loading={loadingDash} />
                <Stat label="Studying" value={dash?.studying ?? 0} loading={loadingDash} />
                <Stat label="Exam scheduled" value={dash?.exam_scheduled ?? 0} loading={loadingDash} />
                <Stat label="Licensed (unhired)" value={dash?.licensed_unhired ?? 0} loading={loadingDash} />
                <Stat label="Hired" value={dash?.hired ?? 0} loading={loadingDash} tone="ok" />
                <Stat label="In onboarding" value={dash?.onboarding ?? 0} loading={loadingDash} />
                <Stat label="Active (Discord)" value={dash?.active_agents ?? 0} loading={loadingDash} tone="muted" />
                <Stat label="Inbound 24h" value={dash?.inbound_24h ?? 0} loading={loadingDash} />
                <Stat label="Outbound 24h" value={dash?.outbound_24h ?? 0} loading={loadingDash} />
                <Stat label="Nudges queued 24h" value={dash?.upcoming_nudges_24h ?? 0} loading={loadingDash} />
              </div>
            </GlassCard>

            <GlassCard className="p-5 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Bot health</h3>
              <ol className="space-y-2 text-sm">
                <HealthLine label="DB tables (telegram_*)" status="ok" hint="7 tables · 3 views · 4 fns" />
                <HealthLine label="Templates seeded" status={(templates?.length ?? 0) >= 38 ? "ok" : "warn"} hint={`${templates?.length ?? 0}/42`} />
                <HealthLine label="Wins group registered" status={groups?.some((g) => g.type === "wins") ? "ok" : "warn"} hint={groups?.some((g) => g.type === "wins") ? "✓" : "no wins group yet — bot can't broadcast hires"} />
                <HealthLine label="Manager Alerts group registered" status={groups?.some((g) => g.type === "manager_alerts") ? "ok" : "warn"} hint={groups?.some((g) => g.type === "manager_alerts") ? "✓" : "no manager_alerts group yet — escalations have no audience"} />
                <HealthLine label="Telegram bot token" status="info" hint="check ~/.config/apex-creds/telegram-bot.token on the operator machine" />
              </ol>
            </GlassCard>
          </TabsContent>

          {/* FUNNEL */}
          <TabsContent value="funnel" className="space-y-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Per-stage breakdown</h3>
              {!funnel || funnel.length === 0 ? (
                <EmptyState title="No users yet" description="Once candidates DM the bot, they'll appear here grouped by stage." icon={Users} />
              ) : (
                <ul className="space-y-2">
                  {funnel.map((f) => (
                    <li key={f.stage} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3">
                      <span className="text-sm">{STAGE_LABEL[f.stage] ?? f.stage}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono">{f.count}</span>
                        <Badge variant="outline">{Number(f.pct ?? 0).toFixed(1)}%</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </TabsContent>

          {/* ESCALATIONS */}
          <TabsContent value="escalations" className="space-y-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Open escalations</h3>
              {!escalations || escalations.length === 0 ? (
                <EmptyState title="No open escalations" description="The bot routes here whenever a candidate hits a hard trigger (money / contract / 'manager')." icon={CheckCircle2} />
              ) : (
                <ul className="space-y-2">
                  {escalations.map((e) => (
                    <li key={e.id} className="flex items-start justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{e.reason.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">chat_id {e.chat_id} · {formatDistanceToNow(parseISO(e.created_at), { addSuffix: true })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {e.acknowledged_at ? <Badge variant="outline">Acked</Badge> : <Badge variant="destructive">Open</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </TabsContent>

          {/* STUCK USERS */}
          <TabsContent value="stuck" className="space-y-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Stale &gt; 3d</h3>
              {!stuck || stuck.length === 0 ? (
                <EmptyState title="Nothing stuck" description="All active users have moved within the last 3 days." icon={CheckCircle2} />
              ) : (
                <ul className="space-y-2">
                  {stuck.map((u) => (
                    <li key={u.chat_id} className="flex items-start justify-between rounded-lg border border-border/40 bg-muted/20 p-3">
                      <div>
                        <p className="text-sm font-medium">{u.first_name ?? "—"} {u.username ? `@${u.username}` : ""}</p>
                        <p className="text-xs text-muted-foreground">{STAGE_LABEL[u.stage] ?? u.stage} · {Number(u.days_stale).toFixed(1)}d stale</p>
                      </div>
                      {u.already_escalated ? <Badge variant="outline">Escalated</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </TabsContent>

          {/* GROUPS */}
          <TabsContent value="groups" className="space-y-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Registered groups</h3>
              {!groups || groups.length === 0 ? (
                <EmptyState
                  title="No groups registered"
                  description="Add the bot as admin to your Telegram groups. The bot auto-registers them here on the first message — then update type via SQL."
                  icon={MessageSquare}
                />
              ) : (
                <ul className="space-y-2">
                  {groups.map((g) => (
                    <li key={g.chat_id} className="flex items-start justify-between rounded-lg border border-border/40 bg-muted/20 p-3">
                      <div>
                        <p className="text-sm font-medium">{g.title}</p>
                        <p className="text-xs text-muted-foreground">chat_id {g.chat_id} · {GROUP_TYPE_LABEL[g.type] ?? g.type}</p>
                      </div>
                      <Badge variant={g.is_active ? "default" : "outline"}>{g.is_active ? "active" : "inactive"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </TabsContent>

          {/* TEMPLATES */}
          <TabsContent value="templates" className="space-y-4">
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Templates ({templates?.length ?? 0})</h3>
              {!templates || templates.length === 0 ? (
                <Skeleton className="h-24" />
              ) : (
                <ul className="space-y-2">
                  {templates.map((t) => (
                    <li key={t.key} className="rounded-lg border border-border/40 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-mono">{t.key}</span>
                        <Badge variant="outline">v{t.version}</Badge>
                      </div>
                      {t.description ? <p className="text-xs text-muted-foreground mt-1">{t.description}</p> : null}
                      <pre className="text-xs whitespace-pre-wrap text-muted-foreground/80 mt-2 max-h-32 overflow-y-auto">{t.body}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Stat({ label, value, loading, tone }: { label: string; value: number | string; loading?: boolean; tone?: "ok" | "warn" | "muted" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-300" :
    tone === "warn" ? "text-amber-300" :
    tone === "muted" ? "text-muted-foreground" :
    "text-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="h-6 w-12 mt-1" /> : <p className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</p>}
    </div>
  );
}

function HealthLine({ label, status, hint }: { label: string; status: "ok" | "warn" | "info"; hint: string }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? AlertTriangle : Activity;
  const tone = status === "ok" ? "text-emerald-400" : status === "warn" ? "text-amber-400" : "text-primary";
  return (
    <li className="flex items-start gap-3">
      <Icon className={`h-4 w-4 mt-0.5 ${tone}`} />
      <div className="flex-1">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </li>
  );
}
