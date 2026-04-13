import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, DollarSign, UserPlus, Percent, Crown, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { startOfWeek, format } from "date-fns";

type DrilldownType = "agents" | "alp" | "apps" | "closerate" | null;

interface StatCardDrilldownProps {
  activeModal: DrilldownType;
  onClose: () => void;
}

function getAvatarUrl(profileId: string | null) {
  if (!profileId) return undefined;
  const { data } = supabase.storage.from("avatars").getPublicUrl(`${profileId}/avatar`);
  return data?.publicUrl;
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

export function StatCardDrilldown({ activeModal, onClose }: StatCardDrilldownProps) {
  const weekStart = format(startOfWeek(new Date()), "yyyy-MM-dd");

  const { data: agents } = useQuery({
    queryKey: ["drilldown-agents"],
    queryFn: async () => {
      const { data: agentData } = await supabase
        .from("agents")
        .select("id, display_name, user_id, profile_id, status, onboarding_stage, is_deactivated")
        .eq("is_deactivated", false);

      const { data: prodData } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations, production_date")
        .gte("production_date", weekStart);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url");

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
      const prodMap = new Map<string, { aop: number; deals: number; pres: number; lastDate: string }>();

      (prodData || []).forEach((r: any) => {
        const existing = prodMap.get(r.agent_id) || { aop: 0, deals: 0, pres: 0, lastDate: "" };
        existing.aop += Number(r.aop || 0);
        existing.deals += r.deals_closed || 0;
        existing.pres += r.presentations || 0;
        if (r.production_date > existing.lastDate) existing.lastDate = r.production_date;
        prodMap.set(r.agent_id, existing);
      });

      const { data: appData } = await supabase
        .from("applications")
        .select("id, first_name, last_name, license_status, ai_score_tier, created_at, assigned_agent_id")
        .gte("created_at", new Date(weekStart).toISOString());

      return {
        agents: (agentData || []).map((a: any) => {
          const profile = profileMap.get(a.user_id);
          const prod = prodMap.get(a.id) || { aop: 0, deals: 0, pres: 0, lastDate: "" };
          return {
            id: a.id,
            name: a.display_name || profile?.full_name || "Agent",
            avatarUrl: profile?.avatar_url,
            stage: a.onboarding_stage || a.status,
            weeklyAlp: prod.aop,
            deals: prod.deals,
            presentations: prod.pres,
            closeRate: prod.pres > 0 ? Math.round((prod.deals / prod.pres) * 100) : 0,
            lastActive: prod.lastDate,
          };
        }).sort((a: any, b: any) => b.weeklyAlp - a.weeklyAlp),
        applications: (appData || []).map((app: any) => ({
          id: app.id,
          name: `${app.first_name} ${app.last_name}`,
          licenseStatus: app.license_status,
          aiScore: app.ai_score_tier,
          createdAt: app.created_at,
          assignedAgentId: app.assigned_agent_id,
        })),
      };
    },
    enabled: !!activeModal,
    staleTime: 30000,
  });

  const totalWeeklyAlp = agents?.agents.reduce((s: number, a: any) => s + a.weeklyAlp, 0) || 0;
  const totalPres = agents?.agents.reduce((s: number, a: any) => s + a.presentations, 0) || 0;
  const totalDeals = agents?.agents.reduce((s: number, a: any) => s + a.deals, 0) || 0;
  const teamCloseRate = totalPres > 0 ? Math.round((totalDeals / totalPres) * 100 * 10) / 10 : 0;

  return (
    <Sheet open={!!activeModal} onOpenChange={() => onClose()}>
      <SheetContent side="bottom" className="h-[80vh] overflow-y-auto bg-background">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2" style={{ fontFamily: "Syne" }}>
            {activeModal === "agents" && <><Users className="h-5 w-5 text-primary" /> Active Agents</>}
            {activeModal === "alp" && <><DollarSign className="h-5 w-5 text-emerald-400" /> Weekly ALP Breakdown</>}
            {activeModal === "apps" && <><UserPlus className="h-5 w-5" /> Applications This Week</>}
            {activeModal === "closerate" && <><Percent className="h-5 w-5 text-emerald-400" /> Close Rate by Agent</>}
          </SheetTitle>
        </SheetHeader>

        {/* ACTIVE AGENTS */}
        {activeModal === "agents" && agents && (
          <div className="space-y-2">
            {agents.agents.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={a.avatarUrl} />
                  <AvatarFallback className="text-xs">{initials(a.name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.stage}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-primary">${a.weeklyAlp.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">{a.lastActive || "No activity"}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* WEEKLY ALP */}
        {activeModal === "alp" && agents && (
          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 mb-3">
              <p className="text-xs text-muted-foreground">Total Team ALP</p>
              <p className="text-2xl font-bold text-primary">${totalWeeklyAlp.toLocaleString()}</p>
            </div>
            {agents.agents.filter((a: any) => a.weeklyAlp > 0).map((a: any, i: number) => {
              const pct = totalWeeklyAlp > 0 ? (a.weeklyAlp / totalWeeklyAlp) * 100 : 0;
              return (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
                  <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
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
                </div>
              );
            })}
          </div>
        )}

        {/* APPLICATIONS */}
        {activeModal === "apps" && agents && (
          <div className="space-y-2">
            {agents.applications.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No applications this week</p>
            )}
            {agents.applications.map((app: any) => (
              <div key={app.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
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
              </div>
            ))}
          </div>
        )}

        {/* CLOSE RATE */}
        {activeModal === "closerate" && agents && (
          <div className="space-y-2">
            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 mb-3">
              <p className="text-xs text-muted-foreground">Team Average Close Rate</p>
              <p className="text-2xl font-bold text-emerald-400">{teamCloseRate}%</p>
            </div>
            {agents.agents.filter((a: any) => a.presentations > 0).map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
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
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
