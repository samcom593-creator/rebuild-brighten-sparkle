import { useState, useEffect } from "react";

import {
  Users,
  UserPlus,
  Shield,
  Crown,
  Search,
  Mail,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  MoreHorizontal,
  Edit,
  UserX,
  UserCheck,
  Loader2,
  Key,
  Link2,
  LockKeyhole,
  GraduationCap,
  MessageCircle,
  BadgeDollarSign,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { HireStageSelect } from "@/components/hires/HireStageControl";
import { useAuth } from "@/hooks/useAuth";

import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Navigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";

type AccountRole = "admin" | "manager" | "agent" | "va_manager" | "va";

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

interface AccountInfo {
  id: string;
  hasAgentRecord: boolean;
  hasProfile: boolean;
  userId: string;
  name: string;
  email: string;
  role: AccountRole;
  status: string;
  createdAt: string | null;
  lastActive?: string;
  licenseStatus: string;
  onboardingStage: string;
  contractPercentage: number | null;
  portalPasswordSet: boolean;
  hasDiscordAccess: boolean;
  hasTrainingCourse: boolean;
}

export default function DashboardAccounts() {
  const { isAdmin, isManager, isLoading: authLoading } = useAuth();
  const { playSound } = useSoundEffects();
  const askConfirm = useConfirm();
  const [searchQuery, setSearchQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    managers: 0,
    agents: 0,
    pendingApproval: 0,
    needsSetup: 0,
  });
  const [unlinkedRecords, setUnlinkedRecords] = useState(0);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountInfo | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<AccountRole>("agent");
  const [editContractPercentage, setEditContractPercentage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      // Roles are the account authority. Starting from agents hid VA/admin
      // identities that intentionally have no producer row.
      const [agentsResult, rolesResult] = await Promise.all([
        supabase
          .from("v_agents_full")
          .select("id, user_id, status, is_deactivated, created_at, license_status, onboarding_stage, contract_percentage, portal_password_set, has_discord_access, has_training_course")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);

      if (agentsResult.error) throw agentsResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const validAgents = (agentsResult.data || []).filter(a => a.user_id);
      const agentMap = new Map<string, (typeof validAgents)[number]>();
      const agentPriority = (agent: (typeof validAgents)[number]) => {
        if (agent.status === "active" && !agent.is_deactivated) return 4;
        if (agent.status === "pending" && !agent.is_deactivated) return 3;
        if (!agent.is_deactivated) return 2;
        return 1;
      };
      for (const agent of validAgents) {
        const current = agentMap.get(agent.user_id!);
        if (!current || agentPriority(agent) > agentPriority(current)) agentMap.set(agent.user_id!, agent);
      }
      const candidateUserIds = Array.from(new Set([
        ...agentMap.keys(),
        ...(rolesResult.data || []).map((role) => role.user_id),
      ]));

      // Profiles/roles can survive an auth deletion. Intersect the visible
      // candidates with auth.users through a staff-only security-definer RPC;
      // otherwise 44 legacy records currently inflate this screen.
      const { data: authRows, error: authError } = await (supabase.rpc as (
        fn: string,
        args: Record<string, unknown>,
      ) => ReturnType<typeof supabase.rpc>)("staff_existing_auth_user_ids", {
        p_user_ids: candidateUserIds,
      });
      if (authError) throw authError;
      const authUserIds = new Set(
        (Array.isArray(authRows) ? authRows : [])
          .map((row) => row && typeof row === "object" && "user_id" in row ? String(row.user_id) : "")
          .filter(Boolean),
      );
      const userIds = candidateUserIds.filter((userId) => authUserIds.has(userId));

      const profilesResult = userIds.length > 0
        ? await supabase.from("profiles").select("user_id, full_name, email, created_at").in("user_id", userIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      const profileMap = new Map<string, { full_name: string | null; email: string | null; created_at: string }>();
      for (const p of profilesResult.data || []) {
        if (p.user_id) profileMap.set(p.user_id, { full_name: p.full_name, email: p.email, created_at: p.created_at });
      }

      // A user can hold multiple roles (e.g. manager + agent). Keep the HIGHEST,
      // not whichever row PostgREST returned last — otherwise a manager's agent row
      // could win by physical order and 4 real managers rendered (and were counted)
      // as plain agents on the very page used to manage roles.
      const ROLE_RANK: Record<string, number> = { admin: 5, va_manager: 4, manager: 3, va: 2, agent: 1 };
      const roleMap = new Map<string, string>();
      for (const r of rolesResult.data || []) {
        const cur = roleMap.get(r.user_id);
        if (!cur || (ROLE_RANK[r.role] ?? 0) > (ROLE_RANK[cur] ?? 0)) roleMap.set(r.user_id, r.role);
      }

      let managersCount = 0;
      let agentsCount = 0;
      let pendingCount = 0;
      let needsSetupCount = 0;

      const accountList = userIds.map((userId): AccountInfo | null => {
        const agent = agentMap.get(userId);
        const profile = profileMap.get(userId);
        const role = (roleMap.get(userId) || "agent") as AccountRole;

        // A role or legacy agent row is not itself a login. Three live legacy
        // producer rows and one role row point at no profile/auth identity;
        // counting them as accounts made this dashboard overstate access.
        if (!profile) return null;

        if (role === "manager" || role === "va_manager") managersCount++;
        if (role === "agent" || role === "va") agentsCount++;
        if (agent?.status === "pending") pendingCount++;
        if (agent && (!agent.portal_password_set || !agent.has_discord_access || agent.contract_percentage == null || (agent.license_status === "licensed" && !agent.has_training_course))) needsSetupCount++;

        return {
          id: agent?.id ?? userId,
          hasAgentRecord: Boolean(agent),
          hasProfile: true,
          userId,
          name: profile.full_name || "Name missing",
          email: profile.email || "Email missing",
          role,
          status: agent?.status ?? "account only",
          createdAt: agent?.created_at ?? profile?.created_at ?? null,
          licenseStatus: agent?.license_status ?? "not applicable",
          onboardingStage: agent?.onboarding_stage ?? "account only",
          contractPercentage: agent?.contract_percentage == null ? null : Number(agent.contract_percentage),
          portalPasswordSet: agent?.portal_password_set === true,
          hasDiscordAccess: agent?.has_discord_access === true,
          hasTrainingCourse: agent?.has_training_course === true,
        };
      }).filter((account): account is AccountInfo => account !== null)
        .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0));

      setAccounts(accountList);
      setUnlinkedRecords(candidateUserIds.length - accountList.length);
      setStats({
        totalAccounts: accountList.length,
        managers: managersCount,
        agents: agentsCount,
        pendingApproval: pendingCount,
        needsSetup: needsSetupCount,
      });
    } catch (error) {
      console.error("Error fetching accounts:", error);
      toast.error("Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditAccount = (account: AccountInfo) => {
    playSound("click");
    setEditingAccount(account);
    setEditName(account.hasProfile ? account.name : "");
    setEditEmail(account.hasProfile ? account.email : "");
    setEditRole(account.role);
    setEditContractPercentage(account.contractPercentage == null ? "" : String(account.contractPercentage));
    setEditDialogOpen(true);
  };

  const handleUpdateEmail = async () => {
    if (!editingAccount || !isAdmin) return;
    if (editEmail === editingAccount.email) {
      toast.info("Email is the same");
      return;
    }
    if (!editEmail || !editEmail.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsUpdatingEmail(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            newEmail: editEmail.trim().toLowerCase(),
            targetUserId: editingAccount.userId,
            fullName: editName.trim() || undefined,
          }),
        }
      );

      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Failed to update email");

      playSound("success");
      toast.success(`Email updated to ${editEmail}`);
      setEditingAccount((current) => current ? {
        ...current,
        hasProfile: true,
        email: editEmail.trim().toLowerCase(),
        name: editName.trim() || current.name,
      } : current);
      await fetchAccounts();
    } catch (err: unknown) {
      playSound("error");
      console.error("Error updating email:", err);
      toast.error(errorMessage(err, "Failed to update email"));
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    if (!editingAccount.hasProfile) {
      toast.error("Add a valid email first so this login has a complete profile");
      return;
    }
    const parsedContractPercentage = editContractPercentage.trim() === "" ? null : Number(editContractPercentage);
    if (parsedContractPercentage != null && (!Number.isFinite(parsedContractPercentage) || parsedContractPercentage < 0 || parsedContractPercentage > 200)) {
      toast.error("Comp percentage must be between 0 and 200");
      return;
    }
    setIsSaving(true);

    try {
      const { data: updatedProfile, error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: editName })
        .eq("user_id", editingAccount.userId)
        .select("user_id")
        .maybeSingle();

      if (profileError) throw profileError;
      if (!updatedProfile) throw new Error("Account profile is missing; add an email before saving");

      if (editingAccount.hasAgentRecord) {
        const { error: agentError } = await supabase
          .from("agents")
          .update({ contract_percentage: parsedContractPercentage })
          .eq("id", editingAccount.id);

        if (agentError) throw agentError;
      }

      if (isAdmin && editRole !== editingAccount.role) {
        // The checked-in generated types predate the live va/va_manager enum
        // values. Runtime Postgres accepts all AccountRole values.
        const roleValue = editRole as "admin" | "manager" | "agent";
        // Add the selected role before removing old operational roles. If the
        // second write fails the user keeps access instead of being orphaned.
        const { error: addRoleError } = await supabase
          .from("user_roles")
          .upsert(
            { user_id: editingAccount.userId, role: roleValue },
            { onConflict: "user_id,role", ignoreDuplicates: true },
          );

        if (addRoleError) throw addRoleError;

        const { error: roleError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", editingAccount.userId)
          .neq("role", roleValue);

        if (roleError) throw roleError;
      }

      playSound("success");
      toast.success("Account updated successfully");
      setEditDialogOpen(false);
      fetchAccounts();
    } catch (error) {
      playSound("error");
      console.error("Error updating account:", error);
      toast.error("Failed to update account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (account: AccountInfo) => {
    const newStatus = account.status === "active" ? "terminated" : "active";
    const action = newStatus === "terminated" ? "deactivate" : "reactivate";

    const confirmed = await askConfirm({
      title: `${newStatus === "terminated" ? "Deactivate" : "Reactivate"} ${account.name}?`,
      description: newStatus === "terminated"
        ? "They will lose active account access. Their historical production and records stay intact."
        : "Their account and dashboard access will be restored.",
      confirmText: newStatus === "terminated" ? "Deactivate account" : "Reactivate account",
      tone: newStatus === "terminated" ? "danger" : "primary",
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("agents")
        .update({ 
          status: newStatus as "active" | "terminated",
          ...(newStatus === "active" ? { 
            verified_at: new Date().toISOString(),
            is_deactivated: false,
            is_inactive: false,
            deactivation_reason: null
          } : {})
        })
        .eq("id", account.id);

      if (error) throw error;

      playSound(newStatus === "active" ? "celebrate" : "whoosh");
      toast.success(`Account ${action}d successfully`);
      fetchAccounts();
    } catch (error) {
      playSound("error");
      console.error(`Error ${action}ing account:`, error);
      toast.error(`Failed to ${action} account`);
    }
  };

  const filteredAccounts = accounts.filter(
    (account) =>
      account.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.licenseStatus.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.onboardingStage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return (
          <Badge className="bg-primary/20 text-primary border-primary/30">
            <Crown className="h-3 w-3 mr-1" />
            Admin
          </Badge>
        );
      case "manager":
        return (
          <Badge className="bg-info/20 text-info border-info/30">
            <Shield className="h-3 w-3 mr-1" />
            Manager
          </Badge>
        );
      case "va_manager":
        return <Badge className="border-violet-500/30 bg-violet-500/15 text-violet-400"><Shield className="mr-1 h-3 w-3" />VA Manager</Badge>;
      case "va":
        return <Badge className="border-cyan-500/30 bg-cyan-500/15 text-cyan-400"><Users className="mr-1 h-3 w-3" />VA</Badge>;
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <Users className="h-3 w-3 mr-1" />
            Agent
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "terminated":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="h-3 w-3 mr-1" />
            Deactivated
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const readinessFor = (account: AccountInfo) => {
    const checks = [
      { label: "Profile", done: account.hasProfile, icon: UserCheck },
      ...(account.hasAgentRecord ? [
      { label: "Password", done: account.portalPasswordSet, icon: LockKeyhole },
      { label: "Discord", done: account.hasDiscordAccess, icon: MessageCircle },
      { label: "Training", done: account.licenseStatus !== "licensed" || account.hasTrainingCourse, icon: GraduationCap },
      { label: "Comp", done: account.contractPercentage != null, icon: BadgeDollarSign },
      ] : []),
    ];
    return { checks, complete: checks.filter((check) => check.done).length };
  };

  const hasReachableEmail = (account: AccountInfo) => account.hasProfile && account.email.includes("@");

  const renderAccountActions = (account: AccountInfo) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`} className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleEditAccount(account)}>
          <Edit className="mr-2 h-4 w-4" />
          Edit Account
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReachableEmail(account)}
          onClick={async () => {
            try {
              const { error } = await supabase.functions.invoke("send-password-reset", {
                body: { email: account.email, type: "reset" },
              });
              if (error) throw error;
              playSound("success");
              toast.success(`Password reset email sent to ${account.email}`);
            } catch (err: unknown) {
              playSound("error");
              toast.error(errorMessage(err, "Failed to send password reset"));
            }
          }}
        >
          <Key className="mr-2 h-4 w-4" />
          Send Password Reset
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReachableEmail(account)}
          onClick={async () => {
            try {
              const { error } = await supabase.functions.invoke("generate-magic-link", {
                body: { email: account.email, destination: "portal" },
              });
              if (error) throw error;
              playSound("success");
              toast.success(`Magic login link sent to ${account.email}`);
            } catch (err: unknown) {
              playSound("error");
              toast.error(errorMessage(err, "Failed to send login link"));
            }
          }}
        >
          <Link2 className="mr-2 h-4 w-4" />
          Send Magic Login Link
        </DropdownMenuItem>
        {account.hasAgentRecord && <DropdownMenuSeparator />}
        {account.hasAgentRecord && (account.status === "active" ? (
          <DropdownMenuItem onClick={() => handleToggleStatus(account)} className="text-destructive focus:text-destructive">
            <UserX className="mr-2 h-4 w-4" />
            Deactivate Account
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => handleToggleStatus(account)} className="text-emerald-500 focus:text-emerald-500">
            <UserCheck className="mr-2 h-4 w-4" />
            Reactivate Account
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (authLoading) {
    return (
      <>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  if (!isAdmin && !isManager) {
    return <Navigate to="/dashboard" replace />;
  }

  const statCards = [
    { label: "Total Accounts", value: stats.totalAccounts, icon: Users, gradient: "from-primary/20 to-primary/5 border-primary/20", color: "text-primary" },
    { label: "Managers", value: stats.managers, icon: Shield, gradient: "from-info/20 to-info/5 border-info/30", color: "text-info" },
    { label: "Agents", value: stats.agents, icon: UserPlus, gradient: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/20", color: "text-emerald-400" },
    { label: "Pending", value: stats.pendingApproval, icon: AlertTriangle, gradient: "from-amber-500/20 to-amber-500/5 border-amber-500/20", color: "text-amber-400" },
    { label: "Needs Setup", value: stats.needsSetup, icon: LockKeyhole, gradient: "from-rose-500/20 to-rose-500/5 border-rose-500/20", color: "text-rose-400" },
  ];

  return (
    <>
      <PageHeader
        accent="blue"
        eyebrow="Admin · Accounts"
        eyebrowIcon={<Users className="h-3 w-3" />}
        title="Accounts"
        subtitle="Manage every manager and agent account — roles, contact info, presenter flags, and license state."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { playSound("whoosh"); fetchAccounts(); }}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", isLoading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* Animated Stat Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {statCards.map((stat, i) => (
          <div
            key={stat.label}
          >
            <div className={cn(
              "relative overflow-hidden rounded-md border  p-4  transition-all hover:scale-[1.02] hover:shadow-lg",
              stat.gradient
            )}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/50">
                  <stat.icon className={cn("h-5 w-5", stat.color)} />
                </div>
                <div>
                  <p className={cn("text-2xl font-bold", stat.color)}>
                    <AnimatedCounter value={stat.value} />
                  </p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
              <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-current opacity-10 blur-xl" />
            </div>
          </div>
        ))}
      </div>

      {isAdmin && unlinkedRecords > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">{unlinkedRecords} legacy record{unlinkedRecords === 1 ? "" : "s"} excluded from account totals</p>
            <p className="mt-1 text-xs text-muted-foreground">These records have no complete auth login/profile, so they cannot sign in or receive account email. Producer history remains in CRM.</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div
        className="mb-6"
      >
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, role, status, or stage..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
      </div>

      {/* Accounts Table */}
      <div>
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            All Accounts
          </h3>
          
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                // stable-key-allow:skeleton
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : filteredAccounts.length === 0 ? (
            /* 2026-06-15 v7.2 · Sam: "Use that technique across the entire website."
               Diagnostic empty-state: fetched count + filter cause + Clear-filters
               button when the search is hiding everything. Same pattern as fb19dcbd. */
            <div className="border border-border rounded-md p-10 text-center space-y-3 max-w-md mx-auto">
              <Users className="h-10 w-10 text-muted-foreground mx-auto" />
              <h3 className="text-base font-semibold">
                {accounts.length === 0 ? "No accounts fetched" : "Search is hiding everything"}
              </h3>
              <p className="text-13 text-muted-foreground">
                Fetched <span className="font-bold text-foreground tabular-nums">{accounts.length.toLocaleString()}</span> account{accounts.length === 1 ? "" : "s"} from the database.
              </p>
              {accounts.length === 0 ? (
                <div className="text-12 text-rose-600 dark:text-rose-400 text-left">
                  Zero rows came back from the database. Likely causes:
                  <ul className="list-disc list-inside mt-2">
                    <li>Your session expired (try logging out + back in)</li>
                    <li>Your role lost admin/manager grant (check user_roles)</li>
                    <li>agents table RLS regression (check Supabase logs)</li>
                  </ul>
                  <p className="mt-2 italic">Hold the Standard.</p>
                </div>
              ) : (
                <>
                  <p className="text-12 text-amber-600 dark:text-amber-400">
                    But your search "<span className="font-mono">{searchQuery}</span>" matches <span className="font-bold tabular-nums">0</span>.
                    The data IS there — your filter is hiding it.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950"
                  >
                    Clear search · show {accounts.length.toLocaleString()} account{accounts.length === 1 ? "" : "s"}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
            <div className="space-y-3 md:hidden">
              {filteredAccounts.map((account) => {
                const readiness = readinessFor(account);
                const complete = readiness.complete === readiness.checks.length;
                return (
                  <div key={account.id} className="rounded-lg border border-border bg-background/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{account.name}</p>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{account.email}</span>
                        </div>
                      </div>
                      {renderAccountActions(account)}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {getRoleBadge(account.role)}
                      {getStatusBadge(account.status)}
                      <Badge variant="outline" className={account.licenseStatus === "licensed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : ""}>
                        {account.licenseStatus}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Onboarding</p>
                        {account.hasAgentRecord ? (
                          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                            <HireStageSelect agentId={account.id} name={account.name} stage={account.onboardingStage} licenseStatus={account.licenseStatus} email={account.email} className="h-7 text-[11px]" />
                          </div>
                        ) : (
                          <p className="mt-1 truncate capitalize">{account.onboardingStage.replaceAll("_", " ")}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-muted-foreground">Comp</p>
                        <p className={cn("mt-1 font-semibold tabular-nums", account.hasAgentRecord && account.contractPercentage == null && "text-amber-400")}>
                          {!account.hasAgentRecord ? "—" : account.contractPercentage == null ? "Not set" : `${account.contractPercentage}%`}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-border pt-3" title={readiness.checks.filter((check) => !check.done).map((check) => check.label).join(", ") || "Complete"}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Setup readiness</span>
                        <span className={complete ? "text-emerald-400" : "text-amber-400"}>{readiness.complete}/{readiness.checks.length} · {complete ? "Ready" : "Needs setup"}</span>
                      </div>
                      <div className="mt-2 flex gap-1">
                        {readiness.checks.map((check) => <span key={check.label} className={cn("h-1.5 flex-1 rounded-full", check.done ? "bg-emerald-500" : "bg-muted")} />)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Lifecycle</TableHead>
                    <TableHead>Setup readiness</TableHead>
                    <TableHead>Comp</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[50px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account) => (
                    <TableRow key={account.id} className="transition-colors hover:bg-muted/50">
                      <TableCell>
                        <p className="font-medium">{account.name}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span className="max-w-56 truncate">{account.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getRoleBadge(account.role)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant="outline" className={account.licenseStatus === "licensed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : ""}>
                            {account.licenseStatus}
                          </Badge>
                          {account.hasAgentRecord ? (
                            <div onClick={(e) => e.stopPropagation()}>
                              <HireStageSelect agentId={account.id} name={account.name} stage={account.onboardingStage} licenseStatus={account.licenseStatus} email={account.email} className="h-7 max-w-40 text-[11px]" />
                            </div>
                          ) : (
                            <p className="max-w-40 truncate text-xs capitalize text-muted-foreground">{account.onboardingStage.replaceAll("_", " ")}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const readiness = readinessFor(account);
                          if (readiness.checks.length === 0) return <span className="text-xs text-muted-foreground">Access account</span>;
                          return (
                            <div className="space-y-1.5" title={readiness.checks.filter((check) => !check.done).map((check) => check.label).join(", ") || "Complete"}>
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <span className={readiness.complete === readiness.checks.length ? "text-emerald-400" : "text-amber-400"}>{readiness.complete}/{readiness.checks.length}</span>
                                <span className="text-muted-foreground">{readiness.complete === readiness.checks.length ? "Ready" : "Needs setup"}</span>
                              </div>
                              <div className="flex gap-1">
                                {readiness.checks.map((check) => <span key={check.label} className={cn("h-1.5 w-7 rounded-full", check.done ? "bg-emerald-500" : "bg-muted")} />)}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {!account.hasAgentRecord ? <span className="text-muted-foreground">—</span> : account.contractPercentage == null ? <span className="text-amber-400">Not set</span> : `${account.contractPercentage}%`}
                      </TableCell>
                      <TableCell>{getStatusBadge(account.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Calendar className="h-4 w-4" />
                          {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : "—"}
                        </div>
                      </TableCell>
                      <TableCell>{renderAccountActions(account)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </GlassCard>
      </div>

      {/* Edit Account Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>
              Update account details for {editingAccount?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter full name"
              />
            </div>
            {isAdmin && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email Address</Label>
                  <div className="flex gap-2">
                    <Input
                      id="edit-email"
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="Enter email address"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleUpdateEmail}
                      disabled={isUpdatingEmail || editEmail === editingAccount?.email}
                    >
                      {isUpdatingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Email will be updated immediately without confirmation required.
                  </p>
                </div>
                {editingAccount?.hasAgentRecord && <div className="space-y-2">
                  <Label htmlFor="edit-contract-percentage">Comp Percentage</Label>
                  <Input
                    id="edit-contract-percentage"
                    inputMode="decimal"
                    min={0}
                    max={200}
                    step="0.01"
                    type="number"
                    value={editContractPercentage}
                    onChange={(e) => setEditContractPercentage(e.target.value)}
                    placeholder="Example: 120"
                  />
                  <p className="text-xs text-muted-foreground">Used for the producer's estimated earnings and commission views.</p>
                </div>}
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as AccountRole)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="va_manager">VA Manager</SelectItem>
                      <SelectItem value="va">VA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
