-- MP-HIRE-CELEBRATION (2026-11-26): an alert and a screen for every hire, the way the
-- deal celebration already works. Slack + email + in-app screen; Discord stays behind
-- the one switch WP7 installed.
--
-- MEASURED BEFORE WRITING (project xrzweoneiieddzxogewk, 2026-11-26 ~02:30Z):
--   * "A hire" is the agents INSERT. On the last 15 agent.hired outbox rows,
--     outbox.created_at - agents.created_at = 0s on every row, so the predicate
--     fn_notify_agent_hired already applies (status active, not deactivated, not
--     inactive, not GHOST_) is the hire predicate. This migration keeps it and adds
--     the is_placeholder_agent() seat check the stage trigger already uses.
--   * Slack: agent.hired is live (14 delivered since 11-01) on recruiting_growth (p1)
--     and general_unlicensed (p5). deal.posted lands on sales_wins (p1) +
--     general_unlicensed (p5). The hire celebration was missing the wins room, so
--     this adds agent.hired -> sales_wins. One-line revert: set that route row
--     is_enabled=false.
--   * Discord: system_settings.discord_notifications_paused='true' since
--     2026-11-10 20:58Z, set DELIBERATELY by WP7 (commit a12c0652, migration
--     20261111100600_wp7_channels.sql: "retire Discord behind one switch"). Every
--     discord outbox row since is skipped BEFORE INSERT by
--     trg_block_paused_discord_outbox; the 4 agent.hired discord rows from before
--     the switch are dead_letter. This migration does NOT unpause Discord. The
--     discord leg below is kept byte-for-byte so flipping that one switch restores
--     Discord hire posts with no code change.
--   * Email: no hire email existed anywhere. A third outbox row per hire,
--     destination 'email', is delivered by apex-outbox-dispatcher.deliverHireEmail
--     to the owner inbox + the recruiting manager (resolved at SEND time, departed
--     managers skipped, email_unsubscribes and the owner mute honoured).
--   * BUG FIXED IN PASSING: the deployed Slack template (v375) only accepts links
--     that start with https://galaxyfinancial.org/ (safeSlackUrl), while this
--     function still wrote apex-financial.org links. Both hire links therefore fell
--     back to generic defaults: "open profile" opened the recruiting pipeline. The
--     payload URLs now carry the galaxyfinancial.org host.
--
-- Idempotent throughout. Applied via Supabase MCP apply_migration.

-- ---------------------------------------------------------------------------
-- 1. Hire enqueuer: + placeholder guard, + email leg, + galaxyfinancial.org links
-- ---------------------------------------------------------------------------
create or replace function public.fn_notify_agent_hired()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_manager text;
  v_payload jsonb;
begin
  if coalesce(new.status::text, '') <> 'active' then return new; end if;
  if coalesce(new.is_deactivated, false) or coalesce(new.is_inactive, false) then return new; end if;
  if coalesce(new.agent_code, '') like 'GHOST_%' then return new; end if;
  -- MP-HIRE-CELEBRATION: a sync placeholder seat (GHOST% code with no login) is a
  -- row, not a person. Same predicate fn_agents_default_stage uses.
  if public.is_placeholder_agent(new.agent_code, new.user_id) then return new; end if;

  -- Credit the person who ACTUALLY recruited them. manager_id defaults to the
  -- owner: measured on 44 hires in 90 days, 10 carried an invited_by_manager_id
  -- that disagreed with manager_id and manager_id was "Samuel James" on all ten
  -- while invited_by held the real recruiter. Same precedence the recruiting
  -- milestones, show-up tracking and deliverHireEmail use.
  select display_name into v_manager from public.agents
   where id = coalesce(new.invited_by_manager_id, new.manager_id);
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'agentName', new.display_name,
    'agentCode', new.agent_code,
    'managerName', v_manager,
    'licenseStatus', new.license_status::text,
    'onboardingStage', new.onboarding_stage::text,
    'hiredAt', to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'contractingUrl', 'https://galaxyfinancial.org/start-contracting',
    'openUrl', 'https://galaxyfinancial.org/dashboard/profile?agentId=' || new.id::text
  ));

  -- One row per channel (slack, discord, email), one idempotency key per
  -- (hire, channel): a status flip on the same agent later re-enters this
  -- function and inserts nothing. The discord row is skipped BEFORE INSERT by
  -- trg_block_paused_discord_outbox while the WP7 switch is on.
  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  )
  select 'agent', new.id, 'agent.hired', channel.name, v_payload,
         'agent.hired:' || new.id::text || ':' || channel.name, gen_random_uuid()
  from unnest(array['slack', 'discord', 'email']) as channel(name)
  on conflict (idempotency_key) do nothing;

  return new;
exception when others then
  raise warning 'fn_notify_agent_hired failed for agent % (%): %', new.id, new.display_name, sqlerrm;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Slack: the hire joins the wins room the deal celebration posts to.
-- ---------------------------------------------------------------------------
insert into public.messaging_route_rules
  (installation_id, event_type, destination_id, audience_scope, hierarchy_rule,
   template_version, priority, batch_policy, is_enabled)
select d.installation_id, 'agent.hired', d.id, 'organization', '{}'::jsonb, 1, 3, 'instant', true
from public.messaging_destinations d
where d.purpose = 'sales_wins'
  and d.is_enabled
  and not exists (
    select 1 from public.messaging_route_rules r
    where r.installation_id = d.installation_id
      and r.event_type = 'agent.hired'
      and r.destination_id = d.id
      and r.audience_scope = 'organization');

-- ---------------------------------------------------------------------------
-- 3. Truth view: one row per hire in the last 30 days, one verdict per channel.
--    Scalar joins on the idempotency keys, so a missing row reads as the
--    REASON it is missing (retired switch / predates this leg), never blank.
--    No names: agent_id only. service_role only (apex-doctor via bot-sql).
-- ---------------------------------------------------------------------------
create or replace view public.v_hire_celebration_truth as
with hires as (
  select a.id, a.created_at as hired_at, a.license_status::text as license_status
  from public.agents a
  where a.created_at >= now() - interval '30 days'
    and a.status::text = 'active'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.agent_code, '') not like 'GHOST%'
    and not public.is_placeholder_agent(a.agent_code, a.user_id)
)
select
  h.id as agent_id,
  h.hired_at,
  h.license_status,
  coalesce(s.status, 'not_enqueued') as slack_status,
  (select count(*) from public.messaging_delivery_receipts r
    where r.outbox_event_id = s.id and r.status = 'delivered') as slack_channels_delivered,
  case
    when d.id is not null then d.status
    when public.fn_discord_paused() then 'retired_by_switch'
    else 'not_enqueued'
  end as discord_status,
  case
    when e.id is not null then e.status
    -- the email leg went live with this migration (version 20261126014627);
    -- older hires never had a row
    when h.hired_at < '2026-11-26T01:46:27Z'::timestamptz then 'predates_email_leg'
    else 'not_enqueued'
  end as email_status,
  (select da.provider_message_id from public.delivery_attempts da
    where da.outbox_event_id = e.id and da.status = 'delivered'
    order by da.finished_at desc nulls last limit 1) as email_provider_message_id
from hires h
left join public.outbox_events s on s.idempotency_key = 'agent.hired:' || h.id::text || ':slack'
left join public.outbox_events d on d.idempotency_key = 'agent.hired:' || h.id::text || ':discord'
left join public.outbox_events e on e.idempotency_key = 'agent.hired:' || h.id::text || ':email'
order by h.hired_at desc;

revoke all on public.v_hire_celebration_truth from anon, authenticated;
grant select on public.v_hire_celebration_truth to service_role;
