

# Plan: Platform-Wide Optimization Audit — Round 3

## Critical Issues Found

### 1. RUNTIME CRASH: `CourseContent.tsx` wrapped in `forwardRef` breaks lazy loading
**File:** `src/pages/CourseContent.tsx` line 28  
The page component is wrapped in `forwardRef` but loaded via `React.lazy()` in `App.tsx`. When React renders a lazy component, it calls the default export as a function component. `forwardRef` returns an object, not a function, causing: `TypeError: Component is not a function`. This is the active runtime error shown in the diagnostics.

**Fix:** Remove the `forwardRef` wrapper — page components inside `<Suspense>` don't receive refs. Change to a standard function component with `export default function CourseContent()`.

### 2. Unused `motion` import in OnboardingPipelineCard
**File:** `src/components/dashboard/OnboardingPipelineCard.tsx` line 2  
`motion` is imported from framer-motion but never used in the rendered output (all entrance animations were removed in prior audit). Dead import increases bundle.

**Fix:** Remove the unused `import { motion } from "framer-motion"` line.

### 3. Pipeline table hides Email/Phone columns on mobile despite scroll container
**File:** `src/pages/DashboardApplicants.tsx` lines 979-980  
Email and Phone columns have `hidden md:table-cell`, hiding them on smaller screens even though the table has `min-w-[1100px]` with overflow scroll. This is inconsistent with the "always visible" standard applied to Aged Leads and Recruiter HQ.

**Fix:** Remove `hidden md:table-cell` from Email, Phone, License, Location, Manager, and Created columns in the Pipeline table view. The `min-w-[1100px]` constraint already ensures horizontal scroll handles the layout.

### 4. CRM uses nested `<tbody>` per agent row — invalid HTML
**File:** `src/pages/DashboardCRM.tsx` line 1003  
Each agent row + expanded row is wrapped in `<tbody key={agent.id}>`, creating multiple `<tbody>` elements inside the `<TableBody>` wrapper. This was flagged in the previous audit plan but the fix replaced `<motion.tbody>` with `<tbody>` — it should be `<React.Fragment>` instead to avoid nesting tbody inside TableBody.

**Fix:** Change `<tbody key={agent.id}>` to `<React.Fragment key={agent.id}>` (and closing tag), since `<TableBody>` already renders a `<tbody>`.

### 5. Pipeline ResendLicensingButton missing `recipientPhone` prop
**File:** `src/pages/DashboardApplicants.tsx` line 1102-1106  
The table view passes `recipientEmail` and `recipientName` but not `recipientPhone`, meaning the Green Hat button won't trigger SMS in the Pipeline. This was added to Recruiter HQ but not Pipeline.

**Fix:** Add `recipientPhone={app.phone || undefined}` to the `ResendLicensingButton` in the Pipeline table view.

### 6. Missing sound effects on several key interactions
- **LeadCenter.tsx**: Has `playSound` imported and used in some places but missing on bulk operations and status changes.
- **DashboardAgedLeads.tsx**: Quick assign and status change actions don't play sounds.
- **DashboardCRM.tsx**: Agent expand/collapse has sounds, but attendance changes, course login sends, and other actions lack them.

These are minor but contribute to the "incomplete" feel. The existing sound effect system (click, success, celebrate, error, whoosh) covers all needed scenarios.

**Fix:** Add `playSound("success")` on successful status changes and `playSound("error")` on failures across LeadCenter, DashboardAgedLeads, and CRM where missing.

### 7. `AgentPortal.tsx` still imports `motion, AnimatePresence` — verify usage
**File:** `src/pages/AgentPortal.tsx` line 2  
Imports `motion, AnimatePresence` from framer-motion. The `QuickStat` component was previously cleaned of entrance animations, but the import remains. Need to check if `motion` is used elsewhere in the file (e.g., tab transitions).

**Fix:** If unused after prior cleanup, remove the import. If used for legitimate interactive animations (tab switches, conditional reveals), keep it.

## Changes

### 1. Fix CourseContent crash (`src/pages/CourseContent.tsx`)
- Remove `forwardRef` wrapping, change to `export default function CourseContent()`.
- Remove unused `forwardRef` import and `displayName`.

### 2. Remove unused motion import (`src/components/dashboard/OnboardingPipelineCard.tsx`)
- Remove `import { motion } from "framer-motion"` on line 2.

### 3. Always show Pipeline table columns (`src/pages/DashboardApplicants.tsx`)
- Remove `hidden md:table-cell` from Email (line 979), Phone (line 980), License (line 982), Location (line 983), Manager (line 984), and Created (line 985) column headers.
- Remove corresponding `hidden md:table-cell` and `hidden lg:table-cell` and `hidden xl:table-cell` from the `<td>` elements in the table body rows (lines 1021, 1024, 1036, 1049, 1052, 1061).

### 4. Fix nested tbody in CRM (`src/pages/DashboardCRM.tsx`)
- Line 1003: Change `<tbody key={agent.id}>` to `<>` (React Fragment with key via explicit `<React.Fragment key={agent.id}>`).
- Line 1108: Change `</tbody>` to `</React.Fragment>`.

### 5. Add recipientPhone to Pipeline licensing button (`src/pages/DashboardApplicants.tsx`)
- Line 1103: Add `recipientPhone={app.phone || undefined}` prop.

### 6. Add missing sound effects
- Audit and add `playSound("success")` / `playSound("error")` calls on key interactions in LeadCenter, DashboardAgedLeads, and DashboardCRM where they're missing.

### 7. Clean up AgentPortal motion import (`src/pages/AgentPortal.tsx`)
- Verify usage and remove if only used for the now-removed QuickStat animations. Keep if used for valid interactive animations elsewhere in the 809-line file.

## Scope
- 5-6 files edited
- No database migrations
- No new dependencies
- Fixes 1 runtime crash, 1 HTML validation issue, cross-board consistency gaps

