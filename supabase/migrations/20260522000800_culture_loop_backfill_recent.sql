-- CULTURE LOOP BACKFILL — recent real deal wins
--
-- The culture trigger is live for future deal inserts. This backfills a small,
-- controlled set of existing recent deals so Content Command and manager
-- culture credits are not empty while waiting for the next deal import.
--
-- It intentionally does NOT mark discord_sent=true or blast public channels.

WITH src AS (
  SELECT
    d.id AS deal_id,
    d.agent_id,
    a.manager_id,
    d.annual_premium,
    COALESCE(d.product_sold, 'Life Insurance') AS product_sold,
    COALESCE(d.posted_at, d.created_at, now()) AS deal_at,
    COALESCE(a.display_name, p.full_name, 'An Apex Agent') AS agent_name
  FROM public.deals d
  LEFT JOIN public.agents a ON a.id = d.agent_id
  LEFT JOIN public.profiles p ON p.user_id = a.user_id
  WHERE d.status IN ('submitted', 'active')
    AND COALESCE(d.annual_premium, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.culture_events ce WHERE ce.deal_id = d.id
    )
  ORDER BY COALESCE(d.posted_at, d.created_at, now()) DESC
  LIMIT 12
),
drafts AS (
  INSERT INTO public.social_bot_drafts (
    draft_date, platform, slot, pillar,
    title, hook, body, cta, caption, hashtags,
    status, notes
  )
  SELECT
    deal_at::date,
    'instagram',
    'any',
    'proof',
    agent_name || ' · $' || TRIM(TO_CHAR(annual_premium, 'FM999,999,999')) || ' Deal Win',
    agent_name || ' just locked in a $' || TRIM(TO_CHAR(annual_premium, 'FM999,999,999')) || ' ' || product_sold || ' deal.',
    'Real people. Real results.' ||
      E'\n\n' || agent_name || ' posted a $' ||
      TRIM(TO_CHAR(annual_premium, 'FM999,999,999')) || ' ' || product_sold ||
      ' policy.' ||
      E'\n\nWant results like this? Apply at apex-financial.org/apply.',
    'Apply at apex-financial.org/apply',
    agent_name || ' just locked in a $' ||
      TRIM(TO_CHAR(annual_premium, 'FM999,999,999')) || ' ' || product_sold ||
      E' deal.\n\n#ApexFinancial #LifeInsurance #AgentWin #HoldTheStandard',
    'ApexFinancial LifeInsurance AgentWin HoldTheStandard',
    'awaiting_approval',
    'culture_loop_backfill deal_id=' || deal_id::text
  FROM src
  RETURNING id, notes
),
mapped AS (
  SELECT
    src.*,
    drafts.id AS draft_id
  FROM src
  JOIN drafts ON drafts.notes = 'culture_loop_backfill deal_id=' || src.deal_id::text
),
events AS (
  INSERT INTO public.culture_events (
    deal_id, event_type, agent_id, manager_id,
    annual_premium, product_sold, draft_id, discord_sent
  )
  SELECT
    deal_id,
    'deal_posted',
    agent_id,
    manager_id,
    annual_premium,
    product_sold,
    draft_id,
    false
  FROM mapped
  ON CONFLICT (deal_id) DO UPDATE
    SET draft_id = COALESCE(public.culture_events.draft_id, EXCLUDED.draft_id)
  RETURNING id, manager_id, agent_id, annual_premium
)
INSERT INTO public.culture_manager_credits (
  culture_event_id, manager_id, agent_id, annual_premium
)
SELECT id, manager_id, agent_id, annual_premium
FROM events
WHERE manager_id IS NOT NULL
ON CONFLICT (culture_event_id, manager_id) DO NOTHING;
