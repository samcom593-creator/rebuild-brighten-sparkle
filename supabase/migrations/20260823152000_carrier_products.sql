-- 2026-08-23 15:20 UTC · Post a Deal: "Product Sold" is a picker in the reference form.
--
-- Nothing in this database lists the products a carrier sells, so the field has
-- been a free-text box: two agents writing the same product spell it two ways
-- and the book cannot group them. The honest source of a product list is the
-- production that has already been written — agentlink_book (the truth table)
-- plus native deals. They are joined on carrier NAME on purpose:
-- agentlink_book.carrier_id is InsuraCloud's integer id, NOT carriers.id (uuid),
-- so joining on carrier_id would silently match nothing.
--
-- Six of eighteen active carriers have no production on file. This view simply
-- returns no rows for them and the form falls back to typing the name, rather
-- than inventing a catalogue.

CREATE OR REPLACE VIEW public.v_carrier_products AS
WITH written AS (
  SELECT b.carrier AS carrier_name, nullif(btrim(b.product), '') AS product
  FROM public.agentlink_book b
  WHERE COALESCE(b.is_dead, false) = false
  UNION ALL
  SELECT c.name, nullif(btrim(d.product_sold), '')
  FROM public.deals d
  JOIN public.carriers c ON c.id = d.carrier_id
)
SELECT
  c.id                       AS carrier_id,
  c.name                     AS carrier_name,
  w.product                  AS product,
  count(*)::integer          AS deals_written
FROM public.carriers c
JOIN written w
  ON lower(btrim(w.carrier_name)) = lower(btrim(c.name))
WHERE w.product IS NOT NULL
GROUP BY c.id, c.name, w.product;

COMMENT ON VIEW public.v_carrier_products IS
  'Post a Deal product picker. Distinct products actually written per carrier, counted from agentlink_book + native deals. Empty for a carrier with no production on file — the form then takes free text.';

GRANT SELECT ON public.v_carrier_products TO authenticated;
