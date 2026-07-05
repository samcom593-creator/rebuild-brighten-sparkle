-- v_new_hires_activation
--
-- Sam's use case: "surface the hired-in-60d never produced" cohort.
-- Licensed agents who cleared the finish line but haven't submitted a first deal.
-- Rendered on /admin/producer-trends as a "Never Activated" surface right next to
-- the 3-week drop alarm — same slip-mode class, one step earlier in the funnel.
--
-- Truth source: public.agents.first_deal_at (updated by the same pipeline that
-- powers v_agent_weekly_production). If first_deal_at IS NULL and license_status
-- = 'licensed' and hire is within the last 60 days, the agent is in-cohort.
--
-- Hire date = COALESCE(contracted_at, created_at) — contracted_at is the truth
-- source when it exists, created_at is the fallback for pre-onboarding-stage rows.
--
-- Excludes deactivated / inactive agents (they aren't a live activation problem).

CREATE OR REPLACE VIEW public.v_new_hires_activation AS
SELECT
  a.id                                                    AS agent_id,
  COALESCE(NULLIF(a.display_name, ''), 'Unnamed')         AS display_name,
  COALESCE(a.contracted_at, a.created_at)                 AS hire_date,
  GREATEST(
    0,
    EXTRACT(DAY FROM (now() - COALESCE(a.contracted_at, a.created_at)))::int
  )                                                       AS days_since_hire,
  a.onboarding_stage::text                                AS onboarding_stage,
  a.license_status::text                                  AS license_status,
  a.manager_id,
  m.display_name                                          AS manager_name,
  (a.al_user_id IS NOT NULL)                              AS agentlink_linked,
  a.next_action_text,
  a.next_action_due_at
FROM public.agents a
LEFT JOIN public.agents m ON m.id = a.manager_id
WHERE a.license_status = 'licensed'
  AND a.first_deal_at IS NULL
  AND COALESCE(a.is_deactivated, false) = false
  AND COALESCE(a.is_inactive, false) = false
  AND COALESCE(a.contracted_at, a.created_at) >= (now() - interval '60 days')
ORDER BY days_since_hire DESC;

COMMENT ON VIEW public.v_new_hires_activation IS
'Licensed agents hired in the last 60 days who have never submitted a first deal.
Powers the "Never Activated" tile + table on /admin/producer-trends.
Cohort = license_status=licensed AND first_deal_at IS NULL AND hire within 60d
AND not deactivated/inactive. Hire date = COALESCE(contracted_at, created_at).
Ordered by days_since_hire DESC so the oldest silent hires surface first.';

GRANT SELECT ON public.v_new_hires_activation TO authenticated;
