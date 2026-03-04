import { useState, useEffect, useMemo, forwardRef } from "react";
import { motion } from "framer-motion";
import { Users, UserPlus, Check, X, Loader2, EyeOff, RotateCcw, Search, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface BulkLead {
  id: string;
  source: "applications" | "aged_leads";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenseStatus: string;
  createdAt: string;
  assignedToId: string | null;
  assignedToName: string | null;
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

export const BulkLeadAssignment = forwardRef<HTMLDivElement>(function BulkLeadAssignment(_, ref) {
  const [leads, setLeads] = useState<BulkLead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [hiddenAgents, setHiddenAgents] = useState<Set<string>>(new Set());
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "applications" | "aged_leads">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "unassigned">("all");

  const visibleAgents = useMemo(() => agents.filter((a) => !hiddenAgents.has(a.id)), [agents, hiddenAgents]);

  // Safe key encoding for composite source::id keys
  const encodeKey = (source: string, id: string) => `${source}::${id}`;
  const decodeKey = (key: string) => {
    const idx = key.indexOf("::");
    return { source: key.slice(0, idx) as "applications" | "aged_leads", id: key.slice(idx + 2) };
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);

    // Fetch agents first for name mapping
    const { data: agentsData } = await supabase
      .from("agents")
      .select("id, user_id")
      .eq("status", "active");

    const agentNameMap: Record<string, string> = {};
    const agentEmailMap: Record<string, string> = {};
    let agentList: Agent[] = [];

    if (agentsData && agentsData.length > 0) {
      const userIds = agentsData.map((a) => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      agentList = agentsData.map((agent) => {
        const profile = profiles?.find((p) => p.user_id === agent.user_id);
        agentNameMap[agent.id] = profile?.full_name || "Unknown";
        agentEmailMap[agent.id] = profile?.email || "";
        return {
          id: agent.id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "",
        };
      });
      setAgents(agentList);
    }

    // Fetch applications (all, not just unassigned)
    const { data: applications, error: appError } = await supabase
      .from("applications")
      .select("id, first_name, last_name, email, phone, license_status, created_at, assigned_agent_id")
      .is("terminated_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    // Fetch aged leads
    const { data: agedLeads, error: agedError } = await supabase
      .from("aged_leads")
      .select("id, first_name, last_name, email, phone, license_status, created_at, assigned_manager_id")
      .order("created_at", { ascending: false })
      .limit(200);

    if (appError) console.error("Error fetching applications:", appError);
    if (agedError) console.error("Error fetching aged leads:", agedError);

    const allLeads: BulkLead[] = [
      ...(applications || []).map((app) => ({
        id: app.id,
        source: "applications" as const,
        firstName: app.first_name,
        lastName: app.last_name,
        email: app.email,
        phone: app.phone || "",
        licenseStatus: app.license_status,
        createdAt: app.created_at,
        assignedToId: app.assigned_agent_id,
        assignedToName: app.assigned_agent_id ? agentNameMap[app.assigned_agent_id] || "Unknown" : null,
      })),
      ...(agedLeads || []).map((lead) => ({
        id: lead.id,
        source: "aged_leads" as const,
        firstName: lead.first_name,
        lastName: lead.last_name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        licenseStatus: lead.license_status || "unknown",
        createdAt: lead.created_at || new Date().toISOString(),
        assignedToId: lead.assigned_manager_id,
        assignedToName: lead.assigned_manager_id ? agentNameMap[lead.assigned_manager_id] || "Unknown" : null,
      })),
    ];

    setLeads(allLeads);
    setIsLoading(false);
  };

  // Filtered leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesSearch = searchQuery === "" ||
        `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone}`
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
      const matchesSource = sourceFilter === "all" || lead.source === sourceFilter;
      const matchesAssignee = assigneeFilter === "all" || !lead.assignedToId;
      return matchesSearch && matchesSource && matchesAssignee;
    });
  }, [leads, searchQuery, sourceFilter, assigneeFilter]);

  const toggleLead = (key: string) => {
    const newSelected = new Set(selectedLeads);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedLeads(newSelected);
  };

  const toggleAll = () => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => encodeKey(l.source, l.id))));
    }
  };

  const handleBulkAssign = async () => {
    if (!selectedAgentId || selectedLeads.size === 0) return;

    setIsAssigning(true);
    try {
      const applicationIds: string[] = [];
      const agedLeadIds: string[] = [];

      selectedLeads.forEach((key) => {
        const { source, id } = decodeKey(key);
        if (source === "applications") applicationIds.push(id);
        else agedLeadIds.push(id);
      });

      const managerId = selectedAgentId === "unassigned" ? null : selectedAgentId;

      if (applicationIds.length > 0) {
        const { error } = await supabase
          .from("applications")
          .update({ assigned_agent_id: managerId })
          .in("id", applicationIds);
        if (error) throw error;
      }

      if (agedLeadIds.length > 0) {
        const { error } = await supabase
          .from("aged_leads")
          .update({ assigned_manager_id: managerId })
          .in("id", agedLeadIds);
        if (error) throw error;
      }

      // Send a single notification to the target manager
      if (managerId) {
        try {
          await supabase.functions.invoke("notify-lead-assigned", {
            body: {
              applicationId: applicationIds[0] || agedLeadIds[0],
              newAgentId: managerId,
              bulkCount: selectedLeads.size,
            },
          });
        } catch (notifyErr) {
          console.error("Failed to notify manager:", notifyErr);
        }
      }

      toast.success(`Successfully assigned ${selectedLeads.size} leads!`, {
        description: `${applicationIds.length} applications + ${agedLeadIds.length} aged leads assigned.`,
      });

      setSelectedLeads(new Set());
      setSelectedAgentId("");
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      console.error("Bulk assignment error:", err);
      toast.error("Failed to assign leads");
    } finally {
      setIsAssigning(false);
    }
  };

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  if (isLoading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-6" ref={ref}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Bulk Lead Assignment
            {leads.length > 0 && (
              <Badge variant="outline" className="ml-2 bg-primary/20 text-primary border-primary/30">
                {leads.length} total
              </Badge>
            )}
          </h3>
        </div>

        {/* Filters row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-input"
            />
          </div>
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
            <SelectTrigger className="w-[150px] h-9">
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="applications">Applications</SelectItem>
              <SelectItem value="aged_leads">Aged Leads</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assigneeFilter} onValueChange={(v) => setAssigneeFilter(v as typeof assigneeFilter)}>
            <SelectTrigger className="w-[150px] h-9">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Leads</SelectItem>
              <SelectItem value="unassigned">Unassigned Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredLeads.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No leads match your filters</p>
            <p className="text-sm">Try adjusting your search or filter criteria.</p>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm text-muted-foreground">
                  {selectedLeads.size} of {filteredLeads.length} selected
                </span>
              </div>

              <div className="flex-1 min-w-[200px]">
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger className="bg-input">
                    <SelectValue placeholder="Select manager to assign..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassign (Remove Assignment)</SelectItem>
                    {visibleAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} ({agent.email})
                      </SelectItem>
                    ))}
                    {hiddenAgents.size > 0 && (
                      <div className="px-2 py-1.5 border-t border-border/50">
                        <button
                          onClick={(e) => { e.stopPropagation(); setHiddenAgents(new Set()); }}
                          className="flex items-center gap-1 text-xs text-primary hover:underline w-full"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Show all ({hiddenAgents.size} hidden)
                        </button>
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Hide agent button */}
              {selectedAgentId && selectedAgentId !== "unassigned" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHiddenAgents((prev) => new Set([...prev, selectedAgentId]));
                    setSelectedAgentId("");
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  <EyeOff className="h-3 w-3 mr-1" />
                  Hide
                </Button>
              )}

              <Button
                onClick={() => setIsConfirmOpen(true)}
                disabled={selectedLeads.size === 0 || !selectedAgentId}
                className="bg-primary hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assign {selectedLeads.size > 0 ? `(${selectedLeads.size})` : ""}
              </Button>
            </div>

            {/* Leads List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-custom">
              {filteredLeads.map((lead) => {
                const key = encodeKey(lead.source, lead.id);
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                      selectedLeads.has(key)
                        ? "bg-primary/10 border-primary/30"
                        : "bg-background/50 border-border hover:bg-muted/30"
                    }`}
                  >
                    <Checkbox
                      checked={selectedLeads.has(key)}
                      onCheckedChange={() => toggleLead(key)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {lead.firstName} {lead.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">{lead.email}</p>
                    </div>
                    {lead.assignedToName && (
                      <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border text-xs">
                        → {lead.assignedToName}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        lead.source === "aged_leads"
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                      }
                    >
                      {lead.source === "aged_leads" ? "Aged" : "App"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        lead.licenseStatus === "licensed"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      }
                    >
                      {lead.licenseStatus === "licensed" ? "Licensed" : "Unlicensed"}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </GlassCard>

      {/* Confirmation Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Assignment</DialogTitle>
            <DialogDescription>
              You are about to assign {selectedLeads.size} lead{selectedLeads.size !== 1 ? "s" : ""} to{" "}
              <strong>{selectedAgentId === "unassigned" ? "Unassigned" : selectedAgent?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              The manager will receive a single email notification about their new leads.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} disabled={isAssigning}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleBulkAssign} disabled={isAssigning}>
              {isAssigning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Confirm Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
