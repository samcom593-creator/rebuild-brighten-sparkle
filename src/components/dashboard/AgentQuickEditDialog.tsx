import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Edit2, Merge, User, AlertCircle, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AgentQuickEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  currentName: string;
  production?: number;
  deals?: number;
  onUpdate?: () => void;
}

interface PossibleMatch {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  production: number;
  deals: number;
}

export function AgentQuickEditDialog({
  open,
  onOpenChange,
  agentId,
  currentName,
  production = 0,
  deals = 0,
  onUpdate,
}: AgentQuickEditDialogProps) {
  const [displayName, setDisplayName] = useState(currentName);
  const [possibleMatches, setPossibleMatches] = useState<PossibleMatch[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && agentId) {
      setDisplayName(currentName);
      setSelectedMergeId(null);
      fetchPossibleMatches();
    }
  }, [open, agentId, currentName]);

  const fetchPossibleMatches = async () => {
    setLoading(true);
    try {
      // Get current agent's profile data if any
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id, user_id, display_name")
        .eq("id", agentId)
        .single();

      // Get all other agents with their production totals
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id, user_id, display_name")
        .neq("id", agentId)
        .eq("is_deactivated", false);

      if (!allAgents) {
        setPossibleMatches([]);
        return;
      }

      // Get profiles for agents with user_ids
      const userIds = allAgents.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone")
        .in("user_id", userIds);

      // Get production totals
      const { data: productionData } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed");

      const productionByAgent: Record<string, { alp: number; deals: number }> = {};
      productionData?.forEach(p => {
        if (!productionByAgent[p.agent_id]) {
          productionByAgent[p.agent_id] = { alp: 0, deals: 0 };
        }
        productionByAgent[p.agent_id].alp += Number(p.aop || 0);
        productionByAgent[p.agent_id].deals += Number(p.deals_closed || 0);
      });

      // Build matches list - agents with names that could be duplicates
      const matches: PossibleMatch[] = allAgents
        .map(agent => {
          const profile = profiles?.find(p => p.user_id === agent.user_id);
          const name = profile?.full_name || agent.display_name || "Unknown";
          const stats = productionByAgent[agent.id] || { alp: 0, deals: 0 };
          
          return {
            id: agent.id,
            name,
            email: profile?.email,
            phone: profile?.phone || undefined,
            production: stats.alp,
            deals: stats.deals,
          };
        })
        .filter(m => m.name !== "Unknown" && m.production > 0)
        .slice(0, 10); // Limit to 10 matches

      setPossibleMatches(matches);
    } catch (error) {
      console.error("Error fetching possible matches:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!displayName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a display name for this agent.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ display_name: displayName.trim() })
        .eq("id", agentId);

      if (error) throw error;

      toast({
        title: "Name updated",
        description: `Agent name set to "${displayName.trim()}"`,
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving name:", error);
      toast({
        title: "Error",
        description: "Failed to update agent name. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async () => {
    if (!selectedMergeId) {
      toast({
        title: "Select an agent",
        description: "Please select an agent to merge with.",
        variant: "destructive",
      });
      return;
    }

    setMerging(true);
    try {
      const { error } = await supabase.functions.invoke("merge-agent-records", {
        body: {
          sourceAgentId: agentId,
          targetAgentId: selectedMergeId,
        },
      });

      if (error) throw error;

      toast({
        title: "Agents merged",
        description: "Records have been combined successfully.",
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error merging agents:", error);
      toast({
        title: "Merge failed",
        description: "Failed to merge agent records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setMerging(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount >= 1000 ? `$${(amount / 1000).toFixed(1)}k` : `$${amount}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-primary" />
            Edit Agent
          </DialogTitle>
          <DialogDescription>
            Update the display name or merge with an existing record.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Agent Info */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-medium">{currentName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(production)} ALP • {deals} deals
                </p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">
              ID: {agentId.slice(0, 8)}...
            </p>
          </div>

          {/* Edit Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter agent name"
            />
          </div>

          {/* Possible Matches for Merge */}
          {possibleMatches.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Merge className="h-3.5 w-3.5" />
                Merge with existing agent
              </Label>
              <div className="max-h-[200px] overflow-y-auto space-y-1 pr-1">
                <RadioGroup
                  value={selectedMergeId || ""}
                  onValueChange={setSelectedMergeId}
                >
                  {possibleMatches.map((match) => (
                    <motion.div
                      key={match.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
                        selectedMergeId === match.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedMergeId(match.id)}
                    >
                      <RadioGroupItem value={match.id} id={match.id} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{match.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {match.email || "No email"} • {formatCurrency(match.production)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {match.deals} deals
                      </Badge>
                    </motion.div>
                  ))}
                </RadioGroup>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">Loading possible matches...</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving || merging}
          >
            Cancel
          </Button>
          {selectedMergeId ? (
            <Button
              onClick={handleMerge}
              disabled={merging}
              className="bg-amber-500 hover:bg-amber-600"
            >
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Merging...
                </>
              ) : (
                <>
                  <Merge className="h-4 w-4 mr-2" />
                  Merge Records
                </>
              )}
            </Button>
          ) : (
            <Button onClick={handleSaveName} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Name
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
