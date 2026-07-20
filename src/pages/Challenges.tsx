import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy,
  Zap,
  Crown,
  Flame,
  Diamond,
  UserPlus,
  Sparkles,
  UserCog,
  Building,
  Award,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";

interface ChallengeRow {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  tier: "bronze" | "silver" | "gold" | "platinum";
  icon: string | null;
  reward_credits: number;
  sort_order: number;
}

interface UnlockRow {
  id: number;
  agent_id: string;
  challenge_id: number;
  unlocked_at: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Trophy, Zap, Crown, Flame, Diamond, UserPlus, Sparkles, UserCog, Building, Award, CheckCircle2,
};

const TIER_META: Record<ChallengeRow["tier"], { label: string; tint: string; ring: string }> = {
  bronze: { label: "Bronze", tint: "border-amber-700/40 bg-amber-700/10 text-amber-700 dark:text-amber-400", ring: "ring-amber-700/30" },
  silver: { label: "Silver", tint: "border-slate-400/50 bg-slate-400/10 text-slate-700 dark:text-slate-300", ring: "ring-slate-400/30" },
  gold: { label: "Gold", tint: "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300", ring: "ring-amber-400/30" },
  platinum: { label: "Platinum", tint: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300", ring: "ring-violet-500/30" },
};

/**
 * Challenges — v22 Wave H (2026-06-10)
 *
 * Sam: "Make it like AgentLink. They have Challenge Unlocked badges."
 *
 * 10 seeded challenges across bronze/silver/gold/platinum tiers. Each
 * challenge has a criteria JSONB that the unlock engine evaluates against
 * agent stats. Wallet credits awarded on unlock.
 *
 * Phase 1 (shipped): static catalog view. Agents see what they CAN unlock.
 * Phase 2: nightly cron evaluates criteria against agent stats and inserts
 * apex_challenge_unlocks rows + sends ntfy + Telegram on each unlock.
 */
export default function Challenges() {
  usePageTitle("Challenges · APEX");
  const { user, isAdmin } = useAuth();

  const challenges = useQuery({
    queryKey: ["apex-challenges"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ChallengeRow[]> => {
      const { data, error } = await supabase
        .from("apex_challenges" as any).select("id,slug,title,description,tier,icon,reward_credits,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as ChallengeRow[];
    },
  });

  const myUnlocks = useQuery({
    queryKey: ["apex-challenge-unlocks", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<UnlockRow[]> => {
      const { data, error } = await supabase
        .from("apex_challenge_unlocks" as any).select("challenge_id,unlocked_at")
        .order("unlocked_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as UnlockRow[];
    },
  });

  const unlockedSet = useMemo(
    () => new Set((myUnlocks.data ?? []).map((u) => u.challenge_id)),
    [myUnlocks.data],
  );

  const totalRewards = useMemo(
    () => (challenges.data ?? [])
      .filter((c) => unlockedSet.has(c.id))
      .reduce((s, c) => s + (c.reward_credits ?? 0), 0),
    [challenges.data, unlockedSet],
  );

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Apex · Achievements"
        eyebrowIcon={<Trophy className="h-3 w-3" />}
        title="Challenges"
        subtitle={
          unlockedSet.size > 0
            ? `${unlockedSet.size} of ${challenges.data?.length ?? 0} unlocked · ${totalRewards} credits earned`
            : "Unlock badges by hitting production milestones. Each unlock credits your wallet."
        }
        accent="primary"
      />

      {challenges.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(challenges.data ?? []).map((c) => (
            <ChallengeCard key={c.id} challenge={c} unlocked={unlockedSet.has(c.id)} />
          ))}
        </div>
      )}

      {isAdmin && (
        <Card className="bg-slate-50/50 dark:bg-slate-900/50 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-14 text-slate-500">Admin · How the engine works</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-12 text-slate-500 space-y-1">
            <p>Each challenge has a JSONB criteria block. A nightly cron job evaluates the criteria against agent stats (deals, recruits, monthly rank, etc) and inserts apex_challenge_unlocks rows.</p>
            <p>On unlock: ntfy notification to agent's phone · Telegram message · wallet credit awarded.</p>
            <p>Phase 1 (live): catalog visible. Phase 2 (next): unlock-engine cron.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChallengeCard({ challenge, unlocked }: { challenge: ChallengeRow; unlocked: boolean }) {
  const Icon = ICON_MAP[challenge.icon ?? "Trophy"] ?? Trophy;
  const tier = TIER_META[challenge.tier];

  return (
    <Card
      className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 transition-base ${
        unlocked ? `ring-2 ${tier.ring}` : "opacity-70"
      }`}
    >
      <CardContent className="p-4 flex gap-3">
        <div className={`shrink-0 h-12 w-12 rounded-lg flex items-center justify-center border ${tier.tint}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-14 font-semibold truncate">{challenge.title}</p>
            <Badge variant="outline" className={`text-11 ${tier.tint}`}>
              {tier.label}
            </Badge>
          </div>
          {challenge.description && (
            <p className="text-12 text-slate-500 line-clamp-2">{challenge.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-11">
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
              +{challenge.reward_credits} credits
            </span>
            {unlocked && (
              <Badge className="text-11 bg-emerald-500 text-white border-emerald-500">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Unlocked
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
