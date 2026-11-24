import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Instagram, DollarSign, RefreshCw, ToggleLeft, ToggleRight,
  CheckCircle, XCircle, Copy, Download, Loader2, Users,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Subscription {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
}

export default function InstagramAutomation() {
  const { isAdmin } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    setLoading(true); setLoadError(null);
    try {
      // Use rpc or raw query since types may not be generated yet
      const { data, error } = await supabase
        .from("instagram_subscriptions" as any)
        .select("id, agent_id, status, instagram_handle, created_at") // amount, last_paid and next_due are not columns (400 on every load)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch agent names separately
      const agentIds = (data || []).map((s: any) => s.agent_id);
      const agentNames: Record<string, string> = {};
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from("agents")
          .select("id, display_name, profiles:profiles!agents_profile_id_fkey(full_name)")
          .in("id", agentIds);
        agents?.forEach((a: any) => {
          agentNames[a.id] = a.display_name || a.profiles?.full_name || "Agent";
        });
      }

      const subs: Subscription[] = (data || []).map((s: any) => ({
        id: s.id,
        agent_id: s.agent_id,
        agent_name: agentNames[s.agent_id] || "Agent",
        status: s.status || "unknown",
      }));

      setSubscriptions(subs);
    } catch (e) {
      setSubscriptions([]);
      setLoadError(e instanceof Error ? e.message : "Subscriptions could not be loaded.");
    }
    setLoading(false);
  };

  const toggleSubscription = async (sub: Subscription) => {
    const newStatus = sub.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("instagram_subscriptions" as any)
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    if (error) {
      toast.error("Failed to update subscription");
      return;
    }
    toast.success(`Subscription ${newStatus === "active" ? "activated" : "paused"}`);
    fetchSubscriptions();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 page-enter">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Instagram className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold gradient-text">Instagram Automation</h1>
        </div>
        <p className="text-muted-foreground">Manage agent Instagram content service subscriptions</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Monthly recurring revenue</p>
              <p className="text-xl font-bold">Not available</p>
              <p className="text-sm text-muted-foreground">Verified billing amounts are needed to calculate revenue.</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Active Subscribers</p>
              <p className="text-2xl font-bold">{loadError ? "Unavailable" : subscriptions.filter(s => s.status === "active").length}</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Posts Generated</p>
              <p className="text-2xl font-bold">—</p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Subscriptions List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Agent Subscriptions</h2>
          <Button variant="outline" size="sm" onClick={fetchSubscriptions}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {loadError ? (
          <GlassCard className="space-y-3 p-6" role="alert">
            <p className="font-medium">Subscriptions could not be loaded</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button type="button" variant="outline" onClick={() => void fetchSubscriptions()}>Retry subscriptions</Button>
          </GlassCard>
        ) : subscriptions.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Instagram className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No Instagram automation subscriptions yet</p>
            <p className="text-sm text-muted-foreground mt-1">Subscriptions appear here when an agent&apos;s service enrollment is recorded. Billing amounts must be verified separately.</p>
          </GlassCard>
        ) : (
          <div className="grid gap-3">
            {subscriptions.map((sub) => (
              <motion.div
                key={sub.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard className="p-4 flex items-center justify-between hover:border-primary/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Instagram className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{sub.agent_name}</p>
                      <p className="text-sm text-muted-foreground">Billing amount unavailable</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={sub.status === "active" ? "default" : "secondary"}
                      className={sub.status === "active" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : ""}
                    >
                      {sub.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${sub.status === "active" ? "Pause" : "Activate"} ${sub.agent_name}'s subscription`}
                      onClick={() => toggleSubscription(sub)}
                    >
                      {sub.status === "active" ? (
                        <ToggleRight className="h-5 w-5 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
