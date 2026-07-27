-- Fix mark_phone_bad(), which failed every call with:
--   column reference "phone_bad_at" is ambiguous
-- The SQL implementation avoids PL/pgSQL OUT-parameter name collisions while
-- preserving the existing signature consumed by the Applications dashboard.
CREATE OR REPLACE FUNCTION public.mark_phone_bad(
  p_application_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(id uuid, phone_bad_at timestamptz, phone_bad_reason text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.applications AS a
     SET phone_bad_at = COALESCE(a.phone_bad_at, now()),
         phone_bad_reason = COALESCE(p_reason, a.phone_bad_reason)
   WHERE a.id = p_application_id
   RETURNING a.id, a.phone_bad_at, a.phone_bad_reason;
$$;

REVOKE ALL ON FUNCTION public.mark_phone_bad(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_phone_bad(uuid, text) TO authenticated;
