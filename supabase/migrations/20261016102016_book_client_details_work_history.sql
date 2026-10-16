-- Book of Business shows the same work state Book Flips does (attempts, last contact,
-- callback time, notes), so book_client_details returns them too. Output columns change,
-- so the function is dropped and recreated; it was added the same day and only the
-- Book of Business page calls it.
drop function if exists public.book_client_details(jsonb);
create function public.book_client_details(p_rows jsonb)
returns table(
  row_key text, phone text, dob date, state text, city text, do_not_call boolean, best_time_to_call text,
  flip_carrier text, flip_policy_number text, flip_client_key text, flip_status text,
  resold_policy_number text, resold_carrier text, resold_annual_premium numeric,
  attempts integer, last_contact_at timestamptz, callback_at timestamptz, notes text
)
language sql
stable
security invoker
set search_path = public
as $fn$
  with r as (
    select x->>'row_key' as row_key, x->>'origin' as origin,
           nullif(btrim(x->>'policy_number'), '') as policy_number, nullif(btrim(x->>'carrier'), '') as carrier
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
    limit 200
  ),
  keys as (
    select coalesce(array_agg(distinct r.policy_number) filter (where r.policy_number is not null), '{}'::text[]) as pns,
           coalesce(array_agg(r.row_key::uuid) filter (where r.origin = 'apex_native'
             and r.row_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}'::uuid[]) as native_ids
    from r
  ),
  d_all as (
    select dd.id, dd.policy_number, dd.client_phone, dd.client_dob
    from public.deals dd, keys k
    where dd.policy_number = any(k.pns) or dd.id = any(k.native_ids)
  ),
  s_all as (
    select ss.id, ss.policy_number, ss.client_phone, ss.client_dob
    from public.agentlink_deals_snapshot ss, keys k
    where ss.policy_number = any(k.pns)
  ),
  f_all as (
    select ff.phone, ff.dob, ff.state, ff.city, ff.do_not_call, ff.best_time_to_call, ff.carrier, ff.policy_number,
           ff.client_key, ff.flip_status, ff.resold_policy_number, ff.resold_carrier, ff.resold_annual_premium,
           ff.attempts, ff.last_contact_at, ff.callback_at, ff.notes
    from public.v_book_flip_worklist ff, keys k
    where ff.policy_number = any(k.pns)
  )
  select r.row_key,
         coalesce(f.phone, d.client_phone, s.client_phone),
         coalesce(f.dob, d.client_dob, s.client_dob),
         f.state, f.city, f.do_not_call, f.best_time_to_call,
         f.carrier, f.policy_number, f.client_key, f.flip_status,
         f.resold_policy_number, f.resold_carrier, f.resold_annual_premium,
         f.attempts, f.last_contact_at, f.callback_at, f.notes
  from r
  left join lateral (
    select d_all.client_phone, d_all.client_dob from d_all
     where (r.origin = 'apex_native' and d_all.id::text = r.row_key)
        or (r.policy_number is not null and d_all.policy_number = r.policy_number)
     order by (d_all.id::text = r.row_key) desc, (d_all.client_phone is not null) desc
     limit 1) d on true
  left join lateral (
    select s_all.client_phone, s_all.client_dob from s_all
     where r.policy_number is not null and s_all.policy_number = r.policy_number
     order by (s_all.client_phone is not null) desc, s_all.id desc
     limit 1) s on true
  left join lateral (
    select f_all.* from f_all
     where r.policy_number is not null and f_all.policy_number = r.policy_number
       and (r.carrier is null or lower(f_all.carrier) = lower(r.carrier)
            or position(lower(f_all.carrier) in lower(r.carrier)) > 0 or position(lower(r.carrier) in lower(f_all.carrier)) > 0)
     order by (f_all.phone is not null) desc
     limit 1) f on true
$fn$;

comment on function public.book_client_details(jsonb) is
  'Client phone, DOB, state/city and Book Flips work state (status, attempts, callback, notes, resale) for the Book of Business rows on screen. SECURITY INVOKER: every lookup runs under the caller''s own row rules.';
revoke all on function public.book_client_details(jsonb) from public, anon;
grant execute on function public.book_client_details(jsonb) to authenticated, service_role;
