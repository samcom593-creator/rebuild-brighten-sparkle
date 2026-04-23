-- ════════════════════════════════════════════════════════════════════════
-- urgent_inbox — classified inbound events (XCEL, SureLC, state DOI, etc.)
-- that warrant human attention. Populated by gmail-webhook / zapier forwarder.
-- Auto-routes to Discord #hiring-pipeline based on classification.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.urgent_inbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,                    -- 'gmail' | 'zapier' | 'manual'
  kind            text NOT NULL,                    -- 'xcel_completion' | 'state_license_issued' | 'contracting_block' | 'exam_passed' | 'exam_failed' | 'other'
  subject         text,
  from_addr       text,
  from_domain     text,
  body_snippet    text,
  match_email     text,                             -- resolved applicant/agent email
  applicant_id    uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES public.agents(id)       ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'new',      -- 'new' | 'routed' | 'handled' | 'ignored'
  discord_message_id text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  routed_at       timestamptz,
  handled_at      timestamptz,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_urg_kind      ON public.urgent_inbox(kind);
CREATE INDEX IF NOT EXISTS idx_urg_status    ON public.urgent_inbox(status);
CREATE INDEX IF NOT EXISTS idx_urg_received  ON public.urgent_inbox(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_urg_email     ON public.urgent_inbox(match_email);

ALTER TABLE public.urgent_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS urg_admin ON public.urgent_inbox;
DROP POLICY IF EXISTS urg_svc   ON public.urgent_inbox;
CREATE POLICY urg_admin ON public.urgent_inbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY urg_svc   ON public.urgent_inbox FOR ALL    TO service_role USING (true);

-- Auto-match applicant / agent by email on insert/update
CREATE OR REPLACE FUNCTION public.trg_fn_match_urgent_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.match_email IS NULL OR NEW.match_email = '' THEN RETURN NEW; END IF;
  IF NEW.applicant_id IS NULL THEN
    SELECT id INTO NEW.applicant_id FROM public.applications
      WHERE LOWER(email) = LOWER(NEW.match_email) ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF NEW.agent_id IS NULL THEN
    SELECT a.id INTO NEW.agent_id FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE LOWER(p.email) = LOWER(NEW.match_email) LIMIT 1;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_match_urgent_inbox ON public.urgent_inbox;
CREATE TRIGGER trg_match_urgent_inbox BEFORE INSERT OR UPDATE ON public.urgent_inbox
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_match_urgent_inbox();

-- Classifier: given subject+body, infer kind. Central so gmail-webhook + cron agree.
CREATE OR REPLACE FUNCTION public.classify_urgent_kind(p_subject text, p_body text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE s text := COALESCE(LOWER(p_subject),''); b text := COALESCE(LOWER(p_body),'');
BEGIN
  IF s LIKE '%course complete%' OR b LIKE '%course complete%' OR s LIKE '%congratulations%complet%' THEN
    RETURN 'xcel_completion';
  ELSIF s LIKE '%license issued%' OR s LIKE '%license approved%' OR b LIKE '%license has been issued%' THEN
    RETURN 'state_license_issued';
  ELSIF s LIKE '%passed%exam%' OR s LIKE '%exam pass%' OR b LIKE '%you passed%' THEN
    RETURN 'exam_passed';
  ELSIF s LIKE '%failed%exam%' OR b LIKE '%did not pass%' THEN
    RETURN 'exam_failed';
  ELSIF s LIKE '%surelc%' OR s LIKE '%contracting%incomplete%' OR b LIKE '%missing%info%contracting%' THEN
    RETURN 'contracting_block';
  ELSIF s LIKE '%enrollment%' OR b LIKE '%you are now enrolled%' THEN
    RETURN 'xcel_enrollment';
  ELSE
    RETURN 'other';
  END IF;
END $fn$;

-- Router: pushes a new urgent_inbox row to Discord #hiring, marks routed_at.
-- Called both on direct insert (via webhook) and by a cron sweep.
CREATE OR REPLACE FUNCTION public.route_urgent_inbox()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE r record; v_body jsonb; v_label text; v_routed int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  FOR r IN
    SELECT * FROM public.urgent_inbox
    WHERE status = 'new'
      AND received_at > now() - interval '72 hours'
    ORDER BY received_at ASC
    LIMIT 25
  LOOP
    v_label := CASE r.kind
      WHEN 'xcel_completion'       THEN '📚 XCEL course COMPLETE'
      WHEN 'xcel_enrollment'       THEN '📘 XCEL enrollment'
      WHEN 'state_license_issued'  THEN '🎉 State license ISSUED'
      WHEN 'exam_passed'           THEN '✅ Exam PASSED'
      WHEN 'exam_failed'           THEN '⚠️ Exam failed — call them'
      WHEN 'contracting_block'     THEN '🚫 Contracting BLOCK'
      ELSE '📬 Inbound: ' || r.kind
    END;
    v_body := jsonb_build_object(
      'username','APEX · Inbox Radar',
      'content', format(
        E'%s\n\n**%s**\n%s\n%s%s',
        v_label,
        COALESCE(r.subject,'(no subject)'),
        COALESCE('From: ' || r.from_addr, ''),
        CASE WHEN r.match_email IS NOT NULL THEN E'\nMatched: ' || r.match_email ELSE '' END,
        CASE WHEN r.body_snippet IS NOT NULL AND length(r.body_snippet) > 0
             THEN E'\n\n> ' || regexp_replace(left(r.body_snippet, 350), E'\n', ' ', 'g')
             ELSE '' END));
    PERFORM public.discord_route(
      'urgent_inbox_' || r.kind,
      r.id::text,
      'hiring',
      v_body);
    UPDATE public.urgent_inbox SET status='routed', routed_at=now() WHERE id = r.id;
    v_routed := v_routed + 1;
  END LOOP;
  RETURN jsonb_build_object('routed', v_routed);
END $fn$;
GRANT EXECUTE ON FUNCTION public.route_urgent_inbox() TO service_role, authenticated;

-- Cron: sweep urgent_inbox every 5 min and push anything still 'new' to Discord.
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='urgent-inbox-router') THEN
    PERFORM cron.unschedule('urgent-inbox-router'); END IF;
  PERFORM cron.schedule('urgent-inbox-router', '*/5 * * * *',
    $j$ SELECT public.route_urgent_inbox(); $j$);
END $outer$;

SELECT 'urgent_inbox scaffold installed' AS r;
