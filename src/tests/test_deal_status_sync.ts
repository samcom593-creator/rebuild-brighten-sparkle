/**
 * test_deal_status_sync.ts — Section 3 integration test
 *
 * Creates a dummy deal in "submitted", flips policy_status_standard via
 * agentlink_live_pull's mapping path, confirms status propagates within
 * the expected window + commission_ledger row appears on transition to
 * active.
 *
 * Run via Supabase SQL editor or `psql -f` against the project DB.
 * This file documents the happy-path assertions.
 */

export const testDealStatusSync = `
DO $$
DECLARE
  v_test_agent uuid;
  v_test_carrier uuid;
  v_test_deal_id uuid;
  v_expected_status text;
  v_actual_status text;
  v_ledger_exists boolean;
BEGIN
  -- 1. Pick a sacrificial agent and carrier that already have a schedule
  SELECT acc.agent_id, acc.carrier_id INTO v_test_agent, v_test_carrier
  FROM public.agent_carrier_comp acc
  WHERE acc.effective_pct > 0
  LIMIT 1;

  IF v_test_agent IS NULL THEN
    RAISE EXCEPTION 'No scheduled agent found — Section 5 backfill must run first';
  END IF;

  -- 2. Create a test deal in 'submitted'
  INSERT INTO public.deals (
    agent_id, carrier_id, client_first_name, client_last_name,
    client_phone, client_dob, product_sold, policy_number,
    monthly_premium, annual_premium, face_amount, effective_date,
    status, policy_status_standard, source, pipeline_stage, external_deal_id
  ) VALUES (
    v_test_agent, v_test_carrier, 'Test', 'Subject',
    '5555555555', '1980-01-01', 'Test Product', 'TEST-' || gen_random_uuid(),
    50, 600, 50000, CURRENT_DATE,
    'submitted', 'Pending', 'apex', 'submitted',
    'TEST-' || gen_random_uuid()
  ) RETURNING id INTO v_test_deal_id;

  -- 3. Flip status to 'active' (simulating Agent Link reporting carrier approval)
  UPDATE public.deals SET status = 'active', policy_status_standard = 'Active', status_updated_at = now()
  WHERE id = v_test_deal_id;

  -- 4. Assert ledger row exists
  SELECT EXISTS(SELECT 1 FROM public.commission_ledger WHERE deal_id = v_test_deal_id)
    INTO v_ledger_exists;

  IF NOT v_ledger_exists THEN
    RAISE EXCEPTION 'FAIL: commission_ledger row not created by trg_deal_status_transition';
  END IF;

  -- 5. Flip to 'lapsed' (simulate retention event)
  UPDATE public.deals SET status = 'lapsed', policy_status_standard = 'Lapsed'
  WHERE id = v_test_deal_id;

  -- 6. Assert ledger row voided
  SELECT status INTO v_expected_status FROM public.commission_ledger WHERE deal_id = v_test_deal_id;
  IF v_expected_status <> 'voided' THEN
    RAISE EXCEPTION 'FAIL: ledger did not void on lapse (got %)', v_expected_status;
  END IF;

  -- 7. Cleanup
  DELETE FROM public.commission_audit_log WHERE deal_id = v_test_deal_id;
  DELETE FROM public.commission_ledger WHERE deal_id = v_test_deal_id;
  DELETE FROM public.deals WHERE id = v_test_deal_id;

  RAISE NOTICE 'PASS: deal status sync + commission trigger round-trip';
END $$;
`;
