import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DollarSign, Save } from "lucide-react";
import { toast } from "sonner";

interface AgentComp {
  id: string;
  name: string;
  role: string;
  contract_percentage: number;
  override_rate: number;
  insuracloud_user_id: number | null;
}

export default function CompTiersSettings() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Partial<AgentComp>>>({});

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["comp-tiers"],
    queryFn: async (): Promise<AgentComp[]> => {
      // PL-075: show only active agents — Sam: "I see a bunch of agents
      // who aren't active. I only want to honestly see active agents."
      // Three flags must ALL be active: is_deactivated=false (HR off-boarded),
      // is_inactive=false (system-flagged inactive — 36 rows leak through
      // without this), and status='active' (enum truth). Legacy data had
      // combinations of all three that needed explicit gating.
      const { data } = await supabase
        .from("agents")
        .select("id, display_name, contract_percentage, override_rate, insuracloud_user_id, user_id, profile:profiles!agents_profile_id_fkey(full_name)")
        .eq("is_deactivated", false)
        .eq("is_inactive", false)
        .eq("status", "active")
        .order("display_name");
      const rolesRes = await supabase.from("user_roles").select("user_id, role");
      const roleMap = new Map((rolesRes.data || []).map((r: any) => [r.user_id, r.role]));
      return (data || []).map((a: any) => ({
        id: a.id,
        name: a.profile?.full_name || a.display_name || "—",
        role: (a.user_id && roleMap.get(a.user_id)) || "agent",
        contract_percentage: Number(a.contract_percentage) || 120,
        override_rate: Number(a.override_rate) || 0,
        insuracloud_user_id: a.insuracloud_user_id,
      }));
    },
    enabled: isAdmin,
  });

  const save = async (agent: AgentComp) => {
    const edit = edits[agent.id];
    if (!edit) return;
    const { error } = await supabase.from("agents")
      .update({
        contract_percentage: edit.contract_percentage ?? agent.contract_percentage,
        override_rate: edit.override_rate ?? agent.override_rate,
        insuracloud_user_id: edit.insuracloud_user_id ?? agent.insuracloud_user_id,
      } as any)
      .eq("id", agent.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved ${agent.name}`);
    setEdits(prev => { const n = { ...prev }; delete n[agent.id]; return n; });
    queryClient.invalidateQueries({ queryKey: ["comp-tiers"] });
  };

  if (!isAdmin) return <div className="p-6 text-muted-foreground">Admin access required</div>;

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-primary/10 border border-emerald-500/30">
          <DollarSign className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Comp Tiers</h1>
          <p className="text-sm text-muted-foreground">
            Contract % (personal) and Override % (downline) per agent. Also InsuraCloud user ID for deal sync.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {isLoading && [...Array(6)].map((_, i) => /* stable-key-allow:skeleton */ <div key={i} className="h-14 rounded bg-muted/20 animate-pulse" />)}
          {agents.map(agent => {
            const edit = edits[agent.id] || {};
            const contract = edit.contract_percentage ?? agent.contract_percentage;
            const override = edit.override_rate ?? agent.override_rate;
            const icUserId = edit.insuracloud_user_id ?? agent.insuracloud_user_id;
            const isDirty = Object.keys(edit).length > 0;
            return (
              <div key={agent.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 p-2 rounded hover:bg-muted/20">
                <div>
                  <p className="font-medium text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{agent.role}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Contract %</p>
                  <Input
                    type="number" step="1" min="0" max="200"
                    className="h-8 w-24 text-sm"
                    value={contract}
                    onChange={e => setEdits(p => ({ ...p, [agent.id]: { ...p[agent.id], contract_percentage: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Override (0–1)</p>
                  <Input
                    type="number" step="0.01" min="0" max="1"
                    className="h-8 w-24 text-sm"
                    value={override}
                    onChange={e => setEdits(p => ({ ...p, [agent.id]: { ...p[agent.id], override_rate: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">InsuraCloud ID</p>
                  <Input
                    type="number"
                    className="h-8 w-28 text-sm"
                    value={icUserId ?? ""}
                    onChange={e => setEdits(p => ({ ...p, [agent.id]: { ...p[agent.id], insuracloud_user_id: e.target.value ? Number(e.target.value) : null } }))}
                  />
                </div>
                <Button size="sm" disabled={!isDirty} onClick={() => save(agent)}>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
