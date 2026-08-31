-- MP-356: the hire board could show you the process but never move anybody through it.
--
-- The Interview Control Room's "New-hire launch board" rendered a four-step
-- rail (Hired / Licensed / Onboarding / Field ready) that was purely derived
-- and entirely read-only. The only button that changed anything navigated to
-- another page. Three things were measurably wrong underneath it:
--
--   1. IT HID MOST OF THE PEOPLE. fetchActiveHires filtered created_at to the
--      current Phoenix month, so the board showed 19 hires while 15 more
--      active, non-canonical hires sat mid-process from earlier months --
--      8 licensed and parked at 'evaluated', 2 at 'onboarding', 1 unlicensed
--      at 'onboarding', 1 'pre_licensed', 1 'training_online', 1
--      'in_field_training'. 14 of those 15 are not field-ready and none of
--      them could be seen or worked here. On the 1st of a month the board
--      empties out entirely.
--
--   2. IT PUT PRODUCERS IN THE LICENSING LANE. hireRailStep matched the stage
--      string against /(training|onboard|contract)/ and /(field|active|
--      production|ready)/. 'evaluated' matches neither, so it fell through to
--      step 1 -- "Licensed". Measured: 8 of 8 active agents at 'evaluated'
--      have a first_deal_at AND rows in agentlink_book. Every one of them is
--      a proven producer being rendered as somebody still waiting on a
--      license, with "NEXT ACTION evaluated" underneath.
--
--   3. THE NEXT ACTION WAS THE RAW COLUMN. The card printed
--      onboarding_stage with the underscores swapped for spaces, truncated to
--      "Onb…" in the layout it was given. It restated where the person is; it
--      never said what to do.
--
-- This migration builds the half that has to exist before the page can do
-- anything: an explicit ladder (the enum's own sort order is not one --
-- 'live' sorts before 'onboarding' and 'evaluated' sorts last), one view
-- carrying every signal a card needs, an audit trail for moves (agents has
-- only stage_changed_at, so today "who moved this hire" is unrecoverable),
-- and two write RPCs with optimistic concurrency.

begin;

-- ---------------------------------------------------------------------------
-- The ladder. Explicit, because pg_enum's order is not it.
-- ---------------------------------------------------------------------------
create or replace function public.fn_hire_stage_rank(p_stage text)
returns integer
language sql
immutable
as $fn$
  select case lower(coalesce(p_stage, ''))
    when ''                 then 0   -- nothing recorded yet
    when 'applied'          then 0
    when 'pre_licensed'     then 0
    when 'meeting_attendance' then 0
    when 'onboarding'       then 1
    when 'training_online'  then 2
    when 'in_field_training' then 3
    when 'live'             then 4
    when 'evaluated'        then 4   -- measured: 8/8 have a first deal and book rows
    else null                        -- off-ladder: inactive, need_followup,
  end;                               -- pending_review, transfer, below_10k
$fn$;

comment on function public.fn_hire_stage_rank(text) is
  'Rank on the new-hire ladder: 0 not started / 1 onboarding / 2 in course / 3 field training / 4 producing. NULL means the stage is a status flag rather than a rung (inactive, need_followup, pending_review, transfer, below_10k) and must be surfaced as an exception, never silently sorted to the bottom.';

create or replace function public.fn_hire_stage_for_rank(p_rank integer)
returns text
language sql
immutable
as $fn$
  select case p_rank
    when 0 then 'pre_licensed'
    when 1 then 'onboarding'
    when 2 then 'training_online'
    when 3 then 'in_field_training'
    when 4 then 'live'
    else null
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- Audit. agents carries stage_changed_at and nothing else, so every move made
-- before today is anonymous. A board built for moving people needs to be able
-- to say who moved them.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_stage_moves (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  field text not null check (field in ('onboarding_stage', 'license_status')),
  from_value text,
  to_value text not null,
  note text,
  moved_by uuid,
  moved_by_agent_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists agent_stage_moves_agent_idx on public.agent_stage_moves(agent_id, created_at desc);
alter table public.agent_stage_moves enable row level security;

drop policy if exists agent_stage_moves_read on public.agent_stage_moves;
create policy agent_stage_moves_read on public.agent_stage_moves
  for select to authenticated
  using (public.apex_is_admin() or public.crm_can_read_agent_scope(agent_id));

-- No insert/update/delete policy: rows are written only by the SECURITY
-- DEFINER RPCs below, so a client can never forge or erase a move receipt.
revoke all on public.agent_stage_moves from anon;
grant select on public.agent_stage_moves to authenticated;

comment on table public.agent_stage_moves is
  'Append-only receipt for every hire stage / license move made from the launch board. Written only by advance_hire_stage and set_hire_license_status; there is deliberately no client write policy.';

commit;

-- ---------------------------------------------------------------------------
-- The board's single read.
-- ---------------------------------------------------------------------------
drop view if exists public.v_hire_launch_board;
begin;

create or replace view public.v_hire_launch_board as
with base as (
  select
    a.id                                   as agent_id,
    a.user_id,
    a.profile_id,
    a.display_name,
    a.license_status::text                 as license_status,
    a.onboarding_stage::text               as onboarding_stage,
    public.fn_hire_stage_rank(a.onboarding_stage::text) as stage_rank,
    a.created_at                           as hired_at,
    a.stage_changed_at,
    a.contracted_at,
    a.first_deal_at,
    a.source_application_id,
    a.invited_by_manager_id
  from public.agents a
  where a.status = 'active'
    and a.canonical_agent_id is null
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
),
enriched as (
  select
    b.*,
    p.full_name,
    p.email,
    p.phone,
    mgr.display_name as manager_name,
    -- Days the person has sat exactly where they are. stage_changed_at is null
    -- for anyone who has never been moved, so fall back to the hire date
    -- rather than reporting an unknowable 0.
    greatest(0, (current_date - coalesce(b.stage_changed_at, b.hired_at)::date)) as days_in_stage,
    greatest(0, (current_date - b.hired_at::date))                              as days_since_hired,
    act.calls_7d,
    act.calls_30d,
    act.conversations_30d,
    act.last_call_at,
    bk.deals    as book_deals,
    bk.ap       as book_ap,
    cal.next_call_at,
    cal.last_outcome as last_call_outcome,
    tr.modules_done
  from base b
  left join public.profiles p on p.id = b.profile_id
  left join public.agents  mgr on mgr.id = b.invited_by_manager_id
  left join lateral (
    select count(*) as deals, coalesce(sum(bb.annual_premium), 0) as ap
    from public.agentlink_book bb
    where bb.agent_id = b.agent_id and bb.is_dead is not true
  ) bk on true
  left join lateral (
    select
      min(oc.scheduled_at) filter (where oc.scheduled_at > now() and oc.canceled_at is null) as next_call_at,
      (array_agg(oc.outcome order by oc.scheduled_at desc) filter (where oc.outcome is not null))[1] as last_outcome
    from public.v_onboarding_calls oc
    where oc.agent_id = b.agent_id
  ) cal on true
  left join lateral (
    select count(*) as modules_done
    from public.onboarding_progress op
    where op.agent_id = b.agent_id and op.completed_at is not null
  ) tr on true
  -- MP-344 landed v_hire_activity the same morning: what a hire actually DOES
  -- (dialer calls, conversations, deals) rather than the stage somebody last
  -- typed. Composed in here rather than duplicated, so the card can say
  -- "1,184 calls in 30 days" next to a stage nobody has touched in months --
  -- which is the whole reason that view exists. It is security_invoker, so a
  -- caller who cannot read the underlying rows gets nulls and the card simply
  -- omits the line.
  left join public.v_hire_activity act on act.agent_id = b.agent_id
)
select
  e.agent_id,
  e.user_id,
  coalesce(nullif(btrim(e.display_name), ''), e.full_name, 'Name not on file') as display_name,
  e.email,
  e.phone,
  e.license_status,
  e.onboarding_stage,
  e.stage_rank,
  e.hired_at,
  e.stage_changed_at,
  e.days_in_stage,
  e.days_since_hired,
  e.contracted_at,
  e.first_deal_at,
  e.source_application_id,
  e.invited_by_manager_id,
  e.manager_name,
  e.book_deals,
  e.book_ap,
  e.next_call_at,
  e.last_call_outcome,
  e.modules_done,
  e.calls_7d,
  e.calls_30d,
  e.conversations_30d,
  e.last_call_at,
  (e.hired_at >= date_trunc('month', (now() at time zone 'America/Phoenix'))::date::timestamptz + interval '7 hours')
    as hired_this_month,
  -- The first unmet gate, in the order a real hire clears them. This is what
  -- the card prints instead of the raw stage string.
  case
    when e.license_status <> 'licensed'                       then 'license'
    when e.stage_rank is null                                 then 'off_ladder'
    when e.stage_rank = 0                                     then 'start_onboarding'
    when e.stage_rank = 1 and e.next_call_at is null          then 'book_call'
    when e.stage_rank = 1                                     then 'move_to_course'
    when e.stage_rank = 2                                     then 'move_to_field'
    when e.stage_rank = 3 and e.first_deal_at is null         then 'first_deal'
    when e.stage_rank = 3                                     then 'mark_producing'
    else 'coach'
  end as next_action_key,
  case
    when e.license_status <> 'licensed'                       then 'Get them licensed'
    when e.stage_rank is null                                 then 'Off the ladder at ' || coalesce(e.onboarding_stage, 'no stage') || ' — put them back on it'
    when e.stage_rank = 0                                     then 'Start onboarding'
    when e.stage_rank = 1 and e.next_call_at is null          then 'Book the onboarding call'
    when e.stage_rank = 1                                     then 'Move them into the course'
    when e.stage_rank = 2                                     then 'Course done — send them to field training'
    when e.stage_rank = 3 and e.first_deal_at is null         then 'Field training — get the first deal'
    when e.stage_rank = 3                                     then 'First deal is in — mark them producing'
    else 'Producing — coach the next win'
  end as next_action_label,
  -- A hire who has not moved in two weeks and is not yet producing. Measured
  -- before choosing 14: the active roster's mean time-in-stage is 69 days at
  -- 'onboarding' and 133 at 'evaluated', so this fires on a real backlog, and
  -- it is deliberately a flag on the card rather than an alert to anybody.
  (coalesce(e.stage_rank, 0) < 4
   and greatest(0, (current_date - coalesce(e.stage_changed_at, e.hired_at)::date)) > 14) as is_stalled,
  (e.email is null or btrim(e.email) = '') as email_missing,
  (e.phone is null or btrim(e.phone) = '') as phone_missing
from enriched e
-- THE VIEW IS THE GATE. Measured before shipping: without this predicate a
-- plain producing agent (not admin, not manager, no team) read all 34 hires
-- and 29 of their email addresses, because a non-security_invoker view runs
-- as its owner and the agents policy "Authenticated users can view agents for
-- leaderboard" admits every logged-in account. That is the MP-325 shape.
-- crm_can_read_agent_scope is the same contract the CRM already publishes:
-- admin and VA staff see the roster, a manager sees their own line, everyone
-- else sees themselves.
where public.apex_is_admin()
   or public.crm_can_read_agent_scope(e.agent_id);

comment on view public.v_hire_launch_board is
  'One row per active, non-canonical hire with every signal the new-hire launch board renders: ladder rank, days parked in stage, onboarding call, course progress, book production, and the first unmet gate as next_action_key/label. Deliberately NOT filtered to the current month — the board it replaces was, which hid 15 mid-process hires and emptied itself on the 1st.';

revoke all on public.v_hire_launch_board from anon;
grant select on public.v_hire_launch_board to authenticated, service_role;

commit;


-- ---------------------------------------------------------------------------
-- The board's two writes.
-- ---------------------------------------------------------------------------
begin;

-- Who may move a hire. Deliberately NOT crm_can_read_agent_scope: that is a
-- READ gate and it admits every va and va_manager to the whole roster. This
-- mirrors the existing "Managers can update team agent onboarding stage" RLS
-- policy exactly, so the RPC grants nobody anything they could not already do
-- with a direct update.
create or replace function public.fn_can_move_hire(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.apex_is_admin()
     or (
       public.has_role(auth.uid(), 'manager')
       and exists (
         select 1 from public.agents a
         where a.id = p_agent_id
           and a.invited_by_manager_id = public.current_agent_id()
       )
     );
$fn$;

create or replace function public.advance_hire_stage(
  p_agent_id uuid,
  p_to_stage text,
  p_expected_stage text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_current text;
  v_licensed text;
  v_to_rank integer;
  v_queued text[];
begin
  if not public.fn_can_move_hire(p_agent_id) then
    raise exception 'You cannot move this hire' using errcode = '42501';
  end if;

  select a.onboarding_stage::text, a.license_status::text
    into v_current, v_licensed
  from public.agents a where a.id = p_agent_id
  for update;

  if not found then
    raise exception 'That hire no longer exists' using errcode = 'P0002';
  end if;

  v_to_rank := public.fn_hire_stage_rank(p_to_stage);
  if v_to_rank is null then
    raise exception '% is not a stage on the hire ladder', coalesce(p_to_stage, 'null') using errcode = '22023';
  end if;

  -- Optimistic concurrency, same contract the interview actions already use:
  -- two managers working the same board cannot silently overwrite each other.
  -- A caller that passes nothing is explicitly opting out.
  if p_expected_stage is not null and coalesce(v_current, '') is distinct from coalesce(p_expected_stage, '') then
    raise exception 'This hire moved to % while you were looking. Refresh and try again.',
      coalesce(v_current, 'no stage') using errcode = '40001';
  end if;

  if coalesce(v_current, '') = lower(btrim(p_to_stage)) then
    return jsonb_build_object('ok', true, 'changed', false, 'stage', v_current,
      'message', 'Already at that stage — nothing was written.');
  end if;

  update public.agents
  set onboarding_stage = lower(btrim(p_to_stage))::onboarding_stage,
      updated_at = now()
  where id = p_agent_id;

  insert into public.agent_stage_moves(agent_id, field, from_value, to_value, note, moved_by, moved_by_agent_id)
  values (p_agent_id, 'onboarding_stage', v_current, lower(btrim(p_to_stage)),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), public.current_agent_id());

  -- Report what the move set in motion. trg_agents_hired_licensed_enqueue
  -- queues the course and Discord emails when a licensed hire reaches 'live',
  -- and the enqueue is ON CONFLICT DO NOTHING, so this reads what is actually
  -- pending rather than predicting it.
  select coalesce(array_agg(q.email_kind order by q.email_kind), '{}')
    into v_queued
  from public.agent_onboarding_queue q
  where q.agent_id = p_agent_id and q.sent_at is null;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'from', v_current,
    'stage', lower(btrim(p_to_stage)),
    'rank', v_to_rank,
    'licenseStatus', v_licensed,
    'queuedEmails', to_jsonb(v_queued)
  );
end;
$fn$;

create or replace function public.set_hire_license_status(
  p_agent_id uuid,
  p_to_status text,
  p_expected_status text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_current text;
  v_to text := lower(btrim(coalesce(p_to_status, '')));
  v_queued text[];
begin
  if not public.fn_can_move_hire(p_agent_id) then
    raise exception 'You cannot change this hire''s license status' using errcode = '42501';
  end if;
  if v_to not in ('licensed', 'unlicensed', 'pending') then
    raise exception '% is not a license status', coalesce(p_to_status, 'null') using errcode = '22023';
  end if;

  select a.license_status::text into v_current
  from public.agents a where a.id = p_agent_id for update;
  if not found then
    raise exception 'That hire no longer exists' using errcode = 'P0002';
  end if;

  if p_expected_status is not null and coalesce(v_current, '') is distinct from coalesce(p_expected_status, '') then
    raise exception 'This hire is now %, not %. Refresh and try again.',
      coalesce(v_current, 'unknown'), p_expected_status using errcode = '40001';
  end if;

  if coalesce(v_current, '') = v_to then
    return jsonb_build_object('ok', true, 'changed', false, 'licenseStatus', v_current,
      'message', 'Already recorded — nothing was written.');
  end if;

  -- license_status is an enum, not text. The first cut assigned the text
  -- directly and Postgres refused it; the membership check above is what makes
  -- this cast safe rather than a way to raise 22P02 at the user.
  update public.agents
  set license_status = v_to::license_status,
      updated_at = now()
  where id = p_agent_id;

  insert into public.agent_stage_moves(agent_id, field, from_value, to_value, note, moved_by, moved_by_agent_id)
  values (p_agent_id, 'license_status', v_current, v_to,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), public.current_agent_id());

  select coalesce(array_agg(q.email_kind order by q.email_kind), '{}')
    into v_queued
  from public.agent_onboarding_queue q
  where q.agent_id = p_agent_id and q.sent_at is null;

  return jsonb_build_object(
    'ok', true, 'changed', true, 'from', v_current,
    'licenseStatus', v_to, 'queuedEmails', to_jsonb(v_queued)
  );
end;
$fn$;

revoke all on function public.advance_hire_stage(uuid, text, text, text) from public, anon;
revoke all on function public.set_hire_license_status(uuid, text, text, text) from public, anon;
grant execute on function public.advance_hire_stage(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.set_hire_license_status(uuid, text, text, text) to authenticated, service_role;

comment on function public.advance_hire_stage(uuid, text, text, text) is
  'Move one hire along the onboarding ladder from the launch board. Admin or the hire''s own inviting manager only (same set the agents RLS update policy already admits). Optimistic on p_expected_stage, writes an agent_stage_moves receipt, and reports the onboarding emails actually left queued rather than predicting the trigger.';

commit;
