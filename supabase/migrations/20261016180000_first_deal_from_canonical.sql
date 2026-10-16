-- PL-WIB-FIRST-DEAL-CANONICAL: agents.first_deal_at follows canonical production.
--
-- Two triggers wrote the column: an INSERT on agentlink_book (whose agent rows end
-- 2026-08-31) and an INSERT on deals. Production that reaches an agent any other way
-- never set it: Discord-reported deals, deals re-attributed with UPDATE agent_id, and a
-- merge that leaves the date on the folded-away row. Measured 2026-10-16, 5 canonical
-- rows with canonical deals and a NULL first_deal_at: Cari Mullen (8, date on her merged
-- twin), Tre'va Tribble (5), David Ladd (2), Tyler Krejcha (4 + 1, merge pending). Every
-- surface keyed on the column read them as never having sold: the next-step engine held
-- Cari at "Start the pre-selling course" and Tre'va at "Complete all pre-selling modules",
-- both stalled, and v_queue_active_no_first_sale listed all four.
--
-- The reconciler derives the date from v_production_canonical, the one definition of
-- production, so no future source has to remember to write it. Same rule as the book
-- trigger: fill a NULL or move the date earlier, never clear it and never move it later.
-- It writes first_deal_at and updated_at only. The agents triggers that send anything
-- (hire notice, onboarding enqueue, Discord activation, scripts packet) are scoped to
-- status/stage/license/contracted_at columns, so the only one this fires is the
-- next-step recompute, which is the point.
CREATE OR REPLACE FUNCTION public.fn_reconcile_first_deal_at(p_apply boolean DEFAULT true)
RETURNS TABLE(agent_id uuid, display_name text, was timestamptz, now_is timestamptz, applied boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH canon AS (
      SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS aid, min(p.posted_date) AS first_posted
        FROM public.v_production_canonical p
        LEFT JOIN public.v_agent_canonical_map cm ON cm.agent_id = p.agent_id
       WHERE p.agent_id IS NOT NULL
         AND p.posted_date BETWEEN DATE '2020-01-01' AND current_date + 1
       GROUP BY 1
    )
    SELECT a.id, a.display_name, a.first_deal_at AS was, c.first_posted::timestamptz AS target
      FROM public.agents a
      JOIN canon c ON c.aid = a.id
     WHERE a.canonical_agent_id IS NULL
       AND (a.first_deal_at IS NULL OR a.first_deal_at::date > c.first_posted)
     ORDER BY a.display_name
  LOOP
    agent_id := r.id; display_name := r.display_name; was := r.was; now_is := r.target;
    applied := false; error := NULL;
    IF p_apply THEN
      BEGIN
        UPDATE public.agents a
           SET first_deal_at = r.target, updated_at = now()
         WHERE a.id = r.id
           AND (a.first_deal_at IS NULL OR a.first_deal_at > r.target);
        applied := FOUND;
      EXCEPTION WHEN others THEN
        error := SQLERRM;
      END;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_reconcile_first_deal_at(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_first_deal_at(boolean) TO service_role;

DO $m$
BEGIN
  PERFORM 1 FROM public.fn_reconcile_first_deal_at(true);
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'first-deal-at-reconcile') THEN
      PERFORM cron.schedule('first-deal-at-reconcile', '23 * * * *',
        $j$select count(*) from public.fn_reconcile_first_deal_at(true)$j$);
    END IF;
  END IF;
END
$m$;
