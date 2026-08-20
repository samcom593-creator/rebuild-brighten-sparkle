-- MP-310 (2026-08-20): a TEST deal reached the live InsuraCloud write path and
-- was stopped only by an expired session cookie.
--
-- WHAT HAPPENED. At 2026-08-19T22:16:41Z a verification run proving Post-a-Deal
-- field persistence wrote deal 10692093 into production `deals`:
-- policy_number 'ZZTEST2-1787177801', $1,800.00 AP, source apex_native, under
-- Sam's agent row 7c3c5581. v_insuracloud_push_eligible accepted it, the outbox
-- POSTed it at InsuraCloud, and the only thing that came back was
--   InsuraCloud 403: {"error":"Invalid CSRF token", ...}
-- A 403 means the request was MADE. It got past the credential gate, reached a
-- third-party system of record, and failed on an expired session -- not on any
-- guard of ours.
--
-- WHY THAT MATTERS MORE THAN THE ROW. MP-306 (2026-08-11) recorded that the
-- only thing preventing bulk writes into agentlink_book -- the book Sam's
-- commissions are computed from -- was that the stored credential was an `al_`
-- API key, which cannot POST deals, and it said in those words: "an accident,
-- not a safety property". That accident is now GONE. Measured today, exactly one
-- agent row holds a credential and it is session-like (84 chars), not `al_`.
-- MP-306's own queued next action was to refresh that session. Doing that while
-- a ZZTEST policy sat eligible would have written the test row into the book.
--
-- THE GUARD THIS VIEW ALREADY HAD, AND THE SHAPE IT MISSED. The eligibility
-- predicate is not naive -- it already refuses drafts, agent_link imports,
-- policies already present in agentlink_book, empty/NULL numbers,
-- 'PLACEHOLDER-%', anything with no digit, and anything under 6 characters.
-- Someone had already thought about not shipping garbage to a third party.
-- 'ZZTEST2-1787177801' passes every one of those: 18 characters, digits
-- throughout, not a placeholder, not a draft. So this extends an existing
-- deliberate filter list; it does not invent a new policy.
--
-- DELIBERATELY NARROW, AND SAYS SO. This matches the 'ZZTEST' prefix that the
-- Post-a-Deal harness actually emits, not '%TEST%'. A substring match would be
-- the wider net and the worse guard: real carrier policy numbers are opaque
-- alphanumerics and one containing "test" is not a thing this view gets to
-- refuse to sync. This stops THIS generator's shape. It is not, and is not
-- claimed to be, a general test-data detector -- there is no structural column
-- in `deals` that distinguishes a test row from a real one, so any filter here
-- is a heuristic and the honest move is to keep the heuristic tight.
--
-- The offending row is NOT deleted. It is Sam's data, it is the evidence, and
-- deleting a production row to clear a check is how a fault becomes invisible.
-- Excluded from the write path, it stays visible in `deals` and is inert.
--
-- Pre-image: ~/business-ops/session-state/preimages/v_insuracloud_push_eligible.2026-08-20.sql
CREATE OR REPLACE VIEW public.v_insuracloud_push_eligible AS
 SELECT id, agent_id, carrier_id, client_first_name, client_last_name,
    client_phone, client_dob, product_sold, policy_number, monthly_premium,
    annual_premium, face_amount, effective_date, policy_expiration_date,
    policy_term_months, notes, status, synced_to_insuracloud_at,
    insuracloud_sync_error, created_at, updated_at, source, pipeline_stage,
    external_deal_id, policy_status_standard, status_updated_at, posted_at,
    commission_cents, chargeback_status, chargeback_at, submitted_at,
    close_date, pipeline_client_id
   FROM deals d
  WHERE synced_to_insuracloud_at IS NULL
    AND status IS DISTINCT FROM 'draft'::text
    AND COALESCE(source, ''::character varying)::text IS DISTINCT FROM 'agent_link'::text
    AND NOT (EXISTS ( SELECT 1
           FROM agentlink_book b
          WHERE upper(TRIM(BOTH FROM b.policy_number)) = upper(TRIM(BOTH FROM d.policy_number))))
    AND policy_number IS NOT NULL
    AND btrim(policy_number) <> ''::text
    AND policy_number !~~* 'PLACEHOLDER-%'::text
    AND policy_number !~~* 'ZZTEST%'::text
    AND policy_number ~ '[0-9]'::text
    AND length(btrim(policy_number)) >= 6;
