-- PL-WIB-AN-GALAXY: the hire welcome said "You are officially an Galaxy agent."
--
-- The 2026-10-08 rename (Apex Financial -> Galaxy Financial) rewrote 96 template cells by hand in
-- production and swapped the word in place, so every "an Apex" became "an Galaxy". Measured
-- 2026-10-16 23:40Z: three live cells, all in next_step_stages, and 15 sent emails to 8 new hires
-- since 2026-10-10 carry it (next_step_messages, channel email):
--
--   hired           candidate_message_template  "You're an Galaxy agent now, {{first_name}}."
--   hired           email_body_template         "You are officially an Galaxy agent."
--   first_10k_week  next_action_label           "You're an Galaxy producer — stay consistent"
--
-- No other small text column in public carries "an Galaxy", "Galaxy Galaxy" or "Galaxy Financial
-- Financial" (swept every base table under 20k rows, logs and message history excluded). The code
-- held 8 more, fixed in this commit: the AgentFlow page ("becoming an Galaxy elite agent"), a Help
-- Center question, three Interview Recovery lines, the interviews-pipeline hire refusal, a
-- test-email-flows sample and the contract test that asserted the refusal text. A first grep for
-- them used `git grep -E '\b...'` and returned 0 because POSIX ERE has no \b; the guard uses -P.
--
-- The hand rename was never written to a migration, so a rebuild from migrations still seeds the
-- 20260519080500 "an Apex" text and this UPDATE matches nothing there. It only ever changes the
-- article in front of the brand word, so it is safe to replay.
--
-- Pre-image: website-integrity-bot/ledger/snapshots/2026-10-16-next-step-stages-an-galaxy-pre.json
-- Guard: website-integrity-bot/scripts/copy-brand-article.py (daily; a positive control proves the
-- sweep can see the brand word before a clean result counts).

UPDATE public.next_step_stages
   SET candidate_message_template = regexp_replace(regexp_replace(candidate_message_template, '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       email_body_template        = regexp_replace(regexp_replace(email_body_template,        '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       next_action_label          = regexp_replace(regexp_replace(next_action_label,          '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       telegram_template          = regexp_replace(regexp_replace(telegram_template,          '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       sms_template               = regexp_replace(regexp_replace(sms_template,               '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       email_subject_template     = regexp_replace(regexp_replace(email_subject_template,     '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       manager_alert_template     = regexp_replace(regexp_replace(manager_alert_template,     '\man Galaxy\M', 'a Galaxy', 'g'), '\mAn Galaxy\M', 'A Galaxy', 'g'),
       updated_at = now()
 WHERE concat_ws(' ', candidate_message_template, email_body_template, next_action_label, telegram_template,
                 sms_template, email_subject_template, manager_alert_template) ~ '\m[Aa]n Galaxy\M';
