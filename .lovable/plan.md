

# Fix Navigation: Make Key Pages Accessible to All Roles

## Problem
- **CRM, Pipeline, Course Progress** are hidden from regular agents in the sidebar — only managers/admins see them
- No cross-links between Pipeline → CRM or Dashboard → CRM (e.g., clicking an agent name in one view doesn't navigate to their record in another)
- Agents like "Cooper" only appear on Dashboard but can't be found from Pipeline or other views

## Changes

### 1. GlobalSidebar.tsx — Expose core pages to all roles
Move these items out of the `isAdmin || isManager` block so ALL authenticated users see them:
- **Dashboard** (already visible to all ✓)
- **CRM** — agents should see their own recruits/team
- **Pipeline** — agents already have "My Pipeline" but it's a separate route; unify to one entry
- **My Course** (already visible to all ✓)
- **Agent Portal / My Portal** — currently duplicated (managers see "Agent Portal", agents see "My Portal" pointing to same route); consolidate into one entry visible to all

Reorganize the TOOLS section:
- All users: Dashboard, Log Numbers, My Course, Portal, Pipeline, CRM, Calendar, Purchase Leads
- Managers add: Recruiter HQ, Course Progress, Call Center, Aged Leads, Growth, Seminar
- Admins add: Command Center, Lead Center, Notifications, Day Planner, Accounts

### 2. Pipeline cards — Add "View in CRM" action
In `AgentPipeline.tsx`, when clicking/tapping an applicant card, add a quick-action link or make the name clickable to navigate to `/dashboard/crm?focusAgentId={id}` (the same deep-link pattern already used by OnboardingPipelineCard).

### 3. Dashboard agent cards — Add CRM deep-link
In key dashboard components that show agent names (like leaderboard entries), make names clickable to navigate to `/dashboard/crm?focusAgentId={id}`.

### Files Modified
- `src/components/layout/GlobalSidebar.tsx` — Restructure nav items for all roles
- `src/pages/AgentPipeline.tsx` — Add CRM deep-link on agent cards
- `src/components/dashboard/LeaderboardTabs.tsx` — Make agent names clickable → CRM

