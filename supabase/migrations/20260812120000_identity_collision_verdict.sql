-- v_identity_collision_verdict — the identity columns the merge flow cannot see.
--
-- WHY (audit 2026-08-12)
-- 397 .maybeSingle() call sites in this repo; 163 filter on columns carrying no
-- unique index. The single largest shape is 51 sites doing
--   agents.select(...).eq('user_id', uid).maybeSingle()
-- and agents has unique indexes on id, agent_code and ref_slug only — NOT on
-- user_id or profile_id. PostgREST returns data=null on a multi-row match, so on
-- a duplicate those 51 sites render "no agent" at a person who has two, from
-- ProtectedRoute's presenter gate to post-deal's "no agent row for caller".
-- profiles.email is read the same way by 8 more sites including
-- send-password-reset, where a collision presents as "no account with that email".
--
-- v_agent_duplicate_candidates already feeds /admin/agent-duplicates, but it keys
-- ONLY on al_user_id (all 6 of its current rows carry dup_reason='al_user_id').
-- Collisions on user_id / profile_id / email are invisible to it. That is the
-- same failure the al_user_id widening fixed on 2026-08-07, one column over:
-- wave-100 keyed on display_name and saw none of the al_user_id pairs; that view
-- keys on al_user_id and sees none of the profile_id pairs.
--
-- GRADING — deliberately NOT another permanently-red guard.
-- The first cut of this view graded on "two live rows in an unwatched group" and
-- went CRITICAL on 6 groups the moment it was created, clearable only by a merge
-- nobody has tooling for. That is the fifth costume of the disease apex-doctor
-- shipped four times this week (36 false pages/day -> a gate that could not cry
-- at all -> 39 true-but-misleading -> a permanent Stripe CRITICAL whose answer
-- was "everything is fine"). Deleted before it ever ran.
--
-- So this grades on MOVEMENT against a fixed anchor, exactly like
-- fn_alert_sms_fix_anchor() (2026-08-12):
--   * new_collision_minted -> CRITICAL. A colliding row was CREATED after the
--     anchor, i.e. something is still minting duplicates and the next one may
--     land on an active agent, blanking their portal across 51 call sites.
--   * known_backlog        -> WARN, naming the groups and which are invisible to
--     /admin/agent-duplicates. Frozen state that needs adjudication, not a page.
--   * clean                -> ok.
-- The frozen backlog is reported as CONTEXT inside the ok/warn line rather than
-- laundered away, per the Check #18 precedent from the same day.
--
-- Scalar subqueries throughout: this returns exactly ONE row in every state,
-- including an empty agents table. A view that renders blank when the thing it
-- watches is broken reads as healthy on every surface — that is how the Stripe
-- ingest stayed dark for 56.8 days (v_stripe_event_health, fixed 2026-08-11).

-- Anchor: the instant this audit measured the backlog. Single-sourced as a
-- function so the view and apex-doctor cannot drift apart the way curl's
-- --max-time drifted from fn_agentlink_reap_stuck's threshold on 2026-08-10.
create or replace function public.fn_identity_collision_anchor()
returns timestamptz
language sql
immutable
as $$ select '2026-08-12T12:00:00Z'::timestamptz $$;

comment on function public.fn_identity_collision_anchor is
  'The instant the 2026-08-12 .maybeSingle() audit measured the identity-collision '
  'backlog (12 groups: 1 agents.user_id, 5 agents.profile_id, 6 profiles.email). '
  'Collisions whose rows predate this are the known backlog; anything minted after '
  'it is new breakage. Single-sourced so the view and apex-doctor cannot drift.';

-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot rename an output
-- column, so a replay against an older shape of this view fails with
-- "cannot change name of view column". Replayability matters here — the deploy
-- pipeline replays migrations over live objects (2026-08-07).
drop view if exists public.v_identity_collision_verdict;

create view public.v_identity_collision_verdict as
with agent_rows as (
  select a.user_id, a.profile_id, a.display_name, a.created_at, a.al_user_id,
         (a.is_deactivated is true or a.status = 'terminated') as is_dead
  from public.agents a
),
groups as (
  select 'agents.user_id'::text as key_shape,
         d.user_id::text        as key_value,
         count(*)::int          as row_count,
         count(*) filter (where not d.is_dead)::int as live_count,
         string_agg(d.display_name, ' | ' order by d.created_at) as who,
         -- watched = v_agent_duplicate_candidates can key on it (it keys on al_user_id only)
         bool_or(d.al_user_id is not null) as watched,
         max(d.created_at) as newest_row_at
  from agent_rows d
  where d.user_id is not null
  group by 1, 2
  having count(*) > 1

  union all

  select 'agents.profile_id',
         d.profile_id::text,
         count(*)::int,
         count(*) filter (where not d.is_dead)::int,
         string_agg(d.display_name, ' | ' order by d.created_at),
         bool_or(d.al_user_id is not null),
         max(d.created_at)
  from agent_rows d
  where d.profile_id is not null
  group by 1, 2
  having count(*) > 1

  union all

  -- profiles carries no liveness flag of its own, so liveness is borrowed from
  -- whether the email resolves to a non-dead agent. Measured, not assumed: 3 of
  -- the 6 current email groups reach a live agent, 3 reach none.
  select 'profiles.email',
         p.email,
         count(*)::int,
         (select count(*)::int from public.agents a
           where a.profile_id in (select id from public.profiles p2 where p2.email = p.email)
             and a.is_deactivated is not true
             and (a.status is null or a.status <> 'terminated')),
         string_agg(p.id::text, ' | ' order by p.created_at),
         false,
         max(p.created_at)
  from public.profiles p
  where p.email is not null
  group by 1, 2
  having count(*) > 1
),
scored as (
  select g.*,
         (g.newest_row_at > public.fn_identity_collision_anchor()) as minted_after_anchor
  from groups g
)
select
  (select count(*)::int from scored)                                  as colliding_groups,
  (select count(*)::int from scored where minted_after_anchor)        as new_groups,
  (select count(*)::int from scored where key_shape = 'agents.user_id')    as user_id_groups,
  (select count(*)::int from scored where key_shape = 'agents.profile_id') as profile_id_groups,
  (select count(*)::int from scored where key_shape = 'profiles.email')    as email_groups,
  -- Groups /admin/agent-duplicates structurally cannot surface. The number that
  -- justifies widening that view, and the reason this one exists at all.
  (select count(*)::int from scored where not watched)                as unwatched_groups,
  (select count(*)::int from scored where live_count > 1)             as groups_touching_live_agents,
  (select coalesce(string_agg(who || ' [' || key_shape || ']', '; ' order by key_shape, key_value), '')
     from scored where minted_after_anchor)                           as new_detail,
  (select coalesce(string_agg(who || ' [' || key_shape || ']', '; ' order by key_shape, key_value), '')
     from scored where not minted_after_anchor)                       as backlog_detail,
  public.fn_identity_collision_anchor()                               as anchor_at,
  case
    when (select count(*)::int from scored where minted_after_anchor) > 0 then 'new_collision_minted'
    when (select count(*)::int from scored) > 0                           then 'known_backlog'
    else 'clean'
  end                                                                 as verdict;

comment on view public.v_identity_collision_verdict is
  'Collisions on agents.user_id / agents.profile_id / profiles.email — the identity '
  'columns 163 .maybeSingle() call sites read and no unique index protects. '
  'v_agent_duplicate_candidates keys only on al_user_id and cannot see most of these '
  '(unwatched_groups). CRITICAL only when a NEW colliding row is minted after '
  'fn_identity_collision_anchor(); the frozen backlog is WARN so this never becomes '
  'a page only Sam can clear. Scalar subqueries: exactly one row in every state.';

grant select on public.v_identity_collision_verdict to authenticated, service_role;
