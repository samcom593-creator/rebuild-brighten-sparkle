-- MP-499: the to_jsonb-into-text corruption had no guard, because the writer
-- that produced it is invisible to every repo guard.
--
-- HISTORY. system_settings.value is `text`. Twice now a writer has passed a
-- JSON *scalar* into it -- to_jsonb(x) / JSON.stringify(x) -- so the column
-- stored the two quote characters as literal data:
--   MP-400  agent_link_session_cookie  -> a LIVE cookie 401'd for 7h
--   MP-498  seminar_meeting_url        -> the public /seminar CTA reached
--                                         Calendly for nobody, and failed the
--                                         page's own startsWith('http') test
-- 8 more rows still hold the shape today (see FROZEN SET below).
--
-- WHY THIS IS A DATABASE TRIGGER AND NOT A REPO CHECK. MP-498 handed forward
-- "a guard there would have caught all 14 at once". Measured: a *repo* guard
-- would have caught ZERO of them. Every write path in the repo passes a plain
-- string (bot-sql/index.ts:124, numbers-reminder:312, apex-audit-engine:493,
-- postmark-approval-monitor:66, call-lab-tts:46, AgentLinkSync.tsx:71-73,
-- ContentLibrary.tsx:125). None produces the shape. The corruption arrived by
-- hand-applied SQL through bot-sql, which is exactly the path no file in this
-- repo models -- the same reason a71e321c had to put the PII check in
-- apex-doctor against pg_proc instead of against supabase/migrations. The
-- table is the only place that sees every writer.
--
-- THE RULE IS MOVEMENT, NOT STATE. The check fires only when the value is
-- actually CHANGING (INSERT, or UPDATE with a distinct value). A permanently
-- red guard is one everybody learns to skip: grading raw state would make the
-- 8 legacy rows un-updatable for any reason -- `set updated_at = now()` on a
-- row nobody is corrupting would fail for a fault its writer did not commit.
-- New corruption cannot enter; the frozen set is grandfathered and named.
--
-- IT REFUSES, IT DOES NOT REPAIR. A trigger that silently btrim'd the quotes
-- would change a value behind its caller's back and report success -- the
-- fake-success disease wearing the costume of a fix. It would also be an
-- ARMING: insuracloud_api_token is deliberately left broken (MP-498 refusal 4)
-- because its being unusable is what stops sweepUnsynced() POSTing into the
-- book commissions are computed from, and an incidental re-upsert would
-- silently make it live. This trigger never modifies a row and never touches
-- the 8 that already exist.
--
-- FROZEN SET at install (all 8 reader-less and unwritten since 2026-06-03;
-- the two that DID have a live reader were fixed by MP-498):
--   apex_bots_primary_host, insuracloud_api_base_url, insuracloud_api_token,
--   manychat_api_token, telegram_bot_id, telegram_invite_url,
--   telegram_webhook_set_at, telegram_webhook_url
--
-- NOT MATCHED, on purpose: the 5 rows holding real JSON *objects*
-- (agentlink_master_invite, carrier_comp_blacklist, ethos_agents_sheet,
-- mentorship_payment_links, stripe_webhook_apex) begin with '{', not '"'.
-- A JSON object in a text column is a legitimate encoding a reader parses; a
-- JSON-quoted *scalar* is not, because the column already holds strings, so
-- the quotes add nothing but breakage. Known cost of the rule: a config value
-- that is genuinely a human quotation ("Average is the disease") would be
-- refused. None exists in the 84 rows, and the exception says how to proceed.

create or replace function public.fn_system_settings_reject_json_quoted()
returns trigger
language plpgsql
as $$
begin
  -- Movement only. An UPDATE that leaves value byte-identical is not this
  -- writer's fault and must not be blocked (see THE RULE IS MOVEMENT above).
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return new;
  end if;

  if new.value is not null
     and length(new.value) >= 2
     and left(new.value, 1) = '"'
     and right(new.value, 1) = '"'
  then
    raise exception
      'system_settings.value for key %: refusing a JSON-quoted scalar (%). '
      'The column is text -- the two quote characters would be stored as '
      'literal data and every reader would get them back. This has shipped '
      'twice already (MP-400 killed a live cookie, MP-498 killed the public '
      '/seminar CTA).',
      new.key, left(new.value, 48)
      using errcode = '22P02',
            hint = 'Write the plain string. If the value came from to_jsonb(x) '
                   'or JSON.stringify(x), pass x directly; to unwrap an '
                   'existing jsonb use  x #>> ''{}''  (or ->>0 for an array).';
  end if;

  return new;
end;
$$;

comment on function public.fn_system_settings_reject_json_quoted() is
  'MP-499: refuses a JSON-quoted scalar into system_settings.value. Grades '
  'MOVEMENT (INSERT, or UPDATE with a distinct value) so the 8 legacy rows '
  'stay updatable. Never modifies a row -- repairing insuracloud_api_token '
  'silently would be an arming, not a fix.';

drop trigger if exists trg_system_settings_reject_json_quoted on public.system_settings;
create trigger trg_system_settings_reject_json_quoted
  before insert or update on public.system_settings
  for each row execute function public.fn_system_settings_reject_json_quoted();

-- ---------------------------------------------------------------------------
-- The verdict surface. A trigger that can be dropped in one statement and
-- noticed by nobody is not a guard, so apex-doctor Check #66 grades this view.
--
-- Keyed on a NAMED SET, not a count. MP-357: a count-only floor is fungible --
-- one legacy row getting repaired would open a slot for one novel corruption
-- and the number would never move. `novel_keys` names what is new; repairing a
-- legacy row shows up as `repaired_keys` and is good news, not headroom.
--
-- All scalar subqueries and no time filter, so it returns exactly ONE ROW in
-- every state including an empty table. eecd7fb4's Stripe view filtered to a
-- 30-day window, returned zero rows once the pipeline went dark, and empty
-- read as "nothing wrong" on every surface it fed.
create or replace view public.v_system_settings_quote_guard as
with frozen(key) as (
  values ('apex_bots_primary_host'), ('insuracloud_api_base_url'),
         ('insuracloud_api_token'),  ('manychat_api_token'),
         ('telegram_bot_id'),        ('telegram_invite_url'),
         ('telegram_webhook_set_at'),('telegram_webhook_url')
),
quoted as (
  select key from public.system_settings
   where value is not null and length(value) >= 2
     and left(value,1) = '"' and right(value,1) = '"'
)
select
  (select coalesce(tgenabled::text,'MISSING') from pg_trigger
     where tgrelid = 'public.system_settings'::regclass
       and tgname  = 'trg_system_settings_reject_json_quoted')          as trigger_state,
  (select count(*) from frozen)                                        as frozen_expected,
  (select count(*) from quoted)                                        as quoted_now,
  (select coalesce(array_agg(key order by key),'{}')
     from (select key from quoted except select key from frozen) n)     as novel_keys,
  (select coalesce(array_agg(key order by key),'{}')
     from (select key from frozen except select key from quoted) r)     as repaired_keys;

comment on view public.v_system_settings_quote_guard is
  'MP-499 verdict for apex-doctor Check #66. trigger_state <> ''O'' means the '
  'guard itself is gone (CRITICAL). novel_keys non-empty means corruption '
  'entered anyway, i.e. the trigger was bypassed or dropped and restored '
  '(CRITICAL). The 8 frozen rows are CONTEXT, never a standing warning -- a '
  'guard pinned yellow by a set nobody can clear is one everybody learns to '
  'skip (8d37e7bd).';
