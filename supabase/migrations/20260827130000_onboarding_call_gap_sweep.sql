-- Head-to-toe audit 2026-08-27: safety net so every recent licensed hire gets
-- an onboarding-call booking even if the on-hire trigger was suspended at insert
-- (18 licensed-active agents were missing one; 3 recent). Scoped to 30d so
-- veterans get no belated invite. pg_cron every 15 min.
create or replace function public.fn_sweep_onboarding_call_gaps()
returns integer language plpgsql security definer set search_path=public as $fn$
declare v_n int := 0; r record;
begin
  -- Safety net for "once hired -> onboarding meeting auto-scheduled": the
  -- on-hire trigger can miss agents inserted while agents triggers are
  -- suspended (bulk status corrections). Sweep RECENT (30d) licensed+active
  -- hires that have no onboarding call booked or queued and enqueue one.
  -- Idempotent (fn_enqueue_onboarding_call_booking guards on existing call);
  -- scoped to recent hires so established veterans never get a belated invite.
  for r in
    select a.id from public.agents a
    where a.license_status = 'licensed' and a.status = 'active'
      and coalesce(a.is_deactivated,false)=false and coalesce(a.is_inactive,false)=false
      and not public.fn_agent_is_roster_excluded(a.id)
      and a.created_at > now() - interval '30 days'
      and public.fn_agent_onboarding_call_booking(a.id) is null
      and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id=a.id and q.email_kind='onboarding_call')
  loop
    if (public.fn_enqueue_onboarding_call_booking(r.id,'sweep')->>'enqueued')::boolean then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $fn$;
revoke all on function public.fn_sweep_onboarding_call_gaps() from public, anon, authenticated;
grant execute on function public.fn_sweep_onboarding_call_gaps() to service_role;
select cron.schedule('apex-onboarding-call-gap-sweep','8,23,38,53 * * * *', $$select public.fn_sweep_onboarding_call_gaps()$$);
