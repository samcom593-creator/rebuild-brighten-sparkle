import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * MP-342: the Slack and Discord links, somewhere a new hire can actually find
 * them.
 *
 * New hires reported they could not find the Discord. Both invites are live and
 * healthy — the Discord invite is permanent (Apex Financial Empire, 26 members)
 * and the Slack invite loads a working join page in a real browser. The links
 * were simply not reachable from anywhere in the product: they existed only
 * inside one onboarding email, and the Getting Started checklist had a "Joined
 * team Slack" task with NO link attached to it. Lose the email and the task is
 * unachievable.
 *
 * Renders only while onboarding is still in progress, so it disappears once
 * someone is established rather than becoming permanent dashboard clutter.
 */
const JOINED_STAGES = new Set(["live", "producing", "evaluated"]);

export function JoinYourTeam() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["join-your-team", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [settings, agent] = await Promise.all([
        supabase.from("system_settings").select("key,value")
          .in("key", ["discord_invite_url", "slack_community_invite_url"]),
        supabase.from("agents").select("onboarding_stage").eq("user_id", user!.id).limit(1),
      ]);
      const map = new Map((settings.data ?? []).map((r) => [r.key as string, String(r.value ?? "").trim()]));
      return {
        discord: map.get("discord_invite_url") || "",
        slack: map.get("slack_community_invite_url") || "",
        stage: String((agent.data ?? [])[0]?.onboarding_stage ?? ""),
        isAgent: (agent.data ?? []).length > 0,
      };
    },
  });

  // Nothing to offer, not an agent, or already settled in: render nothing.
  if (!data || !data.isAgent) return null;
  if (JOINED_STAGES.has(data.stage)) return null;
  if (!data.discord && !data.slack) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Join your team</p>
          <p className="text-[11px] text-muted-foreground">
            Slack is the team hub. Discord is where deals and wins get posted. Join both.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {data.slack && (
            <Button asChild size="sm">
              {/* Invite links leave the app, so they are real anchors, not router links. */}
              <a href={data.slack} target="_blank" rel="noopener noreferrer">
                <Users className="mr-1.5 h-4 w-4" />Join Slack
              </a>
            </Button>
          )}
          {data.discord && (
            <Button asChild size="sm" variant="outline">
              <a href={data.discord} target="_blank" rel="noopener noreferrer">
                <MessageSquare className="mr-1.5 h-4 w-4" />Join Discord
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
