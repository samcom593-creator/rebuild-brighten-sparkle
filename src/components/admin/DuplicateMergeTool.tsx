import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Merge, Loader2, AlertTriangle, Check, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AgentRecord {
  id: string;
  profileId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  totalAlp: number;
  totalDeals: number;
}

interface DuplicateGroup {
  key: string;
  matchType: "email" | "name" | "phone";
  agents: AgentRecord[];
}

interface DuplicateMergeToolProps {
  open: boolean;
  onClose: () => void;
  onMergeComplete: () => void;
}

// ─── Aged Lead Duplicates Sub-Component ───
function AgedLeadDuplicates() {
  const queryClient = useQueryClient();

  const { data: agedDupes, isLoading } = useQuery({
    queryKey: ["aged-lead-duplicates"],
    queryFn: async () => {
      const { data: leads, error } = await supabase
        .from("aged_leads")
        .select("id, first_name, last_name, email, phone, notes, last_contacted_at, created_at")
        .order("email");
      if (error) throw error;

      // Group by email
      const emailGroups = new Map<string, typeof leads>();
      (leads || []).forEach(l => {
        if (l.email && l.email.trim()) {
          const key = l.email.toLowerCase().trim();
          const group = emailGroups.get(key) || [];
          group.push(l);
          emailGroups.set(key, group);
        }
      });

      // Group by phone
      const phoneGroups = new Map<string, typeof leads>();
      (leads || []).forEach(l => {
        if (l.phone && l.phone.trim()) {
          const key = l.phone.replace(/\D/g, "").slice(-10);
          if (key.length === 10) {
            const group = phoneGroups.get(key) || [];
            group.push(l);
            phoneGroups.set(key, group);
          }
        }
      });

      const groups: { key: string; matchType: string; leads: any[] }[] = [];
      const seenIds = new Set<string>();

      emailGroups.forEach((group, email) => {
        if (group.length > 1) {
          const ids = group.map(l => l.id).sort().join(",");
          if (!seenIds.has(ids)) {
            seenIds.add(ids);
            groups.push({ key: email, matchType: "email", leads: group });
          }
        }
      });

      phoneGroups.forEach((group, phone) => {
        if (group.length > 1) {
          const ids = group.map(l => l.id).sort().join(",");
          if (!seenIds.has(ids)) {
            seenIds.add(ids);
            groups.push({ key: phone, matchType: "phone", leads: group });
          }
        }
      });

      return groups;
    },
  });

  const handleDeleteDuplicates = async (group: { leads: any[] }) => {
    // Keep the one with most recent last_contacted_at, or newest created_at
    const sorted = [...group.leads].sort((a, b) => {
      const aDate = a.last_contacted_at || a.created_at || "";
      const bDate = b.last_contacted_at || b.created_at || "";
      return bDate.localeCompare(aDate);
    });
    const keepId = sorted[0].id;
    const deleteIds = sorted.slice(1).map(l => l.id);

    // Merge notes into the keeper
    const allNotes = sorted
      .map(l => l.notes)
      .filter(Boolean)
      .join("\n---\n");

    try {
      if (allNotes) {
        await supabase.from("aged_leads").update({ notes: allNotes }).eq("id", keepId);
      }
      const { error } = await supabase.from("aged_leads").delete().in("id", deleteIds);
      if (error) throw error;
      toast({ title: "Duplicates removed", description: `Kept 1, deleted ${deleteIds.length} duplicate(s)` });
      queryClient.invalidateQueries({ queryKey: ["aged-lead-duplicates"] });
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!agedDupes || agedDupes.length === 0) {
    return (
      <div className="text-center py-12">
        <Check className="h-12 w-12 mx-auto text-green-500 mb-4" />
        <h3 className="text-lg font-semibold">No Aged Lead Duplicates</h3>
        <p className="text-muted-foreground mt-2">All aged lead records appear unique.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Found <strong>{agedDupes.length}</strong> duplicate groups in aged leads
      </p>
      {agedDupes.map((group) => (
        <div key={group.key} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">{group.leads.length} records</span>
              <Badge variant="outline" className="text-[10px]">
                {group.matchType === "email" ? "Same Email" : "Same Phone"}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleDeleteDuplicates(group)}
              className="gap-1 h-7 text-xs"
            >
              <Merge className="h-3 w-3" />
              Keep Best, Delete Rest
            </Button>
          </div>
          <div className="space-y-1">
            {group.leads.map((lead: any) => (
              <div key={lead.id} className="flex items-center gap-3 p-2 rounded bg-muted/30 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{lead.first_name} {lead.last_name || ""}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {lead.email || "No email"} {lead.phone && `• ${lead.phone}`}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {lead.last_contacted_at ? `Contacted ${new Date(lead.last_contacted_at).toLocaleDateString()}` : "Never contacted"}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DuplicateMergeTool({ open, onClose, onMergeComplete }: DuplicateMergeToolProps) {
  const queryClient = useQueryClient();
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"auto" | "manual" | "aged_leads">("manual");
  const [searchQuery, setSearchQuery] = useState("");
  const [manualSelectedAgents, setManualSelectedAgents] = useState<string[]>([]);
  const [manualPrimaryAgent, setManualPrimaryAgent] = useState<string | null>(null);

  // Fetch all agents
  const { data: allAgents, isLoading: loadingAgents } = useQuery({
    queryKey: ["all-agents-for-merge"],
    enabled: open,
    queryFn: async () => {
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select(`
          id,
          user_id,
          profile_id,
          display_name,
          is_inactive,
          is_deactivated,
          profiles!agents_profile_id_fkey (
            id,
            full_name,
            email,
            phone
          )
        `)
        .order("created_at", { ascending: false });

      if (agentsError) throw agentsError;

      // Get production totals
      const { data: production, error: prodError } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed");

      if (prodError) throw prodError;

      // Aggregate production
      const productionMap = new Map<string, { alp: number; deals: number }>();
      production?.forEach((p) => {
        const existing = productionMap.get(p.agent_id) || { alp: 0, deals: 0 };
        productionMap.set(p.agent_id, {
          alp: existing.alp + Number(p.aop || 0),
          deals: existing.deals + Number(p.deals_closed || 0),
        });
      });

      // Identify agents missing profile_id for fallback lookup
      const agentsWithoutProfile = (agents || []).filter(
        (a: any) => !a.profiles?.full_name
      );
      const fallbackUserIds = agentsWithoutProfile
        .map((a: any) => a.user_id)
        .filter(Boolean) as string[];

      let fallbackProfiles: Record<string, { full_name: string | null; email: string | null; phone: string | null }> = {};
      if (fallbackUserIds.length > 0) {
        const { data: fbProfiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email, phone")
          .in("user_id", fallbackUserIds);
        fbProfiles?.forEach((p) => {
          if (p.user_id) fallbackProfiles[p.user_id] = p;
        });
      }

      return (agents || []).map((a: any) => {
        const fbProfile = a.user_id ? fallbackProfiles[a.user_id] : null;
        return {
          id: a.id,
          profileId: a.profile_id,
          fullName: a.profiles?.full_name || fbProfile?.full_name || a.display_name || `Agent ${a.id.slice(0, 6)}`,
          email: a.profiles?.email || fbProfile?.email || null,
          phone: a.profiles?.phone || fbProfile?.phone || null,
          totalAlp: productionMap.get(a.id)?.alp || 0,
          totalDeals: productionMap.get(a.id)?.deals || 0,
          isInactive: a.is_inactive || a.is_deactivated,
        };
      });
    },
  });

  // Detect duplicates - NOW INCLUDES ALL AGENTS (inactive/terminated too)
  const duplicates = useMemo(() => {
    if (!allAgents) return [];

    // Include ALL agents for duplicate detection (don't filter out inactive)
    const agentList = allAgents;

    // Detect duplicates by email
    const emailGroups = new Map<string, typeof agentList>();
    agentList.forEach((agent) => {
      if (agent.email && agent.email.trim()) {
        const key = agent.email.toLowerCase().trim();
        const group = emailGroups.get(key) || [];
        group.push(agent);
        emailGroups.set(key, group);
      }
    });

    // Detect duplicates by similar name
    const nameGroups = new Map<string, typeof agentList>();
    agentList.forEach((agent) => {
      if (agent.fullName && agent.fullName.trim()) {
        const normalizedName = agent.fullName.toLowerCase().trim().replace(/\s+/g, " ");
        const group = nameGroups.get(normalizedName) || [];
        group.push(agent);
        nameGroups.set(normalizedName, group);
      }
    });

    // Detect duplicates by phone
    const phoneGroups = new Map<string, typeof agentList>();
    agentList.forEach((agent) => {
      if (agent.phone && agent.phone.trim()) {
        const normalizedPhone = agent.phone.replace(/\D/g, "");
        if (normalizedPhone.length >= 10) {
          const group = phoneGroups.get(normalizedPhone) || [];
          group.push(agent);
          phoneGroups.set(normalizedPhone, group);
        }
      }
    });

    // Build duplicate groups
    const duplicateGroups: DuplicateGroup[] = [];
    const seenIds = new Set<string>();

    emailGroups.forEach((group, email) => {
      if (group.length > 1) {
        const ids = group.map((a) => a.id).sort().join(",");
        if (!seenIds.has(ids)) {
          seenIds.add(ids);
          duplicateGroups.push({ key: email, matchType: "email", agents: group });
        }
      }
    });

    phoneGroups.forEach((group, phone) => {
      if (group.length > 1) {
        const ids = group.map((a) => a.id).sort().join(",");
        if (!seenIds.has(ids)) {
          seenIds.add(ids);
          duplicateGroups.push({ key: phone, matchType: "phone", agents: group });
        }
      }
    });

    nameGroups.forEach((group, name) => {
      if (group.length > 1) {
        const ids = group.map((a) => a.id).sort().join(",");
        if (!seenIds.has(ids)) {
          seenIds.add(ids);
          duplicateGroups.push({ key: name, matchType: "name", agents: group });
        }
      }
    });

    return duplicateGroups;
  }, [allAgents]);

  // Filter agents for manual selection - INCLUDE ALL agents by default
  const filteredAgents = useMemo(() => {
    if (!allAgents) return [];
    const query = searchQuery.toLowerCase().trim();
    // Show ALL agents (including inactive/terminated) for merge capability
    if (!query) return allAgents;
    return allAgents.filter(a => 
      a.fullName.toLowerCase().includes(query) ||
      a.email?.toLowerCase().includes(query) ||
      a.phone?.includes(query)
    );
  }, [allAgents, searchQuery]);

  // Selected agents for manual merge
  const selectedAgentsForMerge = useMemo(() => {
    if (!allAgents) return [];
    return allAgents.filter(a => manualSelectedAgents.includes(a.id));
  }, [allAgents, manualSelectedAgents]);

  // Merge mutation using edge function for proper handling
  const mergeDuplicates = useMutation({
    mutationFn: async ({ primaryId, duplicateIds }: { primaryId: string; duplicateIds: string[] }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("merge-agent-records", {
        body: { primaryAgentId: primaryId, duplicateAgentIds: duplicateIds },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      toast({
        title: "Merge complete",
        description: data?.message || "Production records have been consolidated and duplicates archived.",
      });
      // Invalidate ALL agent-related caches across every module
      queryClient.invalidateQueries({ queryKey: ["all-agents-for-merge"] });
      queryClient.invalidateQueries({ queryKey: ["command-center-agents"] });
      queryClient.invalidateQueries({ queryKey: ["active-managers"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["production"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Broad invalidation to catch any remaining agent-related queries
      queryClient.invalidateQueries();
      setManualSelectedAgents([]);
      setManualPrimaryAgent(null);
      onMergeComplete();
    },
    onError: (error) => {
      toast({
        title: "Merge failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAutoMerge = (group: DuplicateGroup) => {
    const primaryId = selectedPrimary[group.key];
    if (!primaryId) {
      toast({
        title: "Select primary",
        description: "Please select which agent record to keep as primary.",
        variant: "destructive",
      });
      return;
    }

    const duplicateIds = group.agents.filter((a) => a.id !== primaryId).map((a) => a.id);
    mergeDuplicates.mutate({ primaryId, duplicateIds });
  };

  const handleManualMerge = () => {
    if (!manualPrimaryAgent) {
      toast({
        title: "Select primary",
        description: "Please select which agent record to keep as primary.",
        variant: "destructive",
      });
      return;
    }

    if (manualSelectedAgents.length < 2) {
      toast({
        title: "Select agents",
        description: "Please select at least 2 agents to merge.",
        variant: "destructive",
      });
      return;
    }

    const duplicateIds = manualSelectedAgents.filter(id => id !== manualPrimaryAgent);
    mergeDuplicates.mutate({ primaryId: manualPrimaryAgent, duplicateIds });
  };

  const toggleAgentSelection = (agentId: string) => {
    setManualSelectedAgents(prev => {
      if (prev.includes(agentId)) {
        // If removing and this was the primary, clear primary
        if (manualPrimaryAgent === agentId) {
          setManualPrimaryAgent(null);
        }
        return prev.filter(id => id !== agentId);
      }
      return [...prev, agentId];
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Radix calls onOpenChange(true) when opening; our onClose handler
        // would immediately close the dialog if we pass it directly.
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5" />
            Merge Agent Records
          </DialogTitle>
          <DialogDescription>
            Merge duplicate agent records. All production data will be consolidated into the primary record.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "auto" | "manual" | "aged_leads")} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="manual">Manual Merge</TabsTrigger>
            <TabsTrigger value="auto">
              Auto-Detect ({duplicates?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="aged_leads">
              Aged Lead Dupes
            </TabsTrigger>
          </TabsList>

          {/* Manual Merge Tab */}
          <TabsContent value="manual" className="flex-1 overflow-hidden flex flex-col mt-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Selected agents for merge */}
            {manualSelectedAgents.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 mb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Selected for Merge ({manualSelectedAgents.length})</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setManualSelectedAgents([]);
                      setManualPrimaryAgent(null);
                    }}
                    className="h-7 text-xs"
                  >
                    Clear All
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedAgentsForMerge.map(agent => (
                    <Badge
                      key={agent.id}
                      variant={manualPrimaryAgent === agent.id ? "default" : "secondary"}
                      className="cursor-pointer gap-1"
                      onClick={() => setManualPrimaryAgent(agent.id)}
                    >
                      {agent.fullName}
                      {manualPrimaryAgent === agent.id && " (Primary)"}
                      <X
                        className="h-3 w-3 ml-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAgentSelection(agent.id);
                        }}
                      />
                    </Badge>
                  ))}
                </div>
                {manualSelectedAgents.length >= 2 && (
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Combined ALP: </span>
                      <span className="font-bold">
                        ${Math.round(selectedAgentsForMerge.reduce((sum, a) => sum + a.totalAlp, 0)).toLocaleString()}
                      </span>
                    </div>
                    <Button
                      onClick={handleManualMerge}
                      disabled={!manualPrimaryAgent || mergeDuplicates.isPending}
                      size="sm"
                      className="gap-2"
                    >
                      {mergeDuplicates.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Merge className="h-4 w-4" />
                      )}
                      Merge Selected
                    </Button>
                  </div>
                )}
                {manualSelectedAgents.length >= 2 && !manualPrimaryAgent && (
                  <p className="text-xs text-amber-600">Click a badge above to set as primary (record to keep)</p>
                )}
              </div>
            )}

            {/* Agent list */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-2">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAgents.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No agents found</p>
              ) : (
                filteredAgents.map(agent => (
                  <div
                    key={agent.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                      manualSelectedAgents.includes(agent.id)
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/50"
                    )}
                    onClick={() => toggleAgentSelection(agent.id)}
                  >
                    <Checkbox
                      checked={manualSelectedAgents.includes(agent.id)}
                      onCheckedChange={() => toggleAgentSelection(agent.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{agent.fullName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {agent.email || "No email"} {agent.phone && `• ${agent.phone}`}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-bold">${Math.round(agent.totalAlp).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{agent.totalDeals} deals</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Auto-Detect Tab */}
          <TabsContent value="auto" className="flex-1 overflow-y-auto mt-4">
            {loadingAgents ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !duplicates || duplicates.length === 0 ? (
              <div className="text-center py-12">
                <Check className="h-12 w-12 mx-auto text-green-500 mb-4" />
                <h3 className="text-lg font-semibold">No Duplicates Found</h3>
                <p className="text-muted-foreground mt-2">
                  All agent records appear to be unique. Use Manual Merge to combine specific records.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {duplicates.map((group) => (
                  <div key={group.key} className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">Potential Duplicate</span>
                      <Badge variant="outline">
                        {group.matchType === "email" 
                          ? "Same Email" 
                          : group.matchType === "phone" 
                            ? "Same Phone" 
                            : "Same Name"}
                      </Badge>
                    </div>

                    <RadioGroup
                      value={selectedPrimary[group.key] || ""}
                      onValueChange={(value) => 
                        setSelectedPrimary((prev) => ({ ...prev, [group.key]: value }))
                      }
                    >
                      <div className="space-y-2">
                        {group.agents.map((agent) => (
                          <div
                            key={agent.id}
                            className={cn(
                              "flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-colors",
                              selectedPrimary[group.key] === agent.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-muted-foreground"
                            )}
                            onClick={() => 
                              setSelectedPrimary((prev) => ({ ...prev, [group.key]: agent.id }))
                            }
                          >
                            <RadioGroupItem value={agent.id} id={agent.id} />
                            <div className="flex-1 min-w-0">
                              <Label htmlFor={agent.id} className="font-medium cursor-pointer">
                                {agent.fullName || "Unknown"}
                              </Label>
                              <p className="text-xs text-muted-foreground truncate">
                                {agent.email || "No email"}
                                {agent.phone && ` • ${agent.phone}`}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold">${Math.round(agent.totalAlp).toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground">{agent.totalDeals} deals</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </RadioGroup>

                    <Button
                      onClick={() => handleAutoMerge(group)}
                      disabled={!selectedPrimary[group.key] || mergeDuplicates.isPending}
                      className="w-full gap-2"
                    >
                      {mergeDuplicates.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Merge className="h-4 w-4" />
                      )}
                      Merge to Selected Primary
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Aged Lead Duplicates Tab */}
          <TabsContent value="aged_leads" className="flex-1 overflow-y-auto mt-4">
            <AgedLeadDuplicates />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
