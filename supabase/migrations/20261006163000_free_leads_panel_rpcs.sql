-- OnboardingCommand (contracting staff panel) read v_free_leads_qualification (an owner-rights view,
-- no grant) and v_free_leads_summary directly -> 403 for every signed-in user. Granting the first
-- would expose every row to every agent, so both are served through the staff-gated pattern used by
-- 20261006162000 (admin, va_manager, va).
begin;

do $$
declare
  pair text[];
  pairs text[][] := array[
    ['free_leads_qualification_rows', 'v_free_leads_qualification'],
    ['free_leads_summary_rows', 'v_free_leads_summary']
  ];
begin
  foreach pair slice 1 in array pairs loop
    execute format($f$
      create or replace function public.%1$I()
      returns setof public.%2$I
      language plpgsql stable security definer set search_path to 'public'
      as $body$
      begin
        if not (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va')) then
          raise exception 'contracting staff only' using errcode = '42501';
        end if;
        return query select * from public.%2$I;
      end;
      $body$;
    $f$, pair[1], pair[2]);
    execute format('revoke all on function public.%I() from public, anon', pair[1]);
    execute format('grant execute on function public.%I() to authenticated', pair[1]);
  end loop;
end;
$$;

commit;
