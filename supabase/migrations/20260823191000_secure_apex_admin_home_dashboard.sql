-- Follow-up security boundary for deployments where the 19:00 alias migration
-- was already recorded before its role check was corrected.
revoke all on function public.apex_home_dashboard(text, date, date) from public, anon, authenticated;

create or replace function public.apex_admin_home_dashboard(
  p_start date default null,
  p_end date default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if (p_start is null) <> (p_end is null)
     or (p_start is not null and (p_end <= p_start or p_end - p_start > 3660)) then
    raise exception 'Invalid dashboard date range' using errcode = '22023';
  end if;
  return public.apex_home_dashboard('agency', p_start, p_end);
end;
$$;

revoke all on function public.apex_admin_home_dashboard(date, date) from public, anon, authenticated;
grant execute on function public.apex_admin_home_dashboard(date, date) to authenticated;
