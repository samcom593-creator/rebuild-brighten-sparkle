-- The aggregate must only be reachable through the role-gated wrapper below.
REVOKE ALL ON FUNCTION public.apex_home_dashboard(text, date, date) FROM PUBLIC, anon, authenticated;

-- The live home is an executive/agency surface. Expose it through a narrow
-- authenticated wrapper that proves the caller is an APEX administrator before
-- invoking the broad aggregate.
DROP FUNCTION IF EXISTS public.apex_admin_home_dashboard();

CREATE OR REPLACE FUNCTION public.apex_admin_home_dashboard(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.apex_is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING errcode = '42501';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL)
     OR (p_start IS NOT NULL AND (p_end <= p_start OR p_end - p_start > 3660)) THEN
    RAISE EXCEPTION 'Invalid dashboard date range' USING errcode = '22023';
  END IF;
  RETURN public.apex_home_dashboard('agency', p_start, p_end);
END;
$$;

REVOKE ALL ON FUNCTION public.apex_admin_home_dashboard(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apex_admin_home_dashboard(date, date) TO authenticated;
