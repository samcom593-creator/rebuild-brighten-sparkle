-- MP-CARRIER-BOOK-TRUTH part 4 (2026-11-24): the reverse gap. Deals posted on the site as
-- Ethos / Combined that the carrier portal has no record of (typed policy numbers, apps
-- written under another hierarchy, or deals that never happened). Flagged, never auto-removed.

-- one more match rung: same client, sold within 45 days, unique on both sides, any agent
create or replace function public.carrier_book_match_client_only()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  with cand as (
    select p.carrier, p.policy_key, d.id deal_id,
           count(*) over (partition by p.carrier, p.policy_key) np,
           count(*) over (partition by d.id) nd
      from public.carrier_book_policies p
      join public.deals d
        on public.fn_carrier_name_key(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')) = public.fn_carrier_name_key(p.client_name)
       and abs(coalesce(p.sold_on, p.effective_on) - (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date) <= 45
      join public.carriers c on c.id = d.carrier_id
     where p.site_match is null and public.fn_carrier_name_key(p.client_name) is not null
       and lower(c.name) = case when p.carrier = 'Chubb' then 'combined' else lower(p.carrier) end
       and not exists (select 1 from public.carrier_book_policies q where q.site_deal_id = d.id)
  )
  update public.carrier_book_policies p set site_deal_id = c.deal_id, site_match = 'client_name'
    from cand c where c.np = 1 and c.nd = 1 and p.carrier = c.carrier and p.policy_key = c.policy_key;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.carrier_book_match_client_only() from public, anon, authenticated;

-- site deals on a carrier we pull that the portal does not show
create or replace view public.v_site_deals_not_in_portal as
  select d.id as deal_id, c.name as carrier, d.agent_id, coalesce(a.display_name, 'Agent') as agent_name,
         d.policy_number, public.fn_policy_number_grade(d.policy_number) as policy_number_grade,
         d.annual_premium, (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date as posted_date,
         ((now() at time zone 'America/Phoenix')::date - (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date) as days_old,
         exists (select 1 from public.carrier_book_policies p
                  where p.agent_id = coalesce(a.canonical_agent_id, a.id)) as agent_has_portal_policies
    from public.deals d
    join public.carriers c on c.id = d.carrier_id and lower(c.name) in ('ethos', 'combined')
    left join public.agents a on a.id = d.agent_id
   where d.source::text = 'apex_native'
     and (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date >= date '2026-08-01'
     and not exists (select 1 from public.carrier_book_policies p where p.site_deal_id = d.id);
revoke all on public.v_site_deals_not_in_portal from anon, public, authenticated;
