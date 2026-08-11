# Metric Registry

The executable registry is seeded in `20260811220000_apex_unified_os_foundation.sql`. PostgreSQL owns these formulas; pages do not independently recalculate them.

| ID | Grain/source | Canonical date | Meaning |
|---|---|---|---|
| `submitted_premium_mtd` | distinct deals | `submitted_at`, CT | Safely submitted premium in the current month |
| `approved_alp_mtd` | production ledger | `effective_date`, CT | Qualifying approved/issued/in-force ALP |
| `deals_mtd` | distinct deals | `submitted_at`, CT | Qualifying deal count |
| `active_producers` | distinct ledger agents | `effective_date`, CT | Producers with qualifying activity |
| `average_per_producer` | ledger amount / producers | `effective_date`, CT | ALP per active producer; zero-safe |
| `estimated_income` | ledger × effective comp | `effective_date`, CT | Estimate only, never payroll truth |
| `carrier_share` | carrier ledger / total ledger | `effective_date`, CT | Carrier mix excluding aggregate rows |

Every definition records formula version, owner, inclusion/exclusion state, filters, hierarchy rule, timezone, and validation time. Any formula change increments its version and requires reconciliation against the prior result.
