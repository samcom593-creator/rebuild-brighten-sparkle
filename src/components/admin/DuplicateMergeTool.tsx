import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Merge, Loader2, AlertTriangle, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DuplicateGroup {
  key: string;
  matchType: "email" | "name" | "phone";
  agents: Array<{
    id: string;
    profileId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    totalAlp: number;
    totalDeals: number;
  }>;
}

interface DuplicateMergeToolProps {
  open: boolean;
  onClose: () => void;
  onMergeComplete: () => void;
}

export function DuplicateMergeTool({ open, onClose, onMergeComplete }: DuplicateMergeToolProps) {
  const queryClient = useQueryClient();
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});

  // Fetch all agents and detect duplicates
  const { data: duplicates, isLoading } = useQuery({
    queryKey: ["duplicate-detection"],
    enabled: open,
    queryFn: async () => {
      // Get all agents with profiles
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select(`
          id,
          profile_id,
          profiles!agents_profile_id_fkey (
            id,
            full_name,
            email,
            phone
          )
        `);

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

      // Map agents
      const agentList = (agents || []).map((a) => ({
        id: a.id,
        profileId: a.profile_id,
        fullName: a.profiles?.full_name || "",
        email: a.profiles?.email || null,
        phone: a.profiles?.phone || null,
        totalAlp: productionMap.get(a.id)?.alp || 0,
        totalDeals: productionMap.get(a.id)?.deals || 0,
      }));

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
          // Normalize name: lowercase, remove extra spaces
          const normalizedName = agent.fullName.toLowerCase().trim().replace(/\s+/g, " ");
          const group = nameGroups.get(normalizedName) || [];
          group.push(agent);
          nameGroups.set(normalizedName, group);
        }
      });

      // Build duplicate groups
      const duplicateGroups: DuplicateGroup[] = [];
      const seenIds = new Set<string>();

      // Email duplicates
      emailGroups.forEach((group, email) => {
        if (group.length > 1) {
          const ids = group.map((a) => a.id).sort().join(",");
          if (!seenIds.has(ids)) {
            seenIds.add(ids);
            duplicateGroups.push({
              key: email,
              matchType: "email",
              agents: group,
            });
          }
        }
      });

      // Detect duplicates by phone
      const phoneGroups = new Map<string, typeof agentList>();
      agentList.forEach((agent) => {
        if (agent.phone && agent.phone.trim()) {
          // Normalize phone: remove non-digits
          const normalizedPhone = agent.phone.replace(/\D/g, "");
          if (normalizedPhone.length >= 10) {
            const group = phoneGroups.get(normalizedPhone) || [];
            group.push(agent);
            phoneGroups.set(normalizedPhone, group);
          }
        }
      });

      // Phone duplicates (only if not already grouped by email)
      phoneGroups.forEach((group, phone) => {
        if (group.length > 1) {
          const ids = group.map((a) => a.id).sort().join(",");
          if (!seenIds.has(ids)) {
            seenIds.add(ids);
            duplicateGroups.push({
              key: phone,
              matchType: "phone",
              agents: group,
            });
          }
        }
      });

      // Name duplicates (only if not already grouped by email or phone)
      nameGroups.forEach((group, name) => {
        if (group.length > 1) {
          const ids = group.map((a) => a.id).sort().join(",");
          if (!seenIds.has(ids)) {
            seenIds.add(ids);
            duplicateGroups.push({
              key: name,
              matchType: "name",
              agents: group,
            });
          }
        }
      });

      return duplicateGroups;
    },
  });

  // Merge mutation
  const mergeDuplicates = useMutation({
    mutationFn: async ({ primaryId, duplicateIds }: { primaryId: string; duplicateIds: string[] }) => {
      // Move all production records to primary
      for (const dupId of duplicateIds) {
        const { error: prodError } = await supabase
          .from("daily_production")
          .update({ agent_id: primaryId })
          .eq("agent_id", dupId);

        if (prodError) throw prodError;

        // Mark duplicate as inactive
        const { error: agentError } = await supabase
          .from("agents")
          .update({ is_inactive: true, is_deactivated: true })
          .eq("id", dupId);

        if (agentError) throw agentError;
      }
    },
    onSuccess: () => {
      toast({
        title: "Merge complete",
        description: "Production records have been consolidated and duplicates archived.",
      });
      queryClient.invalidateQueries({ queryKey: ["duplicate-detection"] });
      queryClient.invalidateQueries({ queryKey: ["command-center-agents"] });
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

  const handleMerge = (group: DuplicateGroup) => {
    const primaryId = selectedPrimary[group.key];
    if (!primaryId) {
      toast({
        title: "Select primary",
        description: "Please select which agent record to keep as primary.",
        variant: "destructive",
      });
      return;
    }

    const duplicateIds = group.agents
      .filter((a) => a.id !== primaryId)
      .map((a) => a.id);

    mergeDuplicates.mutate({ primaryId, duplicateIds });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Duplicate Detection & Merge
          </DialogTitle>
          <DialogDescription>
            Review and merge duplicate agent records. Production stats will be consolidated.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !duplicates || duplicates.length === 0 ? (
          <div className="text-center py-12">
            <Check className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-semibold">No Duplicates Found</h3>
            <p className="text-muted-foreground mt-2">
              All agent records appear to be unique.
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
                            {" "}• ID: {agent.id.slice(0, 8)}...
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

                {/* Merge Preview */}
                {selectedPrimary[group.key] && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-sm font-medium mb-2">Merge Preview:</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Combined ALP</p>
                        <p className="font-bold text-lg">
                          ${Math.round(group.agents.reduce((sum, a) => sum + a.totalAlp, 0)).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Combined Deals</p>
                        <p className="font-bold text-lg">
                          {group.agents.reduce((sum, a) => sum + a.totalDeals, 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => handleMerge(group)}
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
      </DialogContent>
    </Dialog>
  );
}
