

# Implementation Plan

## 1. Create "Link in Bio" Landing Page (`/links`)

**New file: `src/pages/LinksPage.tsx`**
- A sleek, mobile-first personal landing page (Linktree-style) with dark glass-card aesthetic
- Social buttons: Snapchat, TikTok, Instagram (each opens external URL — placeholder hrefs for now)
- "Join My Team" button → links to `/apply`
- "Elite Circle — Transform Yourself" button → opens inline signup form (waiting list)
  - Collects: first name, last name, email, phone, motivation
  - Brief description: "An overall life makeover — from out of shape and financially stuck to highly successful, in peak fitness, and financially free."
  - On submit, stores to a new `elite_circle_waitlist` table

**New DB table: `elite_circle_waitlist`**
- `id`, `first_name`, `last_name`, `email`, `phone`, `motivation`, `created_at`
- RLS: public INSERT (anonymous), admin-only SELECT

**Route:** Add `/links` to `App.tsx` (public, no auth)

---

## 2. Fix Manager Selection — Full Names + Hover UX

**File: `supabase/functions/get-active-managers/index.ts`**
- Already returns `full_name` from profiles — verify these are actually populated with full names (first + last). No code change needed here unless names are incomplete.

**File: `src/pages/Apply.tsx` (Step 5 referral selector)**
- Currently shows `agent.name` which comes from `full_name` — this should already be full name
- Add hover tooltip on each SelectItem showing the manager's Instagram handle and a "Manager" badge
- Wrap each SelectItem content in a styled container with subtle hover glow effect

---

## 3. Create Growth Dashboard (`/dashboard/growth`)

**New file: `src/pages/GrowthDashboard.tsx`**

Authenticated page (admin/manager only) with these sections:

### A) Manager Numbers Leaderboard
- Daily input form (like LogNumbers but for managers): applications submitted today, Instagram story views this week, new followers gained
- Leaderboard ranking managers by weekly applications, weekly views, weekly follower gain
- Weekly reset: Monday 9 AM PST the follower input opens for the new week

### B) Instagram Directory
- List of all managers + agents with their Instagram handle
- Sorted by follower count (descending)
- Tap → opens `https://instagram.com/{handle}` in new tab
- Shows avatar, name, follower count, handle

**New DB table: `manager_growth_stats`**
- `id`, `agent_id` (the manager's agent record), `stat_date` (date), `applications_submitted` (int), `instagram_views` (int), `followers_gained` (int), `follower_count` (int), `created_at`
- RLS: managers can INSERT/UPDATE own rows, admins ALL, authenticated SELECT

**Sidebar:** Add "Growth" nav item under TOOLS for admin/manager with a `TrendingUp` icon → `/dashboard/growth`

**Route:** Add to authenticated shell in `App.tsx`

---

## 4. Pipeline Flow & Lead Distribution Improvements

**File: `src/pages/Apply.tsx`**
- In the referral step (Step 5), add the manager's role badge and full name prominently
- Add a subtle card-style layout for each manager option instead of plain dropdown items

**File: `src/components/dashboard/OnboardingPipelineCard.tsx`**
- Already has drill-down dialog — ensure agent names show full first + last name (currently uses `display_name` which may be first-name only)
- Query `profiles.full_name` as fallback when `display_name` is incomplete

---

## 5. Overall Visual Polish Pass

**File: `src/index.css`**
- Add more gradient accents and glassmorphism depth to cards site-wide
- Enhance `nav-item-active` with a subtle glow effect
- Add hover micro-interactions (scale, shadow lift) to clickable cards globally

**Multiple dashboard files:**
- Add subtle color accents to stat cards that currently look flat
- Ensure consistent border-radius, shadow depth, and spacing

---

## Files to Create
| File | Purpose |
|------|---------|
| `src/pages/LinksPage.tsx` | Link-in-bio landing page |
| `src/pages/GrowthDashboard.tsx` | Growth tracking dashboard |

## Files to Modify
| File | Changes |
|------|---------|
| `src/App.tsx` | Add `/links` and `/dashboard/growth` routes |
| `src/components/layout/GlobalSidebar.tsx` | Add "Growth" nav item |
| `src/pages/Apply.tsx` | Enhance manager selector with hover effects and full names |
| `src/components/dashboard/OnboardingPipelineCard.tsx` | Ensure full names in drill-down |
| `src/index.css` | Visual polish — gradients, hover effects, glow accents |

## Database Migrations
1. Create `elite_circle_waitlist` table with public INSERT RLS
2. Create `manager_growth_stats` table with appropriate RLS

