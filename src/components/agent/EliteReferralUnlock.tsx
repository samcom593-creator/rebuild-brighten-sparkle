import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Crown, Copy, Share2, Instagram, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

interface Props {
  agentId: string;
}

/** my_referral_status(): the referral-link gate for the signed-in agent. */
export interface ReferralStatus {
  has_agent: boolean;
  ref_slug: string | null;
  production_total: number;
  threshold: number;
  unlocked: boolean;
  remaining: number;
}

const APEX_HOST = "https://apex-financial.org";

function fmt$(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// MP-ONBOARD-ANCHOR-PKG2 (2026-11-12): one gate, one source. The card used to apply its own hard-coded $10,000
// month-to-date sum over native deals while my_referral_status applied Sam's $20,000 policy (08-01) to the frozen
// AgentLink book, so the two disagreed and neither read live production. Both now read my_referral_status(), which
// keeps the policy threshold (system_settings.referral_unlock_threshold) and sums live production
// (mat_production_unified, every agent row of the person).
export function EliteReferralUnlock({ agentId }: Props) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [refSlug, setRefSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("my_referral_status" as never);
      if (error) {
        // An unreadable gate shows nothing, never a made-up "$0, locked".
        console.warn(`[referral] my_referral_status failed: ${error.message}`);
        setStatus(null);
        return;
      }
      const s = data as unknown as ReferralStatus | null;
      if (!s?.has_agent) {
        setStatus(null);
        return;
      }

      let slug = s.ref_slug ?? null;
      if (!slug) {
        const { data: agent } = await supabase
          .from("agents")
          .select("ref_slug, display_name")
          .eq("id", agentId)
          .maybeSingle();
        slug = (agent as { ref_slug?: string })?.ref_slug ?? null;
        const name = (agent as { display_name?: string })?.display_name || "agent";
        if (!slug) {
          const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "agent";
          slug = `${base}-${agentId.slice(0, 6)}`;
          await supabase.from("agents").update({ ref_slug: slug }).eq("id", agentId);
        }
      }

      setStatus({ ...s, production_total: Number(s.production_total) || 0, threshold: Number(s.threshold) || 0 });
      setRefSlug(slug);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  useProductionRealtime(load, 200);

  if (loading || !status || status.threshold <= 0) return null;

  const total     = status.production_total;
  const threshold = status.threshold;
  const unlocked  = status.unlocked === true;
  const link      = refSlug ? `${APEX_HOST}/apply?ref=${refSlug}&elite=1` : "";
  const pct       = Math.min(100, Math.round((total / threshold) * 100));

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
    const text = `Join me at Galaxy Financial — my team is looking for 1-2 sharp, driven people. ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Galaxy Financial — join my team", text, url: link });
      } catch { /* cancelled */ } // empty-catch-allow:user-cancelled
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

  // Locked state: progress toward the policy threshold (server-provided)
  if (!unlocked) {
    return (
      <GlassCard className="p-4 relative overflow-hidden border border-dashed border-muted/50">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-muted/30 flex items-center justify-center shrink-0">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">Elite Referral Link</h3>
              <span className="text-[11px] uppercase tracking-wider bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Locked</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5" data-testid="elite-referral-locked">
              Reach <span className="font-semibold text-foreground">{fmt$(threshold)} in production</span> to unlock your premium referral link & share kit.
            </p>
            <div className="mt-3">
              <div className="h-1.5 w-full bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white dark:bg-card transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[12px] text-muted-foreground mt-1">
                <span>{fmt$(total)} in production</span>
                <span>{fmt$(Math.max(0, status.remaining ?? threshold - total))} to unlock</span>
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
        "bg-white dark:bg-card",
        "border border-amber-500/40 shadow-lg shadow-amber-500/10",
      )}>
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/20 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-5 w-5 text-amber-400" />
            <h3 className="font-bold">Elite Referral Link</h3>
            <span className="text-[11px] uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-semibold">
              Unlocked
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            You're a top producer ({fmt$(total)} in production). Any applicant who joins with this link is credited to you and flagged for priority onboarding.
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
