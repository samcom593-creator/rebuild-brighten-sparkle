# APEX OS — Requirement Traceability Matrix

Status vocabulary is deliberately strict. **Not started** means not started.
Nothing is marked partial to look busier than it is (directive §4).

| ID | Requirement (§) | Module | Roles | Route | Component | API / fn | DB entity | Test | Status | Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| R-001 | Phase Zero audit (§8) | — | — | — | — | — | — | measured | **Done** | — |
| R-002 | Decision records (§6) | — | — | — | — | — | — | — | **Done** | — |
| R-003 | Assumptions register (§7) | — | — | — | — | — | — | — | **Done** | — |
| R-004 | Restart-safe build state (§7) | — | — | — | — | — | — | — | **Done** | — |
| R-005 | Central brand config (§11, §3.3) | identity | all | — | `src/config/brand.ts` | — | later: `tenants` | `check-brand-literals` | **In progress** | — |
| R-006 | Brand-literal ratchet (§3.3) | tooling | — | — | — | `scripts/check-brand-literals.mjs` | — | self | **In progress** | — |
| R-007 | Tenant entity (§10) | tenants | APEX admin | — | — | — | `tenants` | isolation harness | **Not started** | DEC-002 sequencing |
| R-008 | Tenant scoping of 335 tables (§10) | tenants | all | — | — | — | all | per-table isolation | **Not started** | R-007 |
| R-009 | Cross-tenant isolation tests (§10) | security | — | — | — | — | — | required | **Not started** | R-007 |
| R-010 | Role split platform vs tenant (§13) | identity | all | — | — | `has_role` | `app_role` | authz tests | **Not started** | breaking authz change |
| R-011 | Branding editor + preview/publish/rollback (§11) | branding | owner | `/settings/branding` | — | — | `tenant_branding` | — | **Not started** | R-005, R-007 |
| R-012 | Tenant switcher + impersonation audit (§12) | platform | APEX admin | — | — | — | `impersonation_log` | — | **Not started** | R-007 |
| R-013 | Service packages / entitlements (§14) | billing | APEX admin | — | — | — | `entitlements` | — | **Not started** | R-007 |
| R-014 | Workforce directory (§15) | workforce | workforce dir | — | — | — | `workforce` | — | **Not started** | R-007 |
| R-015 | Platform control center (§16.1) | platform | APEX admin | — | — | — | — | — | **Not started** | R-007 |
| R-016 | Owner command center (§16.2) | analytics | owner | `/dashboard` | exists (single-tenant) | — | — | — | **Exists, single-tenant** | R-008 |
| R-017 | Recruiting pipeline (§16.3) | recruiting | recruiter | exists | exists | — | `applications` | — | **Exists, single-tenant** | R-008 |
| R-018 | Onboarding engine (§16.4) | onboarding | all | exists | partial | — | — | — | **Exists, incomplete** | — |
| R-019 | LMS (§16.5) | learning | trainer | exists | partial | — | — | — | **Exists, incomplete** | — |
| R-020 | One-link contracting (§16.6) | contracting | owner | exists | `ContractingIntakeAdmin` | `submit-contracting-intake` | `contracting_intakes` | — | **Built, unused** | 0 rows; 0 links generated |
| R-021 | VA operations / queues / QA (§16.7) | workforce | VA mgr | partial | partial | — | — | — | **Exists, incomplete** | — |
| R-022 | Manager coaching + QA (§16.8) | quality | manager | — | — | — | — | — | **Not started** | — |
| R-023 | Marketing operations (§16.9) | marketing | owner | — | — | — | — | — | **Not started** | — |
| R-024 | CRM + identity resolution (§16.10) | crm | all | exists | exists | — | multiple | — | **Exists, fragmented** | dedup rules undocumented |
| R-025 | Insurance vertical module (§16.11) | insurance | owner | exists | exists | — | many | — | **Exists, not flag-gated** | A-003 |
| R-026 | Communications center (§16.12) | comms | all | partial | partial | `send-notification` | `bot_alerts` | — | **Repaired 2026-08-17** | delivery-state model incomplete |
| R-027 | Documents (§16.13) | documents | all | partial | partial | — | — | — | **Exists, incomplete** | — |
| R-028 | Billing / entitlement sync (§16.14) | billing | APEX admin | — | — | — | `stripe_*` | — | **Dormant** | 0 Stripe events since 06-15 |
| R-029 | Support + escalation (§16.15) | support | support admin | — | — | — | — | — | **Not started** | — |
| R-030 | Provider-agnostic AI layer (§17) | ai | all | — | — | — | — | — | **Not started** | — |
| R-031 | Tenant-aware knowledge/RAG (§18) | ai | all | — | — | — | — | — | **Not started** | R-007 |
| R-032 | Automation engine + run inspector (§19) | automation | owner | — | — | — | — | — | **Not started** | — |
| R-033 | Workflows 1–7 end-to-end (§20) | multiple | all | — | — | — | — | — | **Not started** | R-007 |
| R-034 | KPI registry w/ formulas + freshness (§21) | analytics | all | — | — | — | `kpi_registry` | — | **Not started** | DEC-004 |
| R-035 | Reporting + branded export (§22) | reporting | all | partial | partial | — | — | — | **Exists, incomplete** | — |
| R-036 | Role-specific navigation (§23) | ux | all | exists | `GlobalSidebar` | — | — | — | **Exists, partial** | R-010 |
| R-037 | Light/dark via semantic tokens (§26) | ux | all | — | — | — | — | — | **Largely done** | 420 hardcoded colors remain |
| R-038 | Public marketing site (Product A, §2) | marketing | public | exists | landing components | — | — | — | **Exists, not repositioned** | copy still insurance-agency |

**Summary:** 4 done, 2 in progress, 12 exist in single-tenant form, 20 not started.
The 20 not-started items are overwhelmingly gated on R-007 (tenant entity), which
is gated on the isolation-test harness by DEC-002.
