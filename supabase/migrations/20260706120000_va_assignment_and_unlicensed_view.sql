-- VA assignment columns on applications + unlicensed all-view + assign RPC
-- Ships the fields needed to route unlicensed applicants to VAs and track next-touch SLAs.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS assigned_va_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS assigned_va_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_touch_by timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_assigned_va_id
  ON public.applications(assigned_va_id)
  WHERE assigned_va_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_next_touch_by
  ON public.applications(next_touch_by)
  WHERE next_touch_by IS NOT NULL AND terminated_at IS NULL;

CREATE OR REPLACE VIEW public.v_unlicensed_all AS
SELECT
  a.id,
  a.first_name,
  a.last_name,
  a.email,
  a.phone,
  a.state,
  a.license_status::text  AS license_status,
  a.license_progress::text AS license_progress,
  a.created_at,
  a.last_contacted_at,
  a.next_action_due_at,
  a.assigned_va_id,
  a.assigned_va_at,
  a.next_touch_by,
  EXTRACT(day FROM (now() - COALESCE(a.last_contacted_at, a.created_at)))::int AS days_since_touch,
  EXTRACT(day FROM (now() - a.created_at))::int AS days_since_applied,
  va.email AS assigned_va_email
FROM public.applications a
LEFT JOIN auth.users va ON va.id = a.assigned_va_id
WHERE a.terminated_at IS NULL
  AND (a.license_status IS NULL OR a.license_status::text IN ('unlicensed', 'pending'))
ORDER BY days_since_touch DESC;

CREATE OR REPLACE FUNCTION public.assign_va_to_application(
  p_application_id uuid,
  p_va_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.applications
     SET assigned_va_id = p_va_user_id,
         assigned_va_at = now()
   WHERE id = p_application_id;
END;
$$;

GRANT SELECT ON public.v_unlicensed_all TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_va_to_application(uuid, uuid) TO authenticated;
