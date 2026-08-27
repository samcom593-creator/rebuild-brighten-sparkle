import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * PL-047 — Inline prompt that surfaces on agent-facing surfaces
 * (Client Pipeline, Book of Business, agent dashboard) when the
 * signed-in user can't pull AgentLink data. Shows a one-tap
 * "Sync your AgentLink" CTA that deep-links to the AgentLinkSync
 * page. Auto-hides for users who are already connected (have
 * agents.insuracloud_api_token OR agents.insuracloud_user_id set)
 * and for admins who use the agency-wide cookie path.
 */
interface Props {
  /** Override the auto-detection — pass true to force-show. */
  force?: boolean;
  /** Optional custom copy. */
  message?: string;
  /** Hide when the user isn't an agent at all. */
  hideForNonAgents?: boolean;
  className?: string;
}

export function AgentLinkConnectionPrompt({ force, message, hideForNonAgents = true, className }: Props) {
  const { user, isAdmin } = useAuth();
  const [status, setStatus] = useState<"loading" | "connected" | "not_connected" | "not_an_agent" | "no_user">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) { setStatus("no_user"); return; }
      // Admins use the agency-wide cookie at /dashboard/agent-link-sync,
      // so we never nag them on agent-facing surfaces.
      if (isAdmin && !force) { setStatus("connected"); return; }
      const { data: agent } = await supabase
        .from("agents")
        .select("id, insuracloud_user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (!agent) { setStatus("not_an_agent"); return; }
      // insuracloud_api_token is column-restricted (audit 2026-08-27); the owner
      // reads their own via the RPC. Presence is all this prompt needs.
      const { data: ownToken } = await supabase.rpc("get_my_insuracloud_token" as never);
      const hasToken = !!ownToken;
      const hasUserId = !!agent.insuracloud_user_id;
      setStatus(hasToken || hasUserId ? "connected" : "not_connected");
    })();
    return () => { cancelled = true; };
  }, [user?.id, isAdmin, force]);

  if (status === "loading") {
    return (
      <GlassCard className={cn("p-3 flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking AgentLink connection…
      </GlassCard>
    );
  }
  if (status === "connected" && !force) return null;
  if (status === "no_user") return null;
  if (status === "not_an_agent" && hideForNonAgents) return null;

  return (
    <GlassCard className={cn("p-4 border-info/30 bg-info/[0.06]", className)}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="rounded-lg p-2 bg-info/15 border border-info/30 shrink-0">
            <AlertCircle className="h-4 w-4 text-info" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">
              Your AgentLink isn't connected yet
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {message ?? "Connect AgentLink to see your full policy book, commissions, chargebacks and client details — synced live every minute."}
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0 w-full sm:w-auto">
          <Link to="/dashboard/agent-link-sync">
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Sync your AgentLink
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Link>
        </Button>
      </div>
    </GlassCard>
  );
}
