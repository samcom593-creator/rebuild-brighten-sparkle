import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { 
  User, 
  Mail, 
  Phone, 
  Shield, 
  Save, 
  ExternalLink,
  AlertTriangle,
  Archive,
  Send,
  Loader2
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

interface AgentProfileEditorProps {
  agent: AgentWithStats | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function AgentProfileEditor({ agent, open, onClose, onUpdate }: AgentProfileEditorProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "terminated">("active");

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
    enabled: !!agent?.id,
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
            avatar_url
          ),
          invited_by:agents!agents_invited_by_manager_id_fkey (
            profiles!agents_profile_id_fkey (
              full_name
            )
          )
        `)
        .eq("id", agent!.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Update profile mutation
  const updateProfile = useMutation({
    mutationFn: async () => {
      if (!agent?.profileId) {
        throw new Error("No profile linked to this agent");
      }

      // Validate name
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
        })
        .eq("id", agent.profileId);

      if (profileError) throw profileError;

      // Update agent status
      const { error: agentError } = await supabase
        .from("agents")
        .update({
          is_deactivated: status === "terminated",
          is_inactive: status === "inactive",
          status: status === "terminated" ? "terminated" : status === "inactive" ? "inactive" : "active",
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

  if (!agent) return null;

  // Extract manager name - handle various possible response shapes
  let managerName = "Unassigned";
  if (agentDetails?.invited_by) {
    const invitedBy = agentDetails.invited_by as unknown;
    if (Array.isArray(invitedBy) && invitedBy.length > 0) {
      const first = invitedBy[0] as { profiles?: { full_name?: string } };
      managerName = first?.profiles?.full_name || "Unassigned";
    } else if (typeof invitedBy === "object" && invitedBy !== null) {
      const single = invitedBy as { profiles?: { full_name?: string } };
      managerName = single?.profiles?.full_name || "Unassigned";
    }
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Agent Profile
          </SheetTitle>
          <SheetDescription>
            Edit agent information and manage their status.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          {/* Stats Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-lg font-bold">${Math.round(agent.totalAlp).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total ALP</p>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <p className="text-lg font-bold">{agent.totalDeals}</p>
              <p className="text-xs text-muted-foreground">Deals</p>
            </div>
            <div className={cn(
              "text-center p-3 rounded-lg",
              agent.closingRate >= 20 ? "bg-green-500/10" : 
              agent.closingRate >= 10 ? "bg-muted" : 
              "bg-amber-500/10"
            )}>
              <p className="text-lg font-bold">{agent.closingRate}%</p>
              <p className="text-xs text-muted-foreground">Close Rate</p>
            </div>
          </div>

          {/* CRM Status */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">CRM Status</span>
            </div>
            {agent.hasCrmLink ? (
              <Badge className="bg-green-500/10 text-green-600 border-green-500/30">
                Linked
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                Not Linked
              </Badge>
            )}
          </div>

          {/* Manager Info */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <span className="text-sm text-muted-foreground">Manager</span>
            <span className="text-sm font-medium">{managerName}</span>
          </div>

          <Separator />

          {/* Editable Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Full Name
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter full name"
              />
              {!fullName.trim() && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Name is required
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      Active
                    </span>
                  </SelectItem>
                  <SelectItem value="inactive">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      Inactive (Hidden from leaderboard)
                    </span>
                  </SelectItem>
                  <SelectItem value="terminated">
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      Terminated / Former
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <Button
              className="w-full gap-2"
              onClick={() => updateProfile.mutate()}
              disabled={updateProfile.isPending || !fullName.trim()}
            >
              {updateProfile.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => sendPortalLink.mutate()}
              disabled={sendPortalLink.isPending || !email}
            >
              {sendPortalLink.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Portal Login Link
            </Button>

            {agent.lastActivity && (
              <p className="text-xs text-center text-muted-foreground">
                Last activity: {agent.lastActivity}
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
