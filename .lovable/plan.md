

# Enhance Dashboard Recruiting Visibility & Quick-View Course/Contact Tracking

## Problem

The user wants to scroll through their main Dashboard and CRM and immediately see:
- Who has purchased a course
- When they were last contacted
- Where each person stands in the hiring/licensing pipeline
- All of this without needing to click into individual cards or navigate to separate pages

Currently, the **main Dashboard** (`/dashboard`) shows production stats, leaderboards, and a high-level `OnboardingPipelineCard` with counts (e.g., "3 in Onboarding, 2 In-Field Training"), but it does **not** show individual names, course purchase status, or last-contact dates inline.

The **CRM** (`/dashboard/crm`) has all this data per agent card, but only shows 3 agents per column before requiring expansion. The **Recruiter HQ** has full lead cards with contact freshness badges but is restricted to one user (Aisha).

## Plan

### 1. Add "Recruiting Quick-View" Section to Main Dashboard

**File: `src/components/dashboard/RecruitingQuickView.tsx`** (NEW)

A new component placed on the Dashboard (below `OnboardingPipelineCard`, visible to managers and admins) that shows a compact table/list of all agents in the pipeline with:

| Name | Stage | Course? | License Progress | Last Contact | Action |
|------|-------|---------|-----------------|--------------|--------|
| John Smith | Onboarding | ✅ Purchased | Course Started | 2h ago | → CRM |
| Jane Doe | In Training | ❌ Not yet | Unlicensed | 3d ago ⚠ | → CRM |
| Bob Lee | Live | ✅ | Licensed | Yesterday | → CRM |

Key features:
- Compact row-based layout (not cards) for fast scanning
- Color-coded "Last Contact" column: green (<24h), amber (24-48h), red (>48h), red pulse (never)
- Course status: green checkmark if `has_training_course` is true, red X if not
- License progress shown as colored badge (reuses `progressColors` from `LicenseProgressSelector`)
- Click any row to jump to CRM with that agent's section expanded
- Collapsible on mobile with a "View Recruiting Pipeline" trigger button
- Fetches from the same `agents` + `applications` tables already used by the CRM
- Uses `useQuery` with a 2-minute stale time, keyed by user ID

### 2. Expand OnboardingPipelineCard to Show Names

**File: `src/components/dashboard/OnboardingPipelineCard.tsx`** (MODIFY)

Currently shows only stage counts. Add a small "peek" section under each count showing the first 2-3 agent names in that stage with their last-contact freshness indicator. Example:

```text
Onboarding (3)
  • John Smith — 2h ago ✅
  • Jane Doe — Never ❌
  • +1 more
```

This gives the user instant visibility without navigating to CRM.

Changes:
- Expand the existing `fetchPipeline` function to also return agent names + `last_contacted_at` for each stage
- Render a small list of names under each stage count
- Add a "View all →" link to CRM

### 3. Increase Default Visible Agents in CRM Columns

**File: `src/pages/DashboardCRM.tsx`** (MODIFY, line 1656)

Currently shows only 3 agents per column before the "View all X agents →" button. Change this to 5 agents to reduce clicks.

```
// Line 1656: Change slice(0, 3) to slice(0, 5)
{columnAgents.slice(0, 5).map(...)}
// Line 1661: Change > 3 to > 5
{columnAgents.length > 5 && (
```

### 4. Add "Course Purchased" Badge to CRM Agent Cards

**File: `src/pages/DashboardCRM.tsx`** (MODIFY, ~line 955)

The CRM agent cards already show the course link for onboarding agents, but there's no visible badge showing course purchase status at a glance. Add a small badge:

```
{agent.hasTrainingCourse && (
  <Badge className="text-[9px] h-3.5 px-1 bg-blue-500/10 text-blue-400 border-blue-500/30">
    📚 Course Purchased
  </Badge>
)}
```

This goes in the badges section next to "Under [Manager]" and "Duplicate" badges (~line 837-863).

### 5. Fix Recruiter HQ Infinite Animation

**File: `src/pages/RecruiterDashboard.tsx`** (MODIFY, line 1000 and 1007)

Two infinite animations detected:
- Line 1000: `<Sparkles className="h-6 w-6 text-pink-400 animate-pulse" />` — change to static
- Line 1007: `animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}` — change to single-play

---

## Technical Details

| File | Change |
|------|--------|
| `src/components/dashboard/RecruitingQuickView.tsx` | **NEW** — compact table of all pipeline agents with course status, license progress, last contact |
| `src/components/dashboard/OnboardingPipelineCard.tsx` | **MODIFY** — add agent names + contact freshness under each stage count |
| `src/pages/Dashboard.tsx` | **MODIFY** — import and place `RecruitingQuickView` below `OnboardingPipelineCard` |
| `src/pages/DashboardCRM.tsx` | **MODIFY** — increase default visible agents from 3→5, add "Course Purchased" badge |
| `src/pages/RecruiterDashboard.tsx` | **MODIFY** — fix 2 infinite animations |

### Data Fetching (RecruitingQuickView)

```typescript
// Fetch all active agents with pipeline data
const agents = await supabase
  .from("agents")
  .select("id, onboarding_stage, has_training_course, license_status, is_deactivated, is_inactive, invited_by_manager_id")
  .eq("status", "active")
  .eq("is_deactivated", false);

// Get profiles for names
const profiles = await supabase
  .from("profiles")
  .select("user_id, full_name")
  .in("user_id", userIds);

// Get last contact from applications
const contacts = await supabase
  .from("applications")
  .select("assigned_agent_id, last_contacted_at, license_progress")
  .in("assigned_agent_id", agentIds)
  .is("terminated_at", null);
```

No new database tables, no edge functions, no migrations needed. All data is already available and protected by existing RLS policies.

