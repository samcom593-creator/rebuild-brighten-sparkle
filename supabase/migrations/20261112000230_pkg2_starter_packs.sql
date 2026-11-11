-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 4 of 10: starter packs in My Leads.
--
-- WHAT
--   fn_starter_pack_candidates()  — who is ready, who is not, and why (read-only).
--   fn_grant_starter_packs(p_dry_run boolean default true, p_limit int default 10)
--       returns (agent_id, first_name, license_states, leads_selected, decision, reason).
--       Ready = active licensed agent (license_status = 'licensed' or license_progress ranked licensed+), not a
--       manager seat, not suspended on any login, signed in at least once since hire
--       (auth.users.last_sign_in_at >= agents.created_at), hired 45 days ago or less, no live lead grant, and never
--       given a starter pack before (so a revoked pack stays revoked).
--       Pack = up to 25 leads from owned inventory (mat_lead_pool, sources marketing + dialer, tier A then B), only in
--       states the agent is licensed in, never on a do-not-call list (pool flag, ReadyMode "Do Not Call", any
--       lead_bundle_items row marked do_not_call, lead_resale_ledger, v_leads_suppression_all), never in another
--       live pack. Fewer than 10 matching leads = no pack (reason says how many).
--       License states, in order: agents.license_states; the application's licensed_states; the application's
--       state; the contracting profile's resident_state (a licensed agent holds a resident license there).
--       Unknown = skip with reason.
--       Live mode writes the same rows lead_pool_assign writes (lead_bundles format client_leads, lead_bundle_items,
--       lead_bundle_grants, lead_bundle_events created + granted), so My Leads, calling hours (callable_now /
--       callable_at), lead_bundle_revoke and lead_bundle_archive work unchanged, and queues ONE email per agent
--       ever (dedupe key starter_pack:<agent_id>) with a one-tap login to My Leads.
--   fn_starter_pack_cron() + cron apex-starter-pack-daily (16:15 UTC = 09:15 Phoenix): calls the grant LIVE only when
--       system_settings.onboarding_starter_pack_enabled = 'true' (created 'false' in part 1).
--
-- WHY
--   DECISIONS N8 + readymode_block 6c.7: every recent producer got onto the dialer; the dialer is canceled; My Leads
--   already works without it. lead_bundle_create / lead_pool_assign gate on can_view_sold_calls() (Sam/Aisha
--   signed in) and have no licensed-state filter, so an automatic, state-matched grant cannot call them; it writes
--   their exact row shapes instead.
--
-- FORWARD-ONLY
--   Eligibility is recomputed each run from a rolling 45-day hire window, and p_limit caps each run (default 10):
--   switching the job on cannot storm. Reversal: onboarding_starter_pack_enabled = 'false', then
--   lead_bundle_revoke / lead_bundle_archive on any pack (criteria->>'starter_pack' = 'true').

-- ---------------------------------------------------------------------------
-- 1. Candidates (read-only)
-- ---------------------------------------------------------------------------
create or replace function public.fn_starter_pack_candidates()
returns table(
  agent_id uuid,
  user_id uuid,
  first_name text,
  hired_at timestamptz,
  days_since_hire integer,
  license_states text[],
  state_source text,
  eligible boolean,
  reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with pop as (
    select a.id, a.user_id, a.created_at, a.license_states, a.source_application_id, a.account_mode,
           coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'there') as first_name,
           (select u.last_sign_in_at from auth.users u where u.id = a.user_id) as last_sign_in_at,
           (select lower(btrim(pr.email)) from public.profiles pr where pr.id = a.profile_id) as profile_email
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and a.user_id is not null
       and not public.is_placeholder_agent(a.agent_code, a.user_id)
       and not public.fn_agent_is_roster_excluded(a.id)
       and (a.license_status::text = 'licensed' or public.fn_license_stage_rank(a.license_progress) >= 8)
       and a.created_at >= now() - interval '45 days'
  ), app as (
    -- the application on file: the linked one, else the newest non-duplicate application with the login's email
    select p.id as agent_id,
           coalesce(
             (select ap.id from public.applications ap where ap.id = p.source_application_id),
             (select ap.id from public.applications ap
               where p.profile_email is not null and lower(btrim(ap.email)) = p.profile_email
                 and coalesce(ap.is_duplicate, false) = false
               order by ap.created_at desc limit 1)) as application_id
      from pop p
  ), states as (
    select p.id as agent_id,
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from unnest(coalesce(p.license_states, '{}'::text[])) x
             where upper(btrim(x)) in (select z.state from public.us_state_timezones z)) as s_agent,
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from public.applications ap, unnest(coalesce(ap.licensed_states, '{}'::text[])) x
             where ap.id = app.application_id
               and upper(btrim(x)) in (select z.state from public.us_state_timezones z)) as s_app_licensed,
           (select array[upper(btrim(ap.state))]
              from public.applications ap
             where ap.id = app.application_id
               and upper(btrim(ap.state)) in (select z.state from public.us_state_timezones z)) as s_app_state,
           (select array[upper(btrim(cp.resident_state))]
              from public.agent_contract_profile cp
             where cp.agent_id = p.id
               and upper(btrim(cp.resident_state)) in (select z.state from public.us_state_timezones z)) as s_resident
      from pop p
      join app on app.agent_id = p.id
  )
  select p.id,
         p.user_id,
         p.first_name,
         p.created_at,
         floor(extract(epoch from now() - p.created_at) / 86400)::int,
         coalesce(st.s_agent, st.s_app_licensed, st.s_app_state, st.s_resident),
         case when st.s_agent is not null then 'agents.license_states'
              when st.s_app_licensed is not null then 'application.licensed_states'
              when st.s_app_state is not null then 'application.state'
              when st.s_resident is not null then 'contract_profile.resident_state'
              else null end,
         v.reason is null,
         coalesce(v.reason, 'ready')
    from pop p
    join states st on st.agent_id = p.id
    cross join lateral (
      select case
        when coalesce(p.account_mode, 'agent') in ('manager', 'admin') then 'manager_seat'
        when public.fn_agent_is_suspended(p.id) then 'suspended'
        when public.fn_user_login_blocked(p.user_id) then 'login_banned'
        when p.last_sign_in_at is null or p.last_sign_in_at < p.created_at then 'not_signed_in_since_hire'
        when exists (select 1 from public.lead_bundle_grants g
                       join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
                      where g.user_id = p.user_id and g.revoked_at is null) then 'has_live_lead_bundle'
        when exists (select 1 from public.lead_bundle_grants g
                       join public.lead_bundles b on b.id = g.bundle_id
                      where g.user_id = p.user_id and coalesce(b.criteria ->> 'starter_pack', '') = 'true') then 'starter_pack_already_given'
        when coalesce(st.s_agent, st.s_app_licensed, st.s_app_state, st.s_resident) is null then 'license_state_unknown'
        else null end as reason
    ) v
$$;

comment on function public.fn_starter_pack_candidates() is
  'PKG2: every active licensed agent hired in the last 45 days, with the starter-pack verdict (eligible + reason) and the licensed states used. Read-only. Service role only.';

-- ---------------------------------------------------------------------------
-- 2. Inventory for one pack (read-only): the leads a pack in these states would hold, best first.
-- ---------------------------------------------------------------------------
create or replace function public.fn_starter_pack_inventory(p_states text[], p_limit integer default 25)
returns table(
  source text, lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer,
  tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select e.source, e.lead_id, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, e.flags, e.lead_age_days, e.under_9mo
    from (
      select p.*,
             row_number() over (partition by p.phone10
                                order by array_position(array['A', 'B'], p.tier), (p.source = 'dialer') desc,
                                         p.lead_age_days asc nulls last) as rn
        from public.mat_lead_pool p
       where p.source in ('marketing', 'dialer')
         and p.tier in ('A', 'B')
         and upper(btrim(p.state)) = any (p_states)
         and p.phone10 ~ '^[0-9]{10}$'
         and not coalesce(p.dnc, false)
         and not coalesce((p.flags ->> 'dnc')::boolean, false)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.removed_at is null)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.status = 'do_not_call')
         and not exists (select 1 from public.readymode_dialer_calls c
                          where c.lead_phone10 = p.phone10 and lower(coalesce(c.disposition, '')) = 'do not call')
         and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = p.phone10)
         and (p.lead_id is null or not exists (select 1 from public.v_leads_suppression_all s where s.lead_id = p.lead_id))
    ) e
   where e.rn = 1
   order by array_position(array['A', 'B'], e.tier), (e.source = 'dialer') desc, e.lead_age_days asc nulls last, e.phone10
   limit greatest(1, least(coalesce(p_limit, 25), 25))
$$;

comment on function public.fn_starter_pack_inventory(text[], integer) is
  'PKG2: up to 25 owned leads (mat_lead_pool marketing + dialer, tier A then B) in the given states that are on no do-not-call list and in no live pack. Read-only. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. Grant (dry run by default)
-- ---------------------------------------------------------------------------
create or replace function public.fn_grant_starter_packs(p_dry_run boolean default true, p_limit integer default 10)
returns table(agent_id uuid, first_name text, license_states text[], leads_selected integer, decision text, reason text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_granted integer := 0;
  v_cap integer := greatest(0, least(coalesce(p_limit, 10), 50));
  v_avail integer;
  v_bundle uuid;
  v_n integer;
  v_day text := to_char(now() at time zone 'America/Phoenix', 'Mon DD');
  v_subject text;
  v_text text;
  v_html text;
  v_email_id uuid;
begin
  if not p_dry_run then
    -- one live run at a time: two concurrent runs must not hand the same agent two packs
    perform pg_advisory_xact_lock(hashtextextended('fn_grant_starter_packs', 7));
  end if;

  for c in
    select * from public.fn_starter_pack_candidates() k
     order by k.eligible desc, k.hired_at desc
  loop
    agent_id := c.agent_id;
    first_name := c.first_name;
    license_states := c.license_states;
    leads_selected := 0;

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

    select count(*)::int into v_avail from public.fn_starter_pack_inventory(c.license_states, 25);
    leads_selected := v_avail;
    if v_avail < 10 then
      decision := 'skip';
      reason := 'only ' || v_avail || ' clean tier A/B lead(s) in ' || array_to_string(c.license_states, ', ');
      return next;
      continue;
    end if;

    if p_dry_run then
      decision := 'would_grant';
      reason := v_avail || ' leads in ' || array_to_string(c.license_states, ', ') || ' (states from ' || c.state_source || ')';
      v_granted := v_granted + 1;
      return next;
      continue;
    end if;

    -- Live: the same rows lead_pool_assign writes.
    insert into public.lead_bundles (name, format, criteria, note, created_by)
    values ('Starter pack · ' || c.first_name || ' · ' || v_day,
            'client_leads',
            jsonb_build_object('pool', 'starter_pack', 'starter_pack', true, 'agent_id', c.agent_id,
                               'states', to_jsonb(c.license_states), 'state_source', c.state_source,
                               'tiers', jsonb_build_array('A', 'B'), 'limit', 25,
                               'granted_by', 'fn_grant_starter_packs'),
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
                                                                'starter_pack', true)
      from public.fn_starter_pack_inventory(c.license_states, 25) e
    on conflict (phone10) where (removed_at is null) do nothing;
    get diagnostics v_n = row_count;

    if v_n < 10 then
      -- a concurrent drop took the leads between the count and the insert: no thin pack
      delete from public.lead_bundles where id = v_bundle;
      decision := 'skip';
      reason := 'only ' || v_n || ' lead(s) could be placed; nothing granted';
      leads_selected := v_n;
      return next;
      continue;
    end if;

    insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
    values (v_bundle, c.user_id, null, 'starter pack (automatic, PKG2)');
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
    values (v_bundle, null, null, 'created',
            jsonb_build_object('items', v_n, 'starter_pack', true, 'states', to_jsonb(c.license_states))),
           (v_bundle, c.user_id, null, 'granted',
            jsonb_build_object('agent_id', c.agent_id, 'items', v_n, 'starter_pack', true));

    -- ONE email per agent, ever (one touch per person per purpose).
    v_subject := c.first_name || ', your first ' || v_n || ' leads are in My Leads';
    v_text := c.first_name || ', your first ' || v_n || ' leads are in My Leads. '
           || 'Call them from your phone between 8 AM and 7 PM their time, and log each call.' || E'\n\n'
           || 'Open My Leads: {{login_link}}' || E'\n\n' || 'Sam';
    v_html := '<p>' || public.fn_pkg2_html_escape(c.first_name) || ', your first ' || v_n || ' leads are in My Leads. '
           || 'Call them from your phone between 8 AM and 7 PM their time, and log each call.</p>'
           || '<p><a href="{{login_link}}" style="display:inline-block;padding:10px 18px;background:#EDB81D;color:#0a0f1a;'
           || 'text-decoration:none;border-radius:6px;font-weight:600;">Open My Leads</a></p>'
           || '<p>Sam</p>';
    v_email_id := public.fn_hire_lane_email_enqueue(
      'starter_pack', 'starter_pack:' || c.agent_id::text, c.user_id, c.agent_id,
      v_subject, v_text, v_html, null, 'leads',
      jsonb_build_object('bundle_id', v_bundle, 'items', v_n));

    v_granted := v_granted + 1;
    decision := 'granted';
    leads_selected := v_n;
    reason := v_n || ' leads in ' || array_to_string(c.license_states, ', ') || '; bundle ' || v_bundle::text
           || case when v_email_id is null then '; email already sent before' else '; email queued' end;
    return next;
  end loop;
end;
$$;

comment on function public.fn_grant_starter_packs(boolean, integer) is
  'PKG2 (N8): grants a 25-lead starter pack in My Leads to each ready licensed hire (see fn_starter_pack_candidates), state-matched, from owned tier A/B inventory, plus one email per agent ever. p_dry_run defaults to TRUE. p_limit caps grants per run. Service role only.';

-- ---------------------------------------------------------------------------
-- 4. Daily job: live only when the switch is on
-- ---------------------------------------------------------------------------
create or replace function public.fn_starter_pack_cron()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb;
begin
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'onboarding_starter_pack_enabled'))), 'false') <> 'true' then
    return jsonb_build_object('skipped', 'onboarding_starter_pack_enabled is not true', 'at', now());
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('agent_id', g.agent_id, 'first_name', g.first_name,
                                               'decision', g.decision, 'leads', g.leads_selected, 'reason', g.reason)), '[]'::jsonb)
    into v_rows
    from public.fn_grant_starter_packs(false, 10) g;
  return jsonb_build_object('ran', true, 'rows', v_rows, 'at', now());
end;
$$;

comment on function public.fn_starter_pack_cron() is
  'PKG2: cron entry point. Runs fn_grant_starter_packs live (cap 10) only while onboarding_starter_pack_enabled = true.';

revoke all on function public.fn_starter_pack_candidates() from public, anon, authenticated;
revoke all on function public.fn_starter_pack_inventory(text[], integer) from public, anon, authenticated;
revoke all on function public.fn_grant_starter_packs(boolean, integer) from public, anon, authenticated;
revoke all on function public.fn_starter_pack_cron() from public, anon, authenticated;
grant execute on function public.fn_starter_pack_candidates() to service_role;
grant execute on function public.fn_starter_pack_inventory(text[], integer) to service_role;
grant execute on function public.fn_grant_starter_packs(boolean, integer) to service_role;
grant execute on function public.fn_starter_pack_cron() to service_role;

select cron.schedule('apex-starter-pack-daily', '15 16 * * *', 'select public.fn_starter_pack_cron()');
