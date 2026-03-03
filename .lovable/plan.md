

# Fix Recruiter HQ Spacing & Layout

## Problem
Too much dead space, buttons hard to click, vertical stacking wastes screen real estate. Need tighter, row-based layout throughout.

## Changes

### 1. Header Section (lines 992-1060)
- Reduce padding from `p-5` to `p-3`
- Make header, XP bar, and scheduling links all in one tight row on desktop
- Reduce title from `text-2xl` to `text-xl`
- Remove decorative blur circles to save space

### 2. Stat Bubbles (lines 1062-1068)
- Convert from large cards with centered text to a **single horizontal row of compact pills**
- Remove the large icon centering, big `text-2xl` values, and `p-4` padding
- Use inline `flex items-center gap-2 px-3 py-2` pill format like MetricsStrip already does
- Always show 4 across on all screen sizes

### 3. StatBubble Component (lines 260-292)
- Rewrite to compact row format: icon + value + label all inline, no stacking
- Remove the decorative blur circle overlay
- Reduce from `p-4 rounded-2xl` to `p-2 rounded-xl`

### 4. Daily Challenge + AI Panel + Metrics Strip (lines 1070-1078)
- These 3 sections stack vertically taking huge space before the Kanban
- Combine Metrics Strip into the header area or make it always-visible inline instead of collapsible
- Keep AI Panel and Daily Challenge as collapsible but reduce their internal padding

### 5. Search/Filter/Sort Bar (lines 1080-1144)
- Already row-based, just reduce padding from `p-3` to `p-2`
- Tighten `space-y-2` to `space-y-1`

### 6. LeadCard Component (lines 432-754)
- Reduce card padding from `p-2.5` to `p-2`
- Reduce `space-y-1.5` to `space-y-1`
- **Action buttons row**: Already row-based with `h-7 w-7` buttons -- keep but reduce `gap-1` and `pt-0.5` to `pt-0`
- Reduce Kanban column gap from `gap-4` to `gap-2` and card spacing from `space-y-3` to `space-y-2`

### 7. Kanban Grid (lines 1280-1338)
- Reduce column padding from `p-3` to `p-2`
- Reduce `gap-4` to `gap-2`
- Reduce card-to-card spacing from `space-y-3` to `space-y-2`
- Column header `mb-3` to `mb-2`

### 8. Page-level spacing
- Reduce `space-y-5` to `space-y-3` on the main container (line 974)
- Reduce page padding from `p-4 md:p-6` to `p-3 md:p-4`

## Technical Details
All changes are in `src/pages/RecruiterDashboard.tsx`. No database or backend changes needed. Roughly 15-20 line-level edits across the file to tighten spacing classes.

