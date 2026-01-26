import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startOfWeek, endOfWeek, format } from "date-fns";

export interface WeeklyBadge {
  id: string;
  name: string;
  description: string;
  icon: "trophy" | "target" | "zap" | "flame" | "crown" | "star";
  color: "amber" | "emerald" | "violet" | "rose" | "primary" | "cyan";
  weekStart: string;
  value: number;
}

interface AgentStats {
  agentId: string;
  agentName: string;
  totalALP: number;
  totalDeals: number;
  totalPresentations: number;
  totalReferrals: number;
  closingRate: number;
}

export function useWeeklyBadges(agentId: string | null) {
  const [badges, setBadges] = useState<WeeklyBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }
    
    fetchWeeklyBadges();
  }, [agentId]);

  const fetchWeeklyBadges = async () => {
    if (!agentId) return;
    
    try {
      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 }); // Sunday
      const weekStartStr = format(weekStart, "yyyy-MM-dd");
      const weekEndStr = format(weekEnd, "yyyy-MM-dd");

      // Fetch all production data for this week
      const { data: allProduction, error } = await supabase
        .from("daily_production")
        .select(`
          agent_id,
          aop,
          deals_closed,
          presentations,
          referrals_caught,
          closing_rate
        `)
        .gte("production_date", weekStartStr)
        .lte("production_date", weekEndStr);

      if (error) throw error;

      // Get agent profiles for names
      const agentIds = [...new Set(allProduction?.map(p => p.agent_id) || [])];
      
      const { data: agents } = await supabase
        .from("agents")
        .select("id, profile_id, profiles:profile_id(full_name)")
        .in("id", agentIds);

      const agentNameMap = new Map<string, string>();
      agents?.forEach(a => {
        const profileData = a.profiles as any;
        agentNameMap.set(a.id, profileData?.full_name || "Agent");
      });

      // Aggregate stats per agent
      const agentStatsMap = new Map<string, AgentStats>();
      
      allProduction?.forEach(p => {
        const existing = agentStatsMap.get(p.agent_id) || {
          agentId: p.agent_id,
          agentName: agentNameMap.get(p.agent_id) || "Agent",
          totalALP: 0,
          totalDeals: 0,
          totalPresentations: 0,
          totalReferrals: 0,
          closingRate: 0,
        };
        
        existing.totalALP += Number(p.aop) || 0;
        existing.totalDeals += Number(p.deals_closed) || 0;
        existing.totalPresentations += Number(p.presentations) || 0;
        existing.totalReferrals += Number(p.referrals_caught) || 0;
        
        agentStatsMap.set(p.agent_id, existing);
      });

      // Calculate closing rates
      agentStatsMap.forEach((stats, id) => {
        if (stats.totalPresentations > 0) {
          stats.closingRate = (stats.totalDeals / stats.totalPresentations) * 100;
        }
        agentStatsMap.set(id, stats);
      });

      const allStats = Array.from(agentStatsMap.values());
      const myStats = agentStatsMap.get(agentId);
      
      if (!myStats || allStats.length === 0) {
        setBadges([]);
        setLoading(false);
        return;
      }

      const earnedBadges: WeeklyBadge[] = [];

      // Check each badge category
      // 1. ALP Champion - Highest ALP
      const topALP = allStats.reduce((max, s) => s.totalALP > max.totalALP ? s : max, allStats[0]);
      if (topALP.agentId === agentId && topALP.totalALP > 0) {
        earnedBadges.push({
          id: "alp-champion",
          name: "ALP Champion",
          description: `Top ALP this week: $${topALP.totalALP.toLocaleString()}`,
          icon: "crown",
          color: "amber",
          weekStart: weekStartStr,
          value: topALP.totalALP,
        });
      }

      // 2. Top Closer - Highest closing rate (min 3 presentations)
      const qualifiedClosers = allStats.filter(s => s.totalPresentations >= 3);
      if (qualifiedClosers.length > 0) {
        const topCloser = qualifiedClosers.reduce((max, s) => 
          s.closingRate > max.closingRate ? s : max, qualifiedClosers[0]);
        if (topCloser.agentId === agentId) {
          earnedBadges.push({
            id: "top-closer",
            name: "Top Closer",
            description: `Best close rate: ${topCloser.closingRate.toFixed(0)}%`,
            icon: "target",
            color: "emerald",
            weekStart: weekStartStr,
            value: topCloser.closingRate,
          });
        }
      }

      // 3. Deal Machine - Most deals closed
      const topDeals = allStats.reduce((max, s) => s.totalDeals > max.totalDeals ? s : max, allStats[0]);
      if (topDeals.agentId === agentId && topDeals.totalDeals > 0) {
        earnedBadges.push({
          id: "deal-machine",
          name: "Deal Machine",
          description: `Most deals: ${topDeals.totalDeals} closed`,
          icon: "zap",
          color: "primary",
          weekStart: weekStartStr,
          value: topDeals.totalDeals,
        });
      }

      // 4. Referral King - Most referrals caught
      const topReferrals = allStats.reduce((max, s) => 
        s.totalReferrals > max.totalReferrals ? s : max, allStats[0]);
      if (topReferrals.agentId === agentId && topReferrals.totalReferrals > 0) {
        earnedBadges.push({
          id: "referral-king",
          name: "Referral King",
          description: `Most referrals: ${topReferrals.totalReferrals} caught`,
          icon: "star",
          color: "violet",
          weekStart: weekStartStr,
          value: topReferrals.totalReferrals,
        });
      }

      // 5. Presentation Pro - Most presentations
      const topPresentations = allStats.reduce((max, s) => 
        s.totalPresentations > max.totalPresentations ? s : max, allStats[0]);
      if (topPresentations.agentId === agentId && topPresentations.totalPresentations > 0) {
        earnedBadges.push({
          id: "presentation-pro",
          name: "Presentation Pro",
          description: `Most presentations: ${topPresentations.totalPresentations}`,
          icon: "flame",
          color: "rose",
          weekStart: weekStartStr,
          value: topPresentations.totalPresentations,
        });
      }

      // 6. Rising Star - Top 3 in multiple categories (2+)
      let topCategories = 0;
      const sortedByALP = [...allStats].sort((a, b) => b.totalALP - a.totalALP);
      const sortedByDeals = [...allStats].sort((a, b) => b.totalDeals - a.totalDeals);
      const sortedByRate = [...qualifiedClosers].sort((a, b) => b.closingRate - a.closingRate);
      
      if (sortedByALP.slice(0, 3).some(s => s.agentId === agentId)) topCategories++;
      if (sortedByDeals.slice(0, 3).some(s => s.agentId === agentId)) topCategories++;
      if (sortedByRate.slice(0, 3).some(s => s.agentId === agentId)) topCategories++;
      
      if (topCategories >= 2) {
        earnedBadges.push({
          id: "rising-star",
          name: "Rising Star",
          description: `Top 3 in ${topCategories} categories`,
          icon: "trophy",
          color: "cyan",
          weekStart: weekStartStr,
          value: topCategories,
        });
      }

      setBadges(earnedBadges);
    } catch (error) {
      console.error("Error fetching weekly badges:", error);
    } finally {
      setLoading(false);
    }
  };

  return { badges, loading, refetch: fetchWeeklyBadges };
}
