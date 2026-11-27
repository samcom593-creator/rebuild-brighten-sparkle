-- MP-OWNER-HOME-SPEED (1): fn_owner_goal_board was the slowest call on Sam's Home — p50 6.2s,
-- p95 17s over 8h (11 calls), because fn_owner_goal_board_uncached runs fn_goal_scorecard once per
-- manager (11 managers, ~6 production scans each = 4.8s measured as Sam) and the single-flight
-- cache is keyed per user with a 300s TTL, so every Home visit more than 5 minutes after the last
-- paid the full price. The board is identical for every admin, so a cron computes it once every
-- 10 minutes as an admin and writes it under every admin's key; the TTL moves to 900s so the
-- prewarm always covers it. A failed prewarm leaves the old row in place and the RPC falls back
-- to computing (no fake success: the function returns -1 and the cache simply ages).
--
-- Applied live 2026-11-27 01:44Z through the Supabase MCP apply_migration (version = file name).
-- After: fn_owner_goal_board() as Sam 6ms from cache (was 4.8-6.2s); cron job apex-owner-goal-board-prewarm.
create or replace function public.apex_owner_goal_board_prewarm()
returns integer
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare v_payload jsonb; v_uid uuid; v_n int := 0; v_first uuid;
begin
  select ur.user_id into v_first from public.user_roles ur where ur.role = 'admin'::public.app_role
   order by (ur.user_id = '811fc5f4-05f4-446e-a916-445ce7fd051f') desc, ur.user_id limit 1;
  if v_first is null then return 0; end if;
  -- The uncached body gates on auth.uid(); compute once as an admin for this transaction only.
  perform set_config('request.jwt.claims', json_build_object('sub', v_first, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_first::text, true);
  v_payload := public.fn_owner_goal_board_uncached(null, null);
  if v_payload is null or v_payload ? 'error' then return -1; end if;
  for v_uid in select ur.user_id from public.user_roles ur where ur.role = 'admin'::public.app_role loop
    insert into public.rpc_result_cache(cache_key, payload, computed_at)
    values ('fn_owner_goal_board:::' || v_uid::text, v_payload, now())
    on conflict (cache_key) do update set payload = excluded.payload, computed_at = excluded.computed_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.apex_owner_goal_board_prewarm() from public, anon, authenticated;

create or replace function public.fn_owner_goal_board(p_period_start date DEFAULT NULL::date, p_period_end date DEFAULT NULL::date)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not (public.is_sam() or public.has_role(auth.uid(), 'admin'::public.app_role)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- 900s: apex-owner-goal-board-prewarm rewrites this key every 10 minutes (MP-OWNER-HOME-SPEED).
  return public.fn_rpc_single_flight(
    'fn_owner_goal_board:' || coalesce(p_period_start::text, '') || ':' || coalesce(p_period_end::text, '') || ':' || auth.uid()::text,
    900,
    format('select public.fn_owner_goal_board_uncached(%L::date, %L::date)', p_period_start, p_period_end));
end
$$;

do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'apex-owner-goal-board-prewarm') then
    perform cron.schedule('apex-owner-goal-board-prewarm', '*/10 * * * *', $cmd$select public.apex_owner_goal_board_prewarm();$cmd$);
  end if;
end $do$;

-- Warm it now so the next Home load is served from cache.
select public.apex_owner_goal_board_prewarm();
