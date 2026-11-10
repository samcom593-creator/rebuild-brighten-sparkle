-- WP4 (2026-11-10 onboarding audit): delivery truth.
--
-- Every recruit-facing email gets a durable receipt that outlives Resend's
-- ~30-day list, a hard bounce flags the recruit and tells Sam (privately),
-- SMS consent is enforced in one place, and the dead recruit crons stop
-- cluttering cron.job.
--
-- What this file creates (all owned by WP4):
--   public.email_template_families     subject/domain -> family map (data, not code)
--   public.email_events                one row per Resend email id, hashes only
--   applications.email_bounced_at      first dead-address evidence (machine-set)
--   agents.email_bounced_at            same, via profiles.email -> agents.user_id
--   public.fn_email_events_ingest      hourly upsert from resend-suppression-sync
--   public.fn_email_bounce_react       flags + private alerts, run once per sync
--   public.fn_sms_consent_for_phone    called by send-sms-auto-detect on every send
--   public.recruit_sequences           registry of every recruit-facing sequence
--   public.v_recruit_message_delivery  per application/agent: sequence, sent, last event
--   public.v_recruit_sequence_health   expected vs receipted sends, 7d
--   public.v_wp4_delivery_truth_health one-row guard view read by apex-doctor #45
--   cron: deletes dead inactive jobs 20/37/39/61/62, unschedules
--         telegram_inactivity_queue_15min, moves telegram_drain_5min to every 30m
--
-- Privacy: email_events stores sha256(lower(trim(address))) and the domain only.
-- The subject is passed to fn_email_events_ingest so it can be classified and is
-- never stored. Raw addresses stay in email_suppressions (pre-existing design).
--
-- Idempotent: every statement is create-or-replace / if-not-exists / guarded.

-- ---------------------------------------------------------------------------
-- 0. Preimage of the crons this file deletes or changes (cron.job, read live
--    2026-11-10 ~21:00Z). Re-create any of them from these rows if needed.
--
-- jobid 20 'apex-licensing-sequences' schedule '0 14 * * *' active=false
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-bulk-unlicensed-outreach',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
--       'Content-Type', 'application/json'),
--     body := '{}'::jsonb, timeout_milliseconds := 25000);
--
-- jobid 37 'pl088_license_milestone_drain' schedule '* * * * *' active=false
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-license-milestone',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
--     body := '{}'::jsonb) AS request_id;
--
-- jobid 39 'notion_sync_drain' schedule '24-59/30 * * * *' active=false
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/notion-sync',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
--     body := '{}'::jsonb) AS request_id;
--
-- jobid 61 'apex-license-renewal-daily-9am-ct' schedule '0 14 * * *' active=false
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/license-renewal-sweep',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
--       'Content-Type',  'application/json'),
--     body := '{}'::jsonb, timeout_milliseconds := 25000);
--
-- jobid 62 'apex-outreach-sender-5min' schedule '3-59/5 * * * *' active=false
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/outreach-sender',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
--     body := '{}'::jsonb);
--
-- jobid 29 'telegram_inactivity_queue_15min' schedule '12-59/15 * * * *' active=true
--   SELECT public.fn_telegram_queue_inactivity_nudges();
--
-- jobid 30 'telegram_drain_5min' schedule '2-59/5 * * * *' active=true  (only the schedule changes)
--   SELECT net.http_post(
--     url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/telegram-drain',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'x-apex-drain-secret', (SELECT value FROM system_settings WHERE key = 'apex_drain_secret' LIMIT 1)),
--     body := jsonb_build_object('source', 'pg_cron', 'fired_at', now()::text),
--     timeout_milliseconds := 25000);
-- ---------------------------------------------------------------------------

-- 0b. Machine-readable preimage, taken before any change, once.
DO $$
BEGIN
  IF to_regclass('public.ops_preimage_snapshots') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ops_preimage_snapshots WHERE reason = 'wp4_delivery_truth: cron preimage') THEN
    INSERT INTO public.ops_preimage_snapshots (reason, payload)
    SELECT 'wp4_delivery_truth: cron preimage',
           coalesce(jsonb_agg(jsonb_build_object(
             'jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active,
             'database', database, 'username', username, 'command', command) ORDER BY jobid), '[]'::jsonb)
      FROM cron.job
     WHERE jobname IN ('apex-licensing-sequences', 'pl088_license_milestone_drain', 'notion_sync_drain',
                       'apex-license-renewal-daily-9am-ct', 'apex-outreach-sender-5min',
                       'telegram_inactivity_queue_15min', 'telegram_drain_5min');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Subject/domain -> family map. Data, so a package that changes a subject
--    line updates a row instead of redefining a view. First match by priority.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_template_families (
  family            text PRIMARY KEY,
  priority          integer NOT NULL DEFAULT 100,
  subject_pattern   text,            -- case-insensitive POSIX regex over the subject
  recipient_domains text[],          -- exact recipient domains (carrier SMS gateways)
  audience          text NOT NULL CHECK (audience IN ('applicant', 'agent', 'both', 'internal', 'gateway')),
  notes             text,
  CHECK (subject_pattern IS NOT NULL OR recipient_domains IS NOT NULL)
);
ALTER TABLE public.email_template_families ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_template_families FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_template_families TO authenticated;
GRANT ALL ON public.email_template_families TO service_role;
DROP POLICY IF EXISTS email_template_families_admin_read ON public.email_template_families;
CREATE POLICY email_template_families_admin_read ON public.email_template_families
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.email_template_families (family, priority, subject_pattern, recipient_domains, audience, notes) VALUES
  ('sms_gateway', 1, NULL,
     ARRAY['txt.att.net','vtext.com','tmomail.net','messaging.sprintpcs.com','email.uscc.net',
           'sms.cricketwireless.net','mymetropcs.com','sms.myboostmobile.com'],
     'gateway', 'send-sms-auto-detect carrier email-to-text; not an email to the person'),
  ('applicant_welcome', 10, 'let.s get you licensed|licensed agent fast track|almost ready to earn', NULL,
     'applicant', 'submit-application day-0 welcome (ledger: email_delivery_log)'),
  ('applicant_magic_login', 20, 'dashboard is ready|one-click login', NULL,
     'applicant', 'applicant_login_tick -> applicant magic login'),
  ('applicant_followup', 30, 'need help getting licensed|are you licensed yet|did we get to you yet', NULL,
     'applicant', 'send-followup-emails'),
  ('applicant_nudge', 40, 'day 1 check-in|last automated check-in', NULL,
     'applicant', 'fn_run_applicant_nudges day-1 / 72h (WP3 may move these; update this row with the new subjects)'),
  ('licensing_drip', 50, 'licensing roadmap|how.s the studying|don.t let the momentum slip', NULL,
     'applicant', 'send-licensing-sequence (OFF by Sam 2026-10-14)'),
  ('partial_recovery', 60, 'you started the application', NULL,
     'applicant', 'instagram-dm-nudge partial applications'),
  ('license_milestone', 65, 'your licensing update from galaxy', NULL,
     'applicant', 'license-milestone-sms-drain email fallback'),
  ('next_step', 70,
     ' — step 1$|seminar locked|pre-selling course is live|you passed — last admin step|contracting started|finish the application|start your pre-license course|day [0-9]+ of training|first deal — congratulations|your first appointment|field-ready|state exam is locked|application received — a manager|you attended — here|course progress check-in|schedule your state exam this week|infield training day|\$10k week',
     NULL, 'both', 'next-step-dispatch stage emails (ledger: next_step_messages)'),
  ('newhire_onboarding', 80, 'get your insurance licen|online training is ready|join the galaxy slack|scripts are unlocked|book your galaxy onboarding call|portal is ready|your galaxy login', NULL,
     'agent', 'send-agent-onboarding-email (ledger: agent_onboarding_queue) and portal login'),
  ('applicant_campaign', 90, 'still interested in galaxy|taking it over personally|an open door|quick update on your manager', NULL,
     'applicant', 'one-off staff blasts'),
  ('seminar', 95, 'seminar', NULL, 'applicant', 'seminar confirmation / invites'),
  ('agent_numbers', 200, 'log your numbers|forget your numbers', NULL, 'agent', 'numbers-reminder'),
  ('agent_digest', 210, 'daily digest|production report', NULL, 'agent', 'agent digests'),
  ('internal', 900, 'critical system issue|clicked reapply|auto-fill|new organic lead|just recruited|\[sms copy\]|licensed ✅|unlicensed — |hot lead|duplicate application|rehire application', NULL,
     'internal', 'staff/system mail')
ON CONFLICT (family) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. email_events: one row per Resend email id. Hashes only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_events (
  resend_id        text PRIMARY KEY,
  last_event       text NOT NULL,
  recipient_hash   text NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  recipient_domain text,
  template_hint    text NOT NULL DEFAULT 'other',
  sender           text,
  created_at       timestamptz NOT NULL,          -- Resend's send time
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  seen_at          timestamptz NOT NULL DEFAULT now(),
  event_changed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.email_events IS
  'WP4: every Resend email resend-suppression-sync has read, with its latest event. recipient_hash = sha256(lower(trim(address))) hex; no raw addresses. Keeps delivery evidence past Resend''s ~30-day list.';
CREATE INDEX IF NOT EXISTS email_events_recipient_hash_idx ON public.email_events (recipient_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_created_at_idx ON public.email_events (created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_hint_created_idx ON public.email_events (template_hint, created_at DESC);
CREATE INDEX IF NOT EXISTS email_events_seen_at_idx ON public.email_events (seen_at DESC);
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_events TO authenticated;
GRANT ALL ON public.email_events TO service_role;
DROP POLICY IF EXISTS email_events_admin_read ON public.email_events;
CREATE POLICY email_events_admin_read ON public.email_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 3. Bounce flags. Distinct from applications.email_bad_at, which a human sets.
-- ---------------------------------------------------------------------------
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz;
ALTER TABLE public.agents       ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz;
COMMENT ON COLUMN public.applications.email_bounced_at IS
  'WP4: send time of the email whose Resend last_event proved this address dead (bounced, complained or suppressed). Machine-set once by fn_email_events_ingest; cleared when the email column changes.';
COMMENT ON COLUMN public.agents.email_bounced_at IS
  'WP4: send time of the email whose Resend last_event proved the profile address dead. Machine-set once by fn_email_events_ingest.';

CREATE OR REPLACE FUNCTION public.fn_wp4_reset_email_bounced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A corrected address is a new address: the old bounce says nothing about it.
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_bounced_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wp4_reset_email_bounced ON public.applications;
CREATE TRIGGER trg_wp4_reset_email_bounced
  BEFORE UPDATE OF email ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.fn_wp4_reset_email_bounced();

-- email_suppressions learns bounced/complained (written only for recruit/agent
-- addresses, by resend-suppression-sync after fn_email_events_ingest matches them).
ALTER TABLE public.email_suppressions DROP CONSTRAINT IF EXISTS email_suppressions_last_event_check;
ALTER TABLE public.email_suppressions ADD CONSTRAINT email_suppressions_last_event_check
  CHECK (last_event IN ('suppressed', 'bounced', 'complained'));

-- Forward-only alerting: a bounce on a send older than this never pages Sam.
INSERT INTO public.system_settings (key, value)
VALUES ('wp4_bounce_alert_cutoff', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;
-- The gateway-SMS ladder check grades only reminders created after the
-- next-step-dispatch deploy that made a gateway receipt non-terminal.
INSERT INTO public.system_settings (key, value)
VALUES ('wp4_ladder_fix_deployed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;
-- send-licensing-sequence sweep mode refuses unless this reads 'true' (Sam 2026-10-14: OFF).
INSERT INTO public.system_settings (key, value)
VALUES ('licensing_sequence_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4a. fn_email_events_ingest(p_rows): pure upsert of what Resend reported.
--     Called once per chunk by resend-suppression-sync. Reacting to bounces is
--     a separate call (4b) made once after ALL chunks land, so a backfill that
--     splits an older bounce and a newer delivery across chunks cannot flag a
--     live address on the stale event.
--     p_rows: [{resend_id,last_event,recipient_hash,recipient_domain,subject,sender,created_at}]
--     The subject is used for classification and is not stored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_email_events_ingest(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_upserted integer := 0;
  v_changed  integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'fn_email_events_ingest: p_rows must be a json array';
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (x.resend_id)
           x.resend_id, lower(coalesce(x.last_event, 'unknown')) AS last_event,
           lower(x.recipient_hash) AS recipient_hash, lower(x.recipient_domain) AS recipient_domain,
           x.subject, left(x.sender, 200) AS sender, x.created_at
      FROM jsonb_to_recordset(p_rows) AS x(resend_id text, last_event text, recipient_hash text,
                                           recipient_domain text, subject text, sender text, created_at timestamptz)
     WHERE x.resend_id IS NOT NULL AND x.created_at IS NOT NULL
       AND lower(x.recipient_hash) ~ '^[0-9a-f]{64}$'
     ORDER BY x.resend_id
  ), fam AS (
    SELECT s.*,
           coalesce((SELECT f.family FROM public.email_template_families f
                      WHERE (f.recipient_domains IS NOT NULL AND s.recipient_domain = ANY (f.recipient_domains))
                         OR (f.subject_pattern IS NOT NULL AND coalesce(s.subject, '') ~* f.subject_pattern)
                      ORDER BY f.priority, f.family LIMIT 1), 'other') AS hint
      FROM src s
  ), up AS (
    INSERT INTO public.email_events AS e
           (resend_id, last_event, recipient_hash, recipient_domain, template_hint, sender, created_at)
    SELECT resend_id, last_event, recipient_hash, recipient_domain, hint, sender, created_at FROM fam
    ON CONFLICT (resend_id) DO UPDATE
       SET seen_at          = now(),
           event_changed_at = CASE WHEN e.last_event IS DISTINCT FROM EXCLUDED.last_event THEN now() ELSE e.event_changed_at END,
           last_event       = EXCLUDED.last_event,
           template_hint    = EXCLUDED.template_hint,
           recipient_domain = coalesce(EXCLUDED.recipient_domain, e.recipient_domain),
           sender           = coalesce(EXCLUDED.sender, e.sender)
    RETURNING e.event_changed_at = now() AS changed
  )
  SELECT count(*), count(*) FILTER (WHERE changed) INTO v_upserted, v_changed FROM up;

  RETURN jsonb_build_object('upserted', v_upserted, 'changed', v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_email_events_ingest(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_email_events_ingest(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4b. fn_email_bounce_react(p_hashes): flag dead recruit/agent addresses (first
--     evidence only), raise at most one private alert per person for bounces on
--     sends after wp4_bounce_alert_cutoff (capped per run, deduped on the link),
--     and return which of p_hashes are recruit/agent addresses whose latest
--     event is bounced/complained, so the caller (which holds the raw address)
--     can mirror them into email_suppressions.
--     Dead address = the LATEST email we hold for that recipient was bounced,
--     complained or suppressed (suppressed = Resend refused to try because of an
--     earlier hard bounce/complaint). A later delivered send clears the verdict.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_email_bounce_react(p_hashes text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apps     jsonb := '[]'::jsonb;
  v_agents   jsonb := '[]'::jsonb;
  v_alerts   integer := 0;
  v_overflow integer := 0;
  v_cap      constant integer := 5;
  v_cutoff   timestamptz;
  v_suppress jsonb;
  r          record;
BEGIN
  WITH dead AS (
    SELECT z.recipient_hash, z.dead_at FROM (
      SELECT DISTINCT ON (e.recipient_hash) e.recipient_hash, e.last_event, e.created_at AS dead_at
        FROM public.email_events e
       WHERE e.template_hint <> 'sms_gateway'
         AND e.recipient_hash IN (SELECT ev.recipient_hash FROM public.email_events ev
                                   WHERE ev.last_event IN ('bounced', 'complained', 'suppressed'))
       ORDER BY e.recipient_hash, e.created_at DESC) z
     WHERE z.last_event IN ('bounced', 'complained', 'suppressed')
  ), hit AS (
    SELECT a.id, d.recipient_hash, d.dead_at
      FROM public.applications a
      JOIN dead d ON d.recipient_hash = encode(sha256(convert_to(lower(btrim(a.email)), 'UTF8')), 'hex')
     WHERE a.email IS NOT NULL AND btrim(a.email) <> '' AND a.email_bounced_at IS NULL
  ), upd AS (
    UPDATE public.applications a SET email_bounced_at = hit.dead_at
      FROM hit WHERE a.id = hit.id AND a.email_bounced_at IS NULL
    RETURNING a.id, hit.recipient_hash, hit.dead_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'application', 'id', id, 'recipient_hash', recipient_hash, 'dead_at', dead_at)), '[]'::jsonb)
    INTO v_apps FROM upd;

  WITH dead AS (
    SELECT z.recipient_hash, z.dead_at FROM (
      SELECT DISTINCT ON (e.recipient_hash) e.recipient_hash, e.last_event, e.created_at AS dead_at
        FROM public.email_events e
       WHERE e.template_hint <> 'sms_gateway'
         AND e.recipient_hash IN (SELECT ev.recipient_hash FROM public.email_events ev
                                   WHERE ev.last_event IN ('bounced', 'complained', 'suppressed'))
       ORDER BY e.recipient_hash, e.created_at DESC) z
     WHERE z.last_event IN ('bounced', 'complained', 'suppressed')
  ), hit AS (
    SELECT DISTINCT g.id, d.recipient_hash, d.dead_at
      FROM public.profiles p
      JOIN dead d ON d.recipient_hash = encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex')
      JOIN public.agents g ON g.user_id = p.user_id
     WHERE p.email IS NOT NULL AND btrim(p.email) <> '' AND g.email_bounced_at IS NULL
  ), upd AS (
    UPDATE public.agents g SET email_bounced_at = hit.dead_at
      FROM hit WHERE g.id = hit.id AND g.email_bounced_at IS NULL
    RETURNING g.id, hit.recipient_hash, hit.dead_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', 'agent', 'id', id, 'recipient_hash', recipient_hash, 'dead_at', dead_at)), '[]'::jsonb)
    INTO v_agents FROM upd;

  v_cutoff := coalesce((SELECT nullif(value, '')::timestamptz FROM public.system_settings
                         WHERE key = 'wp4_bounce_alert_cutoff'), 'infinity'::timestamptz);
  FOR r IN
    SELECT DISTINCT ON (f.recipient_hash)
           f.kind, f.id, f.dead_at,
           CASE f.kind WHEN 'application'
             THEN 'https://apex-financial.org/dashboard/recruiting?lead=' || f.id
             ELSE 'https://apex-financial.org/dashboard/profile?agentId=' || f.id END AS link,
           CASE f.kind WHEN 'application'
             THEN (SELECT nullif(split_part(btrim(a.first_name), ' ', 1), '') FROM public.applications a WHERE a.id = f.id)
             ELSE (SELECT nullif(split_part(btrim(g.display_name), ' ', 1), '') FROM public.agents g WHERE g.id = f.id) END AS first_name,
           (SELECT e.template_hint FROM public.email_events e
             WHERE e.recipient_hash = f.recipient_hash ORDER BY e.created_at DESC LIMIT 1) AS family
      FROM jsonb_to_recordset(v_apps || v_agents) AS f(kind text, id uuid, recipient_hash text, dead_at timestamptz)
     WHERE f.dead_at >= v_cutoff
       AND CASE f.kind
             WHEN 'application' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.id = f.id
                                               AND coalesce(a.is_duplicate, false) = false
                                               AND a.terminated_at IS NULL AND a.closed_at IS NULL)
             ELSE EXISTS (SELECT 1 FROM public.agents g WHERE g.id = f.id
                            AND g.status = 'active' AND coalesce(g.is_deactivated, false) = false)
           END
     ORDER BY f.recipient_hash, (f.kind = 'agent') DESC, f.dead_at DESC
  LOOP
    IF EXISTS (SELECT 1 FROM public.bot_alerts b
                WHERE b.event_type = 'recruit_email_bounced' AND b.action_link = r.link) THEN
      CONTINUE;
    END IF;
    IF v_alerts >= v_cap THEN
      v_overflow := v_overflow + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, action_link, channels)
    VALUES ('resend-suppression-sync', 'recruit_email_bounced', 'critical',
            format('Recruit email bounced: %s', coalesce(r.first_name, 'a recruit')),
            format('The %s email to %s (%s) bounced, so every automated email to this person will bounce too. '
                   'Call them to confirm the address and correct it on their record.',
                   replace(coalesce(r.family, 'latest'), '_', ' '), coalesce(r.first_name, 'this recruit'),
                   CASE r.kind WHEN 'application' THEN 'applicant' ELSE 'agent' END),
            r.link, ARRAY['email', 'ntfy']);
    v_alerts := v_alerts + 1;
  END LOOP;
  IF v_overflow > 0 THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, action_link, channels)
    VALUES ('resend-suppression-sync', 'recruit_email_bounced_overflow', 'critical',
            format('%s more recruit emails bounced', v_overflow),
            'More recruit email addresses went dead in one sync than get an alert each. The list is in v_recruit_message_delivery (bounced = true).',
            'https://apex-financial.org/dashboard/recruiting', ARRAY['email', 'ntfy']);
  END IF;

  -- Suppression mirror: recruit/agent addresses only, hard evidence only.
  WITH latest AS (
    SELECT DISTINCT ON (e.recipient_hash) e.recipient_hash, e.last_event
      FROM public.email_events e
     WHERE e.template_hint <> 'sms_gateway'
       AND e.recipient_hash = ANY (coalesce(p_hashes, '{}'::text[]))
     ORDER BY e.recipient_hash, e.created_at DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('recipient_hash', l.recipient_hash, 'last_event', l.last_event)), '[]'::jsonb)
    INTO v_suppress
    FROM latest l
   WHERE l.last_event IN ('bounced', 'complained')
     AND (EXISTS (SELECT 1 FROM public.applications a
                   WHERE a.email IS NOT NULL
                     AND encode(sha256(convert_to(lower(btrim(a.email)), 'UTF8')), 'hex') = l.recipient_hash)
          OR EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.email IS NOT NULL
                        AND encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex') = l.recipient_hash));

  RETURN jsonb_build_object(
    'applications_flagged', jsonb_array_length(v_apps), 'agents_flagged', jsonb_array_length(v_agents),
    'alerts', v_alerts, 'alerts_overflow', v_overflow, 'suppress', v_suppress);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_email_bounce_react(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_email_bounce_react(text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. fn_sms_consent_for_phone: the one consent answer send-sms-auto-detect uses.
--    allowed=true only on recorded consent. An admin's own phone (system alerts
--    to the operator) is the single exception, and it says so in `source`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sms_consent_for_phone(p_phone text, p_application_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text;
  v_app    record;
BEGIN
  IF p_application_id IS NOT NULL THEN
    SELECT a.id, a.sms_consent_given INTO v_app FROM public.applications a WHERE a.id = p_application_id;
    IF FOUND THEN
      RETURN jsonb_build_object('allowed', coalesce(v_app.sms_consent_given, false) = true,
                                'source', 'application_id', 'application_id', v_app.id);
    END IF;
  END IF;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  IF length(v_digits) < 10 THEN
    RETURN jsonb_build_object('allowed', false, 'source', 'no_phone');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p
               JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'admin'::app_role
              WHERE p.phone IS NOT NULL
                AND right(regexp_replace(p.phone, '\D', '', 'g'), 10) = v_digits) THEN
    RETURN jsonb_build_object('allowed', true, 'source', 'operator_self');
  END IF;

  SELECT a.id, a.sms_consent_given INTO v_app
    FROM public.applications a
   WHERE a.phone IS NOT NULL
     AND right(regexp_replace(a.phone, '\D', '', 'g'), 10) = v_digits
   ORDER BY a.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('allowed', coalesce(v_app.sms_consent_given, false) = true,
                              'source', 'application_phone', 'application_id', v_app.id);
  END IF;

  RETURN jsonb_build_object('allowed', false, 'source', 'no_consent_record');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sms_consent_for_phone(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sms_consent_for_phone(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. recruit_sequences: who sends what, to whom, on what trigger, and how it is
--    graded. grade_mode 'ledger' = a sender table with provider ids;
--    'events_family' = email_events.template_hint IN subject_families.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recruit_sequences (
  key                   text PRIMARY KEY,
  audience              text NOT NULL CHECK (audience IN ('applicant', 'unlicensed', 'licensed', 'agent', 'both')),
  channel               text NOT NULL,
  trigger_kind          text NOT NULL CHECK (trigger_kind IN ('cron', 'trigger', 'edge_inline', 'external', 'manual')),
  cron_jobname          text,
  endpoint              text,
  grade_mode            text NOT NULL DEFAULT 'ungraded' CHECK (grade_mode IN ('ledger', 'events_family', 'ungraded')),
  subject_families      text[],
  expected_min_sends_7d integer NOT NULL DEFAULT 0 CHECK (expected_min_sends_7d >= 0),
  owner                 text,
  status                text NOT NULL CHECK (status IN ('active', 'paused', 'retired', 'manual')),
  notes                 text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recruit_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recruit_sequences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recruit_sequences TO authenticated;
GRANT ALL ON public.recruit_sequences TO service_role;
DROP POLICY IF EXISTS recruit_sequences_admin_read ON public.recruit_sequences;
CREATE POLICY recruit_sequences_admin_read ON public.recruit_sequences
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.recruit_sequences
  (key, audience, channel, trigger_kind, cron_jobname, endpoint, grade_mode, subject_families, expected_min_sends_7d, owner, status, notes)
VALUES
  ('applicant_welcome', 'applicant', 'email', 'edge_inline', NULL, 'submit-application', 'ledger', ARRAY['applicant_welcome'], 1, 'WP2', 'active',
   'Day-0 welcome. Receipt: email_delivery_log template submit-application-applicant provider_message_id.'),
  ('applicant_magic_login', 'applicant', 'email', 'cron', 'applicant-login-tick', 'applicant_login_tick()', 'events_family', ARRAY['applicant_magic_login'], 1, 'WP2', 'active',
   'Applicant dashboard magic link. Eligible: applicant_login_queue rows created in 7d.'),
  ('applicant_nudge', 'applicant', 'email', 'cron', 'apex-applicant-nudges-hourly', 'fn_run_applicant_nudges()', 'events_family', ARRAY['applicant_nudge'], 1, 'WP3', 'active',
   'Day-1 and 72h nudges. 401 since 2026-09-06 and still stamped sent (DELIVERY-1); WP3 moves them to send-followup-emails. Update subject_families/email_template_families if the subjects change.'),
  ('applicant_followup', 'applicant', 'email', 'cron', 'apex-followup-emails-daily', 'send-followup-emails', 'events_family', ARRAY['applicant_followup'], 1, 'WP3', 'active',
   'Day 3-4 / 7-8 follow-ups ("Need Help Getting Licensed?", "Are You Licensed Yet?", "Did We Get to You Yet?").'),
  ('next_step_ladder', 'both', 'telegram>sms>email', 'trigger', 'next_step_nudge_sweep', 'next-step-dispatch', 'ledger', ARRAY['next_step'], 1, 'WP4', 'active',
   'Stage reminders. Receipt: next_step_messages email rows with external_id. A gateway SMS is best effort and never terminal (WP4).'),
  ('partial_recovery', 'applicant', 'email', 'cron', 'apex-instagram-dm-nudge', 'instagram-dm-nudge', 'events_family', ARRAY['partial_recovery'], 0, 'WP2', 'active',
   'Partial-application recovery email while IG automation is paused. Eligible population not modelled yet: ungraded verdict.'),
  ('newhire_onboarding', 'agent', 'email', 'cron', 'apex-agent-onboarding-emails-hourly', 'send-agent-onboarding-email', 'ledger', ARRAY['newhire_onboarding'], 1, 'WP6', 'active',
   'Course / Slack / get_licensed / onboarding_call emails. Receipt: agent_onboarding_queue.resend_message_id.'),
  ('newhire_portal_login', 'agent', 'email', 'cron', 'apex-newhire-portal-login-hourly', 'cron-newhire-portal-login', 'ungraded', ARRAY['newhire_onboarding'], 0, 'WP6', 'active',
   'Portal login links (magic_login_tokens). WP6 adds send receipts.'),
  ('onboarding_call_invites', 'agent', 'email', 'cron', 'apex-onboarding-call-invites-5min', 'onboarding-call-invites', 'ledger', NULL, 1, 'WP6', 'active',
   'Calendar invites. Receipt: onboarding_call_invites.resend_message_id.'),
  ('licensing_drip', 'unlicensed', 'email', 'manual', NULL, 'send-licensing-sequence', 'ungraded', ARRAY['licensing_drip'], 0, 'Sam', 'paused',
   'OFF by Sam 2026-10-14 after a 767-send burst. Sweep mode refuses unless system_settings.licensing_sequence_enabled = true; per-(application, step) dedupe on contact_history (WP4).'),
  ('license_milestone', 'unlicensed', 'sms>email', 'cron', 'license-milestone-sms-drain', 'license-milestone-sms-drain', 'ungraded', ARRAY['license_milestone'], 0, 'WP1', 'active',
   'Milestone texts; SMS has no provider (N11), so the drain falls back to email.'),
  ('seminar_confirmation', 'applicant', 'email', 'edge_inline', NULL, 'seminar-confirmation', 'ungraded', ARRAY['seminar'], 0, 'WP2', 'active',
   'Low volume. Receipt: email_delivery_log template seminar-confirmation.'),
  ('telegram_drain', 'both', 'telegram', 'cron', 'telegram_drain_5min', 'telegram-drain', 'ungraded', NULL, 0, 'WP4', 'active',
   'Telegram retired as a team channel 2026-08-31; 7 linked chats remain. Slowed to every 30 minutes (WP4).'),
  ('telegram_inactivity', 'both', 'telegram', 'cron', 'telegram_inactivity_queue_15min', 'fn_telegram_queue_inactivity_nudges()', 'ungraded', NULL, 0, 'WP4', 'retired',
   'Unscheduled by WP4 (1 of 194 applicants linked).'),
  ('slack_unlicensed_welcome', 'unlicensed', 'slack', 'cron', 'apex-slack-unlicensed-welcome', 'slack-unlicensed-welcome', 'ungraded', NULL, 0, 'WP7', 'active',
   'Slack #unlicensed greeter.'),
  ('interview_reminders', 'applicant', 'calendly', 'external', NULL, 'Calendly', 'ungraded', NULL, 0, 'WP3', 'active',
   'Calendly sends its own reminders; native reminders flag is unset.'),
  ('applicant_campaign', 'applicant', 'email', 'manual', NULL, NULL, 'ungraded', ARRAY['applicant_campaign'], 0, 'Sam', 'manual',
   'One-off staff blasts. Future blasts go through a repo function with a staged list.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. v_recruit_message_delivery: every recruit-facing email we can attribute,
--    with its Resend fate. Ledger rows first; email_events rows whose recipient
--    hash matches an application/agent fill in senders that keep no ledger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_recruit_message_delivery
WITH (security_invoker = true) AS
WITH ledger AS (
  SELECT 'applicant'::text AS person_kind,
         l.related_record_id AS application_id, NULL::uuid AS agent_id,
         CASE l.template WHEN 'submit-application-applicant' THEN 'applicant_welcome' ELSE 'seminar_confirmation' END AS sequence,
         l.template AS step, 'email_delivery_log'::text AS ledger,
         coalesce(l.sent_at, l.created_at) AS sent_at, l.provider_message_id AS resend_id
    FROM public.email_delivery_log l
   WHERE l.template IN ('submit-application-applicant', 'seminar-confirmation')
     AND l.related_record_type = 'application'
  UNION ALL
  SELECT 'agent', NULL::uuid, q.agent_id, 'newhire_onboarding', q.email_kind, 'agent_onboarding_queue',
         q.sent_at, q.resend_message_id
    FROM public.agent_onboarding_queue q
   WHERE q.sent_at IS NOT NULL
  UNION ALL
  SELECT CASE WHEN m.application_id IS NOT NULL THEN 'applicant' ELSE 'agent' END,
         m.application_id, m.agent_id, 'next_step_ladder', m.stage_key, 'next_step_messages',
         m.sent_at, m.external_id
    FROM public.next_step_messages m
   WHERE m.channel = 'email' AND m.sent_at IS NOT NULL
), app_hash AS (
  SELECT a.id, encode(sha256(convert_to(lower(btrim(a.email)), 'UTF8')), 'hex') AS h
    FROM public.applications a
   WHERE a.email IS NOT NULL AND btrim(a.email) <> ''
), agent_hash AS (
  SELECT DISTINCT g.id, encode(sha256(convert_to(lower(btrim(p.email)), 'UTF8')), 'hex') AS h
    FROM public.agents g JOIN public.profiles p ON p.user_id = g.user_id
   WHERE p.email IS NOT NULL AND btrim(p.email) <> ''
), from_events AS (
  SELECT DISTINCT ON (e.resend_id, coalesce(ah.id, gh.id))
         CASE WHEN ah.id IS NOT NULL THEN 'applicant' ELSE 'agent' END AS person_kind,
         ah.id AS application_id, gh.id AS agent_id,
         e.template_hint AS sequence, e.template_hint AS step, 'email_events'::text AS ledger,
         e.created_at AS sent_at, e.resend_id
    FROM public.email_events e
    LEFT JOIN app_hash ah ON ah.h = e.recipient_hash
    LEFT JOIN agent_hash gh ON gh.h = e.recipient_hash AND ah.id IS NULL
   WHERE (ah.id IS NOT NULL OR gh.id IS NOT NULL)
     AND e.template_hint NOT IN ('sms_gateway', 'internal')
     AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.resend_id = e.resend_id)
   ORDER BY e.resend_id, coalesce(ah.id, gh.id)
), unioned AS (
  SELECT * FROM ledger
  UNION ALL
  SELECT * FROM from_events
)
SELECT u.person_kind, u.application_id, u.agent_id, u.sequence, u.step, u.ledger, u.sent_at, u.resend_id,
       (u.resend_id IS NOT NULL AND u.resend_id <> '') AS receipted,
       e.last_event,
       e.seen_at AS event_seen_at,
       (e.last_event IN ('delivered', 'opened', 'clicked')) AS delivered,
       (e.last_event IN ('bounced', 'complained', 'suppressed')) AS bounced
  FROM unioned u
  LEFT JOIN public.email_events e ON e.resend_id = u.resend_id;
COMMENT ON VIEW public.v_recruit_message_delivery IS
  'WP4: recruit-facing emails per application/agent with Resend fate. last_event NULL = no email_events row yet (sent before the ledger existed, or not yet synced).';
REVOKE ALL ON public.v_recruit_message_delivery FROM PUBLIC, anon;
GRANT SELECT ON public.v_recruit_message_delivery TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. v_recruit_sequence_health: expected vs receipted sends in 7 days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_recruit_sequence_health
WITH (security_invoker = true) AS
WITH d AS (
  SELECT sequence, count(*) FILTER (WHERE receipted) AS receipted,
         count(*) FILTER (WHERE delivered) AS delivered,
         count(*) FILTER (WHERE bounced) AS bounced,
         max(sent_at) FILTER (WHERE receipted) AS last_receipt_at
    FROM public.v_recruit_message_delivery
   WHERE sent_at >= now() - interval '7 days'
   GROUP BY sequence
), m AS (
  SELECT s.*,
    CASE s.key
      WHEN 'applicant_welcome' THEN (SELECT count(*) FROM public.applications a
                                      WHERE a.created_at >= now() - interval '7 days'
                                        AND a.record_type = 'application' AND coalesce(a.is_duplicate, false) = false
                                        AND a.email IS NOT NULL)
      WHEN 'applicant_magic_login' THEN (SELECT count(*) FROM public.applicant_login_queue q
                                          WHERE q.created_at >= now() - interval '7 days')
      WHEN 'applicant_nudge' THEN (SELECT count(*) FROM public.applications a
                                    WHERE a.created_at BETWEEN now() - interval '10 days' AND now() - interval '1 day'
                                      AND a.record_type = 'application' AND coalesce(a.is_duplicate, false) = false
                                      AND a.email IS NOT NULL AND a.terminated_at IS NULL AND a.closed_at IS NULL)
      WHEN 'applicant_followup' THEN (SELECT count(*) FROM public.applications a
                                       WHERE a.created_at BETWEEN now() - interval '15 days' AND now() - interval '3 days'
                                         AND a.record_type = 'application' AND coalesce(a.is_duplicate, false) = false
                                         AND a.email IS NOT NULL AND a.terminated_at IS NULL AND a.closed_at IS NULL)
      WHEN 'next_step_ladder' THEN (SELECT count(*) FROM public.next_step_messages m
                                     WHERE m.fallback_of_id IS NULL AND m.created_at >= now() - interval '7 days')
      WHEN 'newhire_onboarding' THEN (SELECT count(*) FROM public.agent_onboarding_queue q
                                       WHERE q.target_send_at BETWEEN now() - interval '7 days' AND now())
      WHEN 'onboarding_call_invites' THEN (SELECT count(*) FROM public.onboarding_call_invites i
                                            WHERE i.created_at >= now() - interval '7 days')
    END AS eligible_7d,
    CASE s.key
      WHEN 'onboarding_call_invites' THEN (SELECT count(*) FROM public.onboarding_call_invites i
                                            WHERE i.sent_at >= now() - interval '7 days' AND i.resend_message_id IS NOT NULL)
      ELSE (SELECT coalesce(sum(d.receipted), 0) FROM d
             WHERE d.sequence = s.key OR d.sequence = ANY (coalesce(s.subject_families, '{}'::text[])))
    END AS receipted_sends_7d,
    (SELECT coalesce(sum(d.delivered), 0) FROM d
      WHERE d.sequence = s.key OR d.sequence = ANY (coalesce(s.subject_families, '{}'::text[]))) AS delivered_7d,
    (SELECT coalesce(sum(d.bounced), 0) FROM d
      WHERE d.sequence = s.key OR d.sequence = ANY (coalesce(s.subject_families, '{}'::text[]))) AS bounced_7d,
    (SELECT max(d.last_receipt_at) FROM d
      WHERE d.sequence = s.key OR d.sequence = ANY (coalesce(s.subject_families, '{}'::text[]))) AS last_receipt_at
  FROM public.recruit_sequences s
)
SELECT key, audience, channel, status, owner, grade_mode, cron_jobname, endpoint,
       expected_min_sends_7d, eligible_7d, receipted_sends_7d, delivered_7d, bounced_7d, last_receipt_at,
       CASE
         WHEN status <> 'active' THEN status
         WHEN grade_mode = 'ungraded' OR eligible_7d IS NULL THEN 'ungraded'
         WHEN eligible_7d = 0 THEN 'idle'
         WHEN receipted_sends_7d = 0 THEN 'critical_no_receipts'
         WHEN receipted_sends_7d < expected_min_sends_7d THEN 'below_expected'
         ELSE 'ok'
       END AS verdict
  FROM m;
COMMENT ON VIEW public.v_recruit_sequence_health IS
  'WP4: per recruit sequence, eligible population vs receipted sends (provider id) in 7d. critical_no_receipts = active, graded, people eligible, zero receipts.';
REVOKE ALL ON public.v_recruit_sequence_health FROM PUBLIC, anon;
GRANT SELECT ON public.v_recruit_sequence_health TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. One-row guard view for apex-doctor #45. Scalar subqueries only, so it
--    returns exactly one row in every state (never blank-green).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_wp4_delivery_truth_health
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.email_events) AS email_events_rows,
  (SELECT max(seen_at) FROM public.email_events) AS email_events_last_seen_at,
  (SELECT max(first_seen_at) FROM public.email_events) AS email_events_last_new_at,
  (SELECT count(*) FROM public.v_recruit_sequence_health WHERE verdict = 'critical_no_receipts') AS sequences_critical,
  (SELECT string_agg(key, ',' ORDER BY key) FROM public.v_recruit_sequence_health WHERE verdict = 'critical_no_receipts') AS sequences_critical_keys,
  (SELECT count(*) FROM public.v_recruit_sequence_health WHERE verdict = 'below_expected') AS sequences_below,
  (SELECT count(*) FROM public.next_step_messages p
    WHERE p.fallback_of_id IS NULL
      AND p.created_at >= greatest(now() - interval '7 days',
            coalesce((SELECT nullif(value, '')::timestamptz FROM public.system_settings WHERE key = 'wp4_ladder_fix_deployed_at'), now()))
      AND (p.external_id LIKE 'gateway:%'
           OR EXISTS (SELECT 1 FROM public.next_step_messages c
                       WHERE c.fallback_of_id = p.id AND c.channel = 'sms' AND c.external_id LIKE 'gateway:%'))
      AND NOT EXISTS (SELECT 1 FROM public.next_step_messages c
                       WHERE c.fallback_of_id = p.id AND c.channel = 'email')
      AND coalesce(p.metadata->>'email_rung', '') = '') AS ladder_gateway_without_email_7d,
  (SELECT count(*) FROM public.email_events e
    WHERE e.created_at >= now() - interval '7 days'
      AND e.template_hint IN ('applicant_welcome', 'applicant_magic_login', 'applicant_followup', 'applicant_nudge', 'partial_recovery', 'licensing_drip')) AS applicant_sends_7d,
  (SELECT count(*) FROM public.email_events e
    WHERE e.created_at >= now() - interval '7 days'
      AND e.template_hint IN ('applicant_welcome', 'applicant_magic_login', 'applicant_followup', 'applicant_nudge', 'partial_recovery', 'licensing_drip')
      AND e.last_event IN ('bounced', 'complained', 'suppressed')) AS applicant_dead_7d,
  (SELECT count(*) FROM public.applications WHERE email_bounced_at IS NOT NULL) AS applications_bounced,
  (SELECT count(*) FROM public.agents WHERE email_bounced_at IS NOT NULL) AS agents_bounced,
  (SELECT count(*) FROM public.notification_log n
    WHERE n.channel = 'sms-auto' AND n.created_at >= now() - interval '7 days'
      AND n.metadata->>'refusal' = 'skipped_no_consent') AS sms_skipped_no_consent_7d;
COMMENT ON VIEW public.v_wp4_delivery_truth_health IS 'WP4 guard row for apex-doctor check #45.';
REVOKE ALL ON public.v_wp4_delivery_truth_health FROM PUBLIC, anon;
GRANT SELECT ON public.v_wp4_delivery_truth_health TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Crons. Delete the dead inactive ones; stop the Telegram inactivity
--     sweep; slow the Telegram drain. Never touches license-milestone-sms-drain
--     (WP1) or any active cron another package owns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid, jobname FROM cron.job
            WHERE jobname IN ('apex-licensing-sequences', 'pl088_license_milestone_drain', 'notion_sync_drain',
                              'apex-license-renewal-daily-9am-ct', 'apex-outreach-sender-5min')
              AND active = false
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;

  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'telegram_inactivity_queue_15min' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;

  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'telegram_drain_5min' AND schedule <> '2,32 * * * *' LOOP
    PERFORM cron.alter_job(job_id := j.jobid, schedule := '2,32 * * * *');
  END LOOP;
END $$;
