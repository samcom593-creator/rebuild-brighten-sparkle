import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminManagerInvites } from "@/components/dashboard/AdminManagerInvites";
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
import { cn } from "@/lib/utils";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

interface AccountInfo {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "agent";
  status: string;
  createdAt: string;
  lastActive?: string;
}

export default function DashboardAccounts() {
  const { isAdmin, isManager, isLoading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    managers: 0,
    agents: 0,
    pendingApproval: 0,
  });

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountInfo | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "manager" | "agent">("agent");
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      // Fetch all agents with their profiles and roles
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id, status, created_at")
        .order("created_at", { ascending: false });

      if (agentsError) throw agentsError;

      const accountList: AccountInfo[] = [];
      let managersCount = 0;
      let agentsCount = 0;
      let pendingCount = 0;

      for (const agent of agents || []) {
        if (!agent.user_id) continue;

        // Get profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", agent.user_id)
          .maybeSingle();

        // Get role
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", agent.user_id)
          .maybeSingle();

        const role = roleData?.role as "admin" | "manager" | "agent" || "agent";

        if (role === "manager") managersCount++;
        if (role === "agent") agentsCount++;
        if (agent.status === "pending") pendingCount++;

        accountList.push({
          id: agent.id,
          userId: agent.user_id,
          name: profile?.full_name || "Unknown",
          email: profile?.email || "Unknown",
          role,
          status: agent.status,
          createdAt: agent.created_at,
        });
      }

      setAccounts(accountList);
      setStats({
        totalAccounts: accountList.length,
        managers: managersCount,
        agents: agentsCount,
        pendingApproval: pendingCount,
      });
    } catch (error) {
      console.error("Error fetching accounts:", error);
      toast.error("Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditAccount = (account: AccountInfo) => {
    setEditingAccount(account);
    setEditName(account.name);
    setEditEmail(account.email);
    setEditRole(account.role);
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
            newEmail: editEmail,
            targetUserId: editingAccount.userId
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update email");
      }

      toast.success(`Email updated to ${editEmail}`);
      fetchAccounts();
    } catch (err: any) {
      console.error("Error updating email:", err);
      toast.error(err.message || "Failed to update email");
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    setIsSaving(true);

    try {
      // Update profile name
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: editName })
        .eq("user_id", editingAccount.userId);

      if (profileError) throw profileError;

      // Update role if changed (admin only)
      if (isAdmin && editRole !== editingAccount.role) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .update({ role: editRole })
          .eq("user_id", editingAccount.userId);

        if (roleError) throw roleError;
      }

      toast.success("Account updated successfully");
      setEditDialogOpen(false);
      fetchAccounts();
    } catch (error) {
      console.error("Error updating account:", error);
      toast.error("Failed to update account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (account: AccountInfo) => {
    const newStatus = account.status === "active" ? "terminated" : "active";
    const action = newStatus === "terminated" ? "deactivate" : "reactivate";

    try {
      const { error } = await supabase
        .from("agents")
        .update({ 
          status: newStatus as any,
          ...(newStatus === "active" ? { 
            verified_at: new Date().toISOString(),
            is_deactivated: false,
            is_inactive: false,
            deactivation_reason: null
          } : {})
        })
        .eq("id", account.id);

      if (error) throw error;

      toast.success(`Account ${action}d successfully`);
      fetchAccounts();
    } catch (error) {
      console.error(`Error ${action}ing account:`, error);
      toast.error(`Failed to ${action} account`);
    }
  };

  const filteredAccounts = accounts.filter(
    (account) =>
      account.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.role.toLowerCase().includes(searchQuery.toLowerCase())
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
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Shield className="h-3 w-3 mr-1" />
            Manager
          </Badge>
        );
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

  // Access control check
  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin && !isManager) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold">Accounts</h1>
        </div>
        <p className="text-muted-foreground">
          Manage all manager and agent accounts. Create invite links to add new managers.
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
      >
        {[
          { label: "Total Accounts", value: stats.totalAccounts, icon: Users, color: "text-primary" },
          { label: "Managers", value: stats.managers, icon: Shield, color: "text-blue-400" },
          { label: "Agents", value: stats.agents, icon: UserPlus, color: "text-emerald-400" },
          { label: "Pending Approval", value: stats.pendingApproval, icon: AlertTriangle, color: "text-amber-400" },
        ].map((stat) => (
          <GlassCard key={stat.label} className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
              <div>
                <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </motion.div>

      {/* Manager Invite Links - The main feature! */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mb-8"
      >
        <AdminManagerInvites />
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mb-6"
      >
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts by name, email, or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-input"
          />
        </div>
      </motion.div>

      {/* Accounts Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            All Accounts
          </h3>
          
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading accounts...</p>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {searchQuery ? "No accounts match your search." : "No accounts found."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[50px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-4 w-4" />
                          {account.email}
                        </div>
                      </TableCell>
                      <TableCell>{getRoleBadge(account.role)}</TableCell>
                      <TableCell>{getStatusBadge(account.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                          <Calendar className="h-4 w-4" />
                          {new Date(account.createdAt).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditAccount(account)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit Account
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                            onClick={async () => {
                                try {
                                  const { error } = await supabase.functions.invoke("send-password-reset", {
                                    body: { email: account.email, type: "reset" },
                                  });
                                  if (error) throw error;
                                  toast.success(`Password reset email sent to ${account.email}`);
                                } catch (err: any) {
                                  toast.error(err.message || "Failed to send password reset");
                                }
                              }}
                            >
                              <Key className="h-4 w-4 mr-2" />
                              Send Password Reset
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={async () => {
                                try {
                                  const { error } = await supabase.functions.invoke("generate-magic-link", {
                                    body: { email: account.email, destination: "portal" }
                                  });
                                  if (error) throw error;
                                  toast.success(`Magic login link sent to ${account.email}`);
                                } catch (err: any) {
                                  toast.error(err.message || "Failed to send login link");
                                }
                              }}
                            >
                              <Link2 className="h-4 w-4 mr-2" />
                              Send Magic Login Link
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {account.status === "active" ? (
                              <DropdownMenuItem 
                                onClick={() => handleToggleStatus(account)}
                                className="text-destructive focus:text-destructive"
                              >
                                <UserX className="h-4 w-4 mr-2" />
                                Deactivate Account
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem 
                                onClick={() => handleToggleStatus(account)}
                                className="text-emerald-500 focus:text-emerald-500"
                              >
                                <UserCheck className="h-4 w-4 mr-2" />
                                Reactivate Account
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </GlassCard>
      </motion.div>

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
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as "admin" | "manager" | "agent")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
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
    </DashboardLayout>
  );
}
