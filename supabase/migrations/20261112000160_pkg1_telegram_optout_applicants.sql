-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 7/9: the Telegram rung is off for applicants.
--
-- WHAT
--   telegram_opt_out = true on every application with a linked Telegram chat that has not
--   opted out (7 rows on 2026-11-11: Gabrielle 03be96c0, Derrick 3fdf0b40, Rasha 4ffa8e35,
--   Angel bcb4148d, Bath e4f8e2a1, Alexander 8a404954, Masonn 119f2888). The ids are saved
--   first in system_settings 'anchor_pkg1_telegram_optout_ids' so the change is reversible
--   row for row. Data only: telegram_chat_id is kept.
-- WHY
--   message_map 4c F1 / DECISIONS.md "Telegram rung": 11 of 15 ladder Telegram messages
--   failed (template_missing) and were recorded as sent; while a chat was linked, the email
--   rung never ran. next-step-dispatch now treats Telegram as best effort, and these 7 get
--   the ladder by email only. No message is sent by this migration (no trigger on the column).
-- ROLLBACK
--   update public.applications a set telegram_opt_out = false
--    where a.id in (select (jsonb_array_elements_text(value::jsonb))::uuid
--                     from public.system_settings where key = 'anchor_pkg1_telegram_optout_ids');

insert into public.system_settings (key, value, updated_at)
select 'anchor_pkg1_telegram_optout_ids', coalesce(jsonb_agg(a.id order by a.created_at), '[]'::jsonb)::text, now()
  from public.applications a
 where a.telegram_chat_id is not null
   and coalesce(a.telegram_opt_out, false) = false
on conflict (key) do nothing;

update public.applications a
   set telegram_opt_out = true
 where a.id in (select (jsonb_array_elements_text(s.value::jsonb))::uuid
                  from public.system_settings s
                 where s.key = 'anchor_pkg1_telegram_optout_ids')
   and coalesce(a.telegram_opt_out, false) = false;
