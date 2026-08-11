-- The InsuraCloud push queue was mostly junk, not owed production.
--
-- apex-doctor Check #17 reports CRITICAL: "10 eligible, all 10 carrying an
-- error, $9,104.04 of annual premium". Both numbers are correct. The sentence
-- built on them is not — the third time in one day a true figure pointed the
-- wrong way (see the $2,336,292.84 that was an import mirror, and the 1,533
-- undispatched alerts that were 79.6% one already-fixed stream).
--
-- Look at what the 10 rows actually are:
--
--   PLACEHOLDER-aab458f1-…   Charles Reese     $618.60
--   PLACEHOLDER-c12a7721-…   Charles Reese     $155.52
--   PLACEHOLDER-174df213-…   Charles Reese   $1,510.32
--   PLACEHOLDER-9b6f266d-…   Charles Reese     $546.12
--   PLACEHOLDER-6c732747-…   Charles Reese     $539.04
--   TA-GARY-THOMAS           Cooper Ubert      $831.12
--   POL-STEPHYOUNG           Michael Kayembe $1,067.64
--   77887r7                  Samuel James    $2,304.00
--   103-0010-378293          Kolade Ayedun     $622.68
--   1030010378284            Kolade Ayedun     $909.00
--
-- Five are the literal sentinel PLACEHOLDER-<uuid>. Two are client names in the
-- policy_number column. Exactly 5 rows in the whole 1,759-row deals table carry
-- a PLACEHOLDER number and ALL FIVE were queued to push — 100% of the junk in
-- the table was in the outbound queue.
--
-- So "fix the auth and drain the queue" would have written eight fabricated
-- policy records into agentlink_book, which is the table Sam's commissions and
-- every leaderboard are computed from. The broken auth was the only thing
-- preventing it — an accident, not a safety property, exactly as the previous
-- wave found for the 1,667 imported deals.
--
-- A policy number is the identity of the record in the carrier's system. If we
-- do not have one, we do not have a policy to push, and inventing an identifier
-- to satisfy a queue is how phantom production gets born.
--
-- DELIBERATELY NOT EXCLUDED: '77887r7'. It is ugly and probably a typo, but it
-- has digits and a human may know it to be real. Encoding "looks wrong to me"
-- would be inventing a rule to hit one value. It stays eligible and visible.

create or replace view public.v_insuracloud_push_eligible as
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
    -- A real policy number, or it is not a policy.
    AND d.policy_number IS NOT NULL
    AND btrim(d.policy_number) <> ''
    AND d.policy_number NOT ILIKE 'PLACEHOLDER-%'
    AND d.policy_number ~ '[0-9]'
    AND length(btrim(d.policy_number)) >= 6;

comment on view public.v_insuracloud_push_eligible is
  'Deals that may be pushed to InsuraCloud/AgentLink. Excludes imports (source=agent_link), drafts, anything already in agentlink_book, and rows without a real policy number (PLACEHOLDER sentinels, client names, blanks). Excluded rows are NOT hidden — see v_insuracloud_push_blocked.';

-- Nothing disappears silently. A filter whose rejects cannot be inspected is how
-- a queue quietly stops representing the work, which is the failure this whole
-- sequence of waves keeps finding.
create or replace view public.v_insuracloud_push_blocked as
 SELECT d.id,
    d.agent_id,
    d.policy_number,
    d.annual_premium,
    d.created_at,
    case
      when d.policy_number is null or btrim(d.policy_number) = ''
        then 'no policy number'
      when d.policy_number ilike 'PLACEHOLDER-%'
        then 'placeholder sentinel — no carrier policy exists'
      when d.policy_number !~ '[0-9]'
        then 'policy_number contains no digits — looks like a client name'
      when length(btrim(d.policy_number)) < 6
        then 'policy_number too short to be a carrier identifier'
    end as block_reason
   FROM deals d
  WHERE d.synced_to_insuracloud_at IS NULL
    AND d.status IS DISTINCT FROM 'draft'::text
    AND COALESCE(d.source, ''::character varying)::text IS DISTINCT FROM 'agent_link'::text
    AND NOT (EXISTS ( SELECT 1
           FROM agentlink_book b
          WHERE upper(TRIM(BOTH FROM b.policy_number)) = upper(TRIM(BOTH FROM d.policy_number))))
    AND (
         d.policy_number IS NULL
      OR btrim(d.policy_number) = ''
      OR d.policy_number ILIKE 'PLACEHOLDER-%'
      OR d.policy_number !~ '[0-9]'
      OR length(btrim(d.policy_number)) < 6
    );

comment on view public.v_insuracloud_push_blocked is
  'Deals held back from the InsuraCloud push because they carry no usable policy number, with the reason. These are data-quality defects to repair at source, not delivery failures to retry.';

grant select on public.v_insuracloud_push_eligible to authenticated;
grant select on public.v_insuracloud_push_blocked to authenticated;
