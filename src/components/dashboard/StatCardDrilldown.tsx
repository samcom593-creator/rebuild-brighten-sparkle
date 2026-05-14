import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, DollarSign, UserPlus, Percent, Crown, ArrowRight,
  Phone, Mail, MessageSquare, ListTodo, MoreVertical,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "sonner";
import { getBusinessDayKey, getBusinessWeekBounds } from "@/lib/dateUtils";
import { LIVE_AGENT_DEAL_WINDOW_DAYS, getCloseRate, getLiveAgentCutoffIso } from "@/lib/metricTruth";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr, liveDealWindowOr } from "@/lib/dealTruth";

type DrilldownType = "agents" | "alp" | "apps" | "closerate" | null;

interface StatCardDrilldownProps {
  activeModal: DrilldownType;
  onClose: () => void;
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

export function StatCardDrilldown({ activeModal, onClose }: StatCardDrilldownProps) {
  const weekBounds = getBusinessWeekBounds();
  const weekStart = getBusinessDayKey(weekBounds.start);
  const liveCutoffIso = getLiveAgentCutoffIso();

  const { data: agents } = useQuery({
    queryKey: ["drilldown-agents"],
    queryFn: async () => {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, display_name, user_id, profile_id, status, onboarding_stage, is_deactivated")
        .eq("is_deactivated", false);

      const [{ data: dealsWeek }, { data: dealsLive }, { data: productionWeek }] = await Promise.all([
        supabase
          .from("deals")
          .select("agent_id, annual_premium, posted_at, created_at")
          .or(dealTruthWindowOr(weekBounds.startIso, weekBounds.endIso))
          .in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase
          .from("deals")
          .select("agent_id, posted_at, created_at")
          .or(liveDealWindowOr(liveCutoffIso))
          .in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase
          .from("daily_production")
          .select("agent_id, presentations")
          .gte("production_date", weekStart),
      ]);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url, email, phone");

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const prodMap = new Map<string, { aop: number; deals: number; pres: number; lastDate: string }>();
      const liveMap = new Map<string, string>();

      (dealsWeek || []).forEach((r: any) => {
        if (!r.agent_id) return;
        const existing = prodMap.get(r.agent_id) || { aop: 0, deals: 0, pres: 0, lastDate: "" };
        existing.aop += Number(r.annual_premium || 0);
        existing.deals += 1;
        const postedDate = String(r.posted_at || r.created_at || "").slice(0, 10);
        if (postedDate > existing.lastDate) existing.lastDate = postedDate;
        prodMap.set(r.agent_id, existing);
      });

      (dealsLive || []).forEach((r: any) => {
        if (!r.agent_id) return;
        const postedDate = String(r.posted_at || "").slice(0, 10);
        if (postedDate > (liveMap.get(r.agent_id) || "")) liveMap.set(r.agent_id, postedDate);
      });

      (productionWeek || []).forEach((r: any) => {
        if (!r.agent_id) return;
        const existing = prodMap.get(r.agent_id) || { aop: 0, deals: 0, pres: 0, lastDate: "" };
        existing.pres += Number(r.presentations || 0);
        prodMap.set(r.agent_id, existing);
      });

      const { data: appData } = await supabase
        .from("applications")
        .select("id, first_name, last_name, email, phone, license_status, ai_score_tier, created_at, assigned_agent_id")
        .gte("created_at", weekBounds.startIso)
        .lt("created_at", weekBounds.endIso);

      return {
        agents: (agentData || []).map((a: any) => {
          const profile: any = profileMap.get(a.user_id);
          const prod = prodMap.get(a.id) || { aop: 0, deals: 0, pres: 0, lastDate: "" };
          return {
            id: a.id,
            name: a.display_name || profile?.full_name || "Agent",
            avatarUrl: profile?.avatar_url,
            email: profile?.email || null,
            phone: profile?.phone || null,
            stage: a.onboarding_stage || a.status,
            weeklyAlp: prod.aop,
            deals: prod.deals,
            presentations: prod.pres,
            closeRate: Math.round(getCloseRate(prod.deals, prod.pres)),
            lastActive: prod.lastDate,
            isLive: liveMap.has(a.id),
            lastDealDate: liveMap.get(a.id) || prod.lastDate,
          };
        }),
        applications: (appData || []).map((app: any) => ({
          id: app.id,
          name: `${app.first_name} ${app.last_name}`,
          email: app.email,
          phone: app.phone,
          licenseStatus: app.license_status,
          aiScore: app.ai_score_tier,
          createdAt: app.created_at,
        })),
      };
    },
    enabled: !!activeModal,
  });

  const createTask = async (agentId: string, name: string) => {
    const { error } = await supabase.from("agent_tasks").insert({
      agent_id: agentId,
      title: `Follow-up: ${name}`,
      description: "Created from dashboard drilldown",
      due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString().split("T")[0],
      priority: "medium",
      status: "pending",
      task_type: "followup",
      created_at: new Date().toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Task created for ${name}`);
  };

  const totalAlp = agents?.agents.reduce((s, a) => s + a.weeklyAlp, 0) || 0;
  const liveAgents = agents?.agents.filter(a => a.isLive) || [];
  const activeAgents = liveAgents.length;
  const teamCloseRate = agents?.agents.length && agents.agents.some(a => a.presentations > 0)
    ? Math.round(
        (agents.agents.reduce((s, a) => s + a.deals, 0) /
          agents.agents.reduce((s, a) => s + a.presentations, 0)) * 100,
      )
    : 0;

  const title =
    activeModal === "agents" ? "Live Agents" :
    activeModal === "alp" ? "Weekly ALP Leaders" :
    activeModal === "apps" ? "Applications This Week" :
    activeModal === "closerate" ? "Close Rate Breakdown" : "";

  return (
    <Sheet open={!!activeModal} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4">
          {/* AGENTS */}
          {activeModal === "agents" && agents && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 mb-3">
                <p className="text-xs text-muted-foreground">Deal posted in last {LIVE_AGENT_DEAL_WINDOW_DAYS} days</p>
                <p className="text-2xl font-bold text-primary">{activeAgents}</p>
              </div>
              {liveAgents.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No live agents in the last {LIVE_AGENT_DEAL_WINDOW_DAYS} days</p>
              )}
              {liveAgents.map((a) => (
                <AgentRow key={a.id} agent={a} onTask={() => createTask(a.id, a.name)} />
              ))}
            </div>
          )}

          {/* ALP */}
          {activeModal === "alp" && agents && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 mb-3">
                <p className="text-xs text-muted-foreground">Team Weekly ALP</p>
                <p className="text-2xl font-bold text-emerald-400">${totalAlp.toLocaleString()}</p>
              </div>
              {agents.agents
                .filter(a => a.weeklyAlp > 0)
                .sort((a, b) => b.weeklyAlp - a.weeklyAlp)
                .map((a) => {
                  const pct = totalAlp > 0 ? (a.weeklyAlp / totalAlp) * 100 : 0;
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={a.avatarUrl} />
                        <AvatarFallback className="text-xs">{initials(a.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{a.name}</p>
                        <Progress value={pct} className="h-1.5 mt-1" />
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">${a.weeklyAlp.toLocaleString()}</p>
                        <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</p>
                      </div>
                      <RowActions agent={a} onTask={() => createTask(a.id, a.name)} />
                    </div>
                  );
                })}
            </div>
          )}

          {/* APPS */}
          {activeModal === "apps" && agents && (
            <div className="space-y-2">
              {agents.applications.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No applications this week</p>
              )}
              {agents.applications.map((app) => (
                <div key={app.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{app.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className={cn("text-[10px]",
                        app.licenseStatus === "licensed" ? "text-emerald-400 border-emerald-500/30" : "text-amber-400 border-amber-500/30"
                      )}>
                        {app.licenseStatus}
                      </Badge>
                      {app.aiScore && (
                        <Badge variant="outline" className="text-[10px]">{app.aiScore}</Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(app.createdAt).toLocaleDateString()}</p>
                  <div className="flex items-center gap-0.5">
                    {app.phone && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Call">
                        <a href={`tel:${app.phone}`}><Phone className="h-3.5 w-3.5" /></a>
                      </Button>
                    )}
                    {app.phone && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Text">
                        <a href={`sms:${app.phone}`}><MessageSquare className="h-3.5 w-3.5" /></a>
                      </Button>
                    )}
                    {app.email && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Email">
                        <a href={`mailto:${app.email}`}><Mail className="h-3.5 w-3.5" /></a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CLOSE RATE */}
          {activeModal === "closerate" && agents && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 mb-3">
                <p className="text-xs text-muted-foreground">Team Avg Close Rate</p>
                <p className="text-2xl font-bold text-emerald-400">{teamCloseRate}%</p>
              </div>
              {agents.agents.filter(a => a.presentations > 0).map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={a.avatarUrl} />
                    <AvatarFallback className="text-xs">{initials(a.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.presentations} pres · {a.deals} deals</p>
                  </div>
                  <Badge variant="outline" className={cn("text-sm font-bold",
                    a.closeRate >= 40 ? "text-emerald-400 border-emerald-500/30" :
                    a.closeRate >= 25 ? "text-amber-400 border-amber-500/30" :
                    "text-red-400 border-red-500/30"
                  )}>
                    {a.closeRate}%
                  </Badge>
                  <RowActions agent={a} onTask={() => createTask(a.id, a.name)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AgentRow({ agent, onTask }: { agent: any; onTask: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group">
      <Avatar className="h-8 w-8">
        <AvatarImage src={agent.avatarUrl} />
        <AvatarFallback className="text-xs">{initials(agent.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{agent.name}</p>
        <p className="text-xs text-muted-foreground">
          {agent.lastDealDate ? `Last deal ${agent.lastDealDate}` : "No live deal"}
        </p>
      </div>
      <RowActions agent={agent} onTask={onTask} />
    </div>
  );
}

function RowActions({ agent, onTask }: { agent: any; onTask: () => void }) {
  return (
    <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition">
      {agent.phone && (
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Call">
          <a href={`tel:${agent.phone}`}><Phone className="h-3.5 w-3.5" /></a>
        </Button>
      )}
      {agent.phone && (
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Text">
          <a href={`sms:${agent.phone}`}><MessageSquare className="h-3.5 w-3.5" /></a>
        </Button>
      )}
      {agent.email && (
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild title="Email">
          <a href={`mailto:${agent.email}`}><Mail className="h-3.5 w-3.5" /></a>
        </Button>
      )}
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onTask} title="Create Task">
        <ListTodo className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
