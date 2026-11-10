import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Users } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { looseSupabase } from "@/lib/looseSupabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * MP-342: the Slack link, somewhere a new hire can actually find it.
 *
 * New hires reported they could not find the community. The invite existed only
 * inside one onboarding email, and the Getting Started checklist had a "Joined
 * team Slack" task with NO link attached to it.
 *
 * WP7 (2026-11-10): Discord is retired (team moved to Slack 2026-10-05), so the
 * Discord invite is no longer read here. Once the agent marks Slack as joined
 * (their own record only, via mark_slack_joined) the card disappears.
 *
 * Renders only while onboarding is still in progress, so it disappears once
 * someone is established rather than becoming permanent dashboard clutter.
 */
const JOINED_STAGES = new Set(["live", "producing", "evaluated"]);

interface AgentSlackRow {
  onboarding_stage: string | null;
  slack_joined_at: string | null;
}

export function JoinYourTeam() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const queryKey = ["join-your-team", user?.id] as const;

  const { data } = useQuery({
    queryKey,
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [settings, agent] = await Promise.all([
        supabase.from("system_settings").select("key,value").eq("key", "slack_community_invite_url"),
        // slack_joined_at is newer than the generated types.
        looseSupabase
          .from<AgentSlackRow>("agents")
          .select("onboarding_stage, slack_joined_at")
          .eq("user_id", user!.id)
          .limit(1),
      ]);
      const slack = String((settings.data ?? [])[0]?.value ?? "").trim();
      const row = (agent.data ?? [])[0] ?? null;
      return {
        slack,
        stage: String(row?.onboarding_stage ?? ""),
        joined: Boolean(row?.slack_joined_at),
        isAgent: Boolean(row),
      };
    },
  });

  // Nothing to offer, not an agent, already joined, or already settled in: render nothing.
  if (!data || !data.isAgent || data.joined) return null;
  if (JOINED_STAGES.has(data.stage)) return null;
  if (!data.slack) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Join your team</p>
          <p className="text-[12px] text-muted-foreground">
            Slack is the team hub: questions, wins, contracting support and the daily huddle.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild size="sm">
            {/* Invite links leave the app, so they are real anchors, not router links. */}
            <a href={data.slack} target="_blank" rel="noopener noreferrer">
              <Users className="mr-1.5 h-4 w-4" />Join Slack
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await looseSupabase.rpc("mark_slack_joined");
              setBusy(false);
              if (error) {
                toast.error(`Could not save that: ${error.message}`);
                return;
              }
              toast.success("Marked as joined. See you in Slack.");
              void queryClient.invalidateQueries({ queryKey });
            }}
          >
            <Check className="mr-1.5 h-4 w-4" />I've joined
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
