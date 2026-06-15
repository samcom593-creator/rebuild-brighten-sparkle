-- ─────────────────────────────────────────────────────────────────────────
-- 2026-06-15 — Per-agent training stage tracker
-- Sam's voice directive (2026-06-15):
--   "It should have systems where it's easy to see, check whether they're
--    in field training, on court [classroom], in classroom. Inventory
--    borrowers active in the field — i.e. active producing in the field."
--
-- Mental model: every agent is in exactly one of 4 stages —
--   (A) test       — prelicensing / studying for state exam
--   (B) classroom  — live training session attendance / cohort week
--   (C) field      — mentored sales calls / shadowing in the field
--   (D) active     — independently producing
--
-- Derivation lives in v_agent_training_stage. Manual override lives in
-- agents.training_stage_override + agents.training_stage_override_at +
-- agents.training_stage_override_by.
--
-- Source-of-truth signals already on agents (no fake data):
--   - license_status: 'licensed' | 'unlicensed' | 'pending'
--   - first_deal_at: timestamptz (set by deals trigger)
--   - field_training_started_at: timestamptz
--   - onboarding_stage: enum (training_online / in_field_training / live / …)
--   - created_at: timestamptz
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Enum for the 4 stages + sentinel 'unknown' (renders as "Stage pending"
--    in the UI per Sam's "never show Unknown" rule).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'agent_training_stage') then
    create type public.agent_training_stage as enum (
      'test', 'classroom', 'field', 'active', 'unknown'
    );
  end if;
end$$;

-- 2) Manual override column (admin-only). Default NULL = let the view derive.
alter table public.agents
  add column if not exists training_stage_override public.agent_training_stage,
  add column if not exists training_stage_override_at timestamptz,
  add column if not exists training_stage_override_by uuid references public.agents(id);

comment on column public.agents.training_stage_override is
  '2026-06-15 — admin manual override for derived training stage. NULL = use v_agent_training_stage.';

-- 3) Derivation view. Every active agent gets a stage + the date stamps
--    Sam wants on the per-agent profile drawer.
create or replace view public.v_agent_training_stage as
with base as (
  select
    a.id as agent_id,
    a.license_status,
    a.onboarding_stage,
    a.first_deal_at,
    a.field_training_started_at,
    a.contracted_at,
    a.created_at,
    a.is_deactivated,
    a.is_inactive,
    a.training_stage_override,
    a.training_stage_override_at,
    a.training_stage_override_by
  from public.agents a
)
select
  agent_id,
  -- Effective stage: manual override wins, else derive.
  coalesce(
    training_stage_override,
    case
      -- (A) Test — still studying for state exam
      when license_status in ('unlicensed', 'pending')
        and onboarding_stage in ('applied', 'meeting_attendance', 'pre_licensed', 'onboarding')
        then 'test'::public.agent_training_stage
      when license_status in ('unlicensed', 'pending')
        then 'test'::public.agent_training_stage
      -- (D) Active — already producing
      when first_deal_at is not null
        then 'active'::public.agent_training_stage
      -- (C) Field — licensed, no first deal yet, field_training_started_at set
      --     OR onboarding_stage explicitly says in_field_training
      when license_status = 'licensed'
        and (field_training_started_at is not null
             or onboarding_stage = 'in_field_training')
        then 'field'::public.agent_training_stage
      -- (B) Classroom — licensed, no first deal, no field training yet
      --     (most recently licensed cohort that's in classroom training_online)
      when license_status = 'licensed'
        and first_deal_at is null
        and field_training_started_at is null
        then 'classroom'::public.agent_training_stage
      else 'unknown'::public.agent_training_stage
    end
  ) as stage,
  -- Date stamps for the 4-dot tracker.
  -- test_started_at: applicants get created when they apply.
  created_at as test_started_at,
  -- classroom_started_at: when they got licensed (entered classroom phase).
  case when license_status = 'licensed' then contracted_at end as classroom_started_at,
  -- field_started_at: explicit field_training_started_at OR contracted_at
  -- as a fallback if they're in_field_training without the explicit stamp.
  coalesce(
    field_training_started_at,
    case when onboarding_stage = 'in_field_training' then contracted_at end
  ) as field_started_at,
  -- active_started_at: first_deal_at is the source of truth.
  first_deal_at as active_started_at,
  -- Pass-through for the drawer UI.
  license_status,
  onboarding_stage,
  training_stage_override,
  training_stage_override_at,
  training_stage_override_by,
  is_deactivated,
  is_inactive
from base;

comment on view public.v_agent_training_stage is
  '2026-06-15 — derived per-agent training stage (test/classroom/field/active) + date stamps for the AgentProfileDrawer tracker. Manual override wins over derivation.';

-- 4) Grant select to authenticated so the React frontend can read it.
--    Anon stays blocked (no grant).
grant select on public.v_agent_training_stage to authenticated;

-- 5) Smoke test: agency-wide stage histogram (RAISE NOTICE for migration log).
do $$
declare
  c_test       int;
  c_classroom  int;
  c_field      int;
  c_active     int;
  c_unknown    int;
begin
  select
    count(*) filter (where stage = 'test'),
    count(*) filter (where stage = 'classroom'),
    count(*) filter (where stage = 'field'),
    count(*) filter (where stage = 'active'),
    count(*) filter (where stage = 'unknown')
  into c_test, c_classroom, c_field, c_active, c_unknown
  from public.v_agent_training_stage;
  raise notice '[v_agent_training_stage] test=% classroom=% field=% active=% unknown=%',
    c_test, c_classroom, c_field, c_active, c_unknown;
end$$;
