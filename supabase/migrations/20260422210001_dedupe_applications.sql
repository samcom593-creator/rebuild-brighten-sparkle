-- Persist the dedupe helper so a rebuild doesn't lose it. The function
-- was already run via bot-sql (merged 9 groups, terminated 10 dupes);
-- this is idempotent — future calls find zero dupes and no-op.
--
-- Scheduling: cron job runs every Monday 04:00 UTC to catch any new
-- dupes introduced during the week without a full-time janitor.

CREATE OR REPLACE FUNCTION public.dedupe_applications_by_email()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_winner_id uuid;
  v_loser_ids uuid[];
  v_merged_count int := 0;
  v_terminated_count int := 0;
BEGIN
  FOR r IN
    SELECT LOWER(email) AS email
    FROM public.applications
    WHERE email IS NOT NULL AND terminated_at IS NULL
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO v_winner_id
    FROM public.applications
    WHERE LOWER(email) = r.email AND terminated_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT array_agg(id) INTO v_loser_ids
    FROM public.applications
    WHERE LOWER(email) = r.email AND terminated_at IS NULL AND id <> v_winner_id;

    UPDATE public.applications w SET
      phone                   = COALESCE(w.phone,                   (SELECT phone                   FROM public.applications WHERE id = ANY(v_loser_ids) AND phone                   IS NOT NULL LIMIT 1)),
      first_name              = COALESCE(w.first_name,              (SELECT first_name              FROM public.applications WHERE id = ANY(v_loser_ids) AND first_name              IS NOT NULL LIMIT 1)),
      last_name               = COALESCE(w.last_name,               (SELECT last_name               FROM public.applications WHERE id = ANY(v_loser_ids) AND last_name               IS NOT NULL LIMIT 1)),
      instagram_handle        = COALESCE(w.instagram_handle,        (SELECT instagram_handle        FROM public.applications WHERE id = ANY(v_loser_ids) AND instagram_handle        IS NOT NULL LIMIT 1)),
      license_progress        = CASE
                                  WHEN w.license_progress IS NULL OR w.license_progress = 'unlicensed'
                                  THEN COALESCE((SELECT license_progress FROM public.applications WHERE id = ANY(v_loser_ids) AND license_progress IS NOT NULL AND license_progress <> 'unlicensed' ORDER BY created_at DESC LIMIT 1), w.license_progress)
                                  ELSE w.license_progress
                                END,
      course_purchased_at     = COALESCE(w.course_purchased_at,     (SELECT course_purchased_at     FROM public.applications WHERE id = ANY(v_loser_ids) AND course_purchased_at     IS NOT NULL LIMIT 1)),
      exam_scheduled_at       = COALESCE(w.exam_scheduled_at,       (SELECT exam_scheduled_at       FROM public.applications WHERE id = ANY(v_loser_ids) AND exam_scheduled_at       IS NOT NULL LIMIT 1)),
      exam_passed_at          = COALESCE(w.exam_passed_at,          (SELECT exam_passed_at          FROM public.applications WHERE id = ANY(v_loser_ids) AND exam_passed_at          IS NOT NULL LIMIT 1)),
      fingerprints_submitted_at = COALESCE(w.fingerprints_submitted_at, (SELECT fingerprints_submitted_at FROM public.applications WHERE id = ANY(v_loser_ids) AND fingerprints_submitted_at IS NOT NULL LIMIT 1)),
      last_contacted_at       = COALESCE(w.last_contacted_at,       (SELECT MAX(last_contacted_at)  FROM public.applications WHERE id = ANY(v_loser_ids) AND last_contacted_at       IS NOT NULL))
    WHERE w.id = v_winner_id;

    UPDATE public.applications
    SET terminated_at = now(),
        status = 'rejected'
    WHERE id = ANY(v_loser_ids);

    v_merged_count := v_merged_count + 1;
    v_terminated_count := v_terminated_count + COALESCE(array_length(v_loser_ids, 1), 0);
  END LOOP;

  RETURN jsonb_build_object(
    'merged_groups',    v_merged_count,
    'terminated_dupes', v_terminated_count
  );
END;
$body$;

-- Schedule weekly cleanup (Mondays 04:00 UTC = Sunday 11pm CST).
-- Rename-and-replace pattern so re-running the migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('dedupe-applications-weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'dedupe-applications-weekly',
  '0 4 * * 1',
  'SELECT public.dedupe_applications_by_email();'
);
