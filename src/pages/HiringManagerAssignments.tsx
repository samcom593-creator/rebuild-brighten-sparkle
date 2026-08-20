import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  UserCog, Plus, Trash2, AlertTriangle, CheckCircle2, Users, GraduationCap, ArrowRightLeft, Rocket, Settings,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";

type Scope = "unlicensed" | "licensed" | "transfer" | "post_started" | "all";

interface Assignment {
  id: string;
  manager_user_id: string;
  manager_display_name: string;
  scope: Scope;
  priority: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface ManagerOption {
  user_id: string;
  full_name: string;
  email: string;
}

const SCOPE_META: Record<Scope, { label: string; description: string; icon: any; color: string; border: string }> = {
  unlicensed: {
    label: "Unlicensed Hires",
    description: "New applicants who still need to get licensed",
    icon: GraduationCap,
    color: "text-amber-400 bg-amber-500/10",
    border: "border-amber-500/30",
  },
  licensed: {
    label: "Licensed Hires",
    description: "Already-licensed agents coming in fresh",
    icon: CheckCircle2,
    color: "text-emerald-400 bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  transfer: {
    label: "Transfers",
    description: "Agents transferring from another agency",
    icon: ArrowRightLeft,
    color: "text-info bg-info/10",
    border: "border-info/30",
  },
  post_started: {
    label: "Post-Started",
    description: "Agents who signed up but haven't activated yet",
    icon: Rocket,
    color: "text-violet-400 bg-violet-500/10",
    border: "border-violet-500/30",
  },
  all: {
    label: "Catchall",
    description: "Fallback when no scope-specific manager exists",
    icon: Users,
    color: "text-muted-foreground bg-muted/30",
    border: "border-border",
  },
};

export default function HiringManagerAssignments() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<Scope>("unlicensed");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [priority, setPriority] = useState(1);
  const [notes, setNotes] = useState("");

  const { data: assignments = [] } = useQuery({
    queryKey: ["hiring-manager-assignments"],
    queryFn: async (): Promise<Assignment[]> => {
      const { data, error } = await supabase
        .from("hiring_manager_assignments" as any)
        .select("*")
        .order("scope")
        .order("priority");
      if (error) {
        console.error(error);
        return [];
      }
      return (data as any) ?? [];
    },
  });

  const { data: eligibleManagers = [] } = useQuery({
    queryKey: ["eligible-hiring-managers"],
    queryFn: async (): Promise<ManagerOption[]> => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["manager", "admin"]);
      const userIds = [...new Set((roles || []).map((r: any) => r.user_id))];
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      return ((profiles || []) as any).filter((p: any) => p.full_name);
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!selectedUserId) {
      toast.error("Pick a manager");
      return;
    }
    const manager = eligibleManagers.find((m) => m.user_id === selectedUserId);
    if (!manager) {
      toast.error("Invalid manager");
      return;
    }

    const { error } = await supabase.from("hiring_manager_assignments" as any).insert({
      manager_user_id: selectedUserId,
      manager_display_name: manager.full_name,
      scope: selectedScope,
      priority,
      is_active: true,
      notes: notes || null,
    });

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${manager.full_name} assigned to ${SCOPE_META[selectedScope].label}`);
    setDialogOpen(false);
    setSelectedUserId("");
    setNotes("");
    setPriority(1);
    queryClient.invalidateQueries({ queryKey: ["hiring-manager-assignments"] });
  };

  const handleRemove = async (id: string, name: string) => {
    const ok = await askConfirm({
      title: `Remove ${name} from this scope?`,
      description: "They stop receiving new pipeline assignments in this scope. Reversible by re-adding them.",
      confirmText: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("hiring_manager_assignments" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Removed");
    queryClient.invalidateQueries({ queryKey: ["hiring-manager-assignments"] });
  };

  const handleToggle = async (id: string, newValue: boolean) => {
    const { error } = await supabase
      .from("hiring_manager_assignments" as any)
      .update({ is_active: newValue, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(newValue ? "Activated" : "Deactivated");
    queryClient.invalidateQueries({ queryKey: ["hiring-manager-assignments"] });
  };

  const byScope = assignments.reduce((acc, a) => {
    if (!acc[a.scope]) acc[a.scope] = [];
    acc[a.scope].push(a);
    return acc;
  }, {} as Record<Scope, Assignment[]>);

  const scopesWithoutActive = (["unlicensed", "licensed", "transfer", "post_started"] as Scope[]).filter(
    (s) => !byScope[s]?.some((a) => a.is_active),
  );

  return (
    <div className="space-y-6 p-4 md:p-6 page-enter max-w-6xl mx-auto">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Routing"
        eyebrowIcon={<UserCog className="h-3 w-3" />}
        title="Hiring Manager Routing"
        subtitle="Assign who handles each type of incoming hire — by licensed/unlicensed, state, lead source, or carrier."
      />
      <div className="flex items-center justify-end flex-wrap gap-3">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1.5" /> Assign Manager
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Hiring Manager</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Manager</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a manager..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleManagers.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name} · {m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={selectedScope} onValueChange={(v) => setSelectedScope(v as Scope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SCOPE_META) as [Scope, typeof SCOPE_META.all][]).map(([k, m]) => (
                      <SelectItem key={k} value={k}>
                        {m.label} — {m.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Input
                  type="number"
                  min="1"
                  max="99"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Lower = higher priority. Primary = 1, backup = 2, etc.
                </p>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Handles unlicensed hires during business hours"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd}>Assign</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {scopesWithoutActive.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm mb-1">Coverage gaps detected</p>
                <p className="text-xs text-muted-foreground mb-2">
                  No active hiring manager for:{" "}
                  <strong className="text-foreground">
                    {scopesWithoutActive.map((s) => SCOPE_META[s].label).join(", ")}
                  </strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Incoming applications matching these scopes will auto-route to the catchall (if set), otherwise land
                  unassigned.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.entries(SCOPE_META) as [Scope, typeof SCOPE_META.all][]).map(([scope, meta]) => {
          const Icon = meta.icon;
          const scopeAssignments = byScope[scope] || [];
          const active = scopeAssignments.filter((a) => a.is_active).sort((a, b) => a.priority - b.priority);
          const inactive = scopeAssignments.filter((a) => !a.is_active);
          return (
            <Card key={scope} className={`border ${meta.border}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-lg ${meta.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">{meta.label}</CardTitle>
                    <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {active.length === 0 && inactive.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">
                    No manager assigned — applications will fall back to catchall
                  </p>
                )}
                {active.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40">
                    <Badge variant="outline" className="shrink-0">
                      P{a.priority}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.manager_display_name}</p>
                      {a.notes && <p className="text-[10px] text-muted-foreground truncate">{a.notes}</p>}
                    </div>
                    <Switch checked={a.is_active} onCheckedChange={(v) => handleToggle(a.id, v)} />
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(a.id, a.manager_display_name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
                {inactive.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 opacity-50">
                    <Badge variant="outline" className="shrink-0">
                      Off
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{a.manager_display_name}</p>
                    </div>
                    <Switch checked={a.is_active} onCheckedChange={(v) => handleToggle(a.id, v)} />
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(a.id, a.manager_display_name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" /> How auto-routing works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p>When a new application comes in, the system determines its scope and auto-assigns a hiring manager:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>
              <strong>license_status = licensed</strong> → <code>licensed</code> scope
            </li>
            <li>
              <strong>is_transfer = true</strong> → <code>transfer</code> scope
            </li>
            <li>
              Everyone else → <code>unlicensed</code> scope
            </li>
          </ul>
          <p>
            The primary (Priority 1) active manager for that scope gets assigned. If none exists, the catchall manager
            takes it. If neither exists, the application lands unassigned.
          </p>
          <p className="pt-2 border-t border-border">
            Example: Jacob set as P1 Unlicensed + P1 Transfer means every new unlicensed applicant and every transfer
            routes to him automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
