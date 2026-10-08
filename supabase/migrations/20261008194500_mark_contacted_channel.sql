-- PL-WIB-CONTACT-LOG-CHANNEL: "Mark contacted" has never recorded a contact on an applied lead.
--
-- unified_mark_contacted inserted channel 'contact' into application_contact_log,
-- and application_contact_log_channel_check admits only
-- call / sms / email / note / in_person / manual. The insert raised 23514 and,
-- being in the same statement, rolled back the applications.last_contacted_at
-- update with it. Measured 2026-10-08 as a real VA in a rolled-back transaction:
-- 23514 on applicant 03be96c0, while 'manual' on the same row succeeds. Zero
-- contact-log rows have ever carried outcome 'marked_contacted'. The aged_lead
-- branch never touched the log and was unaffected.
--
-- 'manual' is the admitted word for a touch a person records by hand without
-- naming the medium, which is exactly what this button records.
--
-- logged_by: the caller's own id wins when there is one. p_by_user_id is kept
-- for callers with no user (service key, pg_cron), so a signed-in account can
-- no longer write a contact under someone else's name. No caller passes it.
--
-- The role gate added in 20261008183000 is carried over unchanged.

CREATE OR REPLACE FUNCTION public.unified_mark_contacted(p_id uuid, p_source text, p_by_user_id uuid DEFAULT auth.uid())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
  IF p_source = 'aged_lead' OR p_source = 'aged_leads' THEN
    UPDATE aged_leads
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;
  ELSE
    UPDATE applications
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;
    INSERT INTO application_contact_log (application_id, channel, outcome, notes, logged_by)
    VALUES (p_id, 'manual', 'marked_contacted', NULL, COALESCE(auth.uid(), p_by_user_id));
  END IF;
END;
$function$;
