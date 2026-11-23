-- Galaxy copy sweep (Sam, 2026-11-23: "anything that says Apex should say Galaxy").
-- Rewrites live, user-facing copy stored in the DB. Every changed value is
-- preserved in public.brand_galaxy_preimage_20261124 (restore = update from it).
--
-- KEPT ON PURPOSE (Sam's calls, 2026-11-23):
--   * "Apex Financial Empire" / "Apex Financial Empire LLC" — registered legal
--     entity + carrier sub-agency name until the filing is done.
--   * "Galaxy Financial (formerly Apex Financial)" win-back copy in
--     next_step_stages — old leads applied to Apex; consent records name Apex.
--   * "Apex Fit" / "APEX FIT" — product name.
--   * apex-financial.org / apex_* / apex- identifiers (domain + internal keys).
--   * History: sent messages, logs, snapshots, published content, people's names.
-- "Apex Standard" -> "Galaxy Standard" (Sam: agency branding, rename).

create table if not exists public.brand_galaxy_preimage_20261124 (
  tbl text not null,
  row_id text not null,
  col text not null,
  old_value text,
  captured_at timestamptz not null default now()
);
alter table public.brand_galaxy_preimage_20261124 enable row level security;
revoke all on public.brand_galaxy_preimage_20261124 from anon, authenticated;

create or replace function pg_temp.galaxy(t text) returns text
language sql immutable as $fn$
  select regexp_replace(
           regexp_replace(t,
             '\mAPEX\M(?![-_:/@]|\.[A-Za-z]|\s+(FIT|Fit|Financial Empire))', 'Galaxy', 'g'),
           '\mApex\M(?![-_:/@]|\.[A-Za-z]|\s+(FIT|Fit|Financial Empire))', 'Galaxy', 'g')
$fn$;

-- Plaque badge is styled all-caps.
insert into public.brand_galaxy_preimage_20261124 (tbl, row_id, col, old_value)
select 'plaque_awards', id::text, 'badge_label', badge_label
from public.plaque_awards where badge_label ~ '\mAPEX\M';
update public.plaque_awards
set badge_label = regexp_replace(badge_label, '\mAPEX\M', 'GALAXY', 'g')
where badge_label ~ '\mAPEX\M';

-- Old company name used as the company in prose.
insert into public.brand_galaxy_preimage_20261124 (tbl, row_id, col, old_value)
select 'resources', id::text, 'description', description
from public.resources where description ~ 'career at APEX Financial Empire';
update public.resources
set description = replace(description, 'career at APEX Financial Empire', 'career at Galaxy Financial')
where description ~ 'career at APEX Financial Empire';

do $$
declare
  r record;
  n int;
begin
  for r in
    select * from (values
      ('contract_templates', 'subject_template'),
      ('contract_templates', 'body_template'),
      ('onboarding_modules', 'title'),
      ('onboarding_modules', 'description'),
      ('onboarding_questions', 'question'),
      ('onboarding_questions', 'explanation'),
      ('announcements', 'title'),
      ('resources', 'title'),
      ('resources', 'description'),
      ('apex_challenges', 'description'),
      ('telegram_faq', 'question_pattern'),
      ('telegram_faq', 'answer_body'),
      ('sales_scripts', 'title'),
      ('cw_pillars', 'name')
    ) v(tbl, col)
  loop
    execute format(
      'insert into public.brand_galaxy_preimage_20261124 (tbl, row_id, col, old_value)
       select %L, id::text, %L, %I from public.%I
       where %I is distinct from pg_temp.galaxy(%I)',
      r.tbl, r.col, r.col, r.tbl, r.col, r.col);
    execute format(
      'update public.%I set %I = pg_temp.galaxy(%I) where %I is distinct from pg_temp.galaxy(%I)',
      r.tbl, r.col, r.col, r.col, r.col);
    get diagnostics n = row_count;
    raise notice 'galaxy sweep %.%: % rows', r.tbl, r.col, n;
  end loop;
end $$;

-- AgentLink invite button label (system_settings.value).
insert into public.brand_galaxy_preimage_20261124 (tbl, row_id, col, old_value)
select 'system_settings', key, 'value', value::text
from public.system_settings
where key = 'agentlink_master_invite' and value::text like '%Join APEX on AgentLink%';
do $$
declare typ text;
begin
  select data_type into typ from information_schema.columns
  where table_schema = 'public' and table_name = 'system_settings' and column_name = 'value';
  if typ = 'jsonb' then
    update public.system_settings
    set value = replace(value::text, 'Join APEX on AgentLink', 'Join Galaxy on AgentLink')::jsonb
    where key = 'agentlink_master_invite' and value::text like '%Join APEX on AgentLink%';
  else
    execute $u$update public.system_settings
      set value = replace(value::text, 'Join APEX on AgentLink', 'Join Galaxy on AgentLink')
      where key = 'agentlink_master_invite' and value::text like '%Join APEX on AgentLink%'$u$;
  end if;
end $$;
