-- Creates an admin-callable RPC to write discord_webhook_url + service_role_key
-- into system_settings without needing direct table access.
-- The function is SECURITY DEFINER so it runs as postgres (bypasses RLS).

CREATE OR REPLACE FUNCTION public.admin_configure_integration(
  p_key   text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only allow admins (profiles.role = 'admin' or supabase_admin)
  SELECT role INTO v_role
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin' AND current_role NOT IN ('service_role','supabase_admin','postgres') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO public.system_settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  RETURN jsonb_build_object('ok', true, 'key', p_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_configure_integration(text, text) TO authenticated;
