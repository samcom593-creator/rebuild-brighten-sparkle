-- MP-LEAD-BLEND (2026-11-27). Sam: every hourly assignment to the people who are on must draw from
-- more than one lead pool, so the brand-new leads are not ripped out and exhausted for no reason.
--
-- Measured first (14 days to 2026-11-27 16:00Z):
--   * Lead Manager drops took ZERO Fresh-tier leads; what consumed leads is apex-morning-leads
--     (fn_grant_morning_leads, hourly 06:45-16:45 Phoenix): 949 Marketing A/B leads in 40 automatic
--     bundles, one source, one tier band, newest first.
--   * 72% of everything dropped in 14 days is still status 'new'; 599 untouched items from one batch
--     sit with 24 agents at 4 days old. The pool is not short: 68,367 Marketing A + 39,264 B,
--     76,154 Dialer F (never called), 50,441 Dialer C (dialed <= 3, never reached) are assignable.
--   * fn_starter_pack_inventory excluded dialer leads on purpose (2026-11-24): a warm dialer lead
--     (A/B/pos: talked or booked) may be another agent's open sale. Fresh (F) and lightly dialed (C)
--     carry no such risk, so the blend uses those and never dialer A/B/pos.
--
-- What this adds:
--   1. system_settings.morning_leads_blend (JSON text): slices of {source, tiers, share, order}.
--      Default 40% Marketing A/B (newest first), 40% Dialer F (oldest first, so arrivals are not
--      consumed the hour they land), 20% Dialer C. morning_leads_recycle_days default 5.
--   2. fn_lead_blend_recipe(): the parsed, validated recipe (falls back to the default).
--   3. fn_lead_blend_inventory(states, limit, recipe): same row shape as fn_starter_pack_inventory
--      plus a slice number; quotas by share, rounding remainder to the first slice, shortfall in a
--      slice spills to the next; one row per phone; the starter pack's exclusions plus
--      lead_contact_dnc and current_client. (Re-cut for speed in 20261127_lead_blend_inventory_window.)
--   4. fn_grant_morning_leads: packs come from the blend; bundle criteria records the recipe and the
--      realised mix per pack.
--   5. fn_morning_leads_recycle(dry_run, days): items of automatic batches still 'new' with no event
--      after N days are released (removed_at) so they return to the pool; one 'recycled' event per
--      bundle; emptied bundles archived. Manual drops are never touched.
--   6. fn_morning_leads_cron recycles first, then grants; owner_licensed_leads_board_uncached carries
--      blend, recycle_days and recycled_7d so the owner card states the live mix.
--
-- Applied live via MCP apply_migration at 2026-11-27 16:33:31Z (this version number is the one the
-- platform recorded); this file is the repo's record.

insert into public.system_settings (key, value)
select 'morning_leads_blend',
       '[{"source":"marketing","tiers":["A","B"],"share":0.4,"order":"newest"},'
       '{"source":"dialer","tiers":["F"],"share":0.4,"order":"oldest"},'
       '{"source":"dialer","tiers":["C"],"share":0.2,"order":"oldest"}]'
 where not exists (select 1 from public.system_settings s where s.key = 'morning_leads_blend');

insert into public.system_settings (key, value)
select 'morning_leads_recycle_days', '5'
 where not exists (select 1 from public.system_settings s where s.key = 'morning_leads_recycle_days');

create or replace function public.fn_lead_blend_recipe()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_default jsonb := '[{"source":"marketing","tiers":["A","B"],"share":0.4,"order":"newest"},
                       {"source":"dialer","tiers":["F"],"share":0.4,"order":"oldest"},
                       {"source":"dialer","tiers":["C"],"share":0.2,"order":"oldest"}]'::jsonb;
  v_raw text;
  v jsonb;
  v_sum numeric;
begin
  select s.value into v_raw from public.system_settings s where s.key = 'morning_leads_blend';
  begin
    v := v_raw::jsonb;
  exception when others then
    v := null;
  end;
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then
    return v_default;
  end if;
  -- every slice must name a known pool, at least one tier and a positive share
  if exists (
    select 1 from jsonb_array_elements(v) e
     where coalesce(e->>'source','') not in ('marketing','dialer','rewrite','winback')
        or jsonb_typeof(e->'tiers') <> 'array' or jsonb_array_length(e->'tiers') = 0
        or coalesce((e->>'share')::numeric, 0) <= 0) then
    return v_default;
  end if;
  -- normalise shares so they sum to 1
  select sum((e->>'share')::numeric) into v_sum from jsonb_array_elements(v) e;
  return (select jsonb_agg(jsonb_build_object(
            'source', e->>'source', 'tiers', e->'tiers',
            'share', round((e->>'share')::numeric / v_sum, 4),
            'order', case when e->>'order' = 'oldest' then 'oldest' else 'newest' end)
          order by ord)
          from jsonb_array_elements(v) with ordinality t(e, ord));
exception when others then
  return v_default;
end;
$function$;
revoke all on function public.fn_lead_blend_recipe() from public, anon, authenticated;

-- First cut; superseded by 20261127_lead_blend_inventory_window (same contract, bounded probe window).
create or replace function public.fn_lead_blend_inventory(p_states text[], p_limit integer default 25, p_recipe jsonb default null)
returns table(source text, lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
              age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean, slice integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r jsonb := coalesce(p_recipe, public.fn_lead_blend_recipe());
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 25));
begin
  return query
  with recipe as (
    select (t.ord - 1)::integer as slice, t.e->>'source' as source,
           array(select jsonb_array_elements_text(t.e->'tiers')) as tiers,
           (t.e->>'share')::numeric as share,
           coalesce(t.e->>'order', 'newest') as ord
      from jsonb_array_elements(r) with ordinality t(e, ord)
  ), floors as (
    select rc.slice, floor(rc.share * v_limit)::integer as q from recipe rc
  ), quota as (
    select f.slice, f.q + case when f.slice = 0 then v_limit - (select sum(q) from floors) else 0 end as q from floors f
  ), sup as materialized (
    select distinct s.lead_id from public.v_leads_suppression_all s where s.lead_id is not null
  ), cand as (
    select p.source, p.lead_id, p.phone10, p.first_name, p.last_name, p.email, p.state, p.age, p.tier, p.tags,
           p.flags, p.lead_age_days, p.under_9mo, rc.slice, rc.ord, array_position(rc.tiers, p.tier) as tier_rank
      from public.mat_lead_pool p
      join recipe rc on rc.source = p.source and p.tier = any (rc.tiers)
     where upper(btrim(p.state)) = any (p_states)
       and p.phone10 ~ '^[0-9]{10}$'
       and not coalesce(p.dnc, false)
       and not coalesce((p.flags->>'dnc')::boolean, false)
       and not coalesce((p.flags->>'true_dnc')::boolean, false)
       and not coalesce((p.flags->>'current_client')::boolean, false)
       and not coalesce((p.flags->>'import_review_required')::boolean, false)
       and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.removed_at is null)
       and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.status = 'do_not_call')
       and not exists (select 1 from public.lead_contact_dnc d where d.phone10 = p.phone10)
       and not exists (select 1 from public.readymode_dialer_calls c
                        where c.lead_phone10 = p.phone10 and lower(coalesce(c.disposition, '')) = 'do not call')
       and not exists (select 1 from public.lead_resale_ledger rl where rl.phone10 = p.phone10)
       and (p.lead_id is null or not exists (select 1 from sup s where s.lead_id = p.lead_id))
  ), one as (
    select c.*, row_number() over (partition by c.phone10 order by c.slice, c.tier_rank, c.lead_age_days asc nulls last) as pr
      from cand c
  ), ranked as (
    select o.*, row_number() over (
             partition by o.slice
             order by o.tier_rank,
                      case when o.ord = 'oldest' then -o.lead_age_days else o.lead_age_days end asc nulls last,
                      o.phone10) as rn
      from one o where o.pr = 1
  ), primary_pick as (
    select k.* from ranked k join quota q on q.slice = k.slice where k.rn <= q.q
  ), short as (
    select v_limit - count(*) as n from primary_pick
  ), spill as (
    select k.* from ranked k
     where not exists (select 1 from primary_pick pp where pp.phone10 = k.phone10)
     order by k.slice, k.rn
     limit (select greatest(0, n) from short)
  )
  select x.source, x.lead_id, x.phone10, x.first_name, x.last_name, x.email, x.state, x.age, x.tier, x.tags,
         x.flags, x.lead_age_days, x.under_9mo, x.slice
    from (select * from primary_pick union all select * from spill) x
   order by x.slice, x.rn;
end;
$function$;
revoke all on function public.fn_lead_blend_inventory(text[], integer, jsonb) from public, anon, authenticated;

create or replace function public.fn_grant_morning_leads(
  p_dry_run boolean default true, p_limit integer default 10, p_only_agent uuid default null)
returns table(agent_id uuid, first_name text, license_states text[], leads_added integer, decision text, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c record;
  v_granted integer := 0;
  v_cap integer := greatest(0, least(coalesce(p_limit, 10), 100));
  v_need integer;
  v_bundle uuid;
  v_n integer;
  v_mix jsonb;
  v_recipe jsonb := public.fn_lead_blend_recipe();
  v_day text := to_char(now() at time zone 'America/Phoenix', 'Mon DD');
begin
  if not p_dry_run then
    -- one live run at a time: two concurrent runs must not hand the same agent two batches
    perform pg_advisory_xact_lock(hashtextextended('fn_grant_morning_leads', 7));
  end if;

  for c in
    select * from public.fn_morning_lead_candidates() k
     where p_only_agent is null or k.agent_id = p_only_agent
     order by k.eligible desc, k.last_sign_in_at desc nulls last
  loop
    agent_id := c.agent_id;
    first_name := c.first_name;
    license_states := c.license_states;
    leads_added := 0;

    if not c.eligible then
      decision := 'skip';
      reason := c.reason;
      return next;
      continue;
    end if;
    if v_granted >= v_cap then
      decision := 'deferred_limit';
      reason := 'p_limit reached; eligible again on the next run';
      return next;
      continue;
    end if;

    v_need := greatest(1, 25 - c.new_leads);
    if p_dry_run then
      decision := 'would_grant';
      leads_added := v_need;
      reason := 'up to ' || v_need || ' leads in ' || array_to_string(c.license_states, ', ')
             || ' (states from ' || c.state_source || '), mixed across pools';
      v_granted := v_granted + 1;
      return next;
      continue;
    end if;

    insert into public.lead_bundles (name, format, criteria, note, created_by)
    values ('Morning leads · ' || c.first_name || ' · ' || v_day,
            'client_leads',
            jsonb_build_object('pool', 'morning_batch', 'morning_batch', true, 'agent_id', c.agent_id,
                               'states', to_jsonb(c.license_states), 'state_source', c.state_source,
                               'recipe', v_recipe, 'limit', v_need,
                               'granted_by', 'fn_grant_morning_leads'),
            null, null)
    returning id into v_bundle;

    insert into public.lead_bundle_items
      (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
       quality_tier, quality_reason, status, attrs)
    select v_bundle, e.lead_id, e.source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
           e.tier, e.tags, 'new',
           coalesce(e.flags, '{}'::jsonb) || jsonb_build_object('lead_age_days', e.lead_age_days,
                                                                'under_9mo', e.under_9mo,
                                                                'pool', e.source,
                                                                'slice', e.slice,
                                                                'morning_batch', true)
      from public.fn_lead_blend_inventory(c.license_states, v_need, v_recipe) e
    on conflict (phone10) where (removed_at is null) do nothing;
    get diagnostics v_n = row_count;

    if v_n < 5 then
      -- not enough clean leads in this agent's states for a batch worth opening
      delete from public.lead_bundles where id = v_bundle;
      decision := 'skip';
      reason := 'only ' || v_n || ' clean lead(s) across the pools in ' || array_to_string(c.license_states, ', ');
      leads_added := 0;
      return next;
      continue;
    end if;

    -- the realised mix, so the pack can be audited against the recipe
    select jsonb_object_agg(k, n) into v_mix
      from (select i.source_kind || ':' || coalesce(i.quality_tier, '?') as k, count(*)::int as n
              from public.lead_bundle_items i where i.bundle_id = v_bundle group by 1) m;
    update public.lead_bundles set criteria = criteria || jsonb_build_object('blend', coalesce(v_mix, '{}'::jsonb))
     where id = v_bundle;

    insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
    values (v_bundle, c.user_id, null, 'morning leads (automatic)');
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
    values (v_bundle, null, null, 'created',
            jsonb_build_object('items', v_n, 'morning_batch', true, 'states', to_jsonb(c.license_states), 'blend', v_mix)),
           (v_bundle, c.user_id, null, 'granted',
            jsonb_build_object('agent_id', c.agent_id, 'items', v_n, 'morning_batch', true));

    v_granted := v_granted + 1;
    decision := 'granted';
    leads_added := v_n;
    reason := v_n || ' leads in ' || array_to_string(c.license_states, ', ') || '; mix ' || coalesce(v_mix::text, '{}')
           || '; bundle ' || v_bundle::text;
    return next;
  end loop;
end;
$function$;
revoke all on function public.fn_grant_morning_leads(boolean, integer, uuid) from public, anon, authenticated;

create or replace function public.fn_morning_leads_recycle(p_dry_run boolean default true, p_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_days integer := coalesce(p_days,
                             nullif(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_recycle_days')), '')::integer,
                             5);
  v_ids uuid[];
  v_items integer := 0;
  v_bundles integer := 0;
  v_agents integer := 0;
begin
  if v_days < 1 then v_days := 1; end if;
  -- automatic batches only; an item is untouched when it is still 'new' and nothing was ever logged on it
  select array_agg(i.id), count(distinct g.user_id)
    into v_ids, v_agents
    from public.lead_bundle_items i
    join public.lead_bundles b on b.id = i.bundle_id
    left join public.lead_bundle_grants g on g.bundle_id = b.id and g.revoked_at is null
   where b.archived_at is null
     and coalesce(b.criteria->>'morning_batch', '') = 'true'
     and i.removed_at is null
     and i.status = 'new'
     and b.created_at < now() - make_interval(days => v_days)
     and not exists (select 1 from public.lead_bundle_events e where e.item_id = i.id);
  v_items := coalesce(array_length(v_ids, 1), 0);
  if p_dry_run or v_items = 0 then
    return jsonb_build_object('dry_run', p_dry_run, 'days', v_days, 'items', v_items, 'agents', coalesce(v_agents, 0));
  end if;

  update public.lead_bundle_items set removed_at = now() where id = any (v_ids);

  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  select i.bundle_id, g.user_id, null, 'recycled',
         jsonb_build_object('items', count(*), 'days_untouched', v_days, 'by', 'fn_morning_leads_recycle')
    from public.lead_bundle_items i
    left join public.lead_bundle_grants g on g.bundle_id = i.bundle_id and g.revoked_at is null
   where i.id = any (v_ids)
   group by i.bundle_id, g.user_id;

  update public.lead_bundles b set archived_at = now()
   where b.archived_at is null
     and coalesce(b.criteria->>'morning_batch', '') = 'true'
     and not exists (select 1 from public.lead_bundle_items i where i.bundle_id = b.id and i.removed_at is null);
  get diagnostics v_bundles = row_count;

  return jsonb_build_object('dry_run', false, 'days', v_days, 'items', v_items, 'agents', coalesce(v_agents, 0),
                            'bundles_archived', v_bundles);
end;
$function$;
revoke all on function public.fn_morning_leads_recycle(boolean, integer) from public, anon, authenticated;

create or replace function public.fn_morning_leads_cron()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb;
  v_blocked jsonb;
  v_mail jsonb;
  v_elig int;
  v_ask jsonb;
  v_recycled jsonb;
begin
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') <> 'true' then
    return jsonb_build_object('skipped', 'morning_leads_enabled is not true', 'at', now());
  end if;
  -- MP-LEAD-BLEND: release untouched automatic batches first, so the refill below reaches people who dial
  begin
    v_recycled := public.fn_morning_leads_recycle(false);
  exception when others then
    v_recycled := jsonb_build_object('error', sqlerrm, 'note', 'recycle failed; grants below stand');
  end;
  with g as (select * from public.fn_grant_morning_leads(false, 100))
  select coalesce(jsonb_agg(jsonb_build_object('first_name', g.first_name, 'decision', g.decision, 'leads', g.leads_added, 'reason', g.reason))
                    filter (where g.decision <> 'skip'), '[]'::jsonb),
         coalesce((select jsonb_object_agg(b.reason, b.n)
                     from (select g2.reason, count(*)::int n from g g2 where g2.decision = 'skip' group by g2.reason) b), '{}'::jsonb),
         count(*) filter (where g.decision <> 'skip')::int
    into v_rows, v_blocked, v_elig
    from g;
  v_mail := public.fn_morning_leads_announce(false);
  begin
    v_ask := public.fn_license_state_ask_sweep(false);
  exception when others then
    v_ask := jsonb_build_object('error', sqlerrm, 'note', 'ask sweep failed; grants above stand');
  end;
  return jsonb_build_object(
    'ran', true, 'recycled', v_recycled, 'granted', v_rows, 'granted_count', v_elig, 'blocked', v_blocked,
    'blocked_total', (select coalesce(sum((value)::int), 0) from jsonb_each_text(v_blocked)),
    'no_licence_state', coalesce((v_blocked->>'license_state_unknown')::int, 0),
    'state_ask', v_ask, 'mail', v_mail, 'at', now());
end;
$function$;
revoke all on function public.fn_morning_leads_cron() from public, anon, authenticated;

create or replace function public.owner_licensed_leads_board_uncached()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', k.agent_id,
           'name', k.full_name,
           'phone', ph.phone,
           'phone_state_hint', case when k.license_states is null then
                                 (select ac.state from public.us_area_codes ac where ac.area_code::text = left(ph.phone, 3) limit 1) end,
           'last_sign_in_at', k.last_sign_in_at,
           'license_states', k.license_states,
           'state_source', k.state_source,
           'new_leads', k.new_leads,
           'live_leads', k.live_leads,
           'reason', k.reason
         ) order by k.last_sign_in_at desc nulls last), '[]'::jsonb)
    into v_rows
    from public.fn_morning_lead_candidates() k
    left join lateral (
      -- a self-enrolled applicant's number is on the application or the booking, not the profile
      select nullif(right(regexp_replace(coalesce(
               nullif(pr.phone, ''), nullif(ap.phone, ''),
               (select ie.invitee_phone from public.interview_events ie
                 where ie.application_id = a.source_application_id and ie.invitee_phone is not null
                 order by ie.scheduled_at desc limit 1), ''), '\D', '', 'g'), 10), '') as phone
        from public.agents a
        left join public.profiles pr on pr.id = a.profile_id
        left join public.applications ap on ap.id = a.source_application_id
       where a.id = k.agent_id
    ) ph on true;
  return jsonb_build_object(
    'enabled', coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') = 'true',
    'blend', public.fn_lead_blend_recipe(),
    'recycle_days', coalesce(nullif(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_recycle_days')), '')::integer, 5),
    'recycled_7d', (select coalesce(sum((e.detail->>'items')::int), 0) from public.lead_bundle_events e
                     where e.action = 'recycled' and e.at >= now() - interval '7 days'),
    'rows', v_rows);
end;
$function$;
