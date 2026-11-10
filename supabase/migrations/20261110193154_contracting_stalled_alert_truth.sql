-- MP-CONTRACTING-STALLED-TRUTH (2026-11-10)
--
-- fn_onboarding_contracting_stalled_alert paged Sam "50 hires stalled in
-- contracting 5d+" as a CRITICAL. Measured against each row on 2026-11-10:
--   * 25 of the 51 rows were agents.status = 'inactive' (left 147-201 days ago).
--     The function only excluded is_deactivated, which none of them carry.
--   * Marquay Vaughns posted 14 deals in the last 60 days. Someone writing
--     business is contracted somewhere; the getting_started bubbles are stale,
--     not the person.
--   * The real set was 25 rows / 24 people (Daniel Bridges has two agent rows).
-- A critical page that is half departed agents trains Sam to skip it, which
-- costs the 6 hires who stalled this month the follow-up they need.
--
-- Change: only agents.status = 'active', and nobody with a posted deal in
-- v_production_unified in the last 60 days. Everything else is unchanged:
-- same 5-day stall bar, same 7-day re-alert stamp, same AHL exemption, same
-- message shape, same ntfy-only channel.
create or replace function public.fn_onboarding_contracting_stalled_alert()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare body_list text; n int;
begin
  with exempt as (
    with recursive down(id) as (
      select e.root_agent_id from carrier_hierarchy_exemptions e where e.carrier = 'american_home_life'
      union
      select ag.id from agents ag join down d on ag.manager_id = d.id or ag.invited_by_manager_id = d.id
    ) select id from down
  ),
  stalled as (
    select p.id, a.display_name,
      greatest(1, floor(extract(epoch from (now() - coalesce(p.last_activity_at, p.stage_entered_at))) / 86400)::int) as days_quiet,
      array_remove(array[
        case when p.agent_id not in (select id from exempt) and p.completed_ahl_onboarding is null then 'AHL onboarding' end,
        case when p.agent_id not in (select id from exempt) and p.contracted_ahl_sent is null then 'AHL contracting' end,
        case when p.contracted_ethos_sent is null then 'Ethos' end,
        case when p.contracted_chubb_sent is null then 'Chubb' end
      ], null) as missing
    from getting_started_progress p
    join agents a on a.id = p.agent_id
      and coalesce(a.is_deactivated, false) = false
      and a.status::text = 'active'
    where p.current_stage = 'contracting'
      and coalesce(p.last_activity_at, p.stage_entered_at) < now() - interval '5 days'
      and (p.contracting_stalled_alerted_at is null or p.contracting_stalled_alerted_at < now() - interval '7 days')
      and not exists (
        select 1 from v_production_unified u
        where u.agent_id = p.agent_id and u.posted_date > now() - interval '60 days'
      )
  ),
  real_stalled as (select * from stalled where array_length(missing, 1) > 0),
  stamped as (
    update getting_started_progress gp set contracting_stalled_alerted_at = now()
    where gp.id in (select id from real_stalled) returning gp.id
  )
  select count(*), string_agg(display_name || ' (' || array_to_string(missing, ', ') || ' — quiet ' || days_quiet || 'd)', '; ' order by days_quiet)
    into n, body_list from real_stalled;
  if coalesce(n, 0) > 0 then
    insert into bot_alerts (source, event_type, severity, subject, body, channels)
    values ('onboarding', 'contracting_stalled', 'critical',
      n || ' hire' || case when n = 1 then '' else 's' end || ' stalled in contracting 5d+',
      'Stalled on carrier contracting: ' || body_list || '. Nudge them or open Getting Started (/dashboard/getting-started).',
      array['ntfy']);
  end if;
end $function$;
