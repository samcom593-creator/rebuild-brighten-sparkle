-- wave-applicant-alert-revival (PL-SAM-2026-06-03-003)
--
-- fn_post_new_applicant_to_onboarding_chat shipped 2026-06-01 and has been a
-- silent no-op ever since. 105 applicants landed in the last 30 days and not one
-- alert fired. THREE independent defects, all silent:
--
--   1. TOKEN: the fn read system_settings.telegram_bot_token. That row has never
--      existed (only telegram_bot_id / _username / _webhook_url do). Bailed with
--      RETURN NEW, no log.
--   2. CHAT: the only onboarding row is chat_id -1006, is_active=false — a
--      placeholder. Bailed with RETURN NEW, no log. The old guard was
--      `chat_id <> 0`, which would have cheerfully POSTed to a placeholder id
--      had anyone flipped is_active.
--   3. ENUM LANDMINE: COALESCE(NEW.license_status, 'unknown') makes Postgres
--      coerce the text literal into enum license_status and throw
--      "invalid input value for enum license_status: unknown". Defects 1+2 were
--      masking it. The moment Sam registered a real group, this fn — on an
--      INSERT trigger on public.applications — would have aborted every single
--      applicant INSERT. The dormancy was hiding a live outage.
--
-- Token is stored in Vault, NOT system_settings: that table carries
-- "Authenticated users can read system settings" USING (true), so any logged-in
-- user could have read the bot token. The secret is set out-of-band via bot-sql
-- (see below) and is deliberately absent from this file so it never enters git.
--
--   select vault.create_secret('<token>', 'telegram_bot_token', '...');
--
-- Applied live via bot-sql 2026-08-07 and verified end-to-end: synthetic
-- applicant INSERT -> trigger -> telegram_broadcast_log status='sent'
-- chat_id=6018839640 target_type='ai_dm' -> net._http_response 200
-- {"ok":true,"result":{"message_id":14544,...,"chat":{"id":6018839640}}}.
-- Synthetic applicant + its next_step_progress/next_step_events rows deleted
-- after proof; 0 stray rows remain.

-- Kill the silent no-op forever: every attempt AND every skip gets a row, with
-- the reason. Dormancy is now visible instead of invisible.
create table if not exists public.telegram_broadcast_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null,
  application_id uuid,
  chat_id bigint,
  target_type text,
  status text not null,           -- sent | skipped | error
  detail text
);
create index if not exists idx_tg_broadcast_log_created
  on public.telegram_broadcast_log(created_at desc);

alter table public.telegram_broadcast_log enable row level security;
drop policy if exists "Admins read telegram broadcast log" on public.telegram_broadcast_log;
create policy "Admins read telegram broadcast log" on public.telegram_broadcast_log
  for select using (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.fn_post_new_applicant_to_onboarding_chat()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_chat_id bigint; v_target text; v_token text; v_msg text;
  v_owner_name text; v_owner_username text; v_emoji text;
BEGIN
  -- Real Telegram ids are >= 1e6 in magnitude. Placeholders (-1001, -1006) are not.
  SELECT chat_id, type INTO v_chat_id, v_target FROM telegram_groups
    WHERE type IN ('pipeline','onboarding') AND is_active = true AND abs(chat_id) >= 1000000
    ORDER BY type DESC LIMIT 1;

  -- Fallback to Sam's live AI-control DM so alerts fire TODAY rather than waiting
  -- on the manager group being registered. Auto-upgrades to the group the moment
  -- a real pipeline/onboarding row goes active — no code change needed.
  IF v_chat_id IS NULL THEN
    SELECT chat_id, type INTO v_chat_id, v_target FROM telegram_groups
      WHERE type = 'ai_dm' AND is_active = true AND abs(chat_id) >= 1000000 LIMIT 1;
  END IF;

  IF v_chat_id IS NULL THEN
    INSERT INTO telegram_broadcast_log(event, application_id, status, detail)
      VALUES ('new_applicant', NEW.id, 'skipped', 'no active chat with a real id');
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
    WHERE name='telegram_bot_token' LIMIT 1;
  IF v_token IS NULL OR v_token = '' THEN
    SELECT TRIM('"' FROM value::text) INTO v_token FROM system_settings WHERE key='telegram_bot_token';
  END IF;
  IF v_token IS NULL OR v_token = '' THEN
    INSERT INTO telegram_broadcast_log(event, application_id, chat_id, target_type, status, detail)
      VALUES ('new_applicant', NEW.id, v_chat_id, v_target, 'skipped', 'no bot token in vault or system_settings');
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name,'Unassigned'), COALESCE(tu.username,'')
    INTO v_owner_name, v_owner_username
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN telegram_users tu ON tu.agent_id = a.id
  WHERE a.id = COALESCE(NEW.referral_manager_id, NEW.assigned_agent_id) LIMIT 1;
  IF v_owner_name IS NULL THEN v_owner_name := 'Unassigned'; END IF;

  v_emoji := CASE WHEN NEW.license_status::text = 'licensed' THEN '🔥' ELSE '🆕' END;

  -- PII-light: first name + last name + state ONLY
  v_msg := v_emoji || ' <b>NEW APPLICANT</b> → '
        || CASE WHEN v_owner_username <> '' THEN '@' || v_owner_username
             ELSE '<b>' || v_owner_name || '</b>' END || E'\n\n'
        || '<b>' || TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'')) || '</b>' || E'\n'
        || '📍 ' || COALESCE(NEW.state,'?') || E'\n'
        || '🏷️ ' || COALESCE(NEW.license_status::text,'unknown') || E'\n\n'
        || '🔗 <a href="https://apex-financial.org/admin/applications/' || NEW.id::text || '">Open file</a> for contact info.';

  -- Never let an alert failure abort the applicant INSERT. Losing an applicant
  -- row to a notification bug is strictly worse than losing the notification.
  BEGIN
    PERFORM net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('chat_id', v_chat_id, 'text', v_msg,
        'parse_mode','HTML','disable_web_page_preview', true));
    INSERT INTO telegram_broadcast_log(event, application_id, chat_id, target_type, status, detail)
      VALUES ('new_applicant', NEW.id, v_chat_id, v_target, 'sent', 'queued via net.http_post');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO telegram_broadcast_log(event, application_id, chat_id, target_type, status, detail)
      VALUES ('new_applicant', NEW.id, v_chat_id, v_target, 'error', SQLERRM);
  END;
  RETURN NEW;
END;
$function$;
