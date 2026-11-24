-- MP-CALLSHEET-ACTIVE-ONLY (2026-11-24). Sam: fired people come off the call sheet,
-- and so does anyone with no production (site or carrier book) and no real
-- conversation in the last 30 days. Hidden, never deleted; returns hidden counts.
create or replace function public.ethos_call_sheet()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_fired int;
  v_idle int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'hide_reason' order by r.full_name) filter (where r.hide_reason is null), '[]'::jsonb),
         count(*) filter (where r.hide_reason = 'fired')::int,
         count(*) filter (where r.hide_reason = 'no_activity_30d')::int
    into v_rows, v_fired, v_idle
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
             coalesce(cc.calls, 0) as calls,
             act.carrier_30d,
             tk.last_talked_at,
             -- Sam, 2026-11-24: "if I fired them, remove them ... people I haven't talked to or
             -- done any production in the last 30 days should not be on that spreadsheet at all."
             -- Hidden, never deleted: call history stays, and a deal or a real conversation brings them back.
             case
               when a.status::text = 'terminated' or coalesce(a.is_deactivated, false)
                 or u.banned_until > now()
                 or exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null)
                 or lc.outcome = 'not_interested'
                 then 'fired'
               when coalesce(prod.deals_30d, 0) > 0 or act.carrier_30d
                 or tk.last_talked_at > now() - interval '30 days'
                 or a.created_at > now() - interval '30 days'
                 then null
               else 'no_activity_30d'
             end as hide_reason
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
        left join lateral (
          select max(c.created_at) as last_talked_at from public.ethos_callsheet_calls c
           where c.person_id = p.id and c.outcome in ('callback', 'coming_back', 'needs_help')
        ) tk on true
        left join lateral (
          -- production in the carrier book (Ethos + Combined) counts even when never posted on the site
          select exists (
            select 1 from public.carrier_book_policies cb
             where public.fn_carrier_bucket_written(cb.status_bucket) and cb.sold_on > current_date - 30
               and ((p.npn is not null and cb.agent_npn = p.npn)
                 or (p.agent_id is not null and cb.agent_id in (
                       select coalesce(x.canonical_agent_id, x.id) from public.agents x where x.id = p.agent_id or x.canonical_agent_id = p.agent_id)))
          ) as carrier_30d
        ) act on true
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
    'rows', v_rows,
    'hidden', jsonb_build_object('fired', v_fired, 'no_activity_30d', v_idle)
  );
end;
$function$;
