import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Edit2, Merge, User, Check, Loader2, Mail, Phone, Send, Instagram, UserPlus, Trash2, AlertTriangle, UserMinus, KeyRound, RefreshCw } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { advanceHireStage } from "@/components/hires/HireStageControl";

interface AgentQuickEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  currentName: string;
  production?: number;
  deals?: number;
  onUpdate?: () => void;
  period?: "day" | "week" | "month" | "custom";
  dateRange?: { from?: string; to?: string };
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
  instagram_handle: string | null;
}

interface AgentData {
  user_id: string | null;
  ref_slug: string | null;
  profile_id: string | null;
  display_name: string | null;
  invited_by_manager_id: string | null;
  license_status: string;
  nipr_number: string | null;
  onboarding_stage: string | null;
  comp_percentage: number;
  comp_approval_status: string;
  license_states: string[] | null;
  eo_certificate_url: string | null;
  eo_policy_number: string | null;
  eo_expires_at: string | null;
  eo_per_claim_limit: number | null;
  eo_aggregate_limit: number | null;
  eft_ready: boolean;
  contracting_contact_name: string | null;
}

export function AgentQuickEditDialog({
  open,
  onOpenChange,
  agentId,
  currentName,
  production = 0,
  deals = 0,
  onUpdate,
  period,
  dateRange,
}: AgentQuickEditDialogProps) {
  const { isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState(currentName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [possibleMatches, setPossibleMatches] = useState<PossibleMatch[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [accountMode, setAccountMode] = useState<string>("agent");
  const [savingMode, setSavingMode] = useState(false);
  const [merging, setMerging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"choice" | "confirm_delete">("choice");
  const [loading, setLoading] = useState(false);
  const [linkedProfile, setLinkedProfile] = useState<LinkedProfile | null>(null);
  const [agentData, setAgentData] = useState<AgentData | null>(null);

  // New state for account management
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [sendingResetLink, setSendingResetLink] = useState(false);
  const [sendingLogin, setSendingLogin] = useState(false);
  const [sendingLoginToManager, setSendingLoginToManager] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState("unlicensed");
  const [npn, setNpn] = useState("");
  const [onboardingStage, setOnboardingStage] = useState("pre_licensed");
  const [compPercentage, setCompPercentage] = useState("60");
  const [compApproved, setCompApproved] = useState(true);
  const [licenseStates, setLicenseStates] = useState("");
  const [eoCertificateUrl, setEoCertificateUrl] = useState("");
  const [eoPolicyNumber, setEoPolicyNumber] = useState("");
  const [eoExpiresAt, setEoExpiresAt] = useState("");
  const [eoPerClaimLimit, setEoPerClaimLimit] = useState("");
  const [eoAggregateLimit, setEoAggregateLimit] = useState("");
  const [eftReady, setEftReady] = useState(false);
  const [contractingContact, setContractingContact] = useState("");

  useEffect(() => {
    if (open && agentId) {
      setDisplayName(currentName);
      setSelectedMergeId(null);
      setLinkedProfile(null);
      setAgentData(null);
      setEmail("");
      setPhone("");
      setInstagram("");
      setNewEmail("");
      setNewPassword("");
      setLicenseStatus("unlicensed");
      setNpn("");
      setOnboardingStage("pre_licensed");
      setCompPercentage("60");
      setCompApproved(true);
      setLicenseStates("");
      setEoCertificateUrl("");
      setEoPolicyNumber("");
      setEoExpiresAt("");
      setEoPerClaimLimit("");
      setEoAggregateLimit("");
      setEftReady(false);
      setContractingContact("");
      fetchAgentData();
      fetchPossibleMatches();
    }
  }, [open, agentId, currentName, production, deals]);

  const fetchAgentData = async () => {
    try {
      const { data: agent } = await supabase
        .from("v_agents_full")
        .select(`
          id, 
          user_id,
          profile_id,
          display_name,
          invited_by_manager_id,
          license_status,
          nipr_number,
          onboarding_stage,
          comp_percentage,
          comp_approval_status,
          license_states,
          ref_slug,
          eo_certificate_url,
          eo_policy_number,
          eo_expires_at,
          eo_per_claim_limit,
          eo_aggregate_limit,
          eft_ready,
          contracting_contact_name,
          profile:profiles!agents_profile_id_fkey(full_name, email, phone, instagram_handle)
        `)
        .eq("id", agentId)
        .maybeSingle();

      // account_mode lives on base agents (not in v_agents_full's column list);
      // it is a non-sensitive column granted to authenticated. Read separately.
      const { data: modeRow } = await supabase
        .from("agents")
        .select("account_mode")
        .eq("id", agentId)
        .maybeSingle();
      setAccountMode(((modeRow as { account_mode?: string } | null)?.account_mode) ?? "agent");

      if (agent) {
        setAgentData({
          user_id: agent.user_id,
          profile_id: agent.profile_id,
          display_name: agent.display_name,
          invited_by_manager_id: agent.invited_by_manager_id,
          license_status: agent.license_status,
          nipr_number: agent.nipr_number,
          onboarding_stage: agent.onboarding_stage,
          comp_percentage: Number(agent.comp_percentage ?? 60),
          comp_approval_status: agent.comp_approval_status ?? "approved",
          license_states: agent.license_states ?? null,
          ref_slug: (agent as { ref_slug?: string | null }).ref_slug ?? null,
          eo_certificate_url: agent.eo_certificate_url ?? null,
          eo_policy_number: agent.eo_policy_number ?? null,
          eo_expires_at: agent.eo_expires_at ?? null,
          eo_per_claim_limit: agent.eo_per_claim_limit == null ? null : Number(agent.eo_per_claim_limit),
          eo_aggregate_limit: agent.eo_aggregate_limit == null ? null : Number(agent.eo_aggregate_limit),
          eft_ready: agent.eft_ready ?? false,
          contracting_contact_name: agent.contracting_contact_name ?? null,
        });
        setLicenseStatus(agent.license_status || "unlicensed");
        setNpn(agent.nipr_number || "");
        setOnboardingStage(agent.onboarding_stage || "pre_licensed");
        setCompPercentage(String(agent.comp_percentage ?? 60));
        setCompApproved((agent.comp_approval_status ?? "approved") === "approved");
        setLicenseStates((agent.license_states ?? []).join(", "));
        setEoCertificateUrl(agent.eo_certificate_url ?? "");
        setEoPolicyNumber(agent.eo_policy_number ?? "");
        setEoExpiresAt(agent.eo_expires_at ?? "");
        setEoPerClaimLimit(agent.eo_per_claim_limit == null ? "" : String(agent.eo_per_claim_limit));
        setEoAggregateLimit(agent.eo_aggregate_limit == null ? "" : String(agent.eo_aggregate_limit));
        setEftReady(agent.eft_ready ?? false);
        setContractingContact(agent.contracting_contact_name ?? "");

        if (agent.profile) {
          const profile = agent.profile as { full_name?: string; email?: string; phone?: string; instagram_handle?: string };
          setLinkedProfile({
            full_name: profile.full_name || null,
            email: profile.email || null,
            phone: profile.phone || null,
            instagram_handle: profile.instagram_handle || null,
          });
          if (profile.full_name && (currentName === "Unknown Agent" || currentName === "—")) {
            setDisplayName(profile.full_name);
          }
          if (profile.email) {
            setEmail(profile.email);
          }
          if (profile.phone) {
            setPhone(profile.phone);
          }
          if (profile.instagram_handle) {
            setInstagram(profile.instagram_handle);
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
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id, user_id, display_name")
        .neq("id", agentId)
        .eq("is_deactivated", false);

      if (!allAgents) {
        setPossibleMatches([]);
        return;
      }

      const userIds = allAgents.map(a => a.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, phone")
        .in("user_id", userIds);

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

      const matches: PossibleMatch[] = allAgents
        .map(agent => {
          const profile = profiles?.find(p => p.user_id === agent.user_id);
          const name = profile?.full_name || agent.display_name || "—";
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
        .map(m => ({
          ...m,
          name: m.name === "—" ? `Agent ${m.id.slice(0, 6)} (no profile)` : m.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 50);

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
      const cleanedNpn = npn.replace(/\D+/g, "");
      const normalizedComp = Number(compPercentage);
      if (licenseStatus === "licensed" && (cleanedNpn.length < 5 || cleanedNpn.length > 10)) {
        throw new Error("A valid 5–10 digit NPN is required before marking an agent licensed.");
      }
      if (!Number.isFinite(normalizedComp) || normalizedComp < 50 || normalizedComp > 200) {
        throw new Error("Comp percentage must be between 50 and 200.");
      }
      // MP-392: the stage moves through advance_hire_stage (gated, audited in
      // agent_stage_moves, queues the licensed→live emails) — never as a bare
      // column write. It runs first so a refusal aborts before anything else
      // on the row changes.
      let stageNote: string | null = null;
      if (onboardingStage && onboardingStage !== (agentData?.onboarding_stage ?? "")) {
        const moved = await advanceHireStage(agentId, onboardingStage, agentData?.onboarding_stage ?? null, "quick edit dialog");
        if (moved.changed && moved.queuedEmails?.length) {
          stageNote = `${moved.queuedEmails.length} onboarding email${moved.queuedEmails.length === 1 ? "" : "s"} queued.`;
        }
      }
      // Update agent display name
      const { error } = await supabase
        .from("agents")
        .update({
          display_name: displayName.trim(),
          license_status: licenseStatus as "licensed" | "unlicensed" | "pending",
          nipr_number: cleanedNpn || null,
          licensed_at: licenseStatus === "licensed" ? new Date().toISOString() : null,
          comp_percentage: normalizedComp,
          comp_approval_status: normalizedComp <= 100 || compApproved ? "approved" : "pending_sam",
          comp_approved_at: normalizedComp <= 100 || compApproved ? new Date().toISOString() : null,
          license_states: licenseStates.split(",").map((state) => state.trim().toUpperCase()).filter(Boolean),
          eo_certificate_url: eoCertificateUrl.trim() || null,
          eo_policy_number: eoPolicyNumber.trim() || null,
          eo_expires_at: eoExpiresAt || null,
          eo_per_claim_limit: eoPerClaimLimit ? Number(eoPerClaimLimit) : null,
          eo_aggregate_limit: eoAggregateLimit ? Number(eoAggregateLimit) : null,
          eft_ready: eftReady,
          contracting_contact_name: contractingContact.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", agentId);

      if (error) throw error;

      // Sync profiles via user_id (preferred) or profile_id fallback
      if (agentData?.user_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: displayName.trim(),
            phone: phone.trim() || null,
            instagram_handle: instagram.trim() || null,
          })
          .eq("user_id", agentData.user_id);

        if (profileError) {
          console.error("Error updating profile:", profileError);
        }
      } else if (agentData?.profile_id) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            full_name: displayName.trim(),
            phone: phone.trim() || null,
            instagram_handle: instagram.trim() || null,
          })
          .eq("id", agentData.profile_id);

        if (profileError) {
          console.error("Error updating profile:", profileError);
        }
      }

      // Money never enters through this dialog. Production comes only from canonical
      // deal ingestion (AgentLink sync + Post a Deal); corrections happen on the deal
      // itself in Book of Business with an audit trail. The manual ALP/deal inputs that
      // used to write daily_production here were removed 2026-08-26.

      let contractingWarning: string | null = null;
      const becameLicensed = licenseStatus === "licensed" && agentData?.license_status !== "licensed";
      if (licenseStatus === "licensed" && cleanedNpn) {
        const nameParts = displayName.trim().split(/\s+/);
        const firstName = nameParts.shift() || "";
        const lastName = nameParts.join(" ");
        const { data: contracting, error: contractingError } = await supabase.functions.invoke("submit-contracting-intake", {
          body: {
            first_name: firstName,
            last_name: lastName,
            email: email.trim(),
            phone: phone.trim(),
            npn: cleanedNpn,
          },
        });
        if (contractingError || !contracting?.ok) {
          contractingWarning = "Profile saved, but contracting could not be queued. Check name, email, phone, and NPN.";
        }
      }

      if (becameLicensed) {
        const { data: onboarding, error: onboardingError } = await supabase.functions.invoke("send-agent-onboarding-email", { body: {} });
        if (onboardingError || onboarding?.ok === false) {
          contractingWarning = contractingWarning
            ? `${contractingWarning} Onboarding email is still queued for retry.`
            : "Profile and contracting saved. Onboarding email is queued for retry.";
        }
      }

      toast({
        title: "Changes saved",
        description: contractingWarning ?? `Agent "${displayName.trim()}" updated successfully.${stageNote ? ` ${stageNote}` : ""}`,
        variant: contractingWarning ? "destructive" : undefined,
      });
      
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error saving changes:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save changes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes("@")) {
      toast({ title: "Valid email required", variant: "destructive" });
      return;
    }
    if (!agentData?.user_id) return;

    setUpdatingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-user-email", {
        body: { newEmail: newEmail.trim(), targetUserId: agentData.user_id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Email updated ✅",
        description: `Email changed to ${newEmail.trim()}. Notifications sent.`,
      });
      setEmail(newEmail.trim());
      setNewEmail("");
      onUpdate?.();
    } catch (error: any) {
      console.error("Error updating email:", error);
      toast({
        title: "Email update failed",
        description: error.message || "Failed to update email.",
        variant: "destructive",
      });
    } finally {
      setUpdatingEmail(false);
    }
  };

  const handleSendResetLink = async () => {
    if (!email.trim()) {
      toast({ title: "No email on file", variant: "destructive" });
      return;
    }
    setSendingResetLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-password-reset", {
        body: { email: email.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Reset link sent ✅", description: `Sent to ${email.trim()}.` });
    } catch (error: any) {
      toast({ title: "Reset link failed", description: error?.message || "Could not send the reset link.", variant: "destructive" });
    } finally {
      setSendingResetLink(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword.trim() || newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (!agentData?.user_id) return;

    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-agent-password", {
        body: { targetUserId: agentData.user_id, newPassword: newPassword.trim() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: "Password reset ✅",
        description: "New password has been set for this agent.",
      });
      setNewPassword("");
    } catch (error: any) {
      console.error("Error resetting password:", error);
      toast({
        title: "Password reset failed",
        description: error.message || "Failed to reset password.",
        variant: "destructive",
      });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSendLogin = async () => {
    if (!agentData?.user_id) return;

    setSendingLogin(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId },
      });

      if (error) throw error;

      toast({
        title: "Login sent ✅",
        description: "Portal login email sent to agent (includes Discord link).",
      });
    } catch (error: any) {
      console.error("Error sending login:", error);
      toast({
        title: "Send failed",
        description: error.message || "Failed to send login email.",
        variant: "destructive",
      });
    } finally {
      setSendingLogin(false);
    }
  };

  const MODE_LABELS: Record<string, string> = {
    agent: "Agent",
    manager: "Manager",
    agency_owner: "Agency Owner",
    recruiter: "Pure Recruiter",
    va: "VA",
    va_manager: "VA Manager",
  };

  const handleModeChange = async (mode: string) => {
    const prev = accountMode;
    if (mode === prev) return;
    setAccountMode(mode); // optimistic
    setSavingMode(true);
    try {
      const { data, error } = await supabase.rpc("set_account_mode" as never, {
        p_agent_id: agentId,
        p_mode: mode,
      } as never);
      const res = data as { ok?: boolean; error?: string } | null;
      if (error || !res?.ok) throw new Error(res?.error || error?.message || "Mode switch failed");
      toast({
        title: "Account mode updated",
        description: `${currentName} is now ${MODE_LABELS[mode] ?? mode}.`,
      });
    } catch (e) {
      setAccountMode(prev); // revert on failure
      toast({
        title: "Mode switch failed",
        description: e instanceof Error ? e.message : "Could not switch account mode.",
        variant: "destructive",
      });
    } finally {
      setSavingMode(false);
    }
  };

  const handleSendLoginToManager = async () => {
    setSendingLoginToManager(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-login-to-manager", {
        body: { agentId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Link sent to manager ✅",
        description: data?.message || "Login link forwarded to the agent's manager.",
      });
    } catch (error: any) {
      console.error("Error sending login to manager:", error);
      toast({
        title: "Send failed",
        description: error.message || "Failed to send login link to manager.",
        variant: "destructive",
      });
    } finally {
      setSendingLoginToManager(false);
    }
  };

  const handleMerge = async () => {
    if (!selectedMergeId) {
      toast({ title: "Select an agent", description: "Please select an agent to merge with.", variant: "destructive" });
      return;
    }
    if (selectedMergeId === agentId) {
      toast({ title: "Invalid selection", description: "You can't merge an agent into itself.", variant: "destructive" });
      return;
    }

    setMerging(true);
    try {
      const { data, error } = await supabase.functions.invoke("merge-agent-records", {
        body: { primaryAgentId: selectedMergeId, duplicateAgentIds: [agentId] },
      });

      if (error) throw new Error(error.message || "Edge function error");
      if (data?.error) throw new Error(data.error);

      toast({ title: "Agents merged ✅", description: data?.message || "Records have been combined successfully." });
      onUpdate?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error merging agents:", error);
      toast({ title: "Merge failed", description: error?.message || "Failed to merge agent records.", variant: "destructive" });
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
      toast({ title: "Agent marked as inactive", description: `${currentName} is now hidden from leaderboards.` });
      setShowDeleteConfirm(false);
      setDeleteStep("choice");
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error inactivating agent:", error);
      toast({ title: "Failed to inactivate", description: "Could not mark agent as inactive.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await supabase.from("agents").update({ manager_id: null }).eq("manager_id", agentId);
      await supabase.from("agents").update({ invited_by_manager_id: null }).eq("invited_by_manager_id", agentId);
      await supabase.from("agents").update({ switched_to_manager_id: null }).eq("switched_to_manager_id", agentId);
      await supabase.from("applications").update({ assigned_agent_id: null }).eq("assigned_agent_id", agentId);
      await supabase.from("aged_leads").update({ assigned_manager_id: null }).eq("assigned_manager_id", agentId);

      await supabase.from("daily_production").delete().eq("agent_id", agentId);
      await supabase.from("agent_notes").delete().eq("agent_id", agentId);
      await supabase.from("agent_goals").delete().eq("agent_id", agentId);
      await supabase.from("agent_metrics").delete().eq("agent_id", agentId);
      await supabase.from("agent_achievements").delete().eq("agent_id", agentId);
      await supabase.from("agent_lead_stats").delete().eq("agent_id", agentId);
      await supabase.from("agent_attendance").delete().eq("agent_id", agentId);
      await supabase.from("agent_ratings").delete().eq("agent_id", agentId);
      await supabase.from("agent_removal_requests").delete().eq("agent_id", agentId);
      await supabase.from("email_tracking").delete().eq("agent_id", agentId);
      await supabase.from("magic_login_tokens").delete().eq("agent_id", agentId);
      await supabase.from("plaque_awards").delete().eq("agent_id", agentId);
      await supabase.from("onboarding_progress").delete().eq("agent_id", agentId);
      await supabase.from("manager_invite_links").delete().eq("manager_agent_id", agentId);
      await supabase.from("contact_history").delete().eq("agent_id", agentId);
      await supabase.from("interview_recordings").delete().eq("agent_id", agentId);

      const { error: agentError } = await supabase.from("agents").delete().eq("id", agentId);
      if (agentError) throw agentError;

      toast({ title: "Agent deleted", description: `${currentName} and all associated records have been removed.` });
      setShowDeleteConfirm(false);
      setDeleteStep("choice");
      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error deleting agent:", error);
      toast({ title: "Delete failed", description: "Failed to delete agent. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateAndSendLogin = async () => {
    if (!email.trim()) {
      toast({ title: "Email required", description: "Please enter an email address.", variant: "destructive" });
      return;
    }
    if (!displayName.trim()) {
      toast({ title: "Name required", description: "Please enter a name.", variant: "destructive" });
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

      toast({ title: "Login Sent! 🎉", description: `Portal access sent to ${email}. Agent is now LIVE.` });
      onUpdate?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating agent login:", error);
      toast({ title: "Creation failed", description: error.message || "Failed to create agent login.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount >= 1000 ? `$${(amount / 1000).toFixed(1)}k` : `$${amount}`;
  };

  const hasExistingLogin = !!agentData?.user_id;
  const isBusy = saving || merging || creating || deleting || updatingEmail || resettingPassword || sendingResetLink || sendingLogin || sendingLoginToManager;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4 text-primary" />
            Edit Agent
          </DialogTitle>
          <DialogDescription>
            Update profile info, manage account access, or merge records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Agent Info */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-white dark:bg-card flex items-center justify-center">
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

          {/* ═══ PROFILE INFO ═══ */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter agent name"
            />
          </div>

          {isAdmin && (
            <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <Label className="text-primary">Account mode</Label>
              <Select value={accountMode} onValueChange={handleModeChange} disabled={savingMode}>
                <SelectTrigger><SelectValue placeholder="Account mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="agency_owner">Agency Owner</SelectItem>
                  <SelectItem value="recruiter">Pure Recruiter</SelectItem>
                  <SelectItem value="va">VA</SelectItem>
                  <SelectItem value="va_manager">VA Manager</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Switches this person&rsquo;s role immediately and syncs their login role. Pure Recruiter = recruits only, no production book or sales team.
              </p>
            </div>
          )}

          {agentData?.ref_slug && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
              <div className="min-w-0">
                <Label>Recruiting link</Label>
                <p className="text-xs text-muted-foreground truncate">apex-financial.org/r/{agentData.ref_slug}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard
                    .writeText(`https://apex-financial.org/r/${agentData.ref_slug}`)
                    .then(() => toast({ title: "Link copied", description: "Applications through it credit and place under this person." }))
                    .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
                }}
              >
                Copy
              </Button>
            </div>
          )}

          {isAdmin && (
            <div className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <Label className="text-amber-600 dark:text-amber-400">License &amp; onboarding control</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={licenseStatus} onValueChange={setLicenseStatus}>
                  <SelectTrigger><SelectValue placeholder="License status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlicensed">Unlicensed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="licensed">Licensed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={onboardingStage} onValueChange={setOnboardingStage}>
                  <SelectTrigger><SelectValue placeholder="Onboarding stage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_licensed">Pre-licensed</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="training_online">Online training</SelectItem>
                    <SelectItem value="in_field_training">Field training</SelectItem>
                    <SelectItem value="evaluated">Evaluated</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-edit-npn">NPN {licenseStatus === "licensed" ? "*" : ""}</Label>
                <Input id="agent-edit-npn" inputMode="numeric" value={npn} onChange={(event) => setNpn(event.target.value)} placeholder="5–10 digit NPN" />
                <p className="text-[11px] text-muted-foreground">Saving Licensed automatically queues the contracting spreadsheet and Discord workflow.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-edit-comp">Comp percentage</Label>
                <Input
                  id="agent-edit-comp"
                  type="number"
                  min={50}
                  max={200}
                  step="0.1"
                  value={compPercentage}
                  onChange={(event) => {
                    setCompPercentage(event.target.value);
                    if (Number(event.target.value) <= 100) setCompApproved(true);
                  }}
                />
                {Number(compPercentage) > 100 ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                    <Checkbox id="agent-edit-comp-approved" checked={compApproved} onCheckedChange={(value) => setCompApproved(value === true)} />
                    <Label htmlFor="agent-edit-comp-approved" className="cursor-pointer text-xs">Approved by Sam</Label>
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-edit-states">Licensed states</Label>
                <Input id="agent-edit-states" value={licenseStates} onChange={(event) => setLicenseStates(event.target.value)} placeholder="FL, OH, TX" />
              </div>
              <details className="rounded-md border border-border bg-background/60 p-2">
                <summary className="cursor-pointer text-xs font-semibold">E&amp;O, EFT &amp; contracting details</summary>
                <div className="mt-3 space-y-2">
                  <Input value={eoCertificateUrl} onChange={(event) => setEoCertificateUrl(event.target.value)} placeholder="E&O certificate Drive/PDF URL" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={eoPolicyNumber} onChange={(event) => setEoPolicyNumber(event.target.value)} placeholder="E&O policy #" />
                    <Input type="date" value={eoExpiresAt} onChange={(event) => setEoExpiresAt(event.target.value)} aria-label="E&O expiration" />
                    <Input type="number" value={eoPerClaimLimit} onChange={(event) => setEoPerClaimLimit(event.target.value)} placeholder="Per-claim limit" />
                    <Input type="number" value={eoAggregateLimit} onChange={(event) => setEoAggregateLimit(event.target.value)} placeholder="Aggregate limit" />
                  </div>
                  <Input value={contractingContact} onChange={(event) => setContractingContact(event.target.value)} placeholder="Contracting contact / placeholder" />
                  <div className="flex items-center gap-2 rounded-md border border-border p-2">
                    <Checkbox id="agent-edit-eft" checked={eftReady} onCheckedChange={(value) => setEftReady(value === true)} />
                    <Label htmlFor="agent-edit-eft" className="cursor-pointer text-xs">EFT/banking information ready</Label>
                  </div>
                </div>
              </details>
            </div>
          )}

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
          </div>

          <div className="space-y-2">
            <Label htmlFor="agentInstagram" className="flex items-center gap-2">
              <Instagram className="h-3.5 w-3.5" />
              Instagram Handle
            </Label>
            <Input
              id="agentInstagram"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@handle"
            />
          </div>

          {/* ═══ ACCOUNT MANAGEMENT (existing login) ═══ */}
          {isAdmin && hasExistingLogin && (
            <div className="space-y-3 p-3 rounded-lg bg-info/5 border border-info/30">
              <Label className="flex items-center gap-2 text-info dark:text-info">
                <KeyRound className="h-4 w-4" />
                Account Management
              </Label>

              {/* Current Email & Update */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Current email: <span className="font-medium text-foreground">{email || "—"}</span></p>
                <div className="flex gap-2">
                  <Input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="New email address"
                    type="email"
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUpdateEmail}
                    disabled={isBusy || !newEmail.trim()}
                  >
                    {updatingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* Password Reset */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Reset password:</p>
                <div className="flex gap-2">
                  <Input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 6 chars)"
                    type="password"
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResetPassword}
                    disabled={isBusy || newPassword.length < 6}
                  >
                    {resettingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSendResetLink}
                  disabled={isBusy || !email.trim()}
                  className="w-full"
                >
                  {sendingResetLink ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-2 h-3.5 w-3.5" />}
                  Send password-reset link
                </Button>
              </div>

              {/* Send Login Button */}
              <Button
                size="sm"
                variant="secondary"
                onClick={handleSendLogin}
                disabled={isBusy}
                className="w-full"
              >
                {sendingLogin ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Sending...</>
                ) : (
                  <><Send className="h-3.5 w-3.5 mr-2" />Send Portal Login (+ Discord)</>
                )}
              </Button>

              {/* Send Login to Manager Button */}
              {agentData?.invited_by_manager_id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSendLoginToManager}
                  disabled={isBusy}
                  className="w-full"
                >
                  {sendingLoginToManager ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Sending to Manager...</>
                  ) : (
                    <><Mail className="h-3.5 w-3.5 mr-2" />Send Login Link to Manager</>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* ═══ ADMIN: Production is read-only here ═══ */}
          {isAdmin && (
            <div className="space-y-1 p-3 rounded-lg bg-muted/40 border border-border">
              <Label className="text-xs text-muted-foreground">Production ({period && period !== "day" ? "range" : "today"})</Label>
              <p className="text-sm font-semibold">${production.toLocaleString()} · {deals} {deals === 1 ? "deal" : "deals"}</p>
              <p className="text-[10px] text-muted-foreground">
                Counted from canonical deals only. To correct a number, fix the deal in Book of Business — manual production edits were retired so every dollar has a source.
              </p>
            </div>
          )}

          {/* ═══ CREATE & SEND LOGIN (no existing login) ═══ */}
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
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating & Sending...</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" />Create & Send Login</>
                )}
              </Button>
            </div>
          )}

          {/* ═══ MERGE ═══ */}
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
          {isAdmin && (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isBusy}
              className="sm:mr-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
          
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          {selectedMergeId ? (
            <Button onClick={handleMerge} disabled={merging} variant="secondary">
              {merging ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Merging...</>
              ) : (
                <><Merge className="h-4 w-4 mr-2" />Merge Records</>
              )}
            </Button>
          ) : (
            <Button onClick={handleSaveChanges} disabled={saving}>
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />Save Changes</>
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
                      Hide from leaderboards and active views. Agent record and all data is kept.
                    </p>
                  </div>
                </button>

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
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Deleting...</>
                  ) : (
                    <><Trash2 className="h-4 w-4 mr-2" />Delete Forever</>
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
