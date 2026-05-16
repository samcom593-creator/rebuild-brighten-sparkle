-- 2026-05-16 — Full client/pipeline schema + role-scoped RLS
--
-- /api/pipeline/clients on AgentLink returns the COMPLETE servicing view:
-- contact info, banking, financial profile, beneficiary, policy/pitch,
-- engagement timestamps, lead source, automation state. That's the dataset
-- the agent needs to actually service a client — what AgentLink shows them
-- on the Pipeline workspace page.
--
-- This migration captures every field that endpoint returns, plus an RLS
-- policy pattern that lets:
--   admin   → every client
--   manager → every client where the owning agent is in their downline
--   agent   → only clients owned by their own agents row
-- without re-implementing role logic on every dashboard query.

BEGIN;

ALTER TABLE public.agentlink_clients
  ADD COLUMN IF NOT EXISTS phone_type text,
  ADD COLUMN IF NOT EXISTS preferred_contact_method text,
  ADD COLUMN IF NOT EXISTS best_time_to_call text,
  ADD COLUMN IF NOT EXISTS client_timezone text,
  ADD COLUMN IF NOT EXISTS do_not_call boolean,
  ADD COLUMN IF NOT EXISTS do_not_email boolean,
  ADD COLUMN IF NOT EXISTS do_not_text boolean,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS is_smoker boolean,
  ADD COLUMN IF NOT EXISTS height text,
  ADD COLUMN IF NOT EXISTS weight text,
  ADD COLUMN IF NOT EXISTS born_location text,
  ADD COLUMN IF NOT EXISTS ssn_last4 text,
  ADD COLUMN IF NOT EXISTS medical_notes text,
  ADD COLUMN IF NOT EXISTS physician_name text,
  ADD COLUMN IF NOT EXISTS physician_phone text,
  ADD COLUMN IF NOT EXISTS physician_address text,
  ADD COLUMN IF NOT EXISTS employer_occupation text,
  ADD COLUMN IF NOT EXISTS employment_status text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_type text,
  ADD COLUMN IF NOT EXISTS bank_routing_number text,
  ADD COLUMN IF NOT EXISTS earned_income numeric,
  ADD COLUMN IF NOT EXISTS pension_income numeric,
  ADD COLUMN IF NOT EXISTS social_security_income numeric,
  ADD COLUMN IF NOT EXISTS other_monthly_income numeric,
  ADD COLUMN IF NOT EXISTS total_monthly_income numeric,
  ADD COLUMN IF NOT EXISTS mortgage_payment numeric,
  ADD COLUMN IF NOT EXISTS rent_payment numeric,
  ADD COLUMN IF NOT EXISTS transportation_expense numeric,
  ADD COLUMN IF NOT EXISTS utilities_expense numeric,
  ADD COLUMN IF NOT EXISTS insurance_expense numeric,
  ADD COLUMN IF NOT EXISTS other_monthly_expenses numeric,
  ADD COLUMN IF NOT EXISTS total_monthly_expenses numeric,
  ADD COLUMN IF NOT EXISTS monthly_surplus numeric,
  ADD COLUMN IF NOT EXISTS estimated_taxes_retirement numeric,
  ADD COLUMN IF NOT EXISTS expected_income_change text,
  ADD COLUMN IF NOT EXISTS expected_change_description text,
  ADD COLUMN IF NOT EXISTS income_consistency text,
  ADD COLUMN IF NOT EXISTS qualified_accounts numeric,
  ADD COLUMN IF NOT EXISTS non_qualified_accounts numeric,
  ADD COLUMN IF NOT EXISTS non_qualified_assets numeric,
  ADD COLUMN IF NOT EXISTS total_investable numeric,
  ADD COLUMN IF NOT EXISTS retirement_savings_qualified numeric,
  ADD COLUMN IF NOT EXISTS retirement_age_goal int,
  ADD COLUMN IF NOT EXISTS retirement_year int,
  ADD COLUMN IF NOT EXISTS legacy_estate numeric,
  ADD COLUMN IF NOT EXISTS mortgages jsonb,
  ADD COLUMN IF NOT EXISTS allocation_debt numeric,
  ADD COLUMN IF NOT EXISTS allocation_savings numeric,
  ADD COLUMN IF NOT EXISTS allocation_spending numeric,
  ADD COLUMN IF NOT EXISTS pitch_carrier text,
  ADD COLUMN IF NOT EXISTS pitch_price numeric,
  ADD COLUMN IF NOT EXISTS product_sold text,
  ADD COLUMN IF NOT EXISTS policy_number text,
  ADD COLUMN IF NOT EXISTS face_amount numeric,
  ADD COLUMN IF NOT EXISTS policy_start_date date,
  ADD COLUMN IF NOT EXISTS policy_review_date date,
  ADD COLUMN IF NOT EXISTS beneficiary_first_name text,
  ADD COLUMN IF NOT EXISTS beneficiary_last_name text,
  ADD COLUMN IF NOT EXISTS beneficiary_number text,
  ADD COLUMN IF NOT EXISTS beneficiary_count int,
  ADD COLUMN IF NOT EXISTS lead_vendor_id int,
  ADD COLUMN IF NOT EXISTS lead_vendor_name text,
  ADD COLUMN IF NOT EXISTS lead_order_id int,
  ADD COLUMN IF NOT EXISTS lead_delivery_id int,
  ADD COLUMN IF NOT EXISTS lead_import_source text,
  ADD COLUMN IF NOT EXISTS lead_product_name text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_name text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_date timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_date timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_notes text,
  ADD COLUMN IF NOT EXISTS callback_date date,
  ADD COLUMN IF NOT EXISTS callback_time text,
  ADD COLUMN IF NOT EXISTS communication_notes text,
  ADD COLUMN IF NOT EXISTS reminder_notes text,
  ADD COLUMN IF NOT EXISTS objectives text,
  ADD COLUMN IF NOT EXISTS client_health_score numeric,
  ADD COLUMN IF NOT EXISTS needs_analysis_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_analysis_data jsonb,
  ADD COLUMN IF NOT EXISTS referred_from_client_id int,
  ADD COLUMN IF NOT EXISTS referred_from_client_first_name text,
  ADD COLUMN IF NOT EXISTS referred_from_client_last_name text,
  ADD COLUMN IF NOT EXISTS referred_from_beneficiary_id int,
  ADD COLUMN IF NOT EXISTS automation_enabled boolean,
  ADD COLUMN IF NOT EXISTS automation_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_automation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS hostile_language_detected boolean;

DROP POLICY IF EXISTS al_clients_admin       ON public.agentlink_clients;
DROP POLICY IF EXISTS al_clients_role_scoped ON public.agentlink_clients;
DROP POLICY IF EXISTS al_clients_admin_write ON public.agentlink_clients;

CREATE POLICY al_clients_role_scoped ON public.agentlink_clients
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agentlink_clients.agent_id
        AND (
          a.user_id = auth.uid()
          OR a.manager_id = public.get_agent_id(auth.uid())
        )
    )
  );

CREATE POLICY al_clients_admin_write ON public.agentlink_clients
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

COMMIT;
