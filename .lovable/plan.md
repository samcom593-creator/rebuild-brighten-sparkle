

# Fix: Licensed Leads Missing from RecruiterHQ

## Problem
Line 890 in `RecruiterDashboard.tsx` has `.neq("license_status", "licensed")` which explicitly excludes all licensed applicants from the query. This means the "Licensed" column is always empty.

The user's rule: **Licensed recruits should remain visible in RecruiterHQ until they are marked as contracted** (i.e., `contracted_at IS NOT NULL`).

## Fix

**File: `src/pages/RecruiterDashboard.tsx`** (line 889-891)

Remove the `.neq("license_status", "licensed")` filter and instead exclude only contracted leads by adding `.is("contracted_at", null)`:

```
// Before:
.is("terminated_at", null)
.neq("license_status", "licensed")
.in("status", ["reviewing", "contracting", "approved", "new"]);

// After:
.is("terminated_at", null)
.is("contracted_at", null)
.in("status", ["reviewing", "contracting", "approved", "new"]);
```

This single line change ensures:
- Unlicensed leads still show (in Needs Outreach, In Course, Test Phase, Final Steps columns)
- Licensed leads now appear in the "Licensed" column
- Once marked contracted (`contracted_at` is set), they disappear from RecruiterHQ
- Terminated leads remain excluded

No other files or database changes needed.

