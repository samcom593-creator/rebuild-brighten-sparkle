import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Rocket, Clock, AlertCircle, Search, Phone, MessageSquare, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";

type Stage =
  | "signed_up"
  | "onboarding"
  | "licensing"
  | "contracting"
  | "field_training"
  | "producing"
  | "inactive";

const STAGE_META: Record<Stage, { label: string; color: string; order: number }> = {
  signed_up: { label: "Signed Up", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", order: 1 },
  onboarding: { label: "Onboarding", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", order: 2 },
  licensing: { label: "Licensing", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", order: 3 },
  contracting: { label: "Contracting", color: "bg-violet-500/20 text-violet-400 border-violet-500/30", order: 4 },
  field_training: { label: "Field Training", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", order: 5 },
  producing: { label: "Producing", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", order: 6 },
  inactive: { label: "Inactive", color: "bg-red-500/20 text-red-400 border-red-500/30", order: 99 },
};

const CHECKLIST_STEPS = [
  { key: "watched_welcome_video", label: "Watched welcome video", stage: "signed_up" },
  { key: "completed_profile", label: "Completed profile", stage: "signed_up" },
  { key: "joined_discord", label: "Joined Discord", stage: "onboarding" },
  { key: "joined_whatsapp", label: "Joined WhatsApp group", stage: "onboarding" },
  { key: "added_phone_number", label: "Added phone number", stage: "onboarding" },
  { key: "uploaded_id", label: "Uploaded ID", stage: "onboarding" },
  { key: "signed_ica", label: "Signed ICA", stage: "onboarding" },
  { key: "scheduled_license_test", label: "Scheduled license test", stage: "licensing" },
  { key: "submitted_fingerprints", label: "Submitted fingerprints", stage: "licensing" },
  { key: "passed_license_test", label: "Passed license test", stage: "licensing" },
  { key: "received_license", label: "Received state license", stage: "licensing" },
  { key: "contracted_with_carriers", label: "Contracted with carriers", stage: "contracting" },
  { key: "completed_first_training", label: "Completed first training", stage: "field_training" },
  { key: "made_first_prospect_call", label: "Made first prospect call", stage: "field_training" },
  { key: "ran_first_appointment", label: "Ran first appointment", stage: "field_training" },
  { key: "closed_first_deal", label: "Closed first deal", stage: "producing" },
] as const;

interface ProgressRow {
  id: string;
  agent_id: string;
  current_stage: Stage;
  stage_entered_at: string;
  last_activity_at: string;
  stalled_alert_sent_at: string | null;
  [key: string]: any;
}

interface AgentData {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  is_deactivated: boolean;
}

export default function GettingStarted() {
  const { user, isAdmin, isManager } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "all" | "stalled">("all");
  const canViewAll = isAdmin || isManager;

  const { data: myAgentId } = useQuery({
    queryKey: ["my-agent-id-gs", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from("agents").select("id").eq("user_id", user.id).maybeSingle();
      return data?.id ?? null;
    },
    enabled: !!user?.id,
  });

  const { data: progressRows = [], isLoading } = useQuery({
    queryKey: ["getting-started-progress", canViewAll, myAgentId],
    queryFn: async (): Promise<ProgressRow[]> => {
      let q = supabase.from("getting_started_progress" as any).select("*");
      if (!canViewAll && myAgentId) q = q.eq("agent_id", myAgentId);
      const { data, error } = await q.order("last_activity_at", { ascending: false });
      if (error) {
        console.error(error);
        return [];
      }
      return (data as any) ?? [];
    },
    enabled: canViewAll || !!myAgentId,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["getting-started-agents", progressRows.map((p) => p.agent_id).join(",")],
    queryFn: async (): Promise<AgentData[]> => {
      if (progressRows.length === 0) return [];
      const { data } = await supabase
        .from("agents")
        .select(
          "id, display_name, is_deactivated, user_id, profile:profiles!agents_profile_id_fkey(full_name, email, phone, avatar_url)",
        )
        .in("id", progressRows.map((p) => p.agent_id));
      return (data || []).map((a: any) => ({
        id: a.id,
        display_name: a.profile?.full_name || a.display_name || "Unknown",
        email: a.profile?.email,
        phone: a.profile?.phone,
        avatar_url: a.profile?.avatar_url,
        is_deactivated: a.is_deactivated,
      }));
    },
    enabled: progressRows.length > 0,
  });

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const stalledCutoff = 5 * 24 * 3600 * 1000;
    return progressRows.filter((p) => {
      const agent = agentMap.get(p.agent_id);
      if (!agent || agent.is_deactivated) return false;
      if (stageFilter === "stalled") {
        const lastActivity = new Date(p.last_activity_at).getTime();
        return (
          now - lastActivity > stalledCutoff &&
          p.current_stage !== "producing" &&
          p.current_stage !== "inactive"
        );
      }
      if (stageFilter !== "all" && p.current_stage !== stageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          agent.display_name.toLowerCase().includes(q) ||
          agent.email?.toLowerCase().includes(q) ||
          agent.phone?.includes(q)
        );
      }
      return true;
    });
  }, [progressRows, agentMap, stageFilter, search]);

  const stats = useMemo(() => {
    const result: Record<string, number> = { total: progressRows.length, stalled: 0 };
    Object.keys(STAGE_META).forEach((s) => (result[s] = 0));
    const now = Date.now();
    const stalledCutoff = 5 * 24 * 3600 * 1000;
    for (const p of progressRows) {
      const agent = agentMap.get(p.agent_id);
      if (!agent || agent.is_deactivated) continue;
      result[p.current_stage] = (result[p.current_stage] || 0) + 1;
      const lastActivity = new Date(p.last_activity_at).getTime();
      if (
        now - lastActivity > stalledCutoff &&
        p.current_stage !== "producing" &&
        p.current_stage !== "inactive"
      ) {
        result.stalled++;
      }
    }
    return result;
  }, [progressRows, agentMap]);

  const countChecklist = (p: ProgressRow) => CHECKLIST_STEPS.filter((s) => p[s.key]).length;

  const toggleStep = async (progressId: string, key: string, currentValue: string | null) => {
    const update: Record<string, any> = { [key]: currentValue ? null : new Date().toISOString() };
    const { error } = await supabase
      .from("getting_started_progress" as any)
      .update(update)
      .eq("id", progressId);
    if (error) {
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["getting-started-progress"] });
  };

  const advanceStage = async (progressId: string, newStage: Stage) => {
    const { error } = await supabase
      .from("getting_started_progress" as any)
      .update({ current_stage: newStage, stage_entered_at: new Date().toISOString() })
      .eq("id", progressId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Advanced to ${STAGE_META[newStage].label}`);
    queryClient.invalidateQueries({ queryKey: ["getting-started-progress"] });
  };

  if (isLoading) return <PageLoadingSkeleton variant="list" />;

  // Agent self-view
  if (!canViewAll && progressRows.length === 1) {
    const p = progressRows[0];
    const completed = countChecklist(p);
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4 page-enter">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/20 border border-primary/30">
            <Rocket className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Getting Started</h1>
            <p className="text-sm text-muted-foreground">
              You're in <strong className="text-foreground">{STAGE_META[p.current_stage as Stage].label}</strong>
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Your progress</CardTitle>
              <Badge variant="outline">
                {completed} / {CHECKLIST_STEPS.length}
              </Badge>
            </div>
            <Progress value={(completed / CHECKLIST_STEPS.length) * 100} className="h-2 mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            {CHECKLIST_STEPS.map((step) => (
              <div key={step.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                <Checkbox
                  checked={!!p[step.key]}
                  onCheckedChange={() => toggleStep(p.id, step.key, p[step.key])}
                />
                <div className="flex-1">
                  <p className={`text-sm ${p[step.key] ? "text-muted-foreground line-through" : ""}`}>
                    {step.label}
                  </p>
                  {p[step.key] && (
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(p[step.key]), { addSuffix: true })}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={STAGE_META[step.stage as Stage].color + " text-[10px]"}>
                  {STAGE_META[step.stage as Stage].label}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter">
      <PageHeader
        accent="emerald"
        eyebrow="Onboarding · Getting Started"
        eyebrowIcon={<Rocket className="h-3 w-3" />}
        title="Getting Started Tracker"
        subtitle="Post-signup onboarding progress for every agent — from signed-up through field-training and into producing."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {(["signed_up", "onboarding", "licensing", "contracting", "field_training", "producing"] as Stage[]).map(
          (s) => (
            <button
              key={s}
              onClick={() => setStageFilter(stageFilter === s ? "all" : s)}
              className={`p-3 rounded-lg border text-left transition ${STAGE_META[s].color} ${
                stageFilter === s ? "ring-2 ring-primary" : ""
              }`}
            >
              <p className="text-[10px] uppercase opacity-70">{STAGE_META[s].label}</p>
              <p className="text-xl font-bold">{stats[s] || 0}</p>
            </button>
          ),
        )}
        <button
          onClick={() => setStageFilter(stageFilter === "stalled" ? "all" : "stalled")}
          className={`p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-left transition ${
            stageFilter === "stalled" ? "ring-2 ring-red-500" : ""
          }`}
        >
          <p className="text-[10px] uppercase opacity-70 text-red-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Stalled 5d+
          </p>
          <p className="text-xl font-bold text-red-400">{stats.stalled}</p>
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as any)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="stalled">Stalled (5d+)</SelectItem>
            {(Object.entries(STAGE_META) as [Stage, typeof STAGE_META.signed_up][]).map(([k, m]) => (
              <SelectItem key={k} value={k}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No agents match this filter.
            </CardContent>
          </Card>
        )}
        {filtered.map((p) => {
          const agent = agentMap.get(p.agent_id);
          if (!agent) return null;
          const completed = countChecklist(p);
          const stage = STAGE_META[p.current_stage as Stage];
          const lastActivity = new Date(p.last_activity_at);
          const daysInactive = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 3600 * 24));
          const isStalled =
            daysInactive >= 5 && p.current_stage !== "producing" && p.current_stage !== "inactive";

          return (
            <Card key={p.id} className={isStalled ? "border-red-500/30" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{agent.display_name}</p>
                      <Badge variant="outline" className={stage.color + " text-xs"}>
                        {stage.label}
                      </Badge>
                      {isStalled && (
                        <Badge
                          variant="outline"
                          className="bg-red-500/10 text-red-400 border-red-500/30 text-xs"
                        >
                          <AlertCircle className="h-3 w-3 mr-0.5" /> Stalled {daysInactive}d
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress
                        value={(completed / CHECKLIST_STEPS.length) * 100}
                        className="h-1.5 w-32"
                      />
                      <span className="text-xs text-muted-foreground">
                        {completed}/{CHECKLIST_STEPS.length} steps
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3 inline" />{" "}
                        {formatDistanceToNow(lastActivity, { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {agent.phone && (
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" asChild title="Call">
                        <a href={`tel:${agent.phone}`}>
                          <Phone className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {agent.phone && (
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" asChild title="Text">
                        <a href={`sms:${agent.phone}`}>
                          <MessageSquare className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {agent.email && (
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" asChild title="Email">
                        <a href={`mailto:${agent.email}`}>
                          <Mail className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Select value={p.current_stage} onValueChange={(v) => advanceStage(p.id, v as Stage)}>
                      <SelectTrigger className="h-8 w-[150px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(STAGE_META) as [Stage, typeof STAGE_META.signed_up][]).map(
                          ([k, m]) => (
                            <SelectItem key={k} value={k}>
                              {m.label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
