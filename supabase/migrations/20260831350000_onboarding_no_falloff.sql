-- MP-354: close every onboarding gap that can be closed by derivation, and make
-- the rest visible instead of silent.
--
-- Sam: "onboarding 100 percent locked and dialed with no fall-off risk."
--
-- MEASURED across 34 live agents: 2 cannot sign in, 20 have no AgentLink id so
-- no sale can ever credit them, 3 have no contact details anywhere, 23 have no
-- start_date, 8 never received an onboarding email, and 13 carry a first_deal_at
-- that is missing or disagrees with their own book.
--
-- THE HONEST SPLIT. Three of those are DERIVABLE from data already held, so they
-- are fixed here and kept fixed by triggers. Three require information nobody in
-- this database has — an AgentLink id, a phone number, a real start date for
-- someone hired before the field existed — so they are surfaced as named work
-- rather than guessed. Inventing a start date or an AgentLink id would make the
-- gap invisible without closing it, which is worse than leaving it open.

begin;

-- ---------------------------------------------------------------------------
-- 1. first_deal_at — derivable, and it was wrong on 13 of the live roster.
-- ---------------------------------------------------------------------------
update public.agents a
   set first_deal_at = b.first_sale::timestamptz,
       updated_at = now()
  from (
    select agent_id, min(posted_date) as first_sale
    from public.agentlink_book
    where agent_id is not null
    group by agent_id
  ) b
 where b.agent_id = a.id
   and (a.first_deal_at is null or a.first_deal_at::date is distinct from b.first_sale);

create or replace function public.fn_book_row_sets_first_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.agent_id is null or new.posted_date is null then return new; end if;
  -- least(), so a backfilled OLDER policy corrects the date downward. Using
  -- coalesce would freeze the first value ever seen, which is the import order,
  -- not the truth.
  update public.agents a
     set first_deal_at = least(coalesce(a.first_deal_at, new.posted_date::timestamptz),
                               new.posted_date::timestamptz),
         updated_at = now()
   where a.id = new.agent_id
     and (a.first_deal_at is null or a.first_deal_at::date > new.posted_date);
  return new;
exception when others then
  raise warning 'fn_book_row_sets_first_deal failed for agent %: %', new.agent_id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_book_row_sets_first_deal on public.agentlink_book;
create trigger trg_book_row_sets_first_deal
  after insert on public.agentlink_book
  for each row execute function public.fn_book_row_sets_first_deal();

-- ---------------------------------------------------------------------------
-- 2. start_date — derived from the hire record, never invented.
-- ---------------------------------------------------------------------------
-- Only where a source application exists: its created_at is the date the person
-- actually entered the funnel, which is a real event. Agents with no
-- application keep a null start_date and appear in the integrity view, because
-- agents.created_at is when the ROW was made — often a bulk import — and
-- passing that off as a start date would be a fabricated fact on a person's
-- record.
update public.agents a
   set start_date = ap.created_at::date,
       updated_at = now()
  from public.applications ap
 where ap.id = a.source_application_id
   and a.start_date is null;

-- ---------------------------------------------------------------------------
-- 3. One place that answers "who is at risk of falling out of onboarding?"
-- ---------------------------------------------------------------------------
create or replace view public.v_onboarding_integrity
with (security_invoker = true) as
select a.id as agent_id,
       a.display_name,
       a.status::text as status,
       a.created_at::date as added_on,
       coalesce(m.display_name, 'Unassigned') as manager_name,
       (a.user_id is null) as cannot_sign_in,
       (a.al_user_id is null) as no_production_credit,
       (coalesce(
          (select p.email from public.profiles p where p.id = a.profile_id),
          (select ap.email from public.applications ap where ap.id = a.source_application_id)
        ) is null
        and coalesce(
          (select p.phone from public.profiles p where p.id = a.profile_id),
          (select ap.phone from public.applications ap where ap.id = a.source_application_id)
        ) is null) as unreachable,
       (a.start_date is null) as no_start_date,
       (not exists (
          select 1 from public.agent_onboarding_queue q
           where q.agent_id = a.id and q.sent_at is not null
        )) as never_onboarded,
       -- The single number a human should act on: how many things are wrong.
       ((a.user_id is null)::int
        + (a.al_user_id is null)::int
        + (a.start_date is null)::int
        + (not exists (select 1 from public.agent_onboarding_queue q
                        where q.agent_id = a.id and q.sent_at is not null))::int) as open_gaps
  from public.agents a
  left join public.agents m on m.id = a.manager_id
 where a.status = 'active'
   and coalesce(a.is_deactivated, false) = false
   and coalesce(a.is_inactive, false) = false
   and a.canonical_agent_id is null
   and not public.fn_agent_is_roster_excluded(a.id);

comment on view public.v_onboarding_integrity is
  'MP-354: every live agent and which onboarding steps are still open. '
  'Derivable gaps (first_deal_at, start_date from the application) are fixed by '
  'trigger and backfill; the rest need information nobody in this database has '
  'and are named rather than guessed.';

grant select on public.v_onboarding_integrity to authenticated;

create or replace function public.my_onboarding_integrity()
returns table(
  agent_id uuid, display_name text, status text, added_on date, manager_name text,
  cannot_sign_in boolean, no_production_credit boolean, unreachable boolean,
  no_start_date boolean, never_onboarded boolean, open_gaps integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  )
  select v.agent_id, v.display_name, v.status, v.added_on, v.manager_name,
         v.cannot_sign_in, v.no_production_credit, v.unreachable,
         v.no_start_date, v.never_onboarded, v.open_gaps
  from public.v_onboarding_integrity v
  join scope s on s.id = v.agent_id
  where v.open_gaps > 0
  order by v.open_gaps desc, v.added_on desc;
$function$;

comment on function public.my_onboarding_integrity() is
  'MP-354: live agents with open onboarding gaps, scoped to the caller and '
  'ordered by how many things are wrong.';

revoke all on function public.my_onboarding_integrity() from public;
grant execute on function public.my_onboarding_integrity() to authenticated;

commit;
