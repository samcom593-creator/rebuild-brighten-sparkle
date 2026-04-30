-- ════════════════════════════════════════════════════════════════════════
-- Deal data integrity — cleanup of test rows + forward-guard trigger
--
-- Before: weekly ALP = $247,154 (inflated by 26 test deals + 11 real
-- duplicates). After cleanup: $183,625 (real).
--
-- Cleanup already run live via bot-sql 2026-04-23; this migration
-- captures the rules so fresh installs / reruns are idempotent and the
-- trigger prevents regression.
-- ════════════════════════════════════════════════════════════════════════

-- Retroactive cleanup (idempotent — matches nothing on future runs after this fires once)
DELETE FROM public.deals
WHERE
  (LOWER(client_first_name || ' ' || client_last_name) IN
    ('test deal','apex crm','john test','apextest autosync','samuel james'))
  OR policy_number IN ('dadasas','2wqwqwwq','qw')
  OR LOWER(product_sold) IN ('qw','dadasas');

-- Dedupe: keep oldest per (agent, client name, premium, effective_date, carrier)
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY agent_id, LOWER(COALESCE(client_first_name,'')),
                   LOWER(COALESCE(client_last_name,'')),
                   annual_premium, effective_date, COALESCE(carrier_id, gen_random_uuid())
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.deals)
DELETE FROM public.deals WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Forward guard: reject obvious test/junk deals going in
CREATE OR REPLACE FUNCTION public.trg_fn_reject_junk_deals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
BEGIN
  IF LOWER(COALESCE(NEW.client_first_name,'') || ' ' || COALESCE(NEW.client_last_name,''))
     IN ('test deal','apex crm','john test','apextest autosync') THEN
    RAISE EXCEPTION 'Rejected test-client deal: % %', NEW.client_first_name, NEW.client_last_name;
  END IF;
  IF NEW.policy_number IN ('dadasas','2wqwqwwq','qw') THEN
    RAISE EXCEPTION 'Rejected junk policy_number: %', NEW.policy_number;
  END IF;
  IF LOWER(COALESCE(NEW.product_sold,'')) IN ('qw','dadasas') THEN
    RAISE EXCEPTION 'Rejected junk product_sold: %', NEW.product_sold;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_reject_junk_deals ON public.deals;
CREATE TRIGGER trg_reject_junk_deals
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_reject_junk_deals();
