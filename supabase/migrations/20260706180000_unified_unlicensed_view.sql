-- PL-MP249 (2026-07-06): Unify unlicensed queue — apps + aged_leads in one view.
--
-- Sam directive: "It should be bringing in everyone from my Excel sheet. Two
-- different side applications are both crappy at best. It needs to be working
-- fully as we able to mark where they're at inside the process and the links
-- if needed, etcetera."
--
-- Problem: 899 aged_leads (Excel imports) never surface in /admin/unlicensed-all
-- because v_unlicensed_all only queries applications. Sam expects everyone he
-- imported to be workable there.
--
-- Fix:
--   1. Extend aged_leads with assign/next-touch columns to match applications shape
--   2. Rebuild v_unlicensed_all as UNION applications + aged_leads with a
--      `source` column ('applied' | 'aged_lead') and stable `id` per row
--   3. Add dispatch RPCs so the UI can call one function regardless of source:
--        - unified_assign_va(uuid, uuid, text)  — source-aware
--        - unified_mark_contacted(uuid, text)
--        - unified_set_license_progress(uuid, text, text)
--   4. Add promote_aged_lead_to_application(uuid) for one-click conversion

-- ---- 1. aged_leads shape parity ----
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS assigned_va_id       uuid;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS assigned_va_at       timestamptz;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS next_touch_by        timestamptz;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS next_action_due_at   timestamptz;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS license_progress     text;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS phone_bad_at         timestamptz;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS state                text;
ALTER TABLE aged_leads ADD COLUMN IF NOT EXISTS couldnt_reach_email_sent_at timestamptz;

-- ---- 2. Unified view ----
DROP VIEW IF EXISTS public.v_unlicensed_all CASCADE;
CREATE VIEW public.v_unlicensed_all AS
SELECT
  a.id::text                                    AS id,
  'applied'::text                               AS source,
  a.first_name,
  a.last_name,
  a.email,
  a.phone,
  a.state,
  a.license_status::text                        AS license_status,
  a.license_progress::text                      AS license_progress,
  a.created_at,
  a.last_contacted_at,
  a.next_action_due_at,
  a.assigned_va_id,
  a.assigned_va_at,
  a.next_touch_by,
  a.phone_bad_at,
  EXTRACT(day FROM now() - COALESCE(a.last_contacted_at, a.created_at))::integer AS days_since_touch,
  EXTRACT(day FROM now() - a.created_at)::integer AS days_since_applied,
  va.email AS assigned_va_email
FROM applications a
LEFT JOIN auth.users va ON va.id = a.assigned_va_id
WHERE a.terminated_at IS NULL
  AND (a.license_status IS NULL
       OR a.license_status::text = ANY (ARRAY['unlicensed'::text,'pending'::text]))

UNION ALL

SELECT
  al.id::text                                   AS id,
  'aged_lead'::text                             AS source,
  al.first_name,
  al.last_name,
  al.email,
  al.phone,
  al.state,
  COALESCE(al.license_status::text, 'unlicensed') AS license_status,
  al.license_progress                           AS license_progress,
  al.created_at,
  al.last_contacted_at,
  al.next_action_due_at,
  al.assigned_va_id,
  al.assigned_va_at,
  al.next_touch_by,
  al.phone_bad_at,
  EXTRACT(day FROM now() - COALESCE(al.last_contacted_at, al.created_at))::integer AS days_since_touch,
  EXTRACT(day FROM now() - al.created_at)::integer AS days_since_applied,
  vau.email AS assigned_va_email
FROM aged_leads al
LEFT JOIN auth.users vau ON vau.id = al.assigned_va_id
WHERE al.dnc IS NOT TRUE
  AND (al.license_status IS NULL OR al.license_status::text = ANY (ARRAY['unlicensed','pending','licensed']))
  AND (al.status IS NULL OR al.status NOT IN ('hired','terminated','promoted_to_application'));

GRANT SELECT ON public.v_unlicensed_all TO authenticated;

-- ---- 3. Dispatch RPCs ----
CREATE OR REPLACE FUNCTION public.unified_assign_va(
  p_id uuid, p_va_user_id uuid, p_source text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads
       SET assigned_va_id = p_va_user_id,
           assigned_va_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE applications
       SET assigned_va_id = p_va_user_id,
           assigned_va_at = now()
     WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unified_assign_va(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unified_mark_contacted(
  p_id uuid, p_source text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads
       SET last_contacted_at = now(),
           contacted_at = COALESCE(contacted_at, now())
     WHERE id = p_id;
  ELSE
    UPDATE applications
       SET last_contacted_at = now(),
           contacted_at = COALESCE(contacted_at, now())
     WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unified_mark_contacted(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unified_set_license_progress(
  p_id uuid, p_progress text, p_source text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads SET license_progress = p_progress WHERE id = p_id;
  ELSE
    UPDATE applications SET license_progress = p_progress::license_progress WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unified_set_license_progress(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unified_mark_phone_bad(
  p_id uuid, p_source text, p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads
       SET phone_bad_at = COALESCE(phone_bad_at, now())
     WHERE id = p_id;
  ELSE
    UPDATE applications
       SET phone_bad_at = COALESCE(phone_bad_at, now()),
           phone_bad_reason = COALESCE(p_reason, phone_bad_reason)
     WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unified_mark_phone_bad(uuid, text, text) TO authenticated;

-- ---- 4. Promote aged_lead → application (one-click conversion) ----
CREATE OR REPLACE FUNCTION public.promote_aged_lead_to_application(p_aged_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_al aged_leads%ROWTYPE;
  v_new_app_id uuid;
BEGIN
  SELECT * INTO v_al FROM aged_leads WHERE id = p_aged_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'aged_lead % not found', p_aged_id; END IF;

  -- Idempotency: if we already promoted, skip
  IF v_al.status = 'promoted_to_application' THEN
    RETURN v_al.id; -- no-op
  END IF;

  INSERT INTO applications (
    first_name, last_name, email, phone, state, notes,
    license_status, license_progress, instagram_handle,
    referral_source, assigned_agent_id, assigned_va_id,
    last_contacted_at
  ) VALUES (
    v_al.first_name, v_al.last_name, v_al.email, v_al.phone, v_al.state,
    COALESCE(v_al.notes, v_al.about_me),
    'unlicensed'::license_status,
    COALESCE(v_al.license_progress, 'unlicensed')::license_progress,
    v_al.instagram_handle,
    'aged_lead_excel_import',
    v_al.assigned_agent_id, v_al.assigned_va_id,
    v_al.last_contacted_at
  ) RETURNING id INTO v_new_app_id;

  UPDATE aged_leads SET status = 'promoted_to_application', processed_at = now()
   WHERE id = p_aged_id;

  RETURN v_new_app_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.promote_aged_lead_to_application(uuid) TO authenticated;
