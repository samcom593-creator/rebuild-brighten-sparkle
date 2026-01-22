import { useState, useEffect } from "react";
import { Link2, Copy, Check, Plus, Trash2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { Label } from "@/components/ui/label";

interface SignupToken {
  id: string;
  token: string;
  manager_name: string | null;
  manager_email: string | null;
  created_at: string;
  expires_at: string;
  is_used: boolean;
  used_at: string | null;
}

export function AdminManagerInvites() {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<SignupToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const baseUrl = window.location.origin;

  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    try {
      const { data, error } = await supabase
        .from("manager_signup_tokens")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTokens(data || []);
    } catch (error) {
      console.error("Error fetching tokens:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateToken = (): string => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  const createToken = async () => {
    if (!user) return;

    setIsCreating(true);
    try {
      const token = generateToken();
      
      const { error } = await supabase.from("manager_signup_tokens").insert({
        token,
        manager_name: managerName || null,
        manager_email: managerEmail || null,
        created_by: user.id,
      });

      if (error) throw error;

      toast.success("Invite link created!");
      setIsDialogOpen(false);
      setManagerName("");
      setManagerEmail("");
      fetchTokens();
    } catch (error) {
      console.error("Error creating token:", error);
      toast.error("Failed to create invite link");
    } finally {
      setIsCreating(false);
    }
  };

  const copyToClipboard = async (token: string, id: string) => {
    const fullUrl = `${baseUrl}/signup?token=${token}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    toast.success("Invite link copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteToken = async (id: string) => {
    try {
      const { error } = await supabase
        .from("manager_signup_tokens")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success("Invite link deleted");
      fetchTokens();
    } catch (error) {
      console.error("Error deleting token:", error);
      toast.error("Failed to delete invite link");
    }
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          Manager Account Invites
        </h3>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-1" />
              Create Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Manager Invite</DialogTitle>
              <DialogDescription>
                Generate a one-time invite link for a new manager. They'll use this link to create their account.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Manager Name (optional)</Label>
                <Input
                  id="name"
                  placeholder="e.g., John Smith"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  className="bg-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Manager Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="e.g., john@example.com"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  className="bg-input"
                />
                <p className="text-xs text-muted-foreground">
                  For your reference only. The manager can use any email when signing up.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createToken} disabled={isCreating}>
                {isCreating ? "Creating..." : "Generate Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : tokens.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No invite links yet. Create one to add a new manager.
        </p>
      ) : (
        <div className="space-y-3">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium">
                    {token.manager_name || "Unnamed Manager"}
                  </p>
                  <Badge
                    variant="outline"
                    className={
                      token.is_used
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : isExpired(token.expires_at)
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                    }
                  >
                    {token.is_used ? "Used" : isExpired(token.expires_at) ? "Expired" : "Active"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  {token.manager_email || "No email specified"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Expires: {new Date(token.expires_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-2 ml-4">
                {!token.is_used && !isExpired(token.expires_at) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(token.token, token.id)}
                  >
                    {copiedId === token.id ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteToken(token.id)}
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
