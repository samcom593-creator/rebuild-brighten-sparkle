import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Edit2, Merge, User, Check, Loader2, Mail, Phone, Send, Instagram, UserPlus, Trash2, AlertTriangle, UserMinus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

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

interface LinkedProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface AgentData {
  user_id: string | null;
  profile_id: string | null;
  display_name: string | null;
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
  const { isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState(currentName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [possibleMatches, setPossibleMatches] = useState<PossibleMatch[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"choice" | "confirm_delete">("choice");
  const [loading, setLoading] = useState(false);
  const [linkedProfile, setLinkedProfile] = useState<LinkedProfile | null>(null);
  const [agentData, setAgentData] = useState<AgentData | null>(null);

  useEffect(() => {
    if (open && agentId) {
      setDisplayName(currentName);
      setSelectedMergeId(null);
      setLinkedProfile(null);
      setAgentData(null);
      setEmail("");
      setPhone("");
      setInstagram("");
      fetchAgentData();
      fetchPossibleMatches();
    }
  }, [open, agentId, currentName]);

  const fetchAgentData = async () => {
    try {
      // Fetch agent with linked profile via profile_id
      const { data: agent } = await supabase
        .from("agents")
        .select(`
          id, 
          user_id,
          profile_id,
          display_name,
          profile:profiles!agents_profile_id_fkey(full_name, email, phone)
        `)
        .eq("id", agentId)
        .maybeSingle();

      if (agent) {
        setAgentData({
          user_id: agent.user_id,
          profile_id: agent.profile_id,
          display_name: agent.display_name,
        });

        if (agent.profile) {
          const profile = agent.profile as { full_name?: string; email?: string; phone?: string };
          setLinkedProfile({
            full_name: profile.full_name || null,
            email: profile.email || null,
            phone: profile.phone || null,
          });
          // Pre-fill form fields from profile
          if (profile.full_name && currentName === "Unknown Agent") {
            setDisplayName(profile.full_name);
          }
          if (profile.email) {
            setEmail(profile.email);
          }
          if (profile.phone) {
            setPhone(profile.phone);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching agent data:", error);
    }
  };

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
        .filter(m => m.name !== "Unknown")
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 50); // Allow more matches for easier finding

      setPossibleMatches(matches);
    } catch (error) {
      console.error("Error fetching possible matches:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChanges = async () => {
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
      // Update agent display name
      const { error } = await supabase
        .from("agents")
        .update({ display_name: displayName.trim() })
        .eq("id", agentId);

      if (error) throw error;

      // If agent has a profile, update phone there
      if (agentData?.profile_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({ phone: phone.trim() || null })
          .eq("id", agentData.profile_id);

        if (profileError) {
          console.error("Error updating profile phone:", profileError);
        }
      }

      toast({
        title: "Changes saved",
        description: `Agent "${displayName.trim()}" updated successfully.`,
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving changes:", error);
      toast({
        title: "Error",
        description: "Failed to save changes. Please try again.",
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
      console.log("🔀 Starting merge:", {
        primaryAgentId: selectedMergeId,
        duplicateAgentIds: [agentId],
      });

      const { data, error } = await supabase.functions.invoke("merge-agent-records", {
        body: {
          primaryAgentId: selectedMergeId,
          duplicateAgentIds: [agentId],
        },
      });

      console.log("🔀 Merge response:", { data, error });

      if (error) {
        throw new Error(error.message || "Edge function error");
      }

      // Check if data contains an error field (edge function returned error response)
      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: "Agents merged ✅",
        description: data?.message || "Records have been combined successfully.",
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error merging agents:", error);
      toast({
        title: "Merge failed",
        description: error?.message || "Failed to merge agent records. Please try again.",
        variant: "destructive",
      });
    } finally {
      setMerging(false);
    }
  };

  const handleInactivate = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ is_inactive: true, status: "inactive" })
        .eq("id", agentId);

      if (error) throw error;

      toast({
        title: "Agent marked as inactive",
        description: `${currentName} is now hidden from leaderboards and active views.`,
      });

      setShowDeleteConfirm(false);
      setDeleteStep("choice");
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error inactivating agent:", error);
      toast({
        title: "Failed to inactivate",
        description: "Could not mark agent as inactive. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Delete all dependent records first (order matters due to FK constraints)
      // Clear references from other agents pointing to this one
      await supabase
        .from("agents")
        .update({ manager_id: null })
        .eq("manager_id", agentId);
      
      await supabase
        .from("agents")
        .update({ invited_by_manager_id: null })
        .eq("invited_by_manager_id", agentId);
      
      await supabase
        .from("agents")
        .update({ switched_to_manager_id: null })
        .eq("switched_to_manager_id", agentId);

      // Clear application assignments
      await supabase
        .from("applications")
        .update({ assigned_agent_id: null })
        .eq("assigned_agent_id", agentId);

      // Clear aged leads assignments
      await supabase
        .from("aged_leads")
        .update({ assigned_manager_id: null })
        .eq("assigned_manager_id", agentId);

      // Delete all records from tables with agent_id FK
      await supabase.from("daily_production").delete().eq("agent_id", agentId);
      await supabase.from("agent_notes").delete().eq("agent_id", agentId);
      await supabase.from("agent_goals").delete().eq("agent_id", agentId);
      await supabase.from("agent_metrics").delete().eq("agent_id", agentId);
      await supabase.from("agent_achievements").delete().eq("agent_id", agentId);
      await supabase.from("agent_lead_stats").delete().eq("agent_id", agentId);
      await supabase.from("agent_onboarding").delete().eq("agent_id", agentId);
      await supabase.from("agent_attendance").delete().eq("agent_id", agentId);
      await supabase.from("agent_ratings").delete().eq("agent_id", agentId);
      await supabase.from("agent_removal_requests").delete().eq("agent_id", agentId);
      await supabase.from("email_tracking").delete().eq("agent_id", agentId);
      await supabase.from("magic_login_tokens").delete().eq("agent_id", agentId);
      await supabase.from("plaque_awards").delete().eq("agent_id", agentId);
      await supabase.from("onboarding_progress").delete().eq("agent_id", agentId);

      // Delete manager invite links
      await supabase
        .from("manager_invite_links")
        .delete()
        .eq("manager_agent_id", agentId);

      // Delete contact history and interview recordings via applications
      // (these reference agent_id directly too)
      await supabase.from("contact_history").delete().eq("agent_id", agentId);
      await supabase.from("interview_recordings").delete().eq("agent_id", agentId);

      // Finally delete the agent record
      const { error: agentError } = await supabase
        .from("agents")
        .delete()
        .eq("id", agentId);

      if (agentError) throw agentError;

      toast({
        title: "Agent deleted",
        description: `${currentName} and all associated records have been removed.`,
      });

      setShowDeleteConfirm(false);
      setDeleteStep("choice");
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error deleting agent:", error);
      toast({
        title: "Delete failed",
        description: "Failed to delete agent. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateAndSendLogin = async () => {
    if (!email.trim()) {
      toast({
        title: "Email required",
        description: "Please enter an email address to send the login.",
        variant: "destructive",
      });
      return;
    }

    if (!displayName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for this agent.",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-agent-from-leaderboard", {
        body: {
          agentId,
          email: email.trim(),
          fullName: displayName.trim(),
          phone: phone.trim() || null,
          instagramHandle: instagram.trim() || null,
        },
      });

      if (error) throw error;

      toast({
        title: "Login Sent! 🎉",
        description: `Portal access sent to ${email}. Agent is now LIVE.`,
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating agent login:", error);
      toast({
        title: "Creation failed",
        description: error.message || "Failed to create agent login. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount >= 1000 ? `$${(amount / 1000).toFixed(1)}k` : `$${amount}`;
  };

  // Check if agent already has login (has user_id)
  const hasExistingLogin = !!agentData?.user_id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-primary" />
            Edit Agent
          </DialogTitle>
          <DialogDescription>
            Update the display name, merge with an existing record, or create login access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Agent Info */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <User className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="font-medium">{currentName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(production)} ALP • {deals} deals
                </p>
              </div>
              {hasExistingLogin && (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  Has Login
                </Badge>
              )}
            </div>
            {/* Show linked profile name if available */}
            {linkedProfile?.full_name && (
              <div className="mt-2 p-2 rounded bg-accent/50 border border-border">
                <p className="text-xs text-foreground">
                  📋 Imported as: <span className="font-semibold">{linkedProfile.full_name}</span>
                </p>
                {linkedProfile.email && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{linkedProfile.email}</p>
                )}
              </div>
            )}
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

          {/* Phone Number - Always visible */}
          <div className="space-y-2">
            <Label htmlFor="agentPhone" className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5" />
              Phone Number
            </Label>
            <Input
              id="agentPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Enter phone number"
              type="tel"
            />
            {!agentData?.profile_id && (
              <p className="text-[10px] text-muted-foreground">
                Phone will be saved when profile is created below.
              </p>
            )}
          </div>

          {/* Admin: Create & Send Login Section */}
          {isAdmin && !hasExistingLogin && (
            <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Label className="flex items-center gap-2 text-primary">
                <UserPlus className="h-4 w-4" />
                Create Profile & Send Login
              </Label>
              <p className="text-xs text-muted-foreground">
                Create a new profile and send magic link login to this agent.
              </p>
              
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email (required)"
                    className="pl-10"
                    type="email"
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Phone (optional)"
                    className="pl-10"
                    type="tel"
                  />
                </div>
                <div className="relative">
                  <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="Instagram handle (optional)"
                    className="pl-10"
                  />
                </div>
              </div>

              <Button
                onClick={handleCreateAndSendLogin}
                disabled={creating || !email.trim()}
                className="w-full"
                size="sm"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating & Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Create & Send Login
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Possible Matches for Merge */}
          {possibleMatches.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Merge className="h-3.5 w-3.5" />
                Merge with existing agent
              </Label>
              <div className="max-h-[150px] overflow-y-auto space-y-1 pr-1">
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
          {/* Delete Button - Admin only */}
          {isAdmin && (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={saving || merging || creating || deleting}
              className="sm:mr-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
          
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving || merging || creating || deleting}
          >
            Cancel
          </Button>
          {selectedMergeId ? (
            <Button
              onClick={handleMerge}
              disabled={merging}
              variant="secondary"
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
            <Button onClick={handleSaveChanges} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Delete Choice / Confirmation Dialog */}
      <AlertDialog 
        open={showDeleteConfirm} 
        onOpenChange={(open) => {
          setShowDeleteConfirm(open);
          if (!open) setDeleteStep("choice");
        }}
      >
        <AlertDialogContent>
          {deleteStep === "choice" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Remove Agent: {currentName}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Choose how you want to handle this agent:
                </AlertDialogDescription>
              </AlertDialogHeader>
              
              <div className="space-y-3 py-4">
                {/* Inactivate Option */}
                <button
                  onClick={handleInactivate}
                  disabled={deleting}
                  className="w-full flex items-start gap-3 p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                >
                  <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <UserMinus className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Mark as Inactive</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Hide from leaderboards and active views. Agent record and all data is kept for reporting.
                    </p>
                  </div>
                </button>

                {/* Permanent Delete Option */}
                <button
                  onClick={() => setDeleteStep("confirm_delete")}
                  disabled={deleting}
                  className="w-full flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors text-left"
                >
                  <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                    <Trash2 className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium text-destructive">Permanently Delete</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Remove agent and all records forever. This cannot be undone.
                    </p>
                  </div>
                </button>
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Permanently Delete Agent?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete <strong>{currentName}</strong> and all their records including:
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>All production data ({formatCurrency(production)} ALP, {deals} deals)</li>
                    <li>Notes, goals, and metrics</li>
                    <li>Attendance and onboarding records</li>
                  </ul>
                  <p className="mt-3 font-medium text-destructive">This action cannot be undone.</p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel 
                  disabled={deleting}
                  onClick={() => setDeleteStep("choice")}
                >
                  Back
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Forever
                    </>
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
