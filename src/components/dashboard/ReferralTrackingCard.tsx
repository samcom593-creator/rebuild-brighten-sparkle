import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Users, Trophy, Star, Copy, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useState } from "react";

export function ReferralTrackingCard() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["referral-stats"],
    queryFn: async () => {
      // Count applications by referral source
      const { data: apps, error } = await supabase
        .from("applications")
        .select("id, referral_source_detail, referral_manager_id, license_status, contracted_at")
        .not("contracted_at", "is", null) as any;

      if (error) throw error;

      const referralApps = (apps || []).filter((a: any) => a.referral_manager_id || a.referral_source_detail);
      const directApps = (apps || []).filter((a: any) => !a.referral_manager_id && !a.referral_source_detail);

      // Referral conversion rate
      const referralLicensed = referralApps.filter(a => a.license_status === "licensed").length;
      const directLicensed = directApps.filter(a => a.license_status === "licensed").length;

      const referralRate = referralApps.length > 0 ? Math.round((referralLicensed / referralApps.length) * 100) : 0;
      const directRate = directApps.length > 0 ? Math.round((directLicensed / directApps.length) * 100) : 0;

      // Group by referral source
      const bySource: Record<string, number> = {};
      for (const app of referralApps) {
        const src = app.referral_source_detail || "Unknown Referrer";
        bySource[src] = (bySource[src] || 0) + 1;
      }

      const topReferrers = Object.entries(bySource)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      return {
        totalReferrals: referralApps.length,
        totalDirect: directApps.length,
        referralRate,
        directRate,
        topReferrers,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const referralLink = "https://rebuild-brighten-sparkle.lovable.app/apply?ref=team";

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <Skeleton className="h-6 w-48 mb-4" />
        <Skeleton className="h-24 w-full" />
      </GlassCard>
    );
  }

  if (!data) return null;

  return (
    <GlassCard className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold text-white text-sm sm:text-base">Referral Tracking</h3>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/5 rounded-lg p-3 text-center">
          <p className="text-xl sm:text-2xl font-bold text-emerald-400">{data.totalReferrals}</p>
          <p className="text-[10px] sm:text-xs text-white/40">Referral Hires</p>
          <p className="text-[10px] text-emerald-400/60">{data.referralRate}% licensed</p>
        </div>
        <div className="bg-white/5 rounded-lg p-3 text-center">
          <p className="text-xl sm:text-2xl font-bold text-blue-400">{data.totalDirect}</p>
          <p className="text-[10px] sm:text-xs text-white/40">Direct Hires</p>
          <p className="text-[10px] text-blue-400/60">{data.directRate}% licensed</p>
        </div>
      </div>

      {/* Top referrers */}
      {data.topReferrers.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-white/40 mb-2 flex items-center gap-1">
            <Trophy className="w-3 h-3" /> Top Referrers
          </p>
          <div className="space-y-1">
            {data.topReferrers.map((ref, i) => (
              <div key={ref.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {i === 0 && <Star className="w-3 h-3 text-amber-400" />}
                  <span className="text-xs text-white/70">{ref.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-white/10">{ref.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Copy referral link */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="w-full text-xs border-emerald-500/20 hover:bg-emerald-500/10"
      >
        {copied ? <CheckCircle className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
        {copied ? "Copied!" : "Copy Referral Link"}
      </Button>
    </GlassCard>
  );
}
