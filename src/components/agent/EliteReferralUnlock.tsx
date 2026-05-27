import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Copy, Share2, Instagram, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getMetricBounds, sumAnnualPremium } from "@/lib/metricTruth";
import { DEAL_TRUTH_STATUS_FILTER } from "@/lib/dealTruth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

interface Props {
  agentId: string;
  /** MTD ALP threshold to unlock the elite link (default $10K). */
  threshold?: number;
}

const APEX_HOST = "https://apex-financial.org";

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function EliteReferralUnlock({ agentId, threshold = 10_000 }: Props) {
  const [mtd, setMtd] = useState(0);
  const [refSlug, setRefSlug] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("agent");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const monthBounds = getMetricBounds("month");
      const { data: deals } = await supabase
        .from("deals")
        .select("annual_premium")
        .eq("agent_id", agentId)
        .gte("posted_at", monthBounds.startIso)
        .lt("posted_at", monthBounds.endIso)
        .in("status", DEAL_TRUTH_STATUS_FILTER);
      const sum = sumAnnualPremium((deals ?? []) as Array<{ annual_premium?: number | null }>);

      const { data: agent } = await supabase
        .from("agents")
        .select("ref_slug, display_name")
        .eq("id", agentId)
        .maybeSingle();

      let slug = (agent as { ref_slug?: string })?.ref_slug ?? null;
      const name = (agent as { display_name?: string })?.display_name || "agent";
      if (!slug) {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "agent";
        slug = `${base}-${agentId.slice(0, 6)}`;
        await supabase.from("agents").update({ ref_slug: slug }).eq("id", agentId);
      }

      setMtd(sum);
      setRefSlug(slug);
      setDisplayName(name);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(load, 200);

  if (loading) return null;

  const unlocked = mtd >= threshold;
  const link     = refSlug ? `${APEX_HOST}/apply?ref=${refSlug}&elite=1` : "";
  const pct      = Math.min(100, Math.round((mtd / threshold) * 100));

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Elite referral link copied!");
    } catch {
      toast.error(`Copy failed. Your link: ${link}`);
    }
  };

  const shareNative = async () => {
    if (!link) return;
    const text = `Join me at APEX Financial — my team is looking for 1-2 sharp, driven people. ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "APEX Financial — join my team", text, url: link });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      toast.success("Share text copied!");
    }
  };

  const shareIG = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copied — paste into your Instagram bio");
    window.open("https://instagram.com/accounts/edit/", "_blank", "noopener");
  };

  // Locked state — show progress toward $10K
  if (!unlocked) {
    return (
      <GlassCard className="p-4 relative overflow-hidden border border-dashed border-muted/50">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/30 flex items-center justify-center shrink-0">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">Elite Referral Link</h3>
              <span className="text-[10px] uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Locked</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hit <span className="font-semibold text-foreground">$10K MTD</span> to unlock your premium referral link & share kit.
            </p>
            <div className="mt-3">
              <div className="h-1.5 w-full bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-amber-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                <span>{fmt$(mtd)} MTD</span>
                <span>{fmt$(Math.max(0, threshold - mtd))} to unlock</span>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    );
  }

  // Unlocked — elite styling
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassCard className={cn(
        "p-5 relative overflow-hidden",
        "bg-gradient-to-br from-amber-500/10 via-primary/10 to-violet-500/10",
        "border border-amber-500/40 shadow-lg shadow-amber-500/10",
      )}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/20 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-5 w-5 text-amber-400" />
            <h3 className="font-bold">Elite Referral Link</h3>
            <span className="text-[10px] uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold">
              Unlocked
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            You're a top producer ({fmt$(mtd)} MTD). Any applicant who joins with this link is credited to you and flagged for priority onboarding.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <code className="flex-1 text-xs bg-background/60 border border-amber-500/20 p-2 rounded-md truncate font-mono">
              {link}
            </code>
            <Button size="sm" onClick={copy} className="shrink-0 gap-1">
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={shareNative} className="gap-1.5 flex-1">
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
            <Button size="sm" variant="outline" onClick={shareIG} className="gap-1.5 flex-1">
              <Instagram className="h-3.5 w-3.5" /> Add to IG Bio
            </Button>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
