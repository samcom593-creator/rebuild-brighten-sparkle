import { useEffect, useMemo, useState } from "react";
import { Crown, Trophy, Users, Target, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * HALL OF FAME — video-fashion scrolling showcase of plaques across three pillars:
 *   1. Personal — single agent production milestones
 *   2. Business — team / manager production milestones
 *   3. Referral — agents who recruited other agents who are now producing
 *
 * Pulls from awards_plaques. Maps milestone_type → category. New milestone types
 * are added via the agent-side admin settings (CATEGORY_MAP below).
 */

type Plaque = {
  id: string;
  agent_id: string;
  milestone_type: string;
  milestone_date: string;
  amount: number | null;
  badge_label: string | null;
  color_hex: string | null;
  image_svg_url: string | null;
  image_png_url: string | null;
  custom_photo_url: string | null;
  awarded_at: string;
  agent_name?: string;
  agent_photo?: string | null;
};

type Category = "personal" | "business" | "referral";

// Initial mapping — update server-side if new milestone types added
const CATEGORY_MAP: Record<string, Category> = {
  single_day_platinum: "personal",
  single_day: "personal",
  single_day_bronze: "personal",
  weekly: "personal",
  monthly: "personal",
  hot_streak: "personal",
  team_weekly: "business",
  team_monthly: "business",
  manager_quarterly: "business",
  agency_milestone: "business",
  recruiter_first_producer: "referral",
  recruiter_team_milestone: "referral",
  referral_chain: "referral",
};

const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Crown; tagline: string; gradient: string }
> = {
  personal: {
    label: "Personal Production",
    icon: Trophy,
    tagline: "Top closers — the agents in the foxhole.",
    gradient: "from-amber-500/20 via-amber-500/0 to-amber-500/0",
  },
  business: {
    label: "Business Production",
    icon: Users,
    tagline: "Team and manager wins — the operators.",
    gradient: "from-sky-500/20 via-sky-500/0 to-sky-500/0",
  },
  referral: {
    label: "Referral Production",
    icon: Target,
    tagline: "Recruiters who built producing teams.",
    gradient: "from-violet-500/20 via-violet-500/0 to-violet-500/0",
  },
};

export default function HallOfFame() {
  const [loading, setLoading] = useState(true);
  const [plaques, setPlaques] = useState<Plaque[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      // Truth-layer fix 2026-04-28: table is `plaque_awards` not `awards_plaques`,
      // and the join goes through agents → profiles (not direct agent_id → profiles).
      const { data, error } = await (supabase
        .from("plaque_awards")
        .select(`
          id, agent_id, milestone_type, milestone_date, amount,
          badge_label, color_hex, image_svg_url, image_png_url,
          custom_photo_url, awarded_at,
          agent:agents!inner(profile:profiles!agents_profile_id_fkey(full_name, avatar_url))
        `)
        .order("awarded_at", { ascending: false })
        .limit(120) as any);
      if (!mounted) return;
      if (error) {
        console.error("HoF load error", error);
        setLoading(false);
        return;
      }
      const flat = (data || []).map((row: any) => ({
        ...row,
        agent_name: row.profiles?.full_name ?? "Unknown",
        agent_photo: row.profiles?.avatar_url ?? null,
      })) as Plaque[];
      setPlaques(flat);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<Category, Plaque[]> = { personal: [], business: [], referral: [] };
    for (const p of plaques) {
      const cat = CATEGORY_MAP[p.milestone_type] ?? "personal";
      out[cat].push(p);
    }
    return out;
  }, [plaques]);

  return (
    <div className="container mx-auto px-4 py-8">
      <PageHeader
        accent="amber"
        eyebrow="Production · Hall of Fame"
        eyebrowIcon={<Crown className="h-3 w-3" />}
        title="Hall of Fame"
        subtitle="Every plaque earned at APEX, displayed for the world. Personal closers, team builders, and the recruiters who built producing teams — all part of the empire."
      />

      <Tabs defaultValue="personal" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-3 mb-8">
          {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <TabsTrigger key={cat} value={cat} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {meta.label}
                <Badge variant="secondary" className="ml-1">
                  {grouped[cat].length}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.keys(CATEGORY_META) as Category[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          const items = grouped[cat];
          return (
            <TabsContent key={cat} value={cat} className="space-y-4">
              <div className={cn("rounded-2xl bg-gradient-to-b p-1", meta.gradient)}>
                <p className="text-sm text-muted-foreground italic px-4 py-2">{meta.tagline}</p>
              </div>
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && items.length === 0 && (
                <p className="text-center text-muted-foreground py-12">
                  No plaques in this category yet — be the first.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map((p) => (
                  <PlaqueCard key={p.id} plaque={p} />
                ))}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function PlaqueCard({ plaque }: { plaque: Plaque }) {
  const img = plaque.image_png_url || plaque.image_svg_url || plaque.custom_photo_url;
  return (
    <GlassCard className="overflow-hidden group cursor-pointer transition-transform hover:scale-[1.02]">
      <div className="aspect-square relative bg-black/20">
        {img ? (
          <img
            src={img}
            alt={plaque.badge_label || plaque.milestone_type}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Trophy className="h-12 w-12" />
          </div>
        )}
        {plaque.amount && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white text-sm px-2 py-1 rounded">
            ${plaque.amount.toLocaleString()}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-2">
          {plaque.agent_photo ? (
            <img
              src={plaque.agent_photo}
              alt=""
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-muted" />
          )}
          <p className="font-semibold text-sm truncate">{plaque.agent_name}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {plaque.badge_label || plaque.milestone_type}
        </p>
        <p className="text-xs text-muted-foreground">
          {plaque.milestone_date && format(new Date(plaque.milestone_date), "MMM d, yyyy")}
        </p>
      </div>
    </GlassCard>
  );
}
