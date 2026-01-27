
# Fix Building Leaderboard Projected Income Calculation

## The Problem

Currently, "Projected Income" only counts **contracted/hired** agents:
```tsx
projectedIncome: stats.contracted * INCOME_PER_HIRE  // $6k × hired only
```

This shows $0 for anyone who has applications but hasn't contracted anyone yet - which defeats the purpose of showing "pipeline value."

## The Fix

**Projected Income should equal ALL applications in the pipeline × $6,000**

This represents the total potential value if every application converts to a hire. This motivates recruiters by showing the value sitting in their pipeline.

---

## Technical Changes

**File: `src/components/dashboard/BuildingLeaderboard.tsx`**

### Change 1: Update projected income calculation (Line 195)

**Before:**
```tsx
projectedIncome: stats.contracted * INCOME_PER_HIRE,
```

**After:**
```tsx
projectedIncome: stats.applications * INCOME_PER_HIRE,
```

This means:
- 5 applications = $30,000 projected income (pipeline value)
- 10 applications = $60,000 projected income
- The number reflects the **potential** if all leads convert

---

## Result

| Agent | Apps | Hired | Projected Income |
|-------|------|-------|------------------|
| Samuel | 8 | 3 | $48k (8 × $6k) |
| KJ | 5 | 2 | $30k (5 × $6k) |
| OB | 3 | 1 | $18k (3 × $6k) |

The projected income now accurately reflects the value of the entire pipeline, not just closed/hired applicants.
