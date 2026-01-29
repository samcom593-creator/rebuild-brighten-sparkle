
# Fix Counter & Unified Sidebar Navigation

## Summary
Two issues to fix:
1. The "first-day deals closed" counter shows **23** but should be **87**
2. Three dashboard pages lack sidebar navigation: LogNumbers, Numbers, and OnboardingCourse

---

## Issue 1: Update Lead Counter to 87

### Current State
The `lead_counter` table has `count: 23`

### Fix
Run a database update to set the count to 87:

```sql
UPDATE lead_counter SET count = 87, updated_at = now();
```

This value is displayed on the landing page via `useLeadCounter` hook and shows in the "X first-day deals closed" badge.

---

## Issue 2: Add Sidebar to All Dashboard Pages

### Pages Missing Sidebar

| Page | Route | Current Layout | Fix |
|------|-------|----------------|-----|
| LogNumbers | `/apex-daily-numbers` | Standalone (no sidebar) | Wrap with `DashboardLayout` |
| Numbers | `/numbers` | Standalone (no sidebar) | Wrap authenticated view with `DashboardLayout` |
| OnboardingCourse | `/onboarding-course` | Custom header | Wrap with `DashboardLayout` |

### Implementation Details

#### 1. LogNumbers.tsx
- Import `DashboardLayout`
- Wrap the entire return content with `<DashboardLayout>`
- Remove the outer min-h-screen/flex centering (DashboardLayout handles this)
- Keep the production entry form and leaderboard display inside

#### 2. Numbers.tsx
- Import `DashboardLayout`
- Wrap the **authenticated view** (lines 224-269) with `<DashboardLayout>`
- Keep the login view (lines 273-505) standalone since unauthenticated users shouldn't see the sidebar

#### 3. OnboardingCourse.tsx
- Import `DashboardLayout`
- Wrap the entire content with `<DashboardLayout>`
- Remove the custom `<header>` section (lines 105-126) as sidebar provides navigation
- Keep the course content and sidebar intact

---

## Files to Modify

| File | Change |
|------|--------|
| **Database** | Update `lead_counter.count` from 23 to 87 |
| `src/pages/LogNumbers.tsx` | Add `DashboardLayout` wrapper |
| `src/pages/Numbers.tsx` | Add `DashboardLayout` to authenticated view only |
| `src/pages/OnboardingCourse.tsx` | Add `DashboardLayout`, remove custom header |

---

## Expected Results

1. Landing page shows "**87** first-day deals closed"
2. All three pages have the collapsible sidebar navigation
3. Users can navigate to/from any dashboard section consistently
4. Mobile users get the standard hamburger menu on all pages
