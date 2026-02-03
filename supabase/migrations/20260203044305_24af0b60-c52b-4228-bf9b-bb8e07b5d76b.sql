-- Create a database function to aggregate production stats per agent for a date range
-- This offloads heavy aggregation from the client to the database
CREATE OR REPLACE FUNCTION public.get_agent_production_stats(
  start_date date,
  end_date date
)
RETURNS TABLE (
  agent_id uuid,
  total_alp numeric,
  total_deals integer,
  total_presentations integer,
  last_activity_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    dp.agent_id,
    COALESCE(SUM(dp.aop), 0) as total_alp,
    COALESCE(SUM(dp.deals_closed), 0)::integer as total_deals,
    COALESCE(SUM(dp.presentations), 0)::integer as total_presentations,
    MAX(dp.production_date) as last_activity_date
  FROM daily_production dp
  WHERE dp.production_date >= start_date 
    AND dp.production_date <= end_date
  GROUP BY dp.agent_id;
$$;