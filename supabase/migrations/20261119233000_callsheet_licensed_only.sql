-- MP-ETHOS-CALLSHEET part 6 (2026-11-19)
-- Sam, while the team was already calling: "we only want people who have their license or on the
-- finishing steps of their license ... in order by people who had their Ethos contract and then license."
--
-- The sheet read is restated with one filter and one new field. A person shows when they hold the Ethos
-- contract, hold an active carrier contract, are licensed, or are on a finishing step of licensing
-- (finished the course, exam booked or taken, fingerprints, waiting on the license). The step comes from
-- the agent record or the application it came from, whichever is on a finishing step. Nobody is removed
-- from the tables: someone who gets licensed later appears on their own.

create or replace function public.ethos_call_sheet()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name), '[]'::jsonb)
    into v_rows
    from (
      select p.id,
             p.full_name,
             p.npn,
             p.phone,
             p.email,
             p.comp_level,
             p.sub_agency,
             coalesce(
               nullif(p.sub_agency, 'Apex Financial Empire'),
               nullif(m.display_name, ''), mp.full_name,
               nullif(sa.display_name, ''), sap.full_name
             ) as manager_name,
             p.first_seen_on,
             p.first_seen_source,
             p.on_ethos,
             p.issued_premium,
             p.inforce_premium,
             p.persistency_4m,
             p.persistency_7m,
             p.persistency_13m,
             p.chargeback_total,
             p.chargeback_personal,
             p.snapshot_on,
             coalesce(p.contracts_total, 0) as contracts_total,
             coalesce(p.contracts_active, 0) as contracts_active,
             (
               select jsonb_agg(distinct c->>'name')
                 from jsonb_array_elements(case when jsonb_typeof(p.carriers) = 'array' then p.carriers else '[]'::jsonb end) c
                where c->>'status' = 'active' or (c->>'active') ~ '^[1-9]'
             ) as active_carriers,
             p.al_last_active_at,
             (a.id is not null) as in_app,
             a.status::text as standing,
             coalesce(a.license_status::text, p.license) as license,
             a.onboarding_stage::text as stage,
             case
               when a.license_progress::text in ('finished_course', 'test_scheduled', 'failed_test', 'passed_test', 'exam_passed', 'fingerprints_done', 'waiting_fingerprints', 'waiting_on_license') then a.license_progress::text
               when src.license_progress::text in ('finished_course', 'test_scheduled', 'failed_test', 'passed_test', 'exam_passed', 'fingerprints_done', 'waiting_fingerprints', 'waiting_on_license') then src.license_progress::text
               when a.license_status::text = 'pending' then 'pending'
             end as license_step,
             (a.user_id is not null) as has_login,
             u.last_sign_in_at,
             prod.lifetime_ap,
             prod.last_deal_on,
             prod.deals_30d,
             lc.outcome as last_outcome,
             lc.reason as last_reason,
             lc.note as last_note,
             lc.follow_up_on,
             lc.created_at as last_called_at,
             lc.logged_by_name as last_called_by,
             coalesce(cc.calls, 0) as calls
        from public.ethos_callsheet_people p
        join public.ethos_callsheet_visible_ids() v on v.person_id = p.id
        left join public.agents a on a.id = p.agent_id
        left join public.agents m on m.id = a.manager_id and m.id <> a.id
        left join public.profiles mp on mp.id = m.profile_id
        left join public.agents sa on sa.id = p.sub_agency_agent_id
        left join public.profiles sap on sap.id = sa.profile_id
        left join public.applications src on src.id = a.source_application_id
        left join auth.users u on u.id = a.user_id
        left join lateral (
          select round(sum(mu.annual_premium), 2) as lifetime_ap,
                 max(mu.posted_date) as last_deal_on,
                 count(*) filter (where mu.posted_date > current_date - 30) as deals_30d
            from public.mat_production_unified mu
           where p.agent_id is not null
             and mu.agent_id in (
               select x.id from public.agents x where x.id = p.agent_id or x.canonical_agent_id = p.agent_id
             )
        ) prod on true
        left join lateral (
          select c.outcome, c.reason, c.note, c.follow_up_on, c.created_at, c.logged_by_name
            from public.ethos_callsheet_calls c
           where c.person_id = p.id
           order by c.created_at desc
           limit 1
        ) lc on true
        left join lateral (
          select count(*)::int as calls from public.ethos_callsheet_calls c where c.person_id = p.id
        ) cc on true
       -- Sam, 2026-11-19: "we only want people who have their license or on the finishing steps of their
       -- license." Ethos and carrier contracts both require a license, so those people qualify as they are.
       -- Someone who has already been called stays, so a logged result is never lost from view.
       where p.on_ethos
          or coalesce(p.contracts_active, 0) > 0
          or coalesce(a.license_status::text, p.license) = 'licensed'
          or a.license_status::text = 'pending'
          or a.license_progress::text in ('finished_course', 'test_scheduled', 'failed_test', 'passed_test', 'exam_passed', 'fingerprints_done', 'waiting_fingerprints', 'waiting_on_license')
          or src.license_progress::text in ('finished_course', 'test_scheduled', 'failed_test', 'passed_test', 'exam_passed', 'fingerprints_done', 'waiting_fingerprints', 'waiting_on_license')
          or lc.outcome is not null
    ) r;

  return jsonb_build_object(
    'sees_all', public.has_role(v_uid, 'admin'::app_role),
    'snapshot_on', (select max(p.snapshot_on) from public.ethos_callsheet_people p where p.in_latest_snapshot and p.on_ethos),
    'rows', v_rows
  );
end;
$$;

revoke all on function public.ethos_call_sheet() from public, anon;
grant execute on function public.ethos_call_sheet() to authenticated;
