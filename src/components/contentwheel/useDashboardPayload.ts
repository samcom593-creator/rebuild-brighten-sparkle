import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CwQuotaDay {
  day: string;
  posts: number;
  hit_quota: boolean;
}

export interface CwDashboardPayload {
  posts_today: { posts_today: number; quota: number; quota_met: boolean } | null;
  kpi_7d: { views_7d: number; followers_7d: number; vf_pct: number; posts_7d: number } | null;
  streak: CwQuotaDay[];
  outliers: Array<{
    id: string;
    post_id: string;
    multiple: number;
    baseline_avg: number;
    iterations_logged: number;
    platform: string;
    post_url: string | null;
    views: number;
    idea_title: string | null;
  }>;
  pipeline: {
    to_contact: number;
    contacted: number;
    responded: number;
    booked: number;
    contracted: number;
    dead: number;
    total: number;
  } | null;
  shot_vs_posted: {
    shot_pool: number;
    posted_pool: number;
    ratio: number;
    bottom_of_barrel_warning: boolean;
  } | null;
  audience_split: {
    icp_count: number;
    nurture_count: number;
    total: number;
    icp_pct: number;
  } | null;
  active_challenge: {
    id: string;
    goal: string;
    deadline: string;
    declared_publicly_at: string | null;
    logs_count: number;
    days_left: number;
  } | null;
  generated_at: string;
}

/**
 * Fetches the ContentWheel dashboard snapshot in a single round-trip via the
 * cw_dashboard_payload() RPC. Admin-only — RLS enforces it server-side.
 *
 * Refresh cadence: 60s (cheap, single RPC, KPIs don't change second-to-second).
 */
export function useDashboardPayload() {
  return useQuery({
    queryKey: ["contentwheel", "dashboard"],
    queryFn: async (): Promise<CwDashboardPayload> => {
      const { data, error } = await supabase.rpc("cw_dashboard_payload");
      if (error) throw error;
      return data as unknown as CwDashboardPayload;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
