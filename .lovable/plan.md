
# Recruiter HQ Dashboard Redesign

## Problem Summary

The Recruiter HQ (`RecruiterDashboard.tsx`) has two problems:

1. **Lead cards are cluttered and hard to read** — Names are truncated, action buttons are cramped, the "Course not purchased" warning strip adds visual noise, and the 5-column kanban at small widths forces everything into tiny cards.
2. **"Failed to get Supabase Edge Function logs" error** — This error message only appears in the Lovable editor's backend panel, not in the live app. It is a platform-level diagnostic message outside the codebase. No code change is needed for it; it should resolve itself. I will note this clearly.

---

## What Will Change

### 1. Lead Card Redesign (`LeadCard` component inside `RecruiterDashboard.tsx`)

The card will be rebuilt to be a **high-density information row** instead of a cramped tile:

**Header row:**
- Full name (both first + last, never truncated — use `font-semibold text-sm` without `truncate`)
- Location pill (city, state) inline
- Contact freshness badge in the top-right

**Info row (2nd line):**
- Phone number shown directly (tap-to-call)
- Email shown directly (truncated gracefully)
- Lead arrival date

**License progress row:**
- Full-width `LicenseProgressSelector` with label visible at all sizes (remove `hidden sm:inline` limitation)

**Action row:**
- Call button (tel: link)
- Email (QuickEmailMenu)
- Send Licensing (ResendLicensingButton) — this replaces the "Course not purchased" strip with a visible actionable button
- Book (schedule Calendly link)
- Notes toggle

**Remove:**
- The "Course not purchased" amber strip — it is redundant noise since the ResendLicensingButton already covers this action. If desired, it can be folded into the license progress badge itself.

### 2. Column Layout Improvement

- Keep the 5-column kanban for large screens (`xl:grid-cols-5`)
- On medium screens, use 3 columns (`md:grid-cols-3`) instead of 2 — the 5-stage groups already make sense as 3+2
- Column headers will show both count and a subtle "needs attention" indicator if any cards are overdue

### 3. Card Width / Name Display

- Remove `truncate` from the name element so full names always show
- Add `text-sm font-semibold` with `leading-tight` and `break-words` instead
- Phone and email appear on a secondary line in `text-xs text-muted-foreground` so all key info is visible at a glance

### 4. Filter/Sort Bar Cleanup

- Move stage filter tabs to a horizontal scrollable row clearly labeled "Filter by stage:"
- Sort options collapse to a `<select>` or pill group on mobile

---

## Technical Details

**File changed:** `src/pages/RecruiterDashboard.tsx`

**Changes inside `LeadCard` component (~lines 211–424):**
- Remove `truncate` from the name `<p>` element (line 292)
- Add email + phone info row below name/location
- Remove the "Course not purchased" strip (lines 386–391) — its info is already captured by the license progress stage column title ("Needs Outreach")
- Widen action buttons slightly by adjusting gap and padding

**No database changes needed.**
**No new edge functions needed.**

---

## About the "Failed to get Supabase Edge Function logs" message

This message **does not appear in your live app**. It appears only in the Lovable editor's Backend view when it cannot fetch diagnostic logs from the platform. It is a temporary Lovable Cloud infrastructure issue and does not affect functionality. Your edge functions are working correctly (confirmed by the network requests showing successful Supabase API calls).

There is no code change that can fix this — it resolves automatically on the platform side.
