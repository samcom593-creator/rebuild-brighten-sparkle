
-- Quote Engine enums
CREATE TYPE public.qe_product_category AS ENUM ('final_expense', 'si_whole_life', 'si_ul', 'mortgage_protection', 'other');
CREATE TYPE public.qe_confidence_status AS ENUM ('verified', 'unverified', 'stale');
CREATE TYPE public.qe_benefit_type AS ENUM ('immediate', 'graded', 'modified', 'guaranteed_issue');
CREATE TYPE public.qe_condition_category AS ENUM ('cardiac', 'respiratory', 'cancer', 'neurological', 'psychiatric', 'renal', 'liver', 'mobility_adl', 'autoimmune', 'metabolic', 'other');

-- Carriers
CREATE TABLE public.qe_carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_carriers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage carriers" ON public.qe_carriers FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view carriers" ON public.qe_carriers FOR SELECT TO authenticated USING (true);

-- Source Documents
CREATE TABLE public.qe_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid REFERENCES public.qe_carriers(id) ON DELETE CASCADE,
  product_id uuid,
  doc_name text NOT NULL,
  doc_type text NOT NULL DEFAULT 'rate_book',
  source_url text,
  effective_date date,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  version text,
  confidence_status public.qe_confidence_status NOT NULL DEFAULT 'unverified'
);
ALTER TABLE public.qe_source_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage source docs" ON public.qe_source_documents FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view source docs" ON public.qe_source_documents FOR SELECT TO authenticated USING (true);

-- Products
CREATE TABLE public.qe_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.qe_carriers(id) ON DELETE CASCADE,
  name text NOT NULL,
  category public.qe_product_category NOT NULL DEFAULT 'final_expense',
  min_age integer NOT NULL DEFAULT 0,
  max_age integer NOT NULL DEFAULT 85,
  min_face numeric NOT NULL DEFAULT 1000,
  max_face numeric NOT NULL DEFAULT 50000,
  has_graded boolean NOT NULL DEFAULT false,
  has_gi boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  needs_verification boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage products" ON public.qe_products FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view products" ON public.qe_products FOR SELECT TO authenticated USING (true);

-- Update source docs FK now that products exists
ALTER TABLE public.qe_source_documents ADD CONSTRAINT qe_source_documents_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.qe_products(id) ON DELETE SET NULL;

-- Product States
CREATE TABLE public.qe_product_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  state_code text NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  UNIQUE(product_id, state_code)
);
ALTER TABLE public.qe_product_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage product states" ON public.qe_product_states FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view product states" ON public.qe_product_states FOR SELECT TO authenticated USING (true);

-- Rate Tables
CREATE TABLE public.qe_rate_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  state_code text,
  age integer NOT NULL,
  gender text NOT NULL DEFAULT 'unisex',
  tobacco_class text NOT NULL DEFAULT 'non_tobacco',
  rate_class text NOT NULL DEFAULT 'standard',
  face_amount numeric NOT NULL,
  monthly_premium numeric NOT NULL,
  modal_factor_quarterly numeric DEFAULT 3.0,
  modal_factor_semi numeric DEFAULT 6.0,
  modal_factor_annual numeric DEFAULT 12.0,
  effective_date date,
  source_doc_id uuid REFERENCES public.qe_source_documents(id) ON DELETE SET NULL,
  needs_verification boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_rate_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage rate tables" ON public.qe_rate_tables FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view rate tables" ON public.qe_rate_tables FOR SELECT TO authenticated USING (true);

-- Modal Factors
CREATE TABLE public.qe_modal_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  mode text NOT NULL,
  factor numeric NOT NULL DEFAULT 1.0,
  UNIQUE(product_id, mode)
);
ALTER TABLE public.qe_modal_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage modal factors" ON public.qe_modal_factors FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view modal factors" ON public.qe_modal_factors FOR SELECT TO authenticated USING (true);

-- Commission Schedules
CREATE TABLE public.qe_commission_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  first_year_pct numeric NOT NULL DEFAULT 0,
  renewal_pct numeric DEFAULT 0,
  advance_months integer DEFAULT 0,
  effective_date date,
  source_doc_id uuid REFERENCES public.qe_source_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_commission_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage commissions" ON public.qe_commission_schedules FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view commissions" ON public.qe_commission_schedules FOR SELECT TO authenticated USING (true);

-- Underwriting Knockouts
CREATE TABLE public.qe_underwriting_knockouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  rule_type text NOT NULL DEFAULT 'condition',
  rule_key text NOT NULL,
  rule_value text,
  severity text NOT NULL DEFAULT 'knockout',
  lookback_months integer,
  routes_to public.qe_benefit_type,
  description text,
  source_doc_id uuid REFERENCES public.qe_source_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_underwriting_knockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage knockouts" ON public.qe_underwriting_knockouts FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view knockouts" ON public.qe_underwriting_knockouts FOR SELECT TO authenticated USING (true);

-- Build Charts
CREATE TABLE public.qe_build_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  gender text NOT NULL DEFAULT 'unisex',
  height_inches integer NOT NULL,
  min_weight integer NOT NULL,
  max_weight integer NOT NULL,
  rate_class text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_build_charts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage build charts" ON public.qe_build_charts FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view build charts" ON public.qe_build_charts FOR SELECT TO authenticated USING (true);

-- Graded Routing Rules
CREATE TABLE public.qe_graded_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  condition_key text NOT NULL,
  routes_to public.qe_benefit_type NOT NULL DEFAULT 'graded',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_graded_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage graded rules" ON public.qe_graded_routing_rules FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view graded rules" ON public.qe_graded_routing_rules FOR SELECT TO authenticated USING (true);

-- Conditions
CREATE TABLE public.qe_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category public.qe_condition_category NOT NULL DEFAULT 'other',
  synonyms text[] DEFAULT '{}',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage conditions" ON public.qe_conditions FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view conditions" ON public.qe_conditions FOR SELECT TO authenticated USING (true);

-- Medications
CREATE TABLE public.qe_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  generic_name text,
  brand_names text[] DEFAULT '{}',
  category public.qe_condition_category NOT NULL DEFAULT 'other',
  linked_conditions text[] DEFAULT '{}',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_medications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage medications" ON public.qe_medications FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view medications" ON public.qe_medications FOR SELECT TO authenticated USING (true);

-- Payment Methods
CREATE TABLE public.qe_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  method text NOT NULL,
  is_supported boolean NOT NULL DEFAULT false,
  notes text,
  UNIQUE(product_id, method)
);
ALTER TABLE public.qe_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage payment methods" ON public.qe_payment_methods FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view payment methods" ON public.qe_payment_methods FOR SELECT TO authenticated USING (true);

-- Product Badges
CREATE TABLE public.qe_product_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.qe_products(id) ON DELETE CASCADE,
  badge_code text NOT NULL,
  tooltip_text text,
  source_doc_id uuid REFERENCES public.qe_source_documents(id) ON DELETE SET NULL,
  UNIQUE(product_id, badge_code)
);
ALTER TABLE public.qe_product_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage badges" ON public.qe_product_badges FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view badges" ON public.qe_product_badges FOR SELECT TO authenticated USING (true);

-- Scoring Weights
CREATE TABLE public.qe_scoring_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'Default',
  approval_weight numeric NOT NULL DEFAULT 0.35,
  suitability_weight numeric NOT NULL DEFAULT 0.20,
  premium_weight numeric NOT NULL DEFAULT 0.15,
  commission_weight numeric NOT NULL DEFAULT 0.15,
  placement_weight numeric NOT NULL DEFAULT 0.10,
  persistency_weight numeric NOT NULL DEFAULT 0.05,
  is_default boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_scoring_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage scoring weights" ON public.qe_scoring_weights FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated can view scoring weights" ON public.qe_scoring_weights FOR SELECT TO authenticated USING (true);

-- Quote Logs
CREATE TABLE public.qe_quote_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid,
  client_inputs jsonb NOT NULL DEFAULT '{}',
  rule_set_version text,
  products_considered jsonb DEFAULT '[]',
  products_excluded jsonb DEFAULT '[]',
  ranking_output jsonb DEFAULT '[]',
  source_versions jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qe_quote_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage quote logs" ON public.qe_quote_logs FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own quote logs" ON public.qe_quote_logs FOR INSERT TO authenticated WITH CHECK (agent_user_id = auth.uid());
CREATE POLICY "Users can view own quote logs" ON public.qe_quote_logs FOR SELECT TO authenticated USING (agent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Insert default scoring weights
INSERT INTO public.qe_scoring_weights (label, is_default) VALUES ('Default', true);
