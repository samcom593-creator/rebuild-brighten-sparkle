import { useState, useEffect } from "react";
import { Link2, Copy, Check, Plus, Trash2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface InviteLink {
  id: string;
  invite_code: string;
  manager_name: string;
  manager_agent_id: string;
  is_active: boolean;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
}

export function ManagerInviteLinks() {
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);

  const baseUrl = window.location.origin;

  useEffect(() => {
    fetchInviteLinks();
    fetchAgents();
  }, []);

  const fetchInviteLinks = async () => {
    try {
      const { data: links, error } = await supabase
        .from("manager_invite_links")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get manager names for each link
      const linksWithNames = await Promise.all(
        (links || []).map(async (link) => {
          const { data: agent } = await supabase
            .from("agents")
            .select("user_id")
            .eq("id", link.manager_agent_id)
            .single();

          let managerName = "Unknown";
          if (agent?.user_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("user_id", agent.user_id)
              .single();
            managerName = profile?.full_name || "Unknown";
          }

          return {
            ...link,
            manager_name: managerName,
          };
        })
      );

      setInviteLinks(linksWithNames);
    } catch (error) {
      console.error("Error fetching invite links:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const { data: agentsData, error } = await supabase
        .from("agents")
        .select("id, user_id")
        .eq("status", "active");

      if (error) throw error;

      // Get profiles for each agent
      const agentsWithNames = await Promise.all(
        (agentsData || []).map(async (agent) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("user_id", agent.user_id)
            .single();

          return {
            id: agent.id,
            name: profile?.full_name || "Unknown",
            email: profile?.email || "",
          };
        })
      );

      setAgents(agentsWithNames.filter((a) => a.name !== "Unknown"));
    } catch (error) {
      console.error("Error fetching agents:", error);
    }
  };

  const copyToClipboard = async (code: string, id: string) => {
    const fullUrl = `${baseUrl}/join?ref=${code}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    toast.success("Invite link copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const createInviteLink = async () => {
    if (!selectedAgent || !newCode.trim()) {
      toast.error("Please select an agent and enter a code");
      return;
    }

    // Sanitize the code - lowercase, no spaces, alphanumeric + dashes only
    const sanitizedCode = newCode
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    if (sanitizedCode.length < 3) {
      toast.error("Code must be at least 3 characters");
      return;
    }

    setIsCreating(true);
    try {
      const { error } = await supabase.from("manager_invite_links").insert({
        manager_agent_id: selectedAgent,
        invite_code: sanitizedCode,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This code is already in use");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Invite link created!");
      setIsDialogOpen(false);
      setNewCode("");
      setSelectedAgent("");
      fetchInviteLinks();
    } catch (error) {
      console.error("Error creating invite link:", error);
      toast.error("Failed to create invite link");
    } finally {
      setIsCreating(false);
    }
  };

  const deleteInviteLink = async (id: string) => {
    try {
      const { error } = await supabase
        .from("manager_invite_links")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Invite link deleted");
      fetchInviteLinks();
    } catch (error) {
      console.error("Error deleting invite link:", error);
      toast.error("Failed to delete invite link");
    }
  };

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" />
          Manager Invite Links
        </h3>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-1" />
              Create Link
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Invite Link</DialogTitle>
              <DialogDescription>
                Create a unique invite link for a manager or agent. People who sign up
                with this link will be tracked as their referrals.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="agent">Select Agent/Manager</Label>
                <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} ({agent.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Invite Code</Label>
                <Input
                  id="code"
                  placeholder="e.g., sam-apex"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="bg-input"
                />
                <p className="text-xs text-muted-foreground">
                  This will create: {baseUrl}/join?ref={newCode.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "your-code"}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createInviteLink} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : inviteLinks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No invite links yet. Create one to start tracking referrals.
        </p>
      ) : (
        <div className="space-y-3">
          {inviteLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium">{link.manager_name}</p>
                  <Badge
                    variant="outline"
                    className={
                      link.is_active
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                    }
                  >
                    {link.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {baseUrl}/join?ref={link.invite_code}
                </p>
              </div>

              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(link.invite_code, link.id)}
                >
                  {copiedId === link.id ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <a
                  href={`${baseUrl}/join?ref=${link.invite_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteInviteLink(link.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
