-- Add Agent: NPN + license capture, and the "license came back" alert.
-- Sam 2026-08-06: "once you click add agent, you put in the NPN number and
-- obviously with their license... I wanna get alerts and emails when you get
-- their life insurance license back."
--
-- REUSE, NOT REBUILD. Everything downstream of the enqueue already exists:
--   * public.agents.nipr_number      — the NPN column. Already declared back in
--     20260110020505. It was simply never captured by any UI: 0 of 178 agent
--     rows have it populated. This migration adds the surrounding license
--     fields; AddAgentModal + the add-agent edge fn start writing them.
--   * apex-alert-dispatch edge fn    — already fans a single alert out to
--     ntfy (Sam's phone) + Resend email + Discord + SMS. severity='celebrate'
--     is a STANDALONE severity, so it dispatches immediately instead of being
--     held for the morning digest. We post to it exactly the way
--     notify_sam_on_licensing_milestone() already does for applications.
--   * public.bot_alerts              — the dispatcher's own receipt table.
--
-- What genuinely did NOT exist: any agents-level license transition alert.
-- Every existing licensing notification (notify_sam_on_licensing_milestone,
-- fn_manager_alerts_licensed_application, trg_bot_alert_newly_licensed, ...)
-- fires on public.applications.license_progress. An agent whose license comes
-- back AFTER they are already in the agents table produced zero notifications.
-- That is the gap this closes.

-- ---------------------------------------------------------------------------
-- 1. License capture columns on agents
-- ---------------------------------------------------------------------------
alter table public.agents
  add column if not exists license_number   text,
  add column if not exists licensed_at      timestamptz,
  add column if not exists nipr_verified    boolean not null default false,
  add column if not exists nipr_verified_at timestamptz;

comment on column public.agents.nipr_number is
  'NPN (National Producer Number). Sam calls this "the NPN"; NIPR is the registry that issues it. Self-reported at Add Agent time — nipr_verified stays false until a real NIPR lookup confirms it.';
comment on column public.agents.license_number is
  'Resident-state license number as issued by the state DOI. Distinct from the NPN.';
comment on column public.agents.licensed_at is
  'Stamped the moment license_status first transitions to licensed. Never backdated.';
comment on column public.agents.nipr_verified is
  'TRUE only after a real NIPR lookup. Defaults false so the UI trust chip cannot claim verification we do not have.';

create index if not exists idx_agents_nipr_number
  on public.agents (nipr_number)
  where nipr_number is not null and btrim(nipr_number) <> '';

-- ---------------------------------------------------------------------------
-- 2. Idempotency ledger — the thing that makes double-sends impossible
-- ---------------------------------------------------------------------------
-- The unique(agent_id, milestone) constraint is the ONLY guarantee that
-- matters here. The trigger inserts with ON CONFLICT DO NOTHING and only
-- dispatches when the insert actually created a row. That means:
--   * a bulk UPDATE flipping 129 agents to licensed enqueues at most 1 row
--     per agent, never 2;
--   * re-running the same UPDATE enqueues 0;
--   * a backfill script that touches every agent row enqueues 0 for anyone
--     already in this table.
create table if not exists public.agent_license_alerts (
  id                    uuid primary key default gen_random_uuid(),
  agent_id              uuid not null references public.agents(id) on delete cascade,
  milestone             text not null default 'licensed',
  prev_status           text,
  new_status            text,
  -- pending | dispatch_requested | suppressed_backfill | failed
  status                text not null default 'pending',
  dispatch_requested_at timestamptz,
  net_request_id        bigint,
  last_error            text,
  created_at            timestamptz not null default now(),
  constraint agent_license_alerts_once unique (agent_id, milestone)
);

comment on table public.agent_license_alerts is
  'One row per agent per license milestone, forever. The unique(agent_id, milestone) constraint is the idempotency guarantee for the license-came-back alert — the trigger only dispatches when its ON CONFLICT DO NOTHING insert actually created a row.';

create index if not exists idx_agent_license_alerts_status
  on public.agent_license_alerts (status, created_at desc);

alter table public.agent_license_alerts enable row level security;

drop policy if exists agent_license_alerts_admin_all on public.agent_license_alerts;
create policy agent_license_alerts_admin_all
  on public.agent_license_alerts
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

revoke all on table public.agent_license_alerts from anon;
grant select on table public.agent_license_alerts to authenticated;
grant all on table public.agent_license_alerts to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill-storm circuit breaker
-- ---------------------------------------------------------------------------
-- 129 of 178 agents are ALREADY license_status='licensed'. If any future
-- migration, import, or dedup wave re-touches those rows, the trigger must not
-- fire 129 pushes at Sam's phone. Seeding them as suppressed_backfill makes
-- that structurally impossible — the unique constraint swallows every one.
-- This repo has been burned by exactly this (465 InsuraCloud + 198 AgentLink
-- fake-success rows; the Discord backfill spam guard). Seed first, arm second.
insert into public.agent_license_alerts (agent_id, milestone, new_status, status)
select a.id, 'licensed', a.license_status::text, 'suppressed_backfill'
from public.agents a
where a.license_status::text = 'licensed'
on conflict (agent_id, milestone) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Stamp licensed_at on the transition (BEFORE — no recursion)
-- ---------------------------------------------------------------------------
create or replace function public.fn_stamp_agent_licensed_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.license_status::text = 'licensed'
     and (tg_op = 'INSERT' or old.license_status::text is distinct from new.license_status::text)
     and new.licensed_at is null then
    new.licensed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_agents_stamp_licensed_at on public.agents;
create trigger trg_agents_stamp_licensed_at
  before insert or update of license_status on public.agents
  for each row execute function public.fn_stamp_agent_licensed_at();

-- ---------------------------------------------------------------------------
-- 5. The alert itself (AFTER UPDATE only)
-- ---------------------------------------------------------------------------
-- Deliberately NOT on INSERT. An agent added through Add Agent who is already
-- licensed is a hire, not a "license came back" event — and the hire already
-- has its own notification chain (trg_agent_inserted_discord,
-- telegram_broadcast_new_hire, welcome-new-agent). Firing here too would just
-- double-notify Sam on every single licensed add.
create or replace function public.fn_agent_license_returned_alert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows        integer := 0;
  v_url         text;
  v_key         text;
  v_name        text;
  v_email       text;
  v_npn         text;
  v_subject     text;
  v_sms         text;
  v_html        text;
  v_req_id      bigint;
begin
  -- Genuine transition into licensed only.
  if new.license_status::text is distinct from 'licensed' then
    return new;
  end if;
  if old.license_status::text is not distinct from new.license_status::text then
    return new;
  end if;

  -- Claim the alert. If a row already exists (backfill seed, or a previous
  -- transition), this inserts nothing and we send nothing.
  insert into public.agent_license_alerts
    (agent_id, milestone, prev_status, new_status, status)
  values
    (new.id, 'licensed', old.license_status::text, new.license_status::text, 'pending')
  on conflict (agent_id, milestone) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return new;
  end if;

  select p.full_name, p.email
    into v_name, v_email
  from public.profiles p
  where p.id = new.profile_id;

  v_name  := coalesce(nullif(btrim(coalesce(v_name, '')), ''), new.display_name, 'Agent ' || new.id::text);
  v_npn   := nullif(btrim(coalesce(new.nipr_number, '')), '');

  v_subject := format('LICENSE BACK — %s is field-ready', v_name);
  v_sms     := format('APEX: %s license came back. NPN %s. Contract + field-ready now.',
                      v_name, coalesce(v_npn, 'not on file'));
  v_html    := format(
    '<p><strong>%s just came back licensed.</strong></p>'
    || '<p>Email: %s<br/>NPN: %s<br/>License #: %s<br/>States: %s<br/>NIPR verified: %s</p>'
    || '<p>Next: get them contracted and into the field.</p>'
    || '<p><a href="https://apex-financial.org/dashboard/crm">Open CRM</a></p>',
    v_name,
    coalesce(v_email, '—'),
    coalesce(v_npn, 'not on file'),
    coalesce(nullif(btrim(coalesce(new.license_number, '')), ''), '—'),
    coalesce(array_to_string(new.license_states, ', '), '—'),
    case when new.nipr_verified then 'yes' else 'NO — self-reported' end);

  select value into v_url from public.system_settings where key = 'supabase_url';
  select value into v_key from public.system_settings where key = 'supabase_anon_key';
  if v_url is null then v_url := 'https://xrzweoneiieddzxogewk.supabase.co'; end if;

  if v_key is null then
    -- No creds = no send. Record the failure honestly instead of leaving a
    -- 'pending' row that looks like it is merely in flight.
    update public.agent_license_alerts
       set status = 'failed',
           last_error = 'supabase_anon_key missing from system_settings'
     where agent_id = new.id and milestone = 'licensed';
    return new;
  end if;

  -- One POST. apex-alert-dispatch inserts its own bot_alerts row and, because
  -- severity='celebrate' is STANDALONE, immediately fans out to ntfy + email +
  -- Discord + SMS. We do not insert bot_alerts ourselves — that would either
  -- double-send or race the dispatcher.
  select net.http_post(
    url     := v_url || '/functions/v1/apex-alert-dispatch',
    body    := jsonb_build_object(
                 'source',      'trigger',
                 'event_type',  'agent_license_returned',
                 'severity',    'celebrate',
                 'subject',     v_subject,
                 'body',        v_html,
                 'sms_body',    v_sms,
                 'action_link', 'https://apex-financial.org/dashboard/crm',
                 'channels',    jsonb_build_array('email', 'sms', 'discord', 'ntfy')),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key,
                 'apikey',        v_key)
  ) into v_req_id;

  -- pg_net is fire-and-forget: the response is NOT visible in this
  -- transaction (see memory apex_pg_net_visibility). So we record
  -- 'dispatch_requested', never 'sent'. v_agent_license_alert_health below
  -- reconciles against bot_alerts to prove whether it actually landed.
  update public.agent_license_alerts
     set status = 'dispatch_requested',
         dispatch_requested_at = now(),
         net_request_id = v_req_id
   where agent_id = new.id and milestone = 'licensed';

  return new;
end;
$function$;

drop trigger if exists trg_agent_license_returned_alert on public.agents;
create trigger trg_agent_license_returned_alert
  after update of license_status on public.agents
  for each row execute function public.fn_agent_license_returned_alert();

-- ---------------------------------------------------------------------------
-- 6. Receipts — did the alert actually land?
-- ---------------------------------------------------------------------------
-- 'dispatch_requested' is a request, not a delivery. This view joins each
-- claimed alert to the bot_alerts row the dispatcher should have created and
-- sent, so a silently-dropped push shows up as delivery_state='NO RECEIPT'
-- instead of reading as success.
create or replace view public.v_agent_license_alert_health as
select
  ala.id,
  ala.agent_id,
  coalesce(p.full_name, a.display_name) as agent_name,
  a.nipr_number,
  a.nipr_verified,
  a.licensed_at,
  ala.status,
  ala.dispatch_requested_at,
  ala.last_error,
  ba.sent_at   as alert_sent_at,
  ba.sent_email_id,
  case
    when ala.status = 'suppressed_backfill'                      then 'SUPPRESSED (pre-existing)'
    when ala.status = 'failed'                                   then 'FAILED'
    when ba.id is null and ala.status = 'dispatch_requested'
         and ala.dispatch_requested_at < now() - interval '15 minutes'
                                                                 then 'NO RECEIPT'
    when ba.id is null                                           then 'IN FLIGHT'
    when ba.sent_at is null                                      then 'QUEUED NOT SENT'
    else 'DELIVERED'
  end as delivery_state
from public.agent_license_alerts ala
join public.agents a on a.id = ala.agent_id
left join public.profiles p on p.id = a.profile_id
left join lateral (
  select b.id, b.sent_at, b.sent_email_id
  from public.bot_alerts b
  where b.event_type = 'agent_license_returned'
    and b.created_at >= ala.dispatch_requested_at - interval '1 minute'
    and b.subject like '%' || coalesce(p.full_name, a.display_name, '~none~') || '%'
  order by b.created_at asc
  limit 1
) ba on true;

comment on view public.v_agent_license_alert_health is
  'Reconciles every claimed license-came-back alert against the bot_alerts row the dispatcher should have produced. delivery_state = NO RECEIPT means the pg_net POST never turned into a real send — treat as a failure, not as pending.';

-- ---------------------------------------------------------------------------
-- 7. Ethos <-> agent linkability, measured honestly
-- ---------------------------------------------------------------------------
-- Sam asked to "integrate that Ethos spreadsheet with Add Agent". There is no
-- spreadsheet on this machine; the data lives in public.ethos_book_policies
-- (1,468 rows, imported from 'sam j - Sheet1.csv'). It CANNOT currently be
-- joined to agents:
--   * ethos_book_policies has no NPN / producer-number column at all;
--   * its only producer identifier is source_agent_names (text[]);
--   * 1,010 distinct names appear there and ZERO of them match any of the 582
--     distinct names across public.agents.display_name + public.profiles.full_name;
--   * owner_agent_id is populated on all 1,468 rows but points at a single
--     agent, so it is an import placeholder, not real attribution.
-- Shipping a name-based join would have manufactured fake attribution. Instead
-- this view reports the real linkability numbers so the gap stays visible, and
-- the NPN now captured at Add Agent time becomes the key that makes a future
-- NPN-bearing Ethos export joinable for real.
create or replace view public.v_ethos_agent_link_health as
with ethos_names as (
  select distinct lower(btrim(unnest(source_agent_names))) as nm
  from public.ethos_book_policies
),
apex_names as (
  select lower(btrim(full_name)) as nm from public.profiles where full_name is not null
  union
  select lower(btrim(display_name)) from public.agents where display_name is not null
)
select
  (select count(*) from public.ethos_book_policies)                      as ethos_policy_rows,
  (select count(*) from ethos_names)                                     as ethos_distinct_producer_names,
  (select count(*) from apex_names)                                      as apex_distinct_people_names,
  (select count(*) from ethos_names where nm in (select nm from apex_names))
                                                                         as names_matched,
  (select count(*) from public.ethos_book_policies e
     where exists (select 1 from unnest(e.source_agent_names) u
                   where lower(btrim(u)) in (select nm from apex_names)))
                                                                         as policy_rows_attributable,
  (select count(*) from public.agents)                                   as agents_total,
  (select count(*) from public.agents
     where nipr_number is not null and btrim(nipr_number) <> '')         as agents_with_npn,
  false                                                                  as ethos_has_npn_column;

comment on view public.v_ethos_agent_link_health is
  'Honest measurement of whether the Ethos book can be attributed to Apex agents. As of 2026-08-06: 0 of 1010 Ethos producer names match any Apex person, so 0 of 1468 policy rows are attributable. Ethos carries no NPN column. Do not build a name-based join off this data.';

grant select on public.v_agent_license_alert_health to authenticated;
grant select on public.v_ethos_agent_link_health   to authenticated;
