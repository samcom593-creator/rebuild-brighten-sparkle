-- Follow-up to the 2026-10-25 termination wave (adversarial sweep findings).
-- 1. Three security-definer views with no in-body gate were readable by anon (the public internet):
--    v_agentlink_book_scoped (1,300 book rows with client names), v_book_status_tiles, v_client_pipeline_stats.
--    Every reader in src/ is a logged-in page, so anon loses nothing.
-- 2. Four security-definer RPCs taking a caller-supplied agent id were anon-executable with no caller check.
-- 3. v_departed_logins_to_revoke was gated on is_agency_staff() with no service-role escape, so apex-doctor and
--    bot-sql read 0 rows forever and the 'departed_can_still_sign_in' branch of v_agent_access_violations was dead.
-- 4. Nothing consumed v_agent_access_violations; a lockout that reverts (it did, twice, in Aug/Sep) paged nobody.
--    fn_access_violation_alert() runs daily and raises one critical bot_alert (ntfy + email) while rows exist.
revoke select on public.v_agentlink_book_scoped, public.v_book_status_tiles, public.v_client_pipeline_stats from anon;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p where p.pronamespace='public'::regnamespace
             and p.proname in ('get_downline_agent_ids','fn_agent_contract_pct_live','fn_agent_subagency_live','fn_agent_onboarding_call_booking') loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;
CREATE OR REPLACE VIEW public.v_departed_logins_to_revoke AS
 SELECT user_id,
    agent_names,
    statuses,
    last_sign_in_at,
    already_banned
   FROM ( SELECT u.id AS user_id,
            string_agg(DISTINCT a.display_name, ' | '::text) AS agent_names,
            string_agg(DISTINCT a.status::text, ','::text) AS statuses,
            max(u.last_sign_in_at) AS last_sign_in_at,
            u.banned_until IS NOT NULL AND u.banned_until > now() AS already_banned
           FROM auth.users u
             JOIN agents a ON a.user_id = u.id
          WHERE NOT (EXISTS ( SELECT 1
                   FROM agents a2
                  WHERE a2.user_id = u.id AND a2.status = 'active'::agent_status)) AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < (now() - '90 days'::interval)) AND NOT (EXISTS ( SELECT 1
                   FROM agentlink_book b
                  WHERE b.agent_id = a.id AND b.posted_date > (CURRENT_DATE - 90)))
          GROUP BY u.id, u.banned_until) t
  WHERE (is_agency_staff() OR auth.uid() IS NULL);
create or replace function public.fn_access_violation_alert()
returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer; v_detail text;
begin
  select count(*), string_agg(violation || ' ' || coalesce(detail,''), ' | ') into n, v_detail from public.v_agent_access_violations;
  if n > 0 and not exists (select 1 from public.bot_alerts where event_type='access_violation' and created_at > now() - interval '20 hours') then
    insert into public.bot_alerts(source, event_type, severity, subject, body, sms_body, channels)
    values ('cron', 'access_violation', 'critical',
            format('Access lockout violation: %s row(s)', n),
            format('<p>v_agent_access_violations is not empty: a departed or suspended login can sign in, or a lockout reverted.</p><p>%s</p>', left(coalesce(v_detail,''), 1500)),
            format('APEX: %s access lockout violation(s). Check v_agent_access_violations.', n),
            array['email']::text[]);
  end if;
  return n;
end $fn$;
revoke all on function public.fn_access_violation_alert() from public, anon, authenticated;
select cron.schedule('apex-access-violation-watch', '15 6 * * *', 'select public.fn_access_violation_alert()');
