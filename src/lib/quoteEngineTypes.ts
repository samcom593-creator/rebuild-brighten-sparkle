// Quote Engine TypeScript Types

export type QEProductCategory = 'final_expense' | 'si_whole_life' | 'si_ul' | 'mortgage_protection' | 'other';
export type QEConfidenceStatus = 'verified' | 'unverified' | 'stale';
export type QEBenefitType = 'immediate' | 'graded' | 'modified' | 'guaranteed_issue';
export type QEConditionCategory = 'cardiac' | 'respiratory' | 'cancer' | 'neurological' | 'psychiatric' | 'renal' | 'liver' | 'mobility_adl' | 'autoimmune' | 'metabolic' | 'other';

export interface QECarrier {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
}

export interface QEProduct {
  id: string;
  carrier_id: string;
  name: string;
  category: QEProductCategory;
  min_age: number;
  max_age: number;
  min_face: number;
  max_face: number;
  has_graded: boolean;
  has_gi: boolean;
  is_active: boolean;
  notes: string | null;
  needs_verification: boolean;
}

export interface QERateRow {
  id: string;
  product_id: string;
  state_code: string | null;
  age: number;
  gender: string;
  tobacco_class: string;
  rate_class: string;
  face_amount: number;
  monthly_premium: number;
  modal_factor_quarterly: number | null;
  modal_factor_semi: number | null;
  modal_factor_annual: number | null;
  needs_verification: boolean;
}

export interface QECommission {
  id: string;
  product_id: string;
  first_year_pct: number;
  renewal_pct: number | null;
  advance_months: number | null;
}

export interface QEKnockout {
  id: string;
  product_id: string;
  rule_type: string;
  rule_key: string;
  rule_value: string | null;
  severity: string;
  lookback_months: number | null;
  routes_to: QEBenefitType | null;
  description: string | null;
}

export interface QEBuildChart {
  id: string;
  product_id: string;
  gender: string;
  height_inches: number;
  min_weight: number;
  max_weight: number;
  rate_class: string;
}

export interface QEGradedRule {
  id: string;
  product_id: string;
  condition_key: string;
  routes_to: QEBenefitType;
  description: string | null;
}

export interface QECondition {
  id: string;
  name: string;
  category: QEConditionCategory;
  synonyms: string[];
  description: string | null;
}

export interface QEMedication {
  id: string;
  name: string;
  generic_name: string | null;
  brand_names: string[];
  category: QEConditionCategory;
  linked_conditions: string[];
  description: string | null;
}

export interface QEPaymentMethod {
  id: string;
  product_id: string;
  method: string;
  is_supported: boolean;
  notes: string | null;
}

export interface QEProductBadge {
  product_id: string;
  badge_code: string;
  tooltip_text: string | null;
}

export interface QEScoringWeights {
  approval_weight: number;
  suitability_weight: number;
  premium_weight: number;
  commission_weight: number;
  placement_weight: number;
  persistency_weight: number;
}

// Client Input
export interface SelectedCondition {
  id: string;
  name: string;
  category: QEConditionCategory;
  severity?: string;
  recencyMonths?: number;
  notes?: string;
}

export interface SelectedMedication {
  id: string;
  name: string;
  category: QEConditionCategory;
  notes?: string;
}

export interface QuoteClientInput {
  faceAmount: number | null;
  premium: number | null;
  solveMode: 'premium' | 'face_amount';
  categories: QEProductCategory[];
  state: string;
  sex: 'male' | 'female';
  dob: string;
  age: number;
  heightFeet: number;
  heightInches: number;
  weight: number;
  bmi: number;
  tobacco: boolean;
  paymentMethod: string;
  conditions: SelectedCondition[];
  medications: SelectedMedication[];
  // Additional qualifiers
  diabetesType?: string;
  insulinUse?: boolean;
  a1c?: number;
  oxygenUse?: boolean;
  chfHistory?: boolean;
  strokeHistory?: boolean;
  strokeRecencyMonths?: number;
  cancerType?: string;
  cancerRemissionMonths?: number;
  heartAttackHistory?: boolean;
  heartAttackRecencyMonths?: number;
  kidneyDisease?: boolean;
  dialysis?: boolean;
  liverDisease?: boolean;
  mentalHealthHospitalization?: boolean;
  mobilityLimitations?: boolean;
  adlLimitations?: boolean;
  nursingHome?: boolean;
  hospitalizationRecencyMonths?: number;
  duiHistory?: boolean;
  duiRecencyMonths?: number;
}

export type ApprovalFitLabel = 'Strong Fit' | 'Good Fit' | 'Borderline' | 'Fallback Only' | 'Not Eligible';
export type RecommendationLabel = 'Recommend First' | 'Strong Backup' | 'Commission Play' | 'Cheapest Viable' | 'Fallback Only' | 'Do Not Use';

export interface ProductScore {
  approvalScore: number;
  suitabilityScore: number;
  premiumScore: number;
  commissionScore: number;
  placementScore: number;
  persistencyScore: number;
  overallScore: number;
}

export interface QuoteRecommendation {
  rank: number;
  carrier: QECarrier;
  product: QEProduct;
  monthlyPremium: number | null;
  faceAmount: number | null;
  benefitType: QEBenefitType;
  approvalFitLabel: ApprovalFitLabel;
  recommendationLabel: RecommendationLabel;
  scores: ProductScore;
  reasonSummary: string;
  advantages: string[];
  risks: string[];
  whyNotFirst: string | null;
  commissionValue: number | null;
  firstYearPct: number | null;
  paymentOptions: string[];
  badges: QEProductBadge[];
  needsVerification: boolean;
  rateFound: boolean;
}

export interface ExcludedProduct {
  carrier: QECarrier;
  product: QEProduct;
  exclusionReason: string;
  ruleTriggered: string;
  sourceVersion: string | null;
}

export interface QuoteResult {
  bestOverall: QuoteRecommendation | null;
  bestApproval: QuoteRecommendation | null;
  bestCommission: QuoteRecommendation | null;
  lowestPremium: QuoteRecommendation | null;
  immediateOption: QuoteRecommendation | null;
  gradedOption: QuoteRecommendation | null;
  giFallback: QuoteRecommendation | null;
  allEligible: QuoteRecommendation[];
  excluded: ExcludedProduct[];
  warnings: string[];
  hasVerifiedData: boolean;
}

export interface QuoteEngineData {
  carriers: QECarrier[];
  products: QEProduct[];
  productStates: { product_id: string; state_code: string; is_available: boolean }[];
  rateTables: QERateRow[];
  commissions: QECommission[];
  knockouts: QEKnockout[];
  buildCharts: QEBuildChart[];
  gradedRules: QEGradedRule[];
  paymentMethods: QEPaymentMethod[];
  badges: QEProductBadge[];
  weights: QEScoringWeights;
}
