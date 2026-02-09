import { useState, useEffect } from "react";
import { Copy, Link2, Loader2, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

export function QuickInviteLink() {
  const { user } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ id: string; invite_code: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) loadExisting();
  }, [user]);

  const loadExisting = async () => {
    setIsLoading(true);
    try {
      const { data: agent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!agent) { setIsLoading(false); return; }
      setAgentId(agent.id);

      const { data: link } = await supabase
        .from("manager_invite_links")
        .select("id, invite_code")
        .eq("manager_agent_id", agent.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (link) setInviteLink(link);
    } catch (e) {
      console.error("Failed to load invite link:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const generateLink = async () => {
    if (!agentId) return;
    setIsGenerating(true);
    try {
      const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const { data, error } = await supabase
        .from("manager_invite_links")
        .insert({ manager_agent_id: agentId, invite_code: code, is_active: true })
        .select("id, invite_code")
        .single();

      if (error) throw error;
      setInviteLink(data);
      toast.success("Invite link created!");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate link");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyLink = () => {
    if (!inviteLink) return;
    const url = `${window.location.origin}/join?ref=${inviteLink.invite_code}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied!");
  };

  const deleteLink = async () => {
    if (!inviteLink) return;
    try {
      await supabase
        .from("manager_invite_links")
        .update({ is_active: false })
        .eq("id", inviteLink.id);
      setInviteLink(null);
      toast.success("Link deleted");
    } catch (e: any) {
      toast.error("Failed to delete link");
    }
  };

  if (isLoading) return null;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Invite Link</h4>
      </div>

      {inviteLink ? (
        <div className="space-y-2">
          <div
            onClick={copyLink}
            className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border cursor-pointer hover:bg-muted transition-colors"
          >
            <code className="text-xs truncate flex-1 text-foreground">
              {window.location.origin}/join?ref={inviteLink.invite_code}
            </code>
            <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={copyLink}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={deleteLink}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="w-full" onClick={generateLink} disabled={isGenerating}>
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Plus className="h-3.5 w-3.5 mr-1" />
          )}
          Generate Link
        </Button>
      )}
    </GlassCard>
  );
}
