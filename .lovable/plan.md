

# Phase 3 — Recruiter Performance Board + Mobile Kanban + Layout Hardening

Phases 1 and 2 are complete (Activity Timeline, Lead Scoring, Smart Follow-Ups, Call Outcomes). This phase delivers the next highest-ROI items: a recruiter performance metrics panel, mobile-friendly column switching, and layout consistency fixes.

---

## 3A. Recruiter Performance Metrics Panel

Add a collapsible metrics strip between the stat bubbles and the search bar.

**Metrics computed from existing data (no new tables):**

- **Contact Rate %** — leads with `last_contacted_at` set / total leads
- **License Rate %** — leads with `license_progress = licensed` / total leads
- **Avg Days to Licensed** — average of `(contacted_at - created_at)` for licensed leads
- **7-Day Activity Count** — count of `lead_activity` rows in last 7 days for this recruiter (TanStack Query)
- **Overdue %** — leads currently overdue / total leads

Each metric shown as a compact pill with icon, value, and subtle trend indicator.

**File changed:** `src/pages/RecruiterDashboard.tsx`

---

## 3B. Mobile Kanban — Segmented Column Picker

Currently the kanban renders as a single-column stack on mobile, which is long and hard to navigate.

**Change:**
- On screens below `md` breakpoint, replace the 5-column grid with a horizontal segmented tab bar (pill buttons for each column name + count)
- Tapping a tab shows only that column's cards
- Default to the column with the most "needs attention" leads
- The tab bar is sticky below the search/filter area

**File changed:** `src/pages/RecruiterDashboard.tsx`

---

## 3C. Layout Hardening

- **Fixed card height for action row**: Set `min-h-[28px]` on the action button row to prevent jitter when tooltips/popovers open
- **Max column height with scroll**: Add `max-h-[65vh] overflow-y-auto` to each column's card container on desktop to prevent extremely long pages
- **Reduce animation weight on large lists**: When a column has 15+ cards, disable `whileHover` on individual cards and use `layout={false}` to prevent expensive layout animations
- **Memoize LeadCard**: Wrap LeadCard with `React.memo` using a custom comparator on `lead.id + lead.license_progress + lead.last_contacted_at + lead.notes`

**File changed:** `src/pages/RecruiterDashboard.tsx`

---

## 3D. Execution Mode Toggle

Add a toggle button in the filter bar: "Focus Mode"

When ON:
- Only shows leads where `isOverdue(lead) === true` OR `computeLeadScore(lead) < 40` OR `getLastContactAge(lead) === Infinity`
- Hides all other leads
- Banner changes to amber: "Focus Mode — Showing only urgent leads"

When OFF: Normal view.

**File changed:** `src/pages/RecruiterDashboard.tsx`

---

## Summary of Changes

| File | Action |
|---|---|
| `src/pages/RecruiterDashboard.tsx` | Modified — add performance metrics strip, mobile segmented tabs, layout hardening, execution mode toggle |

No new database tables, no new migrations, no new edge functions. All computed from existing data.

