-- Set Discord webhook URL in system_settings so the live edge function starts firing
-- This bypasses RLS because migrations run as postgres (superuser)

INSERT INTO public.system_settings (key, value)
VALUES (
  'discord_webhook_url',
  'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T'
)
ON CONFLICT (key) DO UPDATE SET value = excluded.value
WHERE public.system_settings.value = '' OR public.system_settings.value IS NULL;

-- Also ensure the admin_configure_integration RPC exists
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
