
# Notification Hub -- Top-Tier Overhaul + Full Platform Polish Pass

## Overview
Complete redesign of the Notification Hub into a premium, gamified command center with animated stats, gradient cards, sound effects, and visual flair. Plus a polish pass across Accounts and Schedule Bar to ensure consistency.

---

## 1. Notification Hub -- Premium Redesign

### Header Section
- Replace plain text header with a gradient hero banner (teal-to-blue gradient background with glassmorphism)
- Add animated "pulse" indicator next to "Notification Hub" showing real-time status
- Add a "Last refreshed X seconds ago" live counter

### Stats Cards -- Animated + Gradient
- Replace the plain flat stat cards with gradient `GlassCard` components matching the Accounts page pattern
- Each stat gets its own gradient color scheme (Push = blue, SMS = green, Auto SMS = purple, Email = amber, Failed = red)
- Use `AnimatedCounter` for all numbers with count-up animation
- Add glow hover effects on each card
- Add sound effect ("click") when tapping a stat card to filter the log by that channel

### Quick Action Buttons -- Redesigned
- Upgrade the 3 action buttons from plain buttons to large gradient cards with icons, descriptions, and animated hover states
- Add `motion.div` with `whileHover` scale and glow
- Play "whoosh" sound on button click, "celebrate" on completion
- Add a 4th quick action: **"Resend All Failed"** -- retries all failed notifications from today

### Notification Log Table -- Enhanced
- Add alternating row hover highlights with subtle glow
- Add row click to expand full message details inline (accordion-style)
- Add color-coded left border on each row based on channel (blue = push, green = SMS, purple = auto-SMS, amber = email)
- Add a "Success Rate" progress bar at the top of the log showing sent vs failed ratio
- Add pagination (25 per page) instead of showing all 100

### Bulk Blast Section -- Command Center Feel
- Add a live progress bar during blast execution (percentage counter)
- After blast completes, show animated result cards with `AnimatedCounter` counting up stats
- Add confetti burst when blast completes successfully
- Play "celebrate" sound on completion

### Carrier Assignment -- Polish
- Add gradient stat showing "X leads missing carrier" prominently
- Add a "quick assign" dropdown that appears on hover for each row

### Tab Navigation
- Add sound effect ("click") on tab switch
- Add animated underline indicator on active tab
- Add badge counts on each tab (e.g., "Bulk Blast (3 actions)")

---

## 2. Accounts Page -- Final Polish

- Add a "Refresh" button with spin animation
- Add row hover highlight with subtle glow effect matching the design system
- Add a skeleton loader while accounts are loading (instead of text "Loading...")

---

## 3. Schedule Bar -- Minor Polish

- Add a subtle "new" pulse animation on urgent (red) pills
- Sound already plays on dismiss -- add "click" sound on expand/collapse toggle

---

## Technical Details

### Files Modified

| File | Changes |
|------|---------|
| `src/pages/NotificationHub.tsx` | Full redesign: gradient stats with AnimatedCounter, GlassCard wrappers, sound effects on all interactions, success rate bar, pagination, resend-failed button, confetti on blast, animated results, color-coded log rows |
| `src/pages/DashboardAccounts.tsx` | Add refresh button, skeleton loader, row hover glow |
| `src/components/layout/ScheduleBar.tsx` | Add pulse animation on red pills, click sound on toggle |

### Key Implementation Patterns

**Stats cards pattern (NotificationHub):**
- Use same gradient card pattern already in DashboardAccounts (`bg-gradient-to-br` + `from-{color}/20 to-{color}/5 border-{color}/20`)
- Wrap values in `AnimatedCounter` component
- Add `useSoundEffects` hook, play "click" on stat tap to filter

**Pagination for log table:**
- Add `page` state, show 25 rows per page
- Prev/Next buttons at bottom
- Show "Showing X-Y of Z" label

**Resend Failed action:**
- Query `notification_log` for today's failed entries
- For each, re-invoke the original channel function based on metadata
- Track success/fail count and display results

**Confetti on blast complete:**
- Import `canvas-confetti` (already installed)
- Fire confetti burst after blast mutation resolves successfully

**Color-coded log rows:**
- Add a 3px left border to each `TableRow`: `border-l-3 border-l-blue-500` for push, `border-l-green-500` for SMS, etc.

**Success Rate Bar:**
- Calculate `sentCount / totalCount * 100`
- Render using the existing `Progress` component from `@/components/ui/progress`
