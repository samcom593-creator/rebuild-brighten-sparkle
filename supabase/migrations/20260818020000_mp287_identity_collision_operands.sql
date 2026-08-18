-- MP-287 — v_identity_collision_verdict: the operands were proxies, and both lied.
--
-- WHAT 20260812120000 SHIPPED, AND WHY IT COULD NEVER CLEAR
--
-- 1. `watched` was bool_or(al_user_id IS NOT NULL) — a PROXY for "this group is
--    visible on /admin/agent-duplicates", never a measurement of it. Measured
--    against the page's own feed on 2026-08-17: 10 of 12 groups are invisible,
--    not 7, and three groups the proxy called "watched" (Loren Lail, Landon
--    Boyd, Xaviar Watts) are not on that page at all. Wrong in both directions.
--
-- 2. The premise under it was read off OUTPUT ROWS, not off the schema. The
--    header said v_agent_duplicate_candidates "keys ONLY on al_user_id (all 6 of
--    its current rows carry dup_reason='al_user_id')". pg_get_viewdef says it
--    keys on THREE columns — display_name, al_user_id, insuracloud_user_id — and
--    dup_reason is a PRIORITY LABEL assigned by
--      DISTINCT ON (agent_id) ORDER BY CASE dup_reason WHEN 'al_user_id' THEN 1
--                                                      WHEN 'insuracloud_user_id' THEN 2 ELSE 3 END
--    so a display_name-keyed pair that also shares an al_user_id is RELABELLED
--    'al_user_id' on the way out. Reading a derived label as if it were the key
--    is MP-277's "the ratchet was counting its own footnotes", one layer over.
--
-- 3. So the remedy this view told Sam to run every Sunday — "Widening
--    v_agent_duplicate_candidates to key on profile_id + email is what retires
--    this line" — is inert TWICE. (a) The two views are independent; nothing in
--    unwatched_groups reads the candidates view, so widening it cannot move that
--    number by one. (b) MEASURED: unresolved agent groups per key are
--    profile_id=1, user_id=1, email->agents=1, and all three are the SAME PAIR
--    (Matthew Anduha), which is ALREADY on the page under al_user_id 967.
--    Widening adds exactly ZERO rows.
--
-- 4. THE DEFECT THAT KEPT IT WARNING: no canonical_agent_id filter. Sam has
--    ALREADY adjudicated 4 of the 5 agent-keyed groups — Geohn Battle, Landon
--    Boyd, Loren Lail and Xaviar Watts each have their dup row pointing at the
--    canonical via canonical_agent_id, and merge_agent_into_canonical() RAISEs
--    23505 'Dup agent already merged' if you try again. They are finished work
--    that this view counts as an open backlog forever. A guard that cannot be
--    cleared by doing the thing it asks for is the seventh costume of the disease
--    this doctor has now shipped six times (36 false pages/day -> a gate that
--    could not cry at all -> 39 true-but-misleading -> a permanent Stripe
--    CRITICAL -> a frozen SMS-literal count -> this).
--
-- WHAT THIS CHANGES
--   * Adjudicated groups are EXCLUDED from the backlog and reported as
--     resolved_groups context. Not deleted, not laundered — named as done.
--   * visible_on_admin_page is MEASURED by joining v_agent_duplicate_candidates,
--     and requires >= 2 member agents on the page, because the page can only
--     offer a merge when it renders both sides of the pair.
--   * profiles.email groups are kept and counted SEPARATELY, because no agent
--     merge can clear them — they are duplicate PROFILE rows, and the harm is on
--     the 8 .maybeSingle() reads of profiles.email (send-password-reset reads a
--     collision as "no account with that email"). Telling Sam to click Merge for
--     those is pointing him at a page that structurally cannot show them.
--   * Grading still keys on MOVEMENT against fn_identity_collision_anchor(), and
--     adds covered_backlog: open groups that /admin/agent-duplicates ALREADY
--     renders are owned by apex-doctor Check #14. Re-warning here is the
--     duplicate-escalation mistake MP-278 fixed between Checks #18 and #20 —
--     encoding one condition twice does not make it truer.
--
-- Scalar subqueries throughout: exactly ONE row in every state, including empty,
-- so this can never go blank-and-read-as-green (the v_stripe_event_health lesson).

-- Column set changes shape (renames + new columns), so CREATE OR REPLACE is
-- rejected by Postgres. DROP is deliberately NOT CASCADE: if anything has come
-- to depend on this view since 2026-08-12, this migration must fail loudly
-- rather than silently drop the dependent with it.
DROP VIEW IF EXISTS public.v_identity_collision_verdict;

CREATE VIEW public.v_identity_collision_verdict AS
WITH agent_rows AS (
  SELECT a.id, a.user_id, a.profile_id, a.display_name, a.created_at,
         a.al_user_id, a.canonical_agent_id,
         (a.is_deactivated IS TRUE OR a.status = 'terminated'::agent_status) AS is_dead
  FROM public.agents a
),
groups AS (
  SELECT 'agents.user_id'::text AS key_shape,
         d.user_id::text        AS key_value,
         count(*)::int          AS row_count,
         count(*) FILTER (WHERE d.canonical_agent_id IS NULL)::int AS unresolved_count,
         count(*) FILTER (WHERE NOT d.is_dead)::int                AS live_count,
         string_agg(d.display_name, ' | ' ORDER BY d.created_at)   AS who,
         array_agg(d.id)        AS member_agent_ids,
         max(d.created_at)      AS newest_row_at
  FROM agent_rows d
  WHERE d.user_id IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1

  UNION ALL

  SELECT 'agents.profile_id'::text, d.profile_id::text, count(*)::int,
         count(*) FILTER (WHERE d.canonical_agent_id IS NULL)::int,
         count(*) FILTER (WHERE NOT d.is_dead)::int,
         string_agg(d.display_name, ' | ' ORDER BY d.created_at),
         array_agg(d.id),
         max(d.created_at)
  FROM agent_rows d
  WHERE d.profile_id IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1

  UNION ALL

  -- Rows here are PROFILES, not agents. unresolved_count is the number of
  -- UNRESOLVED AGENT rows reachable from the email, because that is the only
  -- thing an agent merge could act on; < 2 means the merge flow is powerless.
  SELECT 'profiles.email'::text, p.email, count(*)::int,
         (SELECT count(*)::int FROM public.agents a
           WHERE a.profile_id IN (SELECT p2.id FROM public.profiles p2 WHERE p2.email = p.email)
             AND a.canonical_agent_id IS NULL),
         (SELECT count(*)::int FROM public.agents a
           WHERE a.profile_id IN (SELECT p2.id FROM public.profiles p2 WHERE p2.email = p.email)
             AND a.is_deactivated IS NOT TRUE
             AND (a.status IS NULL OR a.status <> 'terminated'::agent_status)),
         string_agg(p.id::text, ' | ' ORDER BY p.created_at),
         COALESCE((SELECT array_agg(a.id) FROM public.agents a
                    WHERE a.profile_id IN (SELECT p2.id FROM public.profiles p2 WHERE p2.email = p.email)),
                  '{}'::uuid[]),
         max(p.created_at)
  FROM public.profiles p
  WHERE p.email IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1
),
scored AS (
  SELECT g.*,
         (g.key_shape <> 'profiles.email' AND g.unresolved_count > 1) AS agent_open,
         (g.key_shape =  'profiles.email')                            AS email_group,
         (g.key_shape <> 'profiles.email' AND g.unresolved_count <= 1) AS agent_resolved,
         (SELECT count(*) FROM public.v_agent_duplicate_candidates v
           WHERE v.agent_id = ANY (g.member_agent_ids)) >= 2          AS visible_on_admin_page,
         g.newest_row_at > public.fn_identity_collision_anchor()      AS minted_after_anchor
  FROM groups g
),
graded AS (
  SELECT s.*,
         -- Sam can only act on a group that is OPEN and that the merge page can
         -- actually render both sides of. Email groups are excluded here because
         -- no agent merge clears a duplicate profile row.
         (s.agent_open AND NOT s.visible_on_admin_page) AS needs_tooling,
         ((s.agent_open OR s.email_group) AND s.live_count > 1 AND NOT s.visible_on_admin_page) AS live_and_unreachable
  FROM scored s
)
SELECT
  (SELECT count(*)::int FROM graded WHERE agent_open OR email_group)          AS colliding_groups,
  (SELECT count(*)::int FROM graded WHERE (agent_open OR email_group) AND minted_after_anchor) AS new_groups,
  (SELECT count(*)::int FROM graded WHERE agent_open)                         AS open_agent_groups,
  (SELECT count(*)::int FROM graded WHERE agent_resolved)                     AS resolved_groups,
  (SELECT count(*)::int FROM graded WHERE email_group)                        AS email_groups,
  (SELECT count(*)::int FROM graded WHERE agent_open AND visible_on_admin_page) AS groups_on_admin_page,
  (SELECT count(*)::int FROM graded WHERE needs_tooling)                      AS groups_needing_tooling,
  (SELECT count(*)::int FROM graded WHERE live_and_unreachable)               AS groups_touching_live_agents,
  (SELECT count(*)::int FROM graded WHERE agent_open AND key_shape = 'agents.user_id')    AS user_id_groups,
  (SELECT count(*)::int FROM graded WHERE agent_open AND key_shape = 'agents.profile_id') AS profile_id_groups,
  (SELECT COALESCE(string_agg(who || ' [' || key_shape || ']', '; ' ORDER BY key_shape, key_value), '')
     FROM graded WHERE (agent_open OR email_group) AND minted_after_anchor)   AS new_detail,
  (SELECT COALESCE(string_agg(who || ' [' || key_shape || ']', '; ' ORDER BY key_shape, key_value), '')
     FROM graded WHERE needs_tooling OR live_and_unreachable)                 AS actionable_detail,
  (SELECT COALESCE(string_agg(who || ' [' || key_shape || ']', '; ' ORDER BY key_shape, key_value), '')
     FROM graded WHERE (agent_open OR email_group) AND NOT (needs_tooling OR live_and_unreachable)) AS backlog_detail,
  public.fn_identity_collision_anchor() AS anchor_at,
  CASE
    WHEN (SELECT count(*) FROM graded WHERE (agent_open OR email_group) AND minted_after_anchor) > 0
      THEN 'new_collision_minted'
    WHEN (SELECT count(*) FROM graded WHERE needs_tooling OR live_and_unreachable) > 0
      THEN 'actionable_backlog'
    WHEN (SELECT count(*) FROM graded WHERE agent_open OR email_group) > 0
      THEN 'covered_backlog'
    ELSE 'clean'
  END AS verdict;

COMMENT ON VIEW public.v_identity_collision_verdict IS
  'MP-287: identity collisions graded on measured operands. Adjudicated groups (canonical_agent_id set) are excluded from the backlog; admin-page visibility is measured against v_agent_duplicate_candidates, never proxied by al_user_id; profiles.email dupes are counted separately because no agent merge clears them.';
