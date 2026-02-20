
# Aisha's Recruiting Command Center + Dashboard Unlicensed Fix

## Overview

This plan has two parts:
1. **Fix the dashboard unlicensed count** — currently shows 3, should show 27–30
2. **Build Aisha Kebbeh a dedicated, access-controlled Recruiting Dashboard** with gamified UX, full lead management tools, AI summaries, scheduling links, and automated notifications

---

## Part 1: Fix Dashboard Unlicensed Count

### Root Cause

The `AgencyGrowthCard` queries the `agents` table but only 3 agents there are unlicensed. The 27+ hired people living in `applications` (status: `reviewing`, `contracting`, `approved`) are **not being deduped correctly** — the `profile_id` lookup fails for most agents because `profile_id` is null (agents use `user_id`, not `profile_id`, to link to profiles). This means the dedup by email silently misses most agents and the Set accumulates both sources without removing duplicates.

### Fix

In `src/components/dashboard/AgencyGrowthCard.tsx`, change the agent→email lookup to use `user_id` → profiles (`user_id`) instead of `profile_id` → profiles (`id`). This ensures correct deduplication and the count will reflect the true ~30 unlicensed people.

**Also**: The `allUnlicensedApps` query only pulls `reviewing`, `contracting`, `approved` but misses `new`-status hired applicants. We'll keep it to those three statuses (which are the "hired" statuses) to stay consistent with the CRM's definition.

---

## Part 2: Aisha's Recruiting Dashboard

### Access Control

Aisha already has both `agent` and `manager` roles. Rather than create a new database role (which would require a migration), we'll use **email-based gating** in the route and page component: only `kebbeh045@gmail.com` (and any admin) can access `/dashboard/recruiter`. This is enforced server-side via the authenticated user's email from `useAuth()`, which comes from Supabase Auth — not from localStorage, so it cannot be spoofed.

The route will be added to `App.tsx` and a nav link will appear in `GlobalSidebar.tsx` only for her specific email + admins.

### New Route

`/dashboard/recruiter` — accessible only to Aisha's email + admins

### New File

`src/pages/RecruiterDashboard.tsx` — Aisha's full command center

---

## Dashboard Features

### Header Stats Bar
Four animated stat cards at the top:
- **Total Hired** (all non-terminated, non-licensed applicants assigned to her)
- **Needs Contact** (never contacted or 48h+ stale)
- **In Progress** (actively moving through licensing stages)
- **Licensed This Month** (became licensed)

With bubbly entrance animations and XP/progress-style bar below each card.

### Gamification System
- **XP Points**: Each action earns points — contacting a lead (+10), updating a stage (+15), scheduling a test date (+25), getting someone licensed (+100)
- **Level badge** in the header showing her current recruiter "rank" (Rookie → Rising Star → Power Recruiter → Elite)
- Confetti burst on major milestones (first contact, test scheduled, licensed)
- Sound effects on every stage update (success chime, celebrate on milestone)
- **Streak counter** — consecutive days with activity

### Lead Cards (Kanban-style columns)
Five columns based on `license_progress`:
1. **Needs Outreach** (unlicensed, never contacted)
2. **Course** (course_purchased, finished_course)
3. **Test Phase** (test_scheduled, passed_test)
4. **Final Steps** (fingerprints_done, waiting_on_license)
5. **Licensed** ✓

Each card shows:
- Name, phone, email, location
- Lead date (when they came in — `created_at`)
- Last contact badge (relative time, color-coded: red = never/48h+, amber = 24-48h, green = recent)
- License progress stage selector (existing `LicenseProgressSelector` component)
- **Action buttons**:
  - 🎓 Course link (ResendLicensingButton)
  - 📧 Email menu (QuickEmailMenu with all templates)
  - 🎤 AI Interview Recorder (InterviewRecorder)
  - 📞 Phone tap-to-call
  - 📅 Scheduling link buttons (one for unlicensed Calendly, one for licensed)
- Notes section (inline, expandable)

### Scheduling Links Section
Two quick-access buttons always visible in the page header:
- **"Send Unlicensed Scheduling Link"** — opens email menu pre-filled with `schedule_consultation` template for unlicensed
- **"Send Licensed Scheduling Link"** — same for licensed prospects

Also shown on each card as tap targets.

### AI Notes & Summaries
Each card has an expandable "AI Notes" panel that:
- Shows the most recent `InterviewRecorder` AI summary if one exists
- Shows all contact history inline
- Allows adding a manual note

### Search + Filter Bar
- Search by name, email, phone
- Filter by license progress stage
- Sort by: Needs Contact (stale first), Newest, Oldest, Name

### Rewards/Boosts System
- When she moves someone to "Licensed" → full confetti burst + "🎉 LICENSED!" toast with celebration sound
- When she moves someone to "test_scheduled" → smaller celebration + "Test booked!" badge animation
- Daily activity streak shown in header
- "Boost" counter — total people advanced today shown as a glowing badge

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/dashboard/AgencyGrowthCard.tsx` | Fix agent→profile email lookup to use `user_id` instead of `profile_id` |
| `src/pages/RecruiterDashboard.tsx` | **NEW** — Aisha's full recruiting command center |
| `src/App.tsx` | Add `/dashboard/recruiter` route (lazy loaded) |
| `src/components/layout/GlobalSidebar.tsx` | Add "Recruiter HQ" nav link visible only to Aisha's email + admins |

---

## Design Language

- **Color palette**: Pink/rose/purple accents on top of the existing glass morphism — giving it a distinctly "her" feel while staying within the design system
- **Animations**: Framer Motion spring animations on card entrance, stagger effect on load, `whileTap` scale on buttons, floating particles on milestone events
- **Sound design**: Uses existing `useSoundEffects` hook — `celebrate` on licensing milestones, `success` on stage updates, `click` on actions
- **Confetti**: Uses existing `ConfettiCelebration` component triggered on "Licensed" milestone
- **Mobile-first**: Cards stack on mobile, two-column on tablet, kanban on desktop

---

## Database: No Schema Changes Required

All data already exists in `applications`, `contact_history`, and `interview_recordings` tables. No migrations needed.

---

## Security Note

Access control is done via `user.email === 'kebbeh045@gmail.com' || isAdmin` check using the authenticated Supabase session — this is server-validated identity, not client-side storage, so it cannot be bypassed.
