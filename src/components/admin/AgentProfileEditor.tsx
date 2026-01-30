import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { 
  User, 
  Mail, 
  Phone, 
  Shield, 
  Save, 
  AlertTriangle,
  Send,
  Loader2,
  Instagram,
  Key,
  Users
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AgentWithStats {
  id: string;
  profileId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  isDeactivated: boolean;
  isInactive: boolean;
  totalAlp: number;
  totalDeals: number;
  closingRate: number;
  hasCrmLink: boolean;
  lastActivity: string | null;
}

interface Manager {
  id: string;
  name: string;
}

interface AgentProfileEditorProps {
  agent: AgentWithStats | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

const ONBOARDING_STAGES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "training_online", label: "Training Online" },
  { value: "in_field_training", label: "In Field Training" },
  { value: "evaluated", label: "Evaluated" },
];

export function AgentProfileEditor({ agent, open, onClose, onUpdate }: AgentProfileEditorProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "terminated">("active");
  const [onboardingStage, setOnboardingStage] = useState("onboarding");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);

  // Fetch managers list
  useEffect(() => {
    const fetchManagers = async () => {
      const { data: managerRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["manager", "admin"]);

      if (!managerRoles) return;

      const managerUserIds = managerRoles.map(r => r.user_id);
      
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("is_deactivated", false)
        .in("user_id", managerUserIds);

      if (!agentsData) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);

      const managerList: Manager[] = agentsData.map(a => {
        const profile = profiles?.find(p => p.user_id === a.user_id);
        return { id: a.id, name: profile?.full_name || "Unknown" };
      });

      setManagers(managerList);
    };

    if (open) fetchManagers();
  }, [open]);

  // Reset form when agent changes
  useEffect(() => {
    if (agent) {
      setFullName(agent.fullName || "");
      setEmail(agent.email || "");
      setPhone(agent.phone || "");
      setStatus(
        agent.isDeactivated ? "terminated" : 
        agent.isInactive ? "inactive" : 
        "active"
      );
    }
  }, [agent]);

  // Fetch full agent details
  const { data: agentDetails } = useQuery({
    queryKey: ["agent-details", agent?.id],
    enabled: !!agent?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select(`
          *,
          profiles!agents_profile_id_fkey (
            id,
            full_name,
            email,
            phone,
            avatar_url,
            instagram_handle
          )
        `)
        .eq("id", agent!.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Set additional fields from agentDetails
  useEffect(() => {
    if (agentDetails) {
      const profile = agentDetails.profiles as { instagram_handle?: string } | null;
      setInstagram(profile?.instagram_handle || "");
      setOnboardingStage(agentDetails.onboarding_stage || "onboarding");
      setManagerId(agentDetails.invited_by_manager_id || null);
    }
  }, [agentDetails]);

  // Update profile mutation
  const updateProfile = useMutation({
    mutationFn: async () => {
      if (!agent?.profileId) {
        throw new Error("No profile linked to this agent");
      }

      if (!fullName.trim()) {
        throw new Error("Name is required");
      }

      // Update profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          instagram_handle: instagram.trim() || null,
        })
        .eq("id", agent.profileId);

      if (profileError) throw profileError;

      // Update agent
      const { error: agentError } = await supabase
        .from("agents")
        .update({
          is_deactivated: status === "terminated",
          is_inactive: status === "inactive",
          status: status === "terminated" ? "terminated" : status === "inactive" ? "inactive" : "active",
          onboarding_stage: onboardingStage as "onboarding" | "training_online" | "in_field_training" | "evaluated",
          invited_by_manager_id: managerId,
        })
        .eq("id", agent.id);

      if (agentError) throw agentError;
    },
    onSuccess: () => {
      toast({
        title: "Profile updated",
        description: `${fullName} has been updated successfully.`,
      });
      onUpdate();
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Send portal link mutation
  const sendPortalLink = useMutation({
    mutationFn: async () => {
      if (!email) {
        throw new Error("Agent must have an email to send portal link");
      }

      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { 
          agentId: agent?.id,
          email: email.trim(),
        },
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Portal link sent",
        description: `Login link sent to ${email}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to send",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Send password reset
  const sendPasswordReset = useMutation({
    mutationFn: async () => {
      if (!email) {
        throw new Error("Agent must have an email for password reset");
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/settings`,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Password reset sent",
        description: `Reset link sent to ${email}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to send reset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!agent) return null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Edit Agent Profile
          </SheetTitle>
          <SheetDescription className="text-xs">
            Update agent info, status, and manager assignment.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Stats Summary - Compact */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-muted rounded-lg">
              <p className="text-sm font-bold">${Math.round(agent.totalAlp).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">ALP</p>
            </div>
            <div className="text-center p-2 bg-muted rounded-lg">
              <p className="text-sm font-bold">{agent.totalDeals}</p>
              <p className="text-[10px] text-muted-foreground">Deals</p>
            </div>
            <div className={cn(
              "text-center p-2 rounded-lg",
              agent.closingRate >= 20 ? "bg-emerald-500/10" : 
              agent.closingRate >= 10 ? "bg-muted" : 
              "bg-amber-500/10"
            )}>
              <p className="text-sm font-bold">{agent.closingRate}%</p>
              <p className="text-[10px] text-muted-foreground">Close</p>
            </div>
          </div>

          {/* CRM Status */}
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Shield className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs">CRM Status</span>
            </div>
            {agent.hasCrmLink ? (
              <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                Linked
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
                Not Linked
              </Badge>
            )}
          </div>

          <Separator />

          {/* Editable Fields */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="fullName" className="flex items-center gap-1 text-xs">
                <User className="h-3 w-3" />
                Full Name
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter full name"
                className="h-8 text-sm"
              />
              {!fullName.trim() && (
                <p className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Required
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="email" className="flex items-center gap-1 text-xs">
                <Mail className="h-3 w-3" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="phone" className="flex items-center gap-1 text-xs">
                <Phone className="h-3 w-3" />
                Phone
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="instagram" className="flex items-center gap-1 text-xs">
                <Instagram className="h-3 w-3" />
                Instagram
              </Label>
              <Input
                id="instagram"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@username"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active" className="text-xs">
                    <span className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </SelectItem>
                  <SelectItem value="inactive" className="text-xs">
                    <span className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      Inactive
                    </span>
                  </SelectItem>
                  <SelectItem value="terminated" className="text-xs">
                    <span className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      Terminated
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Onboarding Stage</Label>
              <Select value={onboardingStage} onValueChange={setOnboardingStage}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ONBOARDING_STAGES.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value} className="text-xs">
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                <Users className="h-3 w-3" />
                Reports To
              </Label>
              <Select value={managerId || "none"} onValueChange={(v) => setManagerId(v === "none" ? null : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    <span className="text-muted-foreground">No Manager</span>
                  </SelectItem>
                  {managers
                    .filter(m => m.id !== agent.id)
                    .map((manager) => (
                      <SelectItem key={manager.id} value={manager.id} className="text-xs">
                        {manager.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <Button
              className="w-full gap-2 h-8 text-xs"
              onClick={() => updateProfile.mutate()}
              disabled={updateProfile.isPending || !fullName.trim()}
            >
              {updateProfile.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save Changes
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="gap-1 h-7 text-[10px]"
                onClick={() => sendPortalLink.mutate()}
                disabled={sendPortalLink.isPending || !email}
              >
                {sendPortalLink.isPending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Send className="h-2.5 w-2.5" />
                )}
                Send Login
              </Button>

              <Button
                variant="outline"
                className="gap-1 h-7 text-[10px]"
                onClick={() => sendPasswordReset.mutate()}
                disabled={sendPasswordReset.isPending || !email}
              >
                {sendPasswordReset.isPending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Key className="h-2.5 w-2.5" />
                )}
                Reset Password
              </Button>
            </div>

            {agent.lastActivity && (
              <p className="text-[10px] text-center text-muted-foreground">
                Last activity: {agent.lastActivity}
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
