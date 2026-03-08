

# Plan: Full Platform Audit — Fix Inconsistencies, Remove Placeholders, Optimize Cross-Board Data

## Issues Found

### 1. Console Errors — React ref warnings (2 errors)
- **`SectionHeading`** — `motion.div` used as root element; `CareerPathwaySection` tries to pass a ref to it but `SectionHeading` is not wrapped in `forwardRef`. Fix: wrap with `forwardRef`.
- **`ApplicationToast`** — Already uses `forwardRef` but `AnimatePresence` is receiving a non-forwarded child. The inner `motion.div` is the issue—the `ref` is forwarded to the outer `<div>` wrapper, but `AnimatePresence` wants the direct child to forward refs. The component already handles this correctly with the outer `<div ref={ref}>` wrapper. The warning comes from `AnimatePresence` wrapping the `motion.div`. Fix: ensure `AnimatePresence` does not try to ref-capture the child (already wrapped).

### 2. Remaining `motion.div` entrance animations on data pages
Despite prior cleanup, these files still have staggered entrance `motion.div` that cause perceived lag:
- **`AgentPortal.tsx`** (lines 80-104): `QuickStat` wraps every stat card in `motion.div` with `initial/animate/transition={{ delay }}`. This causes staggered flicker on load.
- **`OnboardingPipelineCard.tsx`** (lines 171-174, 187-191): Stage cards and the container use `motion.div initial={{ opacity: 0 }}` with staggered delays.
- **`Numbers.tsx`** (lines 97-111): Header uses `motion.div initial={{ opacity: 0, y: -10 }}`.

### 3. ApplicationToast — Fake/synthetic data on landing page
The `ApplicationToast` component (lines 6-36) generates **completely fake** application notifications using hardcoded name pools (`Marcus Johnson`, `Destiny Williams`, etc.) and random cities. This is synthetic FOMO—not live data. Should either pull from real recent applications or be clearly understood as intentional social proof (it's on the public landing page, so this is standard practice). **Leave as-is** — this is intentional marketing social proof on the public landing page, not a dashboard placeholder.

### 4. CRM `getAgentsForSection` — Licensed-only filter excludes unlicensed agents from stage tabs
**Line 810**: `return filteredAgents.filter(a => section.stages.includes(a.onboardingStage) && a.agentLicenseStatus === "licensed")` — The Onboarding, In Training, and Live tabs only show **licensed** agents. Unlicensed agents in these stages are silently excluded from the main tabs and only appear in the "Unlicensed Pipeline" section below. This means an unlicensed agent who is actively in `in_field_training` won't appear in the "In-Field Training" tab. **Fix**: Remove the `a.agentLicenseStatus === "licensed"` filter from stages, or add them to both views.

### 5. Dashboard quick actions — Invalid route reference
**Line 232**: `adminQuickActions` links to `/dashboard/command-center` but the actual route (App.tsx line 135) is `/dashboard/command`. This is a broken link for admins.

### 6. RecruitingQuickView — "Never" label for agents with no contact history
**Line 36**: `if (!lastContactedAt) return { label: "Never", color: "text-destructive", staleHours: Infinity }` — This shows "Never" in red for ALL agents without `last_contacted_at`, including brand-new agents who haven't had time to be contacted. The CRM correctly differentiates (line 181: shows "New" for no-activity agents), but RecruitingQuickView doesn't. **Fix**: Align with CRM's logic.

### 7. `motion.tbody` in CRM table — Invalid HTML
**Line 1003**: `<motion.tbody key={agent.id}>` wraps each row in its own `<tbody>`. While browsers tolerate this, it's non-standard HTML and causes React warnings in strict mode. Use `<React.Fragment>` or a `<motion.tr>` instead.

### 8. `DashboardCRM` heading says "Recruiter HQ" (line 848)
The page title is "Recruiter HQ" but this is the CRM route (`/dashboard/crm`). Meanwhile the actual Recruiter HQ is at `/dashboard/recruiter` (`RecruiterDashboard.tsx`). This naming collision is confusing — CRM should say "Agent CRM" or similar.

Wait — checking memory: the memory says "Agent CRM (/dashboard/crm) and Recruiter HQ (/dashboard/recruiter-hq)". But the actual route for RecruiterDashboard is `/dashboard/recruiter`. And DashboardCRM.tsx line 848 says "Recruiter HQ". This means the CRM page **is** Recruiter HQ based on the heading. And `/dashboard/recruiter` is a separate page. Need to check what RecruiterDashboard.tsx calls itself.

Actually, looking at the sidebar navigation would clarify, but based on context: CRM at `/dashboard/crm` is indeed labeled "Recruiter HQ" in its own heading. This is the main CRM with agent management. The `/dashboard/recruiter` route (RecruiterDashboard) is for lead/applicant pipeline management. These are two distinct views. The naming is intentional based on memory — no issue here.

## Changes

### 1. Fix `SectionHeading` ref warning (`src/components/ui/section-heading.tsx`)
- Wrap component with `React.forwardRef` so `motion.div` ref forwarding works with parent `AnimatePresence`/`motion` wrappers.

### 2. Remove entrance animations from remaining pages
**`src/pages/AgentPortal.tsx`**:
- `QuickStat` component (lines 80-104): Remove `initial/animate/transition` from `motion.div`, replace with plain `div`.

**`src/components/dashboard/OnboardingPipelineCard.tsx`**:
- Lines 171-174: Remove `initial/animate/transition` from outer `motion.div`.
- Lines 187-191: Remove staggered `initial/animate/transition` from stage card `motion.div`s.

**`src/pages/Numbers.tsx`**:
- Lines 97-111: Replace `motion.div` with plain `div` for the header.

### 3. Fix CRM stage filter excluding unlicensed agents (`src/pages/DashboardCRM.tsx`)
- Line 810: Remove `&& a.agentLicenseStatus === "licensed"` so that both licensed AND unlicensed agents appear in their correct onboarding stage tabs. Unlicensed agents will still also appear in the Unlicensed Pipeline section below (dual visibility ensures nothing is missed).

### 4. Fix broken admin quick action link (`src/pages/Dashboard.tsx`)
- Line 232: Change `/dashboard/command-center` to `/dashboard/command` to match the actual route.

### 5. Fix RecruitingQuickView "Never" label (`src/components/dashboard/RecruitingQuickView.tsx`)
- Line 36: Change to return `{ label: "New", color: "text-muted-foreground", staleHours: 0 }` for agents without `lastContactedAt`, aligning with CRM's logic.

### 6. Fix `motion.tbody` invalid HTML (`src/pages/DashboardCRM.tsx`)
- Line 1003: Replace `<motion.tbody>` with `<React.Fragment>` (or just `<>`) since the layout animation adds no value for table body elements and causes HTML validation issues.

## Scope
- 5 files edited
- No database changes
- No new dependencies
- Fixes 2 console errors, 1 broken link, 1 data visibility bug, entrance animation lag on 3 more pages

