-- Galaxy Financial: default agency display name (2026-10-08)
--
-- get_my_agency_branding() hardcoded 'Apex Financial' as the fallback display name, and the root agency's
-- agency_branding row held the same string, so the sidebar kept the old name after the code was renamed.
-- Both now say Galaxy Financial. The subdomain key 'apex' is an identifier and is deliberately unchanged.
-- Already applied to production by hand; this file mirrors it so a rebuild gives the same result.
-- Other functions that mention 'Apex Financial' (production_reconciliation_receipt, imo_by_agency_period_uncached,
-- trg_fn_agentlink_book_announce) use it as a DATA label for grouping production and are NOT touched.

begin;

CREATE OR REPLACE FUNCTION public.get_my_agency_branding()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.agency_branding%rowtype;
  v_can_edit boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('display_name','Galaxy Financial','subdomain','apex','accent_color','#d4a900','show_personal_deals',true,'show_leaderboard',true,'show_recruiting',true,'can_edit',false);
  end if;

  select * into v_row from public.agency_branding where owner_user_id = v_uid;
  if found then
    v_can_edit := true;
  else
    with recursive chain as (
      select a.id, a.user_id, coalesce(a.invited_by_manager_id, a.manager_id) as parent_id,
             array[a.id] as path, 0 as depth
      from (
        select * from public.agents
        where user_id = v_uid
        order by case when status = 'active' then 0 else 1 end, created_at desc
        limit 1
      ) a
      union all
      select p.id, p.user_id, coalesce(p.invited_by_manager_id, p.manager_id),
             c.path || p.id, c.depth + 1
      from chain c
      join public.agents p on p.id = c.parent_id
      where c.depth < 20 and not p.id = any(c.path)
    )
    select b.* into v_row
    from chain c join public.agency_branding b on b.owner_user_id = c.user_id
    order by c.depth
    limit 1;
  end if;

  if v_row.owner_user_id is null then
    return jsonb_build_object('display_name','Galaxy Financial','subdomain','apex','accent_color','#d4a900','show_personal_deals',true,'show_leaderboard',true,'show_recruiting',true,'can_edit',false);
  end if;
  return to_jsonb(v_row) || jsonb_build_object('can_edit', v_can_edit);
end;
$function$;

update public.agency_branding
   set display_name = 'Galaxy Financial'
 where owner_user_id = '811fc5f4-05f4-446e-a916-445ce7fd051f' and display_name = 'Apex Financial';

commit;
