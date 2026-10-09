-- Hire red flags + "talk to these people now" list (2026-10-09)
--
-- Sam: when a hire sits more than three or four days, throw a red flag for Aflac and for Ethos; after five days,
-- a red flag for the first contract and for AgentLink. The team should tell him urgently who needs a
-- conversation first.
--
-- Scope: ACTIVE, LICENSED hires made in the last 45 days. Unlicensed hires cannot be contracted yet.
-- Clock: days since the hire's contracting intake, else since the agent row was created.
--
-- Evidence per step, never inferred:
--   Aflac           done when a send to Aflac is recorded (aflac_submissions) or a verified-ready Aflac carrier case exists
--   Ethos           done when the Ethos portal exists (v_contracting_audit.ethos_status portal_created / subagency_head)
--   First contract  done when the contracts are confirmed (contracting_checkins.contracts_confirmed_at) or agents.contracted_at is set
--   AgentLink       done when an AgentLink account exists with no incomplete profile and no pending upline
--
-- Thresholds live in system_settings (hire_flag_days_carrier = 3, hire_flag_days_contract = 5) so Sam can move them.
--
-- WHY THE RANKING MATTERS: measured 2026-10-09, 26 of 27 recent hires are red on Aflac, because Aflac tracking began
-- today, and 23 of 27 are red on three or more steps. A list where nearly everyone is red tells nobody who to call,
-- so every row gets a score and a rank, the top ten are Priority 1, and a hire called in the last 24 hours drops to the
-- bottom of the pile without disappearing. The rank is computed here once, so the page, the alert and any future
-- surface agree.
--
-- The rules live in ONE pure function (hire_flag_eval) so they can be proven against synthetic cases.

begin;

create or replace function public.hire_flag_eval(
  p_days int,
  p_aflac_done boolean,
  p_ethos_status text,
  p_contract_done boolean,
  p_al_id bigint,
  p_al_incomplete int,
  p_al_pending_upline int,
  p_carrier_days int default 3,
  p_contract_days int default 5
) returns jsonb
language sql immutable
set search_path = public
as $$
  with x as (
    select
      (coalesce(p_days, 0) >= p_carrier_days and not coalesce(p_aflac_done, false)) as aflac,
      (coalesce(p_days, 0) >= p_carrier_days and coalesce(p_ethos_status, 'not_on_sheet') not in ('portal_created', 'subagency_head')) as ethos,
      (coalesce(p_days, 0) >= p_contract_days and not coalesce(p_contract_done, false)) as first_contract,
      (coalesce(p_days, 0) >= p_contract_days
        and (p_al_id is null or coalesce(p_al_incomplete, 0) > 0 or coalesce(p_al_pending_upline, 0) > 0)) as agentlink
  )
  select jsonb_build_object(
    'aflac', aflac, 'ethos', ethos, 'first_contract', first_contract, 'agentlink', agentlink,
    'red_count', aflac::int + ethos::int + first_contract::int + agentlink::int,
    'reasons', to_jsonb(array_remove(array[
      case when aflac then 'Aflac not sent' end,
      case when ethos then
        case coalesce(p_ethos_status, 'not_on_sheet')
          when 'needs_reparenting' then 'Ethos needs reparenting'
          when 'on_sheet_pending' then 'Ethos portal pending'
          else 'Ethos not started' end
      end,
      case when first_contract then 'First contract not confirmed' end,
      case when agentlink then
        case when p_al_id is null then 'No AgentLink account'
             when coalesce(p_al_pending_upline, 0) > 0 then 'AgentLink upline not assigned'
             else 'AgentLink profile incomplete' end
      end
    ], null))
  ) from x
$$;

create or replace function public.fn_hire_priority_rows()
returns table (
  agent_id uuid, display_name text, phone text, email text, manager_id uuid, manager_name text,
  hired_at timestamptz, days int,
  aflac boolean, ethos boolean, first_contract boolean, agentlink boolean,
  red_count int, reasons jsonb,
  last_call_at timestamptz, called_recently boolean,
  score int, priority_rank int, priority int
)
language sql stable security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce((select case when value ~ '^[0-9]{1,2}$' then value::int end from public.system_settings where key = 'hire_flag_days_carrier' limit 1), 3) as carrier_days,
      coalesce((select case when value ~ '^[0-9]{1,2}$' then value::int end from public.system_settings where key = 'hire_flag_days_contract' limit 1), 5) as contract_days
  ), base as (
    select g.id as agent_id, g.display_name, g.manager_id,
           coalesce((select min(i.created_at) from public.contracting_intakes i where i.agent_id = g.id), g.created_at) as hired_at,
           g.contracted_at as agent_contracted_at
    from public.agents g
    where g.status::text = 'active' and g.license_status::text = 'licensed'
      and g.created_at > now() - interval '45 days'
  ), ev as (
    select b.*,
      ((now() at time zone 'America/Phoenix')::date - (b.hired_at at time zone 'America/Phoenix')::date) as days,
      a.ethos_status, a.al_id, a.al_incomplete_profile_n, a.al_pending_upline_n, a.phone as a_phone, a.email as a_email,
      (exists (select 1 from public.aflac_submissions s join public.contracting_intakes i on i.id = s.intake_id where i.agent_id = b.agent_id)
        or exists (select 1 from public.v_contracting_carrier_cases c
                   where c.agent_id = b.agent_id and c.carrier_name ilike '%aflac%' and c.lifecycle = 'verified_ready_to_write')) as aflac_done,
      (k.contracts_confirmed_at is not null or b.agent_contracted_at is not null) as contract_done,
      k.last_call_at
    from base b
    left join public.v_contracting_audit a on a.agent_id = b.agent_id
    left join lateral (
      select c.contracts_confirmed_at, c.last_call_at from public.contracting_checkins c
      where c.agent_id = b.agent_id order by c.updated_at desc nulls last limit 1
    ) k on true
  ), f as (
    select e.*, public.hire_flag_eval(e.days, e.aflac_done, e.ethos_status, e.contract_done, e.al_id,
             e.al_incomplete_profile_n::int, e.al_pending_upline_n::int, cfg.carrier_days, cfg.contract_days) as fl
    from ev e cross join cfg
  ), s as (
    select f.*, (f.fl->>'red_count')::int as red_count,
      ((f.fl->>'red_count')::int * 100 + f.days
        + case when f.last_call_at is not null and f.last_call_at > now() - interval '24 hours' then -1000 else 0 end
        + case when f.last_call_at is null then 15 else 0 end) as score
    from f
  )
  select s.agent_id, s.display_name,
         coalesce(s.a_phone, (select p.phone from public.profiles p join public.agents g2 on g2.user_id = p.user_id where g2.id = s.agent_id limit 1)) as phone,
         coalesce(s.a_email, (select p.email from public.profiles p join public.agents g2 on g2.user_id = p.user_id where g2.id = s.agent_id limit 1)) as email,
         s.manager_id,
         (select m.display_name from public.agents m where m.id = s.manager_id) as manager_name,
         s.hired_at, s.days,
         (s.fl->>'aflac')::boolean, (s.fl->>'ethos')::boolean, (s.fl->>'first_contract')::boolean, (s.fl->>'agentlink')::boolean,
         s.red_count, s.fl->'reasons',
         s.last_call_at,
         (s.last_call_at is not null and s.last_call_at > now() - interval '24 hours') as called_recently,
         s.score,
         (row_number() over (order by s.score desc, s.days desc, s.display_name))::int as priority_rank,
         case when s.red_count > 0 and row_number() over (order by s.score desc, s.days desc, s.display_name) <= 10 then 1
              when s.red_count > 0 then 2 else 3 end as priority
  from s
  where s.red_count > 0
$$;

-- The page's single read. Admin and VA managers see everyone; a manager sees only their own hires.
create or replace function public.hire_priority_list()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_scope uuid;
begin
  if public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') then
    v_scope := null;
  elsif public.has_role(auth.uid(), 'manager') then
    select g.id into v_scope from public.agents g where g.user_id = auth.uid()
      order by case when g.status::text = 'active' then 0 else 1 end, g.created_at desc limit 1;
    if v_scope is null then return '[]'::jsonb; end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.priority_rank)
    from public.fn_hire_priority_rows() r
    where v_scope is null or r.manager_id = v_scope
  ), '[]'::jsonb);
end;
$$;

-- Phone alert: weekdays 9 AM and 3 PM Phoenix. First names only: the topic is a shared secret, not a private channel.
create or replace function public.hire_priority_alert(p_topic text default null)
returns jsonb
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_total int; v_p1 int; v_body text; v_req bigint;
begin
  select count(*) into v_total from public.fn_hire_priority_rows();
  if v_total = 0 then return jsonb_build_object('sent', false, 'reason', 'nobody_flagged'); end if;
  select count(*) into v_p1 from public.fn_hire_priority_rows() where priority = 1 and not called_recently;
  select string_agg(split_part(r.display_name, ' ', 1) || ' (day ' || r.days || ': ' ||
           (select string_agg(x, ', ') from jsonb_array_elements_text(r.reasons) x) || ')', E'\n' order by r.priority_rank)
    into v_body
  from (select * from public.fn_hire_priority_rows() where not called_recently order by priority_rank limit 5) r;
  v_req := public.fn_ntfy_relay(
    v_p1 || ' people need a call now',
    coalesce(v_body, 'Everyone flagged was already called in the last 24 hours.') || E'\n' || v_total || ' hires are behind in total.',
    '5', 'rotating_light', coalesce(nullif(p_topic, ''), 'sams-agent-yrkv9kbqp9e987nb'));
  return jsonb_build_object('sent', true, 'request_id', v_req, 'flagged', v_total, 'priority_one', v_p1);
end;
$$;

revoke all on function public.hire_flag_eval(int, boolean, text, boolean, bigint, int, int, int, int) from public, anon;
revoke all on function public.fn_hire_priority_rows() from public, anon, authenticated;
revoke all on function public.hire_priority_list() from public, anon;
revoke all on function public.hire_priority_alert(text) from public, anon, authenticated;
grant execute on function public.hire_flag_eval(int, boolean, text, boolean, bigint, int, int, int, int) to authenticated, service_role;
grant execute on function public.fn_hire_priority_rows() to service_role;
grant execute on function public.hire_priority_list() to authenticated, service_role;
grant execute on function public.hire_priority_alert(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hire-priority-alert') then perform cron.unschedule('hire-priority-alert'); end if;
  -- 16:00 and 22:00 UTC = 9 AM and 3 PM Phoenix (no daylight saving), Monday to Friday.
  perform cron.schedule('hire-priority-alert', '0 16,22 * * 1-5', 'select public.hire_priority_alert()');
end
$$;

commit;
