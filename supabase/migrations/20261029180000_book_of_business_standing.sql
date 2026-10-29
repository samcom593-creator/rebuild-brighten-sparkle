-- OVERHAUL-book (2026-10-29): Book of Business says who is still on the books and who is not.
--
-- Sam (2026-10-28): "For the Book of Business tab, remove the advanced financial flow. Again, it should
-- be breakdown of people who are here and not people who aren't here. Just use logic."
--
-- Why a new view. The page listed v_production_unified, which is the production ledger: it drops every
-- policy AgentLink marks dead (agentlink_book.is_dead) and every native deal whose workflow status is
-- lapsed, cancelled, charged back, withdrawn, not taken or declined, because dead policies are not
-- production. So the people who are NOT on the books could never appear: measured as Sam on 2026-10-29,
-- 205 dead AgentLink policies (57 Lapse Pending, 42 Lapsed, 51 Declined, 30 Withdrawn, 24 Not Taken,
-- 1 Cancelled) were missing from the page, and its Lapsed / Cancelled / Withdrawn / Not Taken tiles
-- could only ever read 0. It also showed every native deal as "submitted" (its workflow state) when the
-- agent recorded the carrier's policy status on the deal (deals.policy_status_standard: 166 Issued, Not
-- Paid, 12 Pending, 11 Active, 8 Approved, 1 In Review).
--
-- v_book_of_business is every row of v_production_unified (same rows, same scope, native rows carrying
-- the policy status the agent recorded) plus the policies that left the books, each with:
--   status_key  the status normalised to one key: lower case, spaces, commas, dashes and underscores
--               folded to one underscore ("Issued, Not Paid" -> issued_not_paid), synonyms merged
--               (canceled -> cancelled, chargeback -> charged_back, inforce -> in_force), blank -> unknown;
--   standing    where the policy stands, the same groups Book Flips uses (v_book_flip_worklist):
--     active   active, approved, issued, in force, paid
--     pending  pending, in review, submitted, underwriting, issued not paid, approved not issued, needs review
--     lapsing  lapse pending, lapsed, grace period (a missed payment; it can still be saved)
--     gone     declined, withdrawn, not taken, cancelled, terminated, postponed, rescinded, surrendered,
--              deceased, closed, incomplete, charged back, or any other policy AgentLink marks dead
--     unknown  no status from the carrier (AgentLink "Unknown", blank) and production reported as a total
--              (reported_external, no client)
--   src/lib/bookStanding.ts holds the same lists for the labels, and a test pins the two together.
--
-- Scope: exactly v_production_unified's rule, applied to every row: the database's own roles, Sam's admin
-- logins and the book_readers list (Aisha) see the whole book; everyone else sees the rows whose agent is
-- in api_scope_agent_ids() (their own agent rows, and a manager's downline). anon has no grant.
--
-- book_of_business_counts(p_agent_ids) counts the same rows by standing and status_key, inside the
-- caller's scope (SECURITY INVOKER) and, when the page passes its team list, only those agents, which is
-- the list's own `agent_id in (...)` filter. So a tile's number is the length of the list it opens.
--
-- Nothing is deleted and no table changes: production views and totals still read v_production_unified.

create or replace view public.v_book_of_business
with (security_barrier = true) as
select q.row_key, q.origin, q.agent_id, q.agent_name, q.client_name, q.carrier, q.product,
       q.policy_number, q.annual_premium, q.posted_date, q.effective_date, q.status, q.synced_at,
       q.status_key, q.standing
from (
  with on_books as (
    -- Every row of the production book. A native deal carries the policy status its agent recorded.
    select u.row_key, u.origin, u.agent_id, u.agent_name, u.client_name, u.carrier, u.product,
           u.policy_number, u.annual_premium, u.posted_date, u.effective_date,
           case when u.origin = 'apex_native' then coalesce(nullif(btrim(nd.policy_status_standard), ''), u.status)
                else u.status end as status,
           u.synced_at,
           false as is_dead
      from public.v_production_unified u
      left join public.deals nd
        on nd.id = case when u.origin = 'apex_native' then u.row_key::uuid end
  ),
  off_books_agentlink as (
    -- The AgentLink policies v_production_canonical drops as dead, under the same agent-name rule.
    select b.deal_key as row_key, 'agentlink'::text as origin, b.agent_id, b.agent_name, b.client_name,
           b.carrier, b.product, b.policy_number, b.annual_premium, b.posted_date, b.effective_date,
           b.status, b.imported_at as synced_at, true as is_dead
      from public.v_agentlink_book_scoped b
     where b.is_dead is true
       and case when b.agent_id is null then public.fn_book_agent_name_known(b.agent_name) else true end
  ),
  off_books_native as (
    -- The native deals v_production_canonical drops for a dead workflow status (none on 2026-10-29),
    -- under the same rules it applies to the native deals it keeps.
    select d.id::text as row_key, 'apex_native'::text as origin, d.agent_id,
           coalesce(ag.display_name, 'Agent'::text) as agent_name,
           btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')) as client_name,
           c.name as carrier, d.product_sold as product, d.policy_number, d.annual_premium,
           (coalesce(d.posted_at, d.created_at) at time zone 'America/Phoenix')::date as posted_date,
           d.effective_date,
           coalesce(nullif(btrim(d.policy_status_standard), ''), d.status) as status,
           d.created_at as synced_at, true as is_dead
      from public.deals d
      left join public.agents ag on ag.id = d.agent_id
      left join public.carriers c on c.id = d.carrier_id
     where d.agent_id is not null
       and d.annual_premium is not null
       and d.source::text = 'apex_native'
       and lower(coalesce(d.status, '')) = any (array['lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'])
       and not public.fn_agent_is_roster_excluded(d.agent_id)
       and not exists (
         select 1 from public.v_agentlink_book_scoped b
          where nullif(btrim(coalesce(b.policy_number, '')), '') is not null
            and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number, ''))))
       and not exists (
         select 1 from public.v_agentlink_book_scoped b2
          where b2.agent_id = d.agent_id and b2.annual_premium = d.annual_premium and b2.effective_date = d.effective_date
            and lower(btrim(coalesce(b2.client_name, ''))) = lower(btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, ''))))
  ),
  book as (
    select * from on_books
    union all
    select * from off_books_agentlink
    union all
    select * from off_books_native
  )
  select book.*,
         k.status_key,
         case
           when k.status_key = any (array['active', 'approved', 'issued', 'in_force', 'paid']) then 'active'
           when k.status_key = any (array['lapse_pending', 'lapsed', 'grace_period']) then 'lapsing'
           when k.status_key = any (array['declined', 'withdrawn', 'not_taken', 'cancelled', 'terminated', 'postponed',
                                          'rescinded', 'surrendered', 'deceased', 'closed', 'incomplete', 'charged_back',
                                          'not_in_force'])
                or book.is_dead then 'gone'
           when k.status_key = any (array['pending', 'in_review', 'submitted', 'underwriting', 'issued_not_paid',
                                          'approved_not_issued', 'needs_review']) then 'pending'
           else 'unknown'
         end as standing
    from book
   cross join lateral (
     select case r.raw_key
              when 'canceled' then 'cancelled'
              when 'chargeback' then 'charged_back'
              when 'inforce' then 'in_force'
              when 'dead' then 'not_in_force'
              when '' then 'unknown'
              else r.raw_key
            end as status_key
       from (select lower(regexp_replace(btrim(coalesce(book.status, '')), '[[:space:],_-]+', '_', 'g')) as raw_key) r
   ) k
) q
where current_user <> all (array['anon'::name, 'authenticated'::name])
   or (select public.api_is_full_reader())
   or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[]);

comment on view public.v_book_of_business is
  'OVERHAUL-book (2026-10-29): every policy on the book, including the ones that left it, with its standing (active, pending, lapsing, gone, unknown) and a normalised status_key. Same rows and scope as v_production_unified plus dead AgentLink policies and dead native deals. Read by /dashboard/production.';

revoke all on table public.v_book_of_business from public, anon, authenticated;
grant select on table public.v_book_of_business to authenticated, service_role;

create or replace function public.book_of_business_counts(p_agent_ids uuid[] default null)
returns table(standing text, status_key text, n integer)
language sql
stable
security invoker
set search_path = public
as $function$
  select b.standing, b.status_key, count(*)::integer as n
    from public.v_book_of_business b
   where p_agent_ids is null or b.agent_id = any (p_agent_ids)
   group by b.standing, b.status_key
$function$;

comment on function public.book_of_business_counts(uuid[]) is
  'OVERHAUL-book (2026-10-29): v_book_of_business counted by standing and status_key inside the caller''s scope; p_agent_ids narrows to the agents the page lists (its agent_id in (...) filter), so each count equals the list it opens.';

revoke all on function public.book_of_business_counts(uuid[]) from public, anon;
grant execute on function public.book_of_business_counts(uuid[]) to authenticated, service_role;
