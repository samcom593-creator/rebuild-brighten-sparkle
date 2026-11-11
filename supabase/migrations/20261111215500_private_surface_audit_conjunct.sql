-- fn_private_surface_audit: accept is_sam() AND <more conditions>; still rejects any OR / role grant.
-- 20:48Z guard run paged a false LEAK on money_inbox_sam_select = is_sam() AND private = false AND classified_at IS NOT NULL.
CREATE OR REPLACE FUNCTION public.fn_private_surface_audit()
 RETURNS TABLE(violation text, object text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  sam constant text := '71826bba-5577-4810-a226-1f6f2ad5288a';
  role_grant_re constant text := '(has_role\s*\(|apex_is_admin\s*\(|is_owner\s*\(|current_agent_id\s*\(|is_manager|my_downline)';
begin
  -- 1. A registered private table is missing or has RLS off.
  return query
    select 'rls_off_or_missing', r.name, 'private table has no row level security (or was dropped)'
    from private_surface_registry r
    left join pg_class c on c.relname = r.name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    where r.kind = 'private_table' and (c.oid is null or not c.relrowsecurity);

  -- 2. A policy on a private table lets anyone but Sam in. Allowed predicates: is_sam(), Sam's uid
  --    (without OR), content_can_access() (itself audited below), or false.
  return query
    select 'policy_not_sam_only', p.tablename || '.' || p.policyname,
           p.cmd || ' to ' || p.roles::text || ': ' || left(coalesce(p.qual, '') || ' | check: ' || coalesce(p.with_check, ''), 300)
    from pg_policies p
    join private_surface_registry r on r.kind = 'private_table' and r.name = p.tablename
    cross join lateral (select unnest(array[p.qual, p.with_check]) as q) x
    where p.schemaname = 'public'
      and p.permissive = 'PERMISSIVE'
      and p.roles && array['public', 'anon', 'authenticated']::name[]
      and x.q is not null
      and not (
        x.q ~* '^[\s(]*(select\s+)?(public\.)?is_sam\(\)(\s+as\s+is_sam)?[\s)]*$'
        or x.q ~* '^[\s(]*(select\s+)?(public\.)?content_can_access\(\)(\s+as\s+content_can_access)?[\s)]*$'
        or x.q ~* '^[\s(]*false[\s)]*$'
        or (position(sam in x.q) > 0 and x.q !~* '\mor\M' and x.q !~* role_grant_re)
        -- is_sam() as one conjunct of an AND-only predicate is stricter than is_sam() alone
        or (x.q ~* 'is_sam\(\)' and x.q !~* '\mor\M' and x.q !~* role_grant_re)
      )
    group by p.tablename, p.policyname, p.cmd, p.roles, p.qual, p.with_check;

  -- 3. A registered gate function stopped checking is_sam() or grants by role.
  return query
    select 'gate_fn_not_sam_only', r.name,
           case when p.oid is null then 'function missing'
                when p.prosrc !~* 'is_sam\(\)' then 'no is_sam() check'
                else 'grants by role: ' || substring(p.prosrc from role_grant_re) end
    from private_surface_registry r
    left join pg_proc p on p.proname = r.name and p.pronamespace = 'public'::regnamespace
    where r.kind = 'private_function'
      and (p.oid is null or p.prosrc !~* 'is_sam\(\)' or p.prosrc ~* role_grant_re);

  -- 4. A SECURITY DEFINER function callable by a signed-in user (or anon) reads a private table without
  --    the is_sam() gate: that bypasses every policy above (the 2026-11 definer-view disease).
  return query
    select distinct 'definer_fn_backdoor', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           'reads ' || t.name || ' and is executable by '
             || case when has_function_privilege('anon', p.oid, 'execute') then 'anon' else 'authenticated' end
    from pg_proc p
    join private_surface_registry t on t.kind = 'private_table' and p.prosrc ~* ('\m' || t.name || '\M')
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
      and p.prosrc !~* 'is_sam\(\)'
      and position(sam in p.prosrc) = 0
      and p.proname not in (select name from private_surface_registry where kind = 'reviewed_not_private')
      and p.proname not in ('fn_private_surface_audit', 'fn_private_surface_alert');

  -- 5. A view over a private table runs as its owner (bypassing RLS) and a signed-in user can select it.
  return query
    select distinct 'definer_view_backdoor', c.relname::text, 'selects ' || t.name || ' without security_invoker'
    from pg_class c
    join private_surface_registry t on t.kind = 'private_table' and pg_get_viewdef(c.oid) ~* ('\m' || t.name || '\M')
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
      and coalesce(array_to_string(c.reloptions, ','), '') !~* 'security_invoker=(true|on|1)'
      and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'));

  -- 6. A new table that looks private was created and nobody classified it.
  return query
    select 'unregistered_private_looking_table', c.relname::text, 'name looks private; add it to private_surface_registry'
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and c.relname ~* '(instagram|imessage|^dm_|^ig_|money_inbox|camera|content_clip|content_share|content_access|mailbox|gmail|inbox_message)'
      and c.relname not in (select name from private_surface_registry);
end $function$;
revoke all on function public.fn_private_surface_audit() from public, anon, authenticated;
