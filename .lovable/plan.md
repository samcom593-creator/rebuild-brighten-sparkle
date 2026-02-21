

# Recruiter HQ — Further Declutter and Information Density Pass

## Current State

The previous redesign is already live in the code: full names are shown, phone/email are displayed inline, and the layout uses a responsive 3/5-column grid. However, the cards still use a multi-row tile layout inside narrow kanban columns, which can feel cramped with many leads.

## What This Plan Will Do

### 1. Switch to a Compact Row-Style Card (less vertical space per lead)

Current cards use 4 vertical sections (header, info row, license selector, action row). We will compress this into a tighter 2-row layout:

- **Row 1**: Full name (bold, no truncation) + location pill + contact freshness badge (right-aligned)
- **Row 2**: Phone (tap-to-call) | Email | License stage badge | Action icons (Call, Email, Licensing, Book, Notes) — all inline

This cuts each card's height roughly in half, letting the recruiter see more leads per column without scrolling.

### 2. Make Action Buttons Icon-Only (with tooltips)

Currently the "Call" and "Book" buttons show text labels. On narrow kanban columns these wrap awkwardly. Switching to icon-only buttons with tooltips keeps them compact and uniform — matching the existing `ResendLicensingButton` which is already icon-only.

### 3. Move License Progress to an Inline Badge

Instead of a full-width dropdown trigger button, the `LicenseProgressSelector` will render as a small inline badge (same color coding) that opens the dropdown on click. This saves a full row of height per card.

### 4. Add "Needs Attention" Count on Column Headers

Each column header will show a small red dot or count if any leads in that column haven't been contacted in 48+ hours. This gives an at-a-glance urgency indicator.

### 5. No Changes to "Edge Function Logs" Error

This error only appears in the Lovable editor's backend panel — it is NOT in your live app. No code change can fix it; it is a temporary platform diagnostic message.

---

## Technical Details

### File: `src/pages/RecruiterDashboard.tsx`

**LeadCard component (lines 211-437):**
- Restructure the JSX to use a 2-row compact layout instead of 4 sections
- Convert "Call" and "Book" buttons from labeled buttons to icon-only with `Tooltip` wrappers
- Move the `LicenseProgressSelector` inline next to the phone/email row
- Reduce padding from `px-3 pt-3 pb-2` to `p-2.5` for tighter cards
- Remove the separate "Action row" div — merge action icons into the info row

**Column headers (lines 736-743):**
- Add a red dot indicator when any lead in the column has `getLastContactAge > 48 hours`

**No new files, no database changes, no new edge functions.**

