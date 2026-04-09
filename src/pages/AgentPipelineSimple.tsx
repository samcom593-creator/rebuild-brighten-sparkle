import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Search, RefreshCw, ArrowRightLeft, CheckCircle2, XCircle,
  User, Crown, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STAGES = [
  { key: "applied",        label: "Applied",         color: "bg-blue-500/20 text-blue-400 border-blue-500/30",    dot: "bg-blue-400" },
  { key: "interviewed",    label: "Interviewed",     color: "bg-violet-500/20 text-violet-400 border-violet-500/30", dot: "bg-violet-400" },
  { key: "contracted",     label: "Contracted",      color: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-400" },
  { key: "in_training",    label: "In Training",     color: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-400" },
  { key: "field_training", label: "Field Training",  color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",    dot: "bg-cyan-400" },
  { key: "evaluated",      label: "Active",          color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-400" },
  { key: "inactive",       label: "Inactive",        color: "bg-gray-500/20 text-gray-400 border-gray-500/30",    dot: "bg-gray-400" },
];

const stageMap = Object.fromEntries(STAGES.map(s => [s.key, s]));

interface Agent {
  id: string;
  name: string;
  email: string;
  phone?: string;
  stage: string;
  managerName: string;
  managerId?: string;
  assignedBy: string;
  licenseStatus: string;
  weeklyALP: number;
  hasPendingSwitchRequest: boolean;
}

interface Manager {
  id: string;
  name: string;
}

interface SwitchRequest {
  id: string;
  agentName: string;
  agentId: string;
  currentManager: string;
  requestedManager: string;
  reason: string;
  requestedAt: string;
}

export default function AgentPipelineSimple() {
  const { isAdmin, isManager, user } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [switchRequests, setSwitchRequests] = useState<SwitchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("all");
  const [showRequests, setShowRequests] = useState(false);

  const [switchDialog, setSwitchDialog] = useState(false);
  const [switchAgentId, setSwitchAgentId] = useState("");
  const [switchAgentName, setSwitchAgentName] = useState("");
  const [switchTargetManager, setSwitchTargetManager] = useState("");
  const [switchReason, setSwitchReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: agentData } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          invited_by_manager_id,
          is_deactivated,
          profiles:profile_id(full_name, email)
        `)
        .eq("is_deactivated", false)
        .order("created_at", { ascending: false });

      const { data: mgrAgents } = await supabase
        .from("agents")
        .select("id, display_name, user_id, invited_by_manager_id")
        .not("user_id", "is", null);

      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const { data: prodData } = await supabase
        .from("daily_production")
        .select("agent_id, aop")
        .gte("production_date", weekStart.toISOString().split("T")[0]);

      const alpByAgent: Record<string, number> = {};
      prodData?.forEach((p: any) => {
        alpByAgent[p.agent_id] = (alpByAgent[p.agent_id] || 0) + (Number(p.aop) || 0);
      });

      const managerList: Manager[] = (mgrAgents || []).map((m: any) => ({
        id: m.id,
        name: m.display_name || "Manager",
      }));

      const managerMap = Object.fromEntries(managerList.map(m => [m.id, m.name]));

      const agentList: Agent[] = (agentData || []).map((a: any) => {
        const profile = a.profiles;
        const mgrName = managerMap[a.invited_by_manager_id] || "Sam";
        return {
          id: a.id,
          name: profile?.full_name || "Agent",
          email: profile?.email || "",
          stage: a.onboarding_stage || "applied",
          managerName: mgrName,
          managerId: a.invited_by_manager_id,
          assignedBy: mgrName,
          licenseStatus: "unknown",
          weeklyALP: alpByAgent[a.id] || 0,
          hasPendingSwitchRequest: false,
        };
      });

      setAgents(agentList);
      setManagers(managerList);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const openSwitchDialog = (agentId: string, agentName: string) => {
    setSwitchAgentId(agentId);
    setSwitchAgentName(agentName);
    setSwitchTargetManager("");
    setSwitchReason("");
    setSwitchDialog(true);
  };

  const submitSwitchRequest = async () => {
    if (!switchTargetManager || !switchReason.trim()) {
      toast.error("Please select a manager and provide a reason");
      return;
    }
    setSubmitting(true);
    try {
      const targetMgr = managers.find(m => m.id === switchTargetManager);
      await supabase.from("agents").update({ invited_by_manager_id: switchTargetManager }).eq("id", switchAgentId);
      await supabase.functions.invoke("send-notification", {
        body: {
          email: "sam@apex-financial.org",
          title: `Manager Switch Request — ${switchAgentName}`,
          message: `${switchAgentName} is requesting a move to ${targetMgr?.name}. Reason: ${switchReason}`,
        },
      });
      toast.success("Switch request submitted — Sam will review it");
      setSwitchDialog(false);
      fetchAll();
    } catch (e) {
      toast.error("Failed to submit request");
    }
    setSubmitting(false);
  };

  const approveSwitch = async (req: SwitchRequest) => {
    await supabase.from("agents").update({ invited_by_manager_id: req.requestedManager }).eq("id", req.agentId);
    toast.success(`${req.agentName} moved`);
    fetchAll();
  };

  const declineSwitch = async (reqId: string) => {
    toast.success("Request declined");
    fetchAll();
  };

  const filtered = agents.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    const matchStage = filterStage === "all" || a.stage === filterStage;
    return matchSearch && matchStage;
  });

  const byStage = STAGES.map(s => ({
    ...s,
    agents: filtered.filter(a => a.stage === s.key),
  })).filter(s => s.agents.length > 0);

  const stageCounts = Object.fromEntries(
    STAGES.map(s => [s.key, agents.filter(a => a.stage === s.key).length])
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium tracking-wider uppercase">APEX Financial</p>
          <h1 className="text-2xl font-bold text-foreground">Agent Pipeline</h1>
        </div>
        <div className="flex items-center gap-2">
          {switchRequests.length > 0 && (isAdmin || isManager) && (
            <Button variant="outline" size="sm" onClick={() => setShowRequests(!showRequests)} className="gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              {switchRequests.length} Switch Request{switchRequests.length > 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={fetchAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Switch Requests Panel */}
      <AnimatePresence>
        {showRequests && switchRequests.length > 0 && (isAdmin || isManager) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <GlassCard className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-primary" /> Pending Manager Switch Requests
              </div>
              <div className="space-y-2">
                {switchRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                    <div>
                      <p className="text-sm font-medium text-foreground">{req.agentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {req.currentManager} → {req.requestedManager}
                      </p>
                      <p className="text-xs text-muted-foreground italic">"{req.reason}"</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="text-emerald-400" onClick={() => approveSwitch(req)}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-400" onClick={() => declineSwitch(req.id)}>
                        <XCircle className="h-3 w-3 mr-1" /> Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search + Stage Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStage("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filterStage === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
          >
            All ({agents.length})
          </button>
          {STAGES.map(s => stageCounts[s.key] > 0 && (
            <button
              key={s.key}
              onClick={() => setFilterStage(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${filterStage === s.key ? s.color : "border-border text-muted-foreground hover:border-primary/50"}`}
            >
              {s.label} ({stageCounts[s.key]})
            </button>
          ))}
        </div>
      </div>

      {/* Stage Groups */}
      {byStage.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No agents found</p>
      ) : (
        <div className="space-y-6">
          {byStage.map(group => (
            <div key={group.key} className="space-y-3">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${group.dot}`} />
                <span className="text-sm font-semibold text-foreground">{group.label}</span>
                <Badge variant="secondary" className="text-xs">{group.agents.length}</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.agents.map((agent, idx) => (
                  <motion.div key={agent.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
                    <GlassCard className="p-4 space-y-3">
                      {/* Agent header */}
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                            {agent.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.email}</p>
                          </div>
                        </div>
                        <Badge className={`text-[10px] ${stageMap[agent.stage]?.color || ""}`}>
                          {stageMap[agent.stage]?.label || agent.stage}
                        </Badge>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          via {agent.assignedBy}
                        </div>
                        {agent.weeklyALP > 0 && (
                          <div className="text-emerald-400 font-semibold">
                            ${agent.weeklyALP.toLocaleString()} wk
                          </div>
                        )}
                      </div>

                      {/* Manager + switch */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Crown className="h-3 w-3 text-amber-400" />
                          <span className="text-foreground">{agent.managerName}</span>
                          {agent.hasPendingSwitchRequest && (
                            <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30">
                              Switch pending
                            </Badge>
                          )}
                        </div>
                        {!agent.hasPendingSwitchRequest && (
                          <button
                            onClick={() => openSwitchDialog(agent.id, agent.name)}
                            className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Request switch
                          </button>
                        )}
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Switch Request Dialog */}
      <Dialog open={switchDialog} onOpenChange={setSwitchDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Request Manager Switch
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              Requesting switch for <span className="font-semibold text-foreground">{switchAgentName}</span>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">New Manager</label>
              <Select value={switchTargetManager} onValueChange={setSwitchTargetManager}>
                <SelectTrigger>
                  <SelectValue placeholder="Select manager..." />
                </SelectTrigger>
                <SelectContent>
                  {managers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Reason for switch</label>
              <textarea
                value={switchReason}
                onChange={(e) => setSwitchReason(e.target.value)}
                placeholder="Why is this switch needed?"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwitchDialog(false)}>Cancel</Button>
            <Button onClick={submitSwitchRequest} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}