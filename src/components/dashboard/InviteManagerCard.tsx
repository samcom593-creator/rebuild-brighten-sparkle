import { useState } from "react";
import { UserPlus, Copy, Check, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface RecentInvite {
  id: string;
  token: string;
  manager_name: string | null;
  is_used: boolean;
  expires_at: string;
}

export function InviteManagerCard() {
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [recentInvite, setRecentInvite] = useState<RecentInvite | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const baseUrl = window.location.origin;

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
      
      const { data, error } = await supabase
        .from("manager_signup_tokens")
        .insert({
          token,
          manager_name: managerName || null,
          manager_email: managerEmail || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Invite link created!");
      setRecentInvite(data);
      setIsDialogOpen(false);
      setManagerName("");
      setManagerEmail("");
      
      // Auto-copy to clipboard
      const fullUrl = `${baseUrl}/signup?token=${token}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(data.id);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopiedId(null), 3000);
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
    toast.success("Link copied!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <UserPlus className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Invite a Manager</h3>
            <p className="text-sm text-muted-foreground">
              Create a one-time signup link
            </p>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-1" />
              Create Link
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Manager Invite</DialogTitle>
              <DialogDescription>
                Generate a one-time invite link. Send it to your new manager so they can create their account.
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
                  For your reference only. They can use any email when signing up.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createToken} disabled={isCreating}>
                {isCreating ? "Creating..." : "Generate & Copy Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Show most recent invite if exists */}
      {recentInvite && !recentInvite.is_used && new Date(recentInvite.expires_at) > new Date() && (
        <div className="mt-4 p-3 rounded-lg bg-background/50 border border-border">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {recentInvite.manager_name || "New Manager"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {baseUrl}/signup?token={recentInvite.token.slice(0, 8)}...
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(recentInvite.token, recentInvite.id)}
            >
              {copiedId === recentInvite.id ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        View all invites in <span className="text-primary">Accounts</span> page
      </p>
    </GlassCard>
  );
}
