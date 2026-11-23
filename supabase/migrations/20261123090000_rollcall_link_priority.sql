-- MP-ROLLCALL-LINK (2026-11-23, Sam, the morning of the meeting): "the people to call for today's meeting should
-- be prioritizing the people we've sent that Galaxy link, we just haven't got production or they haven't been
-- onboarded. Get those people on there and keep them rolling."
--
-- "The Galaxy link" is the contracting link (the MGN Agent Hub link since 2026-11-17) and the hire link that
-- activates a Galaxy account. Measured: 42 active agents with no production were sent one or the other. 28 are
-- licensed: 26 were emailed the contracting link between 11-17 and 11-22, 2 have opened it, and 26 have no carrier
-- contract on file. 14 joined through the hire link and are not licensed yet. The call list held only hires of the
-- last 45 days, so 27 of the 42 were not on it.
--
-- owner_monday_rollcall(), restated from the live definition:
--   * keeps anyone with no production who came in through a hire link, was emailed the contracting link, or
--     opened it, however long ago they were hired;
--   * returns producing, via_hire_link, link_sent_at, link_opened_at, contracts_on_file and the agent's own
--     contracting link, so the row can say where that person stands and the list can put them first.
--   * takes each licensed person's states and lead standing from fn_morning_lead_candidates(), the morning
--     grant's own verdict. The starter-pack candidates it read before cover only the last 45 days, so an older
--     licensed agent showed "no leads until licensed" and a missing state that was in fact on file.
-- The emailed-link log is read once (it has no index on the address). 44 rows in 482 ms under the signed-in role.

CREATE OR REPLACE FUNCTION public.owner_monday_rollcall(p_monday date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_monday date;
  v_week_start timestamptz;
  v_rows jsonb;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- today when today is Monday, otherwise the next Monday
  v_monday := coalesce(p_monday, v_today + ((8 - extract(isodow from v_today)::int) % 7));
  v_week_start := ((v_monday - 7)::timestamp at time zone 'America/Phoenix');

  with cand as (
    select * from public.fn_starter_pack_candidates()
  ), mcand as materialized (
    -- the morning grant's own verdict: the one place that knows a licensed agent's states and lead standing
    select * from public.fn_morning_lead_candidates()
  ), nudged as materialized (
    -- everyone the contracting link was emailed to, read once (the log has no index on the address)
    select lower(btrim(l.recipient_email)) as email, max(l.created_at) as sent_at
      from public.email_delivery_log l
     where l.template = 'contracting_nudge' and l.recipient_email is not null
     group by 1
  ), pop as (
    select a.id, a.user_id, a.profile_id, a.created_at, a.display_name, a.license_status::text as license_status,
           a.license_progress::text as license_progress, a.onboarding_stage, a.source_application_id,
           a.metadata, a.manager_id, a.nipr_number, a.origin, a.first_deal_at, a.mgn_link
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
       and (a.user_id is null or not public.is_placeholder_agent(a.agent_code, a.user_id))
       and not public.fn_agent_is_roster_excluded(a.id)
       and not public.fn_agent_is_suspended(a.id)
       and (a.user_id is null or not public.fn_user_login_blocked(a.user_id))
       and (a.created_at >= now() - interval '45 days'
            -- MP-ROLLCALL-LINK (2026-11-23): anyone who was sent a link and has no production stays on the list
            or (a.first_deal_at is null
                and not exists (select 1 from public.deals d where d.agent_id = a.id)
                and (a.origin = 'hire_link'
                     or exists (select 1 from public.invite_tokens t where t.used_by_agent_id = a.id)
                     or exists (select 1 from public.contracting_link_opens o where o.agent_id = a.id)
                     or exists (select 1 from nudged n
                                 where n.email = (select lower(btrim(pr2.email)) from public.profiles pr2 where pr2.id = a.profile_id)))))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', p.id,
           'name', coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(pr.full_name), ''), 'No name on file'),
           'phone', nullif(right(regexp_replace(coalesce(nullif(pr.phone, ''), nullif(ap.phone, ''), iv.invitee_phone, ''), '\D', '', 'g'), 10), ''),
           'email', coalesce(nullif(btrim(pr.email), ''), nullif(btrim(ap.email), '')),
           'hired_at', p.created_at,
           'days_since_hire', floor(extract(epoch from now() - p.created_at) / 86400)::int,
           'this_week', p.created_at >= v_week_start,
           'how_hired', case when p.origin = 'hire_link' then 'hire_link'
                             when public.fn_agent_interview_state(p.id) = 'hired_direct' then 'added'
                             else 'self_enrolled' end,
           'interview_state', public.fn_agent_interview_state(p.id),
           'interview_at', iv.scheduled_at,
           'licensed', p.license_status = 'licensed',
           'license_step', case when p.license_status = 'licensed' then null else p.license_progress end,
           'npn_on_file', p.nipr_number is not null,
           'npn_note', nullif(btrim(coalesce(p.metadata ->> 'npn_missing_reason', '')), ''),
           'license_states', coalesce(mc.license_states, c.license_states,
                                      case when upper(btrim(coalesce(ap.state, ''))) in (select z.state from public.us_state_timezones z)
                                           then array[upper(btrim(ap.state))] end),
           'phone_state_hint', (select ac.state from public.us_area_codes ac
                                 where ac.area_code::text = left(nullif(right(regexp_replace(coalesce(nullif(pr.phone, ''), nullif(ap.phone, ''), iv.invitee_phone, ''), '\D', '', 'g'), 10), ''), 3)
                                 limit 1),
           'leads_state', case when p.license_status <> 'licensed' then 'not_licensed'
                               else coalesce(mc.reason, c.reason, 'not_licensed') end,
           'live_leads', coalesce(ld.n, 0),
           'last_sign_in_at', u.last_sign_in_at,
           'manager_name', mg.name,
           'stage', p.onboarding_stage,
           'producing', (p.first_deal_at is not null or exists (select 1 from public.deals d where d.agent_id = p.id)),
           'via_hire_link', (p.origin = 'hire_link' or exists (select 1 from public.invite_tokens t where t.used_by_agent_id = p.id)),
           'link_sent_at', (select n.sent_at from nudged n where n.email = lower(btrim(pr.email))),
           'link_opened_at', (select o.last_opened_at from public.contracting_link_opens o where o.agent_id = p.id),
           'contracts_on_file', (select count(*)::int from public.contract_review_marks m
                                  where m.agent_id = p.id
                                    and m.version = (select c.version from public.contract_review_config c where c.singleton)),
           'contracting_link', nullif(btrim(coalesce(p.mgn_link, '')), ''),
           'mark', mk.mark,
           'mark_note', mk.note,
           'marked_at', mk.created_at,
           'marked_by', mk.marked_by_name
         ) order by p.created_at desc), '[]'::jsonb)
    into v_rows
    from pop p
    left join public.profiles pr on pr.id = p.profile_id
    left join public.applications ap on ap.id = p.source_application_id
    left join auth.users u on u.id = p.user_id
    left join cand c on c.agent_id = p.id
    left join mcand mc on mc.agent_id = p.id
    left join lateral (
      select ie.scheduled_at, ie.invitee_phone
        from public.interview_events ie
       where (ie.application_id = p.source_application_id or ie.agent_id = p.id
              or (pr.email is not null and lower(btrim(ie.invitee_email)) = lower(btrim(pr.email))))
         and ie.canceled_at is null and coalesce(ie.is_backfill_duplicate, false) = false
       order by (ie.scheduled_at > now()) desc,
                case when ie.scheduled_at > now() then ie.scheduled_at end asc,
                ie.scheduled_at desc
       limit 1
    ) iv on true
    left join lateral (
      select count(*)::int as n
        from public.lead_bundle_grants g
        join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
        join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
       where g.user_id = p.user_id and g.revoked_at is null
    ) ld on true
    left join lateral (
      select coalesce(nullif(btrim(m.display_name), ''), mp.full_name) as name
        from public.agents m left join public.profiles mp on mp.id = m.profile_id
       where m.id = p.manager_id
    ) mg on true
    left join lateral (
      select k.mark, k.note, k.created_at, k.marked_by_name
        from public.monday_rollcall_marks k
       where k.agent_id = p.id and k.monday = v_monday and k.mark <> 'interviewed'
       order by k.created_at desc limit 1
    ) mk on true;

  return jsonb_build_object('monday', v_monday, 'is_today', v_monday = v_today, 'rows', v_rows);
end;
$function$;
