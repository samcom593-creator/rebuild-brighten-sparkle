-- RPC to expose cron jobs + their latest run status to admins
CREATE OR REPLACE FUNCTION public.get_cron_jobs_with_status()
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  command text,
  last_run timestamptz,
  last_status text,
  last_error text,
  runs_24h integer,
  errors_24h integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  RETURN QUERY
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    LEFT(j.command::text, 200) AS command,
    latest.last_run,
    latest.last_status,
    latest.last_error,
    COALESCE(stats.runs_24h, 0)::integer,
    COALESCE(stats.errors_24h, 0)::integer
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT triggered_at AS last_run, status AS last_status, error AS last_error
    FROM public.automation_run_log
    WHERE job_name = j.jobname
    ORDER BY triggered_at DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS runs_24h,
      COUNT(*) FILTER (WHERE status = 'error') AS errors_24h
    FROM public.automation_run_log
    WHERE job_name = j.jobname
      AND triggered_at > now() - interval '24 hours'
  ) stats ON true
  ORDER BY j.jobname;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cron_jobs_with_status() TO authenticated;