-- CULTURE LOOP — PL-CULTURE-001
--
-- When a deal is posted (from any source — post-deal fn, agentlink import,
-- manual admin insert) this trigger fires and:
--   1. Inserts into culture_events (idempotent on deal_id).
--   2. Auto-generates a social_bot_drafts row for Content Command.
--   3. Credits the agent's manager via culture_manager_credits.
--
-- This means Content Command starts auto-populating with real deal wins
-- the moment agents post deals. Sam approves/rejects, then posts.

-- ── culture_events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.culture_events (
  id               bigserial PRIMARY KEY,
  deal_id          uuid        NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  event_type       text        NOT NULL DEFAULT 'deal_posted',
  agent_id         uuid        REFERENCES public.agents(id),
  manager_id       uuid        REFERENCES public.agents(id),
  annual_premium   numeric,
  product_sold     text,
  draft_id         bigint      REFERENCES public.social_bot_drafts(id) ON DELETE SET NULL,
  discord_sent     boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS culture_events_agent_id_idx   ON public.culture_events(agent_id);
CREATE INDEX IF NOT EXISTS culture_events_manager_id_idx ON public.culture_events(manager_id);
CREATE INDEX IF NOT EXISTS culture_events_created_at_idx ON public.culture_events(created_at DESC);

ALTER TABLE public.culture_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_all_culture_events" ON public.culture_events;
CREATE POLICY "admins_all_culture_events" ON public.culture_events
  FOR ALL USING ((SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1) = 'admin');
DROP POLICY IF EXISTS "agents_own_culture_events" ON public.culture_events;
CREATE POLICY "agents_own_culture_events" ON public.culture_events
  FOR SELECT USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

-- ── culture_manager_credits ──────────────────────────────────────────────────
-- Lightweight credit ledger: each deal in the manager's downline earns credit.
CREATE TABLE IF NOT EXISTS public.culture_manager_credits (
  id             bigserial PRIMARY KEY,
  culture_event_id bigint NOT NULL REFERENCES public.culture_events(id) ON DELETE CASCADE,
  manager_id     uuid    NOT NULL REFERENCES public.agents(id),
  agent_id       uuid    NOT NULL REFERENCES public.agents(id),
  annual_premium numeric,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(culture_event_id, manager_id)
);

CREATE INDEX IF NOT EXISTS cmc_manager_id_idx ON public.culture_manager_credits(manager_id);

ALTER TABLE public.culture_manager_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_all_cmc" ON public.culture_manager_credits;
CREATE POLICY "admins_all_cmc" ON public.culture_manager_credits
  FOR ALL USING ((SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1) = 'admin');
DROP POLICY IF EXISTS "managers_own_cmc" ON public.culture_manager_credits;
CREATE POLICY "managers_own_cmc" ON public.culture_manager_credits
  FOR SELECT USING (
    manager_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

-- ── fn_culture_loop_on_deal ──────────────────────────────────────────────────
-- Trigger function: fires on INSERT to deals.
-- Idempotent: ON CONFLICT(deal_id) DO NOTHING.
CREATE OR REPLACE FUNCTION public.fn_culture_loop_on_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_name       text;
  v_manager_id       uuid;
  v_manager_name     text;
  v_alp              numeric;
  v_product          text;
  v_event_id         bigint;
  v_draft_id         bigint;
  v_hook             text;
  v_caption          text;
  v_body             text;
  v_today            date;
BEGIN
  -- Only fire for real posted deals
  IF NEW.annual_premium IS NULL OR NEW.annual_premium <= 0 THEN
    RETURN NEW;
  END IF;

  v_alp     := NEW.annual_premium;
  v_product := COALESCE(NEW.product_sold, 'Life Insurance');
  v_today   := COALESCE(NEW.posted_at::date, CURRENT_DATE);

  -- Resolve agent display name
  SELECT COALESCE(a.display_name, p.full_name, 'An Apex Agent')
    INTO v_agent_name
    FROM public.agents a
    LEFT JOIN public.profiles p ON p.user_id = a.user_id
   WHERE a.id = NEW.agent_id
   LIMIT 1;

  -- Resolve manager
  SELECT a.manager_id INTO v_manager_id
    FROM public.agents a
   WHERE a.id = NEW.agent_id
   LIMIT 1;

  IF v_manager_id IS NOT NULL THEN
    SELECT COALESCE(a.display_name, p.full_name, 'Manager')
      INTO v_manager_name
      FROM public.agents a
      LEFT JOIN public.profiles p ON p.user_id = a.user_id
     WHERE a.id = v_manager_id
     LIMIT 1;
  END IF;

  -- Build draft copy
  v_hook    := v_agent_name || ' just locked in a $' ||
               TRIM(TO_CHAR(v_alp, 'FM999,999,999')) ||
               ' ' || v_product || ' deal.';

  v_body    := 'Real people. Real results.' ||
               E'\n\n' || v_agent_name || ' posted a $' ||
               TRIM(TO_CHAR(v_alp, 'FM999,999,999')) ||
               ' ' || v_product || ' policy today.' ||
               CASE WHEN v_manager_id IS NOT NULL
                    THEN E'\n\nManager: ' || COALESCE(v_manager_name, 'Team Lead')
                    ELSE '' END ||
               E'\n\nWant results like this? Apply at apex-financial.org/apply.';

  v_caption := v_hook ||
               E'\n\n#ApexFinancial #LifeInsurance #AgentWin #HoldTheStandard';

  -- 1) Insert culture_event (skip if deal already processed)
  INSERT INTO public.culture_events (
    deal_id, event_type, agent_id, manager_id,
    annual_premium, product_sold, discord_sent
  )
  VALUES (
    NEW.id, 'deal_posted', NEW.agent_id, v_manager_id,
    v_alp, v_product, false
  )
  ON CONFLICT (deal_id) DO NOTHING
  RETURNING id INTO v_event_id;

  -- If conflict (already processed), bail out — idempotent
  IF v_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2) Auto-generate social_bot_drafts row for Content Command
  INSERT INTO public.social_bot_drafts (
    draft_date, platform, slot, pillar,
    title, hook, body, cta, caption, hashtags,
    status, notes
  )
  VALUES (
    v_today, 'instagram', 'any', 'proof',
    v_agent_name || ' · $' || TRIM(TO_CHAR(v_alp, 'FM999,999,999')) || ' Deal Win',
    v_hook,
    v_body,
    'Apply at apex-financial.org/apply',
    v_caption,
    'ApexFinancial LifeInsurance AgentWin HoldTheStandard',
    'awaiting_approval',
    'Auto-generated by culture loop on deal insert. Approve to post.'
  )
  RETURNING id INTO v_draft_id;

  -- Link draft back to culture_event
  IF v_draft_id IS NOT NULL THEN
    UPDATE public.culture_events SET draft_id = v_draft_id WHERE id = v_event_id;
  END IF;

  -- 3) Manager credit
  IF v_manager_id IS NOT NULL THEN
    INSERT INTO public.culture_manager_credits (
      culture_event_id, manager_id, agent_id, annual_premium
    )
    VALUES (v_event_id, v_manager_id, NEW.agent_id, v_alp)
    ON CONFLICT (culture_event_id, manager_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Wire trigger onto deals
DROP TRIGGER IF EXISTS trg_culture_loop_on_deal ON public.deals;
CREATE TRIGGER trg_culture_loop_on_deal
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_culture_loop_on_deal();

-- ── Views for dashboard ──────────────────────────────────────────────────────

-- Manager culture credit rollup (past 30 days)
CREATE OR REPLACE VIEW public.v_manager_culture_credits AS
SELECT
  cmc.manager_id,
  COALESCE(a.display_name, p.full_name, 'Unknown') AS manager_name,
  COUNT(*)                                          AS deal_count,
  SUM(cmc.annual_premium)                           AS total_alp,
  MAX(ce.created_at)                                AS last_deal_at
FROM public.culture_manager_credits cmc
JOIN public.culture_events ce ON ce.id = cmc.culture_event_id
LEFT JOIN public.agents a     ON a.id  = cmc.manager_id
LEFT JOIN public.profiles p   ON p.user_id = a.user_id
WHERE ce.created_at >= now() - INTERVAL '30 days'
GROUP BY cmc.manager_id, a.display_name, p.full_name;

GRANT SELECT ON public.v_manager_culture_credits TO authenticated;

-- Culture feed (last 20 deal wins with draft status)
CREATE OR REPLACE VIEW public.v_culture_feed AS
SELECT
  ce.id,
  ce.deal_id,
  ce.event_type,
  ce.created_at,
  ce.annual_premium,
  ce.product_sold,
  ce.discord_sent,
  COALESCE(a.display_name, p.full_name, 'Unknown') AS agent_name,
  (SELECT p2.avatar_url FROM public.profiles p2 WHERE p2.user_id = a.user_id LIMIT 1) AS agent_photo,
  sd.id      AS draft_id,
  sd.status  AS draft_status,
  sd.hook    AS draft_hook,
  sd.caption AS draft_caption
FROM public.culture_events ce
LEFT JOIN public.agents a         ON a.id  = ce.agent_id
LEFT JOIN public.profiles p       ON p.user_id = a.user_id
LEFT JOIN public.social_bot_drafts sd ON sd.id = ce.draft_id
ORDER BY ce.created_at DESC
LIMIT 50;

GRANT SELECT ON public.v_culture_feed TO authenticated;

-- ── Verification notice ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_tbl  int;
  v_fn   int;
  v_trg  int;
BEGIN
  SELECT count(*) INTO v_tbl FROM information_schema.tables
    WHERE table_name IN ('culture_events','culture_manager_credits');
  SELECT count(*) INTO v_fn FROM information_schema.routines
    WHERE routine_name = 'fn_culture_loop_on_deal';
  SELECT count(*) INTO v_trg FROM information_schema.triggers
    WHERE trigger_name = 'trg_culture_loop_on_deal';
  RAISE NOTICE 'CULTURE LOOP READY: % tables + % fn + % trigger', v_tbl, v_fn, v_trg;
END $$;
