

# Apex Quote Engine — Implementation Plan

## Overview

This is a massive, multi-phase feature. The engine is fundamentally **data-driven** — it cannot produce any real recommendations without verified carrier data loaded by admins. The implementation must therefore prioritize the **data model + admin ingestion tools first**, then the quoting UI and recommendation engine.

Given the scale, this plan covers **Phase 1** (foundation) which delivers a working end-to-end system. Subsequent phases add advanced features (PDF ingestion, compare mode, export, audit logs, etc.).

---

## Phase 1 Deliverables

1. Database schema (all core tables)
2. Navigation entry in sidebar (admin/manager only)
3. Quote input page with two-column layout
4. Searchable health conditions + medications inputs
5. Admin panel for carrier/product/rule management
6. Basic recommendation engine (gate 1-3 eligibility + scoring)
7. Results display with ranked cards + eligible/excluded tables
8. Quote audit logging

---

## Database Schema

Create these tables via migration:

**Core carrier data:**
- `qe_carriers` — id, name, logo_url, is_active, created_at
- `qe_products` — id, carrier_id, name, category (enum: final_expense, si_whole_life, si_ul, mortgage_protection, other), min_age, max_age, min_face, max_face, has_graded, has_gi, is_active, notes, needs_verification, created_at
- `qe_product_states` — product_id, state_code, is_available
- `qe_rate_tables` — id, product_id, state_code, age, gender, tobacco_class, rate_class, face_amount, monthly_premium, modal_factor_quarterly, modal_factor_annual, effective_date, source_doc_id, needs_verification
- `qe_modal_factors` — product_id, mode (monthly/quarterly/semi/annual), factor
- `qe_commission_schedules` — id, product_id, first_year_pct, renewal_pct, advance_months, effective_date, source_doc_id

**Underwriting rules:**
- `qe_underwriting_knockouts` — id, product_id, rule_type (condition/medication/build/age), rule_key, rule_value, severity, lookback_months, description, source_doc_id
- `qe_build_charts` — id, product_id, gender, height_inches, min_weight, max_weight, rate_class
- `qe_graded_routing_rules` — id, product_id, condition_key, routes_to (graded/modified/gi/decline), description

**Health data:**
- `qe_conditions` — id, name, category (cardiac, respiratory, cancer, etc.), synonyms (text[]), description
- `qe_medications` — id, name, generic_name, brand_names (text[]), category, linked_conditions (text[]), description
- `qe_condition_synonyms` — id, condition_id, synonym (for misspelling/alternate terms)
- `qe_medication_synonyms` — id, medication_id, synonym

**Payment/features:**
- `qe_payment_methods` — id, product_id, method (eft/ss_billing/direct_express/credit_card/debit_card), is_supported, notes
- `qe_product_badges` — product_id, badge_code (SS/DE/CC/PI/RA/GI/GR/IM), tooltip_text, source_doc_id

**Admin/audit:**
- `qe_source_documents` — id, carrier_id, product_id, doc_name, doc_type, source_url, effective_date, uploaded_by, uploaded_at, version, confidence_status (verified/unverified/stale)
- `qe_scoring_weights` — id, label, approval_weight, suitability_weight, premium_weight, commission_weight, placement_weight, persistency_weight, is_default, updated_by
- `qe_quote_logs` — id, agent_user_id, client_inputs (jsonb), rule_set_version, products_considered (jsonb), products_excluded (jsonb), ranking_output (jsonb), source_versions (jsonb), created_at

All tables get RLS: admin full access, manager/agent SELECT on non-admin tables. Admin-only for mutations.

---

## Sidebar Integration

Add "Quote Engine" nav item under TOOLS section in `GlobalSidebar.tsx` for admin + manager roles. Route: `/dashboard/quote-engine`. Add admin sub-route `/dashboard/quote-engine/admin` for data management.

---

## Quote Input Page (`src/pages/QuoteEngine.tsx`)

Two-column layout:

**Left column — Client Info:**
- Face amount / Premium input with solve-mode toggle
- Product category selector (multi-select)
- State dropdown
- Sex selector
- DOB picker + auto-calculated age
- Height (ft/in) + Weight + auto BMI
- Tobacco/nicotine toggle

**Right column — Health Profile:**
- Searchable conditions input (typeahead, multi-select tags, severity/recency qualifiers per tag)
- Searchable medications input (same pattern)
- Additional underwriting qualifiers section (collapsible): diabetes/insulin/A1C, COPD/oxygen, CHF, stroke/TIA, cancer details, cardiac history, kidney/dialysis, liver, mental health, mobility/ADL, nursing home, hospitalization recency, DUI, build chart

**Bottom — Action bar:** "Get Recommendations" button

---

## Health Search Components

`src/components/quote-engine/ConditionSearch.tsx` and `MedicationSearch.tsx`:
- Query `qe_conditions`/`qe_medications` tables with ILIKE + synonym array matching
- Fuzzy match via trigram or client-side Levenshtein on small datasets
- Selected items render as tags with severity/recency popover per tag
- Hover tooltips from description field

---

## Recommendation Engine

`src/lib/quoteEngine.ts` — pure TypeScript scoring logic:

1. **Gate 1 (Eligibility):** Filter products by state, age, gender, face amount range, payment mode, tobacco class, BMI/build chart
2. **Gate 2 (Underwriting):** Check knockouts against selected conditions/medications, apply lookback rules, route to graded/modified/GI if applicable
3. **Gate 3 (Rate Lookup):** Match rate table rows. If no exact match, mark "Needs carrier-source verification"
4. **Gate 4 (Scoring):** Calculate weighted scores using admin-configurable weights from `qe_scoring_weights`
5. **Rank and categorize:** Best Overall, Best Approval, Best Commission, Lowest Premium, Immediate, Graded/Modified, GI Fallback

Products that fail any gate go to "Excluded" with reason. Missing data triggers "More underwriting details required" or "Recommendation quality limited by missing verified carrier data."

---

## Results Display

`src/components/quote-engine/QuoteResults.tsx`:
- Top cards: Best Overall, Best Approval, Best Commission, Lowest Premium, etc.
- Each card shows: carrier, product, premium, face amount, benefit type, approval fit label, reason summary, advantages, risks, comp value, payment badges (SS/DE/CC/PI/RA/GI/GR/IM with hover tooltips)
- "All Eligible" table below with sortable columns
- "Excluded Products" collapsible table with exclusion reasons

---

## Admin Panel

`src/pages/QuoteEngineAdmin.tsx` — tabbed interface:
- **Carriers:** CRUD carrier list
- **Products:** CRUD products per carrier with all config fields
- **States:** Product-state availability matrix
- **Rates:** Upload/manage rate table rows (manual entry first; CSV import in Phase 2)
- **Underwriting:** Manage knockout rules, graded routing rules
- **Build Charts:** Manage height/weight tables per product
- **Medications:** Manage medication library + synonyms
- **Conditions:** Manage condition library + synonyms + category mapping
- **Commissions:** Manage commission schedules
- **Payment Methods:** Per-product payment support matrix
- **Badges:** Per-product feature badge management
- **Source Docs:** Registry of source documents with verification status
- **Scoring Weights:** Edit ranking formula weights
- **Verification:** Dashboard showing products/rates needing verification

---

## Files to Create/Edit

**New files (~15):**
- `src/pages/QuoteEngine.tsx` — main quoting page
- `src/pages/QuoteEngineAdmin.tsx` — admin data management
- `src/components/quote-engine/QuoteInputForm.tsx` — client info form
- `src/components/quote-engine/HealthProfileForm.tsx` — conditions/meds/qualifiers
- `src/components/quote-engine/ConditionSearch.tsx` — searchable condition input
- `src/components/quote-engine/MedicationSearch.tsx` — searchable medication input
- `src/components/quote-engine/QuoteResults.tsx` — results display
- `src/components/quote-engine/RecommendationCard.tsx` — individual ranked card
- `src/components/quote-engine/EligibleProductsTable.tsx` — all eligible table
- `src/components/quote-engine/ExcludedProductsTable.tsx` — excluded with reasons
- `src/components/quote-engine/ProductBadges.tsx` — badge icons with tooltips
- `src/components/quote-engine/AdminTabs.tsx` — admin panel tab container
- `src/lib/quoteEngine.ts` — scoring/ranking logic
- `src/lib/quoteEngineTypes.ts` — TypeScript types

**Edited files:**
- `src/App.tsx` — add routes
- `src/components/layout/GlobalSidebar.tsx` — add nav item

**Database:** Single migration with all `qe_*` tables + RLS policies

---

## Phase 2 (Future)

- CSV/XLSX rate table bulk import
- PDF ingestion via AI extraction + human verification workflow
- Compare mode (side-by-side drawer)
- PDF export of quote summary
- Saved quote scenarios + duplicate
- Shareable internal quote link
- Real-time recalculation on input change
- Carrier e-app deep links

---

## Scope Note

This Phase 1 will ship with **empty carrier data**. The system will correctly display "Recommendation quality limited by missing verified carrier data" until an admin loads real rates, underwriting rules, and product configurations. This is by design — no fabricated data.

