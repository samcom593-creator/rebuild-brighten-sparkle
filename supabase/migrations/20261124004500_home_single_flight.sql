-- MP-HOME-SPEED (2026-11-23, Sam: "the website itself is going overall slow"). Measured from pg_stat_statements:
-- the owner Home fires its heaviest calls together and none of these four was behind the result cache the
-- other Home cards already use: fn_owner_goal_board 4.4s average, owner_monday_rollcall 1.4s,
-- home_conversion_people_range 1.3s, owner_licensed_leads_board 1.1s. While they run even a 7 ms read
-- (system_health_logs) averages 1.6s, so every card on the page waits on them.
--
-- Each keeps its body as <name>_uncached (callable only through the wrapper) and gets a wrapper that checks
-- the caller first and then serves fn_rpc_single_flight, keyed by caller and arguments. The two call lists are
-- cleared the moment a result is recorded, a state is saved or leads are granted, so a tap is never stale.

alter function public.fn_owner_goal_board(date, date) rename to fn_owner_goal_board_uncached;
alter function public.home_conversion_people_range(date, date) rename to home_conversion_people_range_uncached;
alter function public.owner_monday_rollcall(date) rename to owner_monday_rollcall_uncached;
alter function public.owner_licensed_leads_board() rename to owner_licensed_leads_board_uncached;
revoke all on function public.fn_owner_goal_board_uncached(date, date) from public, anon, authenticated;
revoke all on function public.home_conversion_people_range_uncached(date, date) from public, anon, authenticated;
revoke all on function public.owner_monday_rollcall_uncached(date) from public, anon, authenticated;
revoke all on function public.owner_licensed_leads_board_uncached() from public, anon, authenticated;

create function public.fn_owner_goal_board(p_period_start date default null, p_period_end date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not (public.is_sam() or public.has_role(auth.uid(), 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return public.fn_rpc_single_flight(
    'fn_owner_goal_board:' || coalesce(p_period_start::text, '') || ':' || coalesce(p_period_end::text, '') || ':' || auth.uid()::text,
    300,
    format('select public.fn_owner_goal_board_uncached(%L::date, %L::date)', p_period_start, p_period_end));
end
$function$;

create function public.home_conversion_people_range(p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return public.fn_rpc_single_flight(
    'home_conversion_people_range:' || coalesce(p_start::text, '') || ':' || coalesce(p_end::text, '') || ':' || auth.uid()::text,
    60,
    format('select public.home_conversion_people_range_uncached(%L::date, %L::date)', p_start, p_end));
end
$function$;

create function public.owner_monday_rollcall(p_monday date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.fn_rpc_single_flight(
    'owner_monday_rollcall:' || coalesce(p_monday::text, '') || ':' || auth.uid()::text,
    120,
    format('select public.owner_monday_rollcall_uncached(%L::date)', p_monday));
end
$function$;

create function public.owner_licensed_leads_board()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.fn_rpc_single_flight(
    'owner_licensed_leads_board:' || auth.uid()::text,
    120,
    'select public.owner_licensed_leads_board_uncached()');
end
$function$;

revoke all on function public.fn_owner_goal_board(date, date) from public, anon;
revoke all on function public.home_conversion_people_range(date, date) from public, anon;
revoke all on function public.owner_monday_rollcall(date) from public, anon;
revoke all on function public.owner_licensed_leads_board() from public, anon;
grant execute on function public.fn_owner_goal_board(date, date) to authenticated;
grant execute on function public.home_conversion_people_range(date, date) to authenticated;
grant execute on function public.owner_monday_rollcall(date) to authenticated;
grant execute on function public.owner_licensed_leads_board() to authenticated;

-- A recorded result, a saved state or a lead grant changes what the two call lists say: drop their cached copies.
create or replace function public.fn_owner_lists_cache_clear()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.rpc_result_cache c
   where c.cache_key like 'owner_monday_rollcall:%' or c.cache_key like 'owner_licensed_leads_board:%';
  return null;
exception when others then
  return null;  -- a cache that cannot be cleared must never fail the write that touched it
end
$function$;
revoke all on function public.fn_owner_lists_cache_clear() from public, anon, authenticated;

drop trigger if exists trg_owner_lists_cache_marks on public.monday_rollcall_marks;
create trigger trg_owner_lists_cache_marks after insert on public.monday_rollcall_marks
  for each statement execute function public.fn_owner_lists_cache_clear();
drop trigger if exists trg_owner_lists_cache_states on public.agents;
create trigger trg_owner_lists_cache_states after update of license_states on public.agents
  for each statement execute function public.fn_owner_lists_cache_clear();
drop trigger if exists trg_owner_lists_cache_grants on public.lead_bundle_grants;
create trigger trg_owner_lists_cache_grants after insert on public.lead_bundle_grants
  for each statement execute function public.fn_owner_lists_cache_clear();
