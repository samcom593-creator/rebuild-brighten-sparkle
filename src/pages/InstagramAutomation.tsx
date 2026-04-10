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
  CheckCircle, XCircle, Image, Copy, Download, Loader2, Users,
  TrendingUp, Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Subscription {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  amount: number;
  last_paid: string | null;
  next_due: string | null;
}

export default function InstagramAutomation() {
  const { isAdmin } = useAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalMRR, setTotalMRR] = useState(0);

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("instagram_subscriptions")
        .select(`
          id, agent_id, status, amount, last_paid, next_due,
          agents!inner(id, display_name, profiles:profile_id(full_name))
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const subs: Subscription[] = (data || []).map((s: any) => ({
        id: s.id,
        agent_id: s.agent_id,
        agent_name: s.agents?.display_name || s.agents?.profiles?.full_name || "Agent",
        status: s.status || "active",
        amount: Number(s.amount) || 97,
        last_paid: s.last_paid,
        next_due: s.next_due,
      }));

      setSubscriptions(subs);
      setTotalMRR(subs.filter(s => s.status === "active").reduce((sum, s) => sum + s.amount, 0));
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const toggleSubscription = async (sub: Subscription) => {
    const newStatus = sub.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("instagram_subscriptions")
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
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Monthly MRR</p>
              <p className="text-2xl font-bold">${totalMRR.toLocaleString()}</p>
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
              <p className="text-2xl font-bold">{subscriptions.filter(s => s.status === "active").length}</p>
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

        {subscriptions.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <Instagram className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No Instagram automation subscriptions yet</p>
            <p className="text-sm text-muted-foreground mt-1">Subscriptions will appear here when agents sign up for the $97/mo service</p>
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
                      <p className="text-sm text-muted-foreground">${sub.amount}/mo</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={sub.status === "active" ? "default" : "secondary"}
                      className={sub.status === "active" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : ""}
                    >
                      {sub.status}
                    </Badge>
                    {sub.last_paid && (
                      <span className="text-xs text-muted-foreground">
                        Last paid: {new Date(sub.last_paid).toLocaleDateString()}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
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

      {/* Content Generator placeholder */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Image className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">Content Generator</h2>
        </div>
        <p className="text-muted-foreground mb-4">
          Auto-generate Instagram posts from agent achievements and milestones.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <GlassCard className="p-4 border-dashed border-2 border-border hover:border-primary/30 transition-all cursor-pointer text-center">
            <div className="h-12 w-12 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold text-sm">Moody Lifestyle</p>
            <p className="text-xs text-muted-foreground mt-1">Dark background, achievement stat in large green text</p>
          </GlassCard>
          <GlassCard className="p-4 border-dashed border-2 border-border hover:border-primary/30 transition-all cursor-pointer text-center">
            <div className="h-12 w-12 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold text-sm">Hype Post</p>
            <p className="text-xs text-muted-foreground mt-1">Bright, energetic deal announcement</p>
          </GlassCard>
          <GlassCard className="p-4 border-dashed border-2 border-border hover:border-primary/30 transition-all cursor-pointer text-center">
            <div className="h-12 w-12 rounded-lg bg-muted mx-auto mb-3 flex items-center justify-center">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold text-sm">Recruitment Post</p>
            <p className="text-xs text-muted-foreground mt-1">Designed to attract new agents</p>
          </GlassCard>
        </div>
      </GlassCard>
    </div>
  );
}
