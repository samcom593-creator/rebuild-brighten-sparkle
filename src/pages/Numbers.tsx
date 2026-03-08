import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Link2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CompactProductionEntry } from "@/components/dashboard/CompactProductionEntry";
import { CompactLeaderboard } from "@/components/dashboard/CompactLeaderboard";
import { AgentRankBadge } from "@/components/dashboard/AgentRankBadge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { useAuth } from "@/hooks/useAuth";

export default function Numbers() {
  const { user, isLoading: authLoading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [noAgent, setNoAgent] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;

    const loadAgentData = async () => {
      try {
        const { data: agent, error } = await supabase
          .from("agents")
          .select("id, profile_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Agent query error:", error);
          setNoAgent(true);
          setLoading(false);
          return;
        }

        if (!agent) {
          setNoAgent(true);
          setLoading(false);
          return;
        }

        setAgentId(agent.id);

        // Fetch profile name
        let name = "Agent";
        if (agent.profile_id) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", agent.profile_id)
            .maybeSingle();
          name = profile?.full_name || "Agent";
        } else {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", user.id)
            .maybeSingle();
          name = profile?.full_name || "Agent";
        }

        setAgentName(name);
      } catch (err) {
        console.error("Error loading agent data:", err);
        setNoAgent(true);
      } finally {
        setLoading(false);
      }
    };

    loadAgentData();
  }, [user, authLoading]);

  if (authLoading || loading) {
    return <SkeletonLoader variant="page" />;
  }

  if (noAgent || !agentId) {
    return (
      <div className="max-w-lg mx-auto flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold">No Agent Record Found</h2>
          <p className="text-sm text-muted-foreground">
            Your account doesn't have an agent profile linked. Please contact your manager to get set up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="space-y-4">
        <div className="text-center py-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
            APEX Daily Numbers
          </h1>
          <div className="flex items-center justify-center gap-2 mt-0.5">
            <p className="text-xs text-muted-foreground">
              Welcome, {agentName}
            </p>
            <AgentRankBadge agentId={agentId} size="sm" />
          </div>
        </div>

        <CompactProductionEntry 
          agentId={agentId} 
          agentName={agentName}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />

        <CompactLeaderboard currentAgentId={agentId} refreshKey={refreshKey} />

        <div className="text-center text-xs text-muted-foreground py-4 flex items-center justify-center gap-2">
          <Link2 className="h-3 w-3" />
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/numbers`);
              toast.success("Link copied to clipboard!");
            }}
            className="underline hover:text-primary transition-colors"
          >
            Share this page with your team
          </button>
        </div>
      </div>
    </div>
  );
}
