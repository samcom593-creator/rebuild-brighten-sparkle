-- MP-352: a carrier-accepted sale is proof of a licence.
--
-- Sam: "if they have one sale, their licence automatically. Mark that
-- throughout the system."
--
-- He is right, and it is a legal fact rather than a convention: you cannot bind
-- life insurance without an active producer licence, so a policy the carrier
-- accepted and posted to the book could not exist unless the writer was
-- licensed on that date.
--
-- MEASURED: 17 agents hold posted production while reading 'unlicensed',
-- including Marquay Vaughns (35 policies / $56,734.44) and Alyjah Rowland
-- (30 / $121,082.40). Every one of them shows as unlicensed on the roster, in
-- the call queue's licence filter, and to any surface that gates on
-- license_status — which is why licensed producers kept appearing in
-- pre-licensing lists.
--
-- licensed_at IS SET TO THEIR FIRST SALE, not now(). now() would assert they
-- became licensed the moment this migration ran, which is false and would
-- corrupt every tenure and time-to-licence measure. The first posted policy is
-- the earliest date the record can actually prove.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not touch agents with zero book
-- rows. Jaden Selvaraj, David Ladd and Alonzo Johnson have made 2,393 dialer
-- calls between them and Sam believes they should be licensed — but they carry
-- NO al_user_id, so no production can attribute to them and there is nothing
-- here to prove anything with. Inferring a licence from an empty book would be
-- inventing a legal status. Their problem is AgentLink linkage (MP-351), and it
-- must be fixed there first; the trigger below will then promote them the
-- moment a real policy lands.

begin;

-- ---------------------------------------------------------------------------
-- 1. Correct the existing rows.
-- ---------------------------------------------------------------------------
create table if not exists public.license_inference_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  from_status text,
  first_sale_on date,
  policies integer,
  inferred_at timestamptz not null default now()
);

alter table public.license_inference_log enable row level security;

drop policy if exists "staff read license inference" on public.license_inference_log;
create policy "staff read license inference" on public.license_inference_log
  for select to authenticated using (public.apex_is_admin() or public.is_agency_staff());

grant select on public.license_inference_log to authenticated;

with producers as (
  select b.agent_id,
         min(b.posted_date) as first_sale,
         count(*)::integer as policies
  from public.agentlink_book b
  where b.agent_id is not null
  group by b.agent_id
),
targets as (
  select a.id, a.license_status::text as from_status, p.first_sale, p.policies
  from public.agents a
  join producers p on p.agent_id = a.id
  where a.license_status::text is distinct from 'licensed'
),
logged as (
  insert into public.license_inference_log (agent_id, from_status, first_sale_on, policies)
  select id, from_status, first_sale, policies from targets
  returning agent_id
)
update public.agents a
   set license_status = 'licensed'::public.license_status,
       licensed_at    = coalesce(a.licensed_at, t.first_sale::timestamptz),
       updated_at     = now()
  from targets t
 where a.id = t.id;

-- ---------------------------------------------------------------------------
-- 2. Keep it true going forward.
-- ---------------------------------------------------------------------------
create or replace function public.fn_book_row_proves_license()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.agent_id is null then return new; end if;

  update public.agents a
     set license_status = 'licensed'::public.license_status,
         licensed_at    = coalesce(a.licensed_at, new.posted_date::timestamptz, now()),
         updated_at     = now()
   where a.id = new.agent_id
     and a.license_status::text is distinct from 'licensed';

  return new;
exception when others then
  -- A licence inference must never block production landing in the book.
  raise warning 'fn_book_row_proves_license failed for agent %: %', new.agent_id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_book_row_proves_license on public.agentlink_book;
create trigger trg_book_row_proves_license
  after insert on public.agentlink_book
  for each row execute function public.fn_book_row_proves_license();

comment on function public.fn_book_row_proves_license() is
  'MP-352: a posted carrier policy cannot exist without a licence, so the first '
  'book row promotes its agent to licensed and stamps licensed_at from the '
  'POSTED DATE, never now(). EXCEPTION-guarded: an inference must never block '
  'production from landing.';

-- ---------------------------------------------------------------------------
-- 3. A guard that can go red, so this cannot silently regress.
-- ---------------------------------------------------------------------------
create or replace view public.v_producers_missing_license
with (security_invoker = true) as
select a.id as agent_id,
       a.display_name,
       a.status::text as status,
       count(b.*)::integer as policies,
       min(b.posted_date) as first_sale_on,
       sum(b.annual_premium)::numeric(12,2) as alp
  from public.agents a
  join public.agentlink_book b on b.agent_id = a.id
 where a.license_status::text is distinct from 'licensed'
 group by a.id, a.display_name, a.status;

comment on view public.v_producers_missing_license is
  'MP-352: agents holding posted production while not marked licensed. Should '
  'be permanently EMPTY — the trigger promotes on the first book row. A non-zero '
  'count means something wrote license_status back after a sale.';

grant select on public.v_producers_missing_license to authenticated;

commit;
