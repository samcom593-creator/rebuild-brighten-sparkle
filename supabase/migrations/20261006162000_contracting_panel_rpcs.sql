-- The contracting Audit / Onboarding Command / Ethos panels read seven views directly. Measured as the
-- owner, every one failed for a signed-in user: the views either lack a SELECT grant or are
-- security_invoker over agents columns MP-329 deliberately stopped granting (read-leak closure).
-- Granting those columns would reopen the leak, so each view is served through a staff-gated
-- SECURITY DEFINER function instead (admin, va_manager, va) — the pattern contracting_carrier_cases uses.
begin;

do $$
declare
  pair text[];
  pairs text[][] := array[
    ['contracting_audit_rows', 'v_contracting_audit'],
    ['contracting_audit_summary_rows', 'v_contracting_audit_summary'],
    ['ethos_paste_rows_approved', 'v_ethos_paste_rows'],
    ['ethos_agent_update_rows', 'v_ethos_agent_updates'],
    ['onboarding_funnel_rows', 'v_onboarding_funnel'],
    ['onboarding_funnel_summary_rows', 'v_onboarding_funnel_summary'],
    ['contracting_worklist_rows', 'v_contracting_worklist']
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
