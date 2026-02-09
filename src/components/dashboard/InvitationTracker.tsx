import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  UserPlus, 
  Clock, 
  CheckCircle2, 
  Mail, 
  Phone, 
  Instagram, 
  RefreshCw,
  Loader2,
  UserCheck,
  Send,
  X
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface InvitationStatus {
  id: string;
  agentName: string;
  email: string;
  phone: string | null;
  instagram: string | null;
  sentAt: string;
  hasPassword: boolean;
  isActive: boolean;
}

export function InvitationTracker() {
  const { user, isAdmin } = useAuth();
  const [invitations, setInvitations] = useState<InvitationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  

  useEffect(() => {
    fetchInvitations();
    
    // Real-time subscription
    const channel = supabase
      .channel("invitation-tracker")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        () => fetchInvitations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchInvitations = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Get current user's agent ID
      const { data: currentAgent } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!currentAgent) {
        setLoading(false);
        return;
      }

      // Fetch agents invited by this manager (or all if admin)
      let query = supabase
        .from("agents")
        .select(`
          id,
          created_at,
          portal_password_set,
          status,
          profile:profiles!agents_profile_id_fkey(
            full_name,
            email,
            phone,
            instagram_handle
          )
        `)
        .eq("is_deactivated", false)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!isAdmin) {
        query = query.eq("invited_by_manager_id", currentAgent.id);
      }

      const { data: agents, error } = await query;

      if (error) throw error;

      // Filter out entries without valid names
      const invitationData: InvitationStatus[] = (agents || [])
        .filter((agent: any) => agent.profile?.full_name && agent.profile.full_name !== "Pending")
        .map((agent: any) => ({
          id: agent.id,
          agentName: agent.profile?.full_name || "Pending",
          email: agent.profile?.email || "",
          phone: agent.profile?.phone || null,
          instagram: agent.profile?.instagram_handle || null,
          sentAt: agent.created_at,
          hasPassword: agent.portal_password_set || false,
          isActive: agent.status === "active",
        }));

      setInvitations(invitationData);
    } catch (error) {
      console.error("Error fetching invitations:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAgent = async (invitation: InvitationStatus) => {
    setRemovingId(invitation.id);
    try {
      const { error } = await supabase
        .from("agents")
        .update({ is_deactivated: true, status: "terminated" as const })
        .eq("id", invitation.id);
      if (error) throw error;
      toast.success(`${invitation.agentName} removed`);
      setConfirmRemoveId(null);
      fetchInvitations();
    } catch (error) {
      console.error("Error removing agent:", error);
      toast.error("Failed to remove agent");
    } finally {
      setRemovingId(null);
    }
  };

  const handleSendInvite = async (invitation: InvitationStatus) => {
    setSendingTo(invitation.id);
    try {
      const { error } = await supabase.functions.invoke("send-agent-portal-login", {
        body: { agentId: invitation.id }
      });
      if (error) throw error;
      toast.success(`Portal login sent to ${invitation.email}`);
    } catch (error) {
      console.error("Error sending invite:", error);
      toast.error("Failed to send invitation");
    } finally {
      setSendingTo(null);
    }
  };


  const acceptedCount = invitations.filter(i => i.hasPassword).length;
  const pendingCount = invitations.filter(i => !i.hasPassword).length;

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Recent Invitations</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchInvitations}
          disabled={loading}
          className="h-7 w-7 p-0"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 mb-3">
        <Badge variant="secondary" className="text-xs">
          <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
          {acceptedCount} Accepted
        </Badge>
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1 text-amber-500" />
          {pendingCount} Pending
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : invitations.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          No invitations yet
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          <AnimatePresence initial={false}>
            {invitations.map((invitation, index) => (
              <motion.div
                key={invitation.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: index * 0.05 }}
                className={`p-3 rounded-lg border transition-colors ${
                  invitation.hasPassword
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-muted/30 border-border"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {invitation.hasPassword ? (
                      <UserCheck className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="font-medium text-sm">{invitation.agentName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!invitation.hasPassword && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSendInvite(invitation)}
                        disabled={sendingTo === invitation.id}
                        className="h-6 w-6 p-0 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                        title="Send login email"
                      >
                        {sendingTo === invitation.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                    {confirmRemoveId === invitation.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAgent(invitation)}
                          disabled={removingId === invitation.id}
                          className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                        >
                          {removingId === invitation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmRemoveId(null)}
                          className="h-6 px-1.5 text-[10px]"
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRemoveId(invitation.id)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Remove agent"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-2">
                  {formatDistanceToNow(new Date(invitation.sentAt), { addSuffix: true })}
                </p>

                {/* Profile completion indicators */}
                <div className="flex items-center gap-3 text-[10px]">
                  <div className={`flex items-center gap-1 ${invitation.email ? "text-emerald-500" : "text-muted-foreground"}`}>
                    <Mail className="h-3 w-3" />
                    {invitation.email ? "✓" : "—"}
                  </div>
                  <div className={`flex items-center gap-1 ${invitation.phone ? "text-emerald-500" : "text-muted-foreground"}`}>
                    <Phone className="h-3 w-3" />
                    {invitation.phone ? "✓" : "—"}
                  </div>
                  <div className={`flex items-center gap-1 ${invitation.instagram ? "text-primary" : "text-muted-foreground"}`}>
                    <Instagram className="h-3 w-3" />
                    {invitation.instagram ? `@${invitation.instagram}` : "—"}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </GlassCard>
  );
}