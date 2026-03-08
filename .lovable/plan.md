

# Plan: Platform Polish Round 5 — Sound Effects, Entrance Animation Cleanup, UX Fun

## What Was Found

### 1. NotificationHub — Entrance animations on data sections
`src/pages/NotificationHub.tsx` lines 365, 1175, 1226: Three `motion.div` wrappers with `initial={{ opacity: 0, y: 20 }}` on operational data sections (Carrier Assignment, Resume Blast, Bulk Blast). These are admin-facing data tools — not marketing — and should render instantly per the platform standard.

### 2. CallCenter missing sound effects
`src/pages/CallCenter.tsx`: High-interaction page (calling leads, marking actions, sending emails) has zero sound feedback. Every `toast.success` and `toast.error` should be paired with `playSound("success")` / `playSound("error")`. The "hired" action should use `playSound("celebrate")`.

### 3. GrowthDashboard missing sound effects
`src/pages/GrowthDashboard.tsx`: No sound effects at all. Form submissions and data saves should play success/error sounds.

### 4. OnboardingCourse missing sound effects
`src/pages/OnboardingCourse.tsx`: Course completion, quiz answers, and module progress have no audio feedback. These are key gamification moments.

### 5. PurchaseLeads missing sound effects
`src/pages/PurchaseLeads.tsx`: Lead purchase confirmations and package selections have no audio feedback.

### 6. Landing page animations — KEEP
HeroSection, BenefitsSection, Login, Apply, LinksPage, SeminarPage, ScheduleCall all use entrance animations appropriately for marketing/public pages. No changes needed.

## Changes

### 1. Remove entrance animations from NotificationHub data sections
**File:** `src/pages/NotificationHub.tsx`
- Line 365: Replace `<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>` with `<div>` (and closing tag).
- Line 1175: Same replacement for Resume Blast card wrapper.
- Line 1226: Same replacement for Bulk Blast card wrapper (also remove `transition={{ delay: 0.2 }}`).
- Clean up `motion` import if no longer used elsewhere in the file.

### 2. Add sound effects to CallCenter
**File:** `src/pages/CallCenter.tsx`
- Import `useSoundEffects` and initialize `playSound`.
- Add `playSound("success")` alongside every `toast.success()`.
- Add `playSound("error")` alongside every `toast.error()`.
- Add `playSound("celebrate")` when action is "hired" (line 407).
- Add `playSound("whoosh")` on skip/next lead navigation.
- Add `playSound("click")` on `handleStartCalling`.

### 3. Add sound effects to GrowthDashboard
**File:** `src/pages/GrowthDashboard.tsx`
- Import and add sound effects on data save success/error within the growth form submission flow.

### 4. Add sound effects to OnboardingCourse
**File:** `src/pages/OnboardingCourse.tsx`
- Import and add `playSound("celebrate")` on course/module completion.
- Add `playSound("success")` on quiz correct answers.
- Add `playSound("click")` on tab switches.

### 5. Add sound effects to PurchaseLeads
**File:** `src/pages/PurchaseLeads.tsx`
- Import and add `playSound("success")` on purchase confirmations.
- Add `playSound("click")` on package selection.

## Scope
- 5 files edited
- No database changes
- No new dependencies
- Adds audio feedback to 4 high-interaction pages, removes entrance lag from NotificationHub

