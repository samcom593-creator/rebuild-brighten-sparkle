

# Add Total Applications FOMO Counter to Dashboard

## What We're Building

A visually striking "Total Applications" banner on the Dashboard that combines all applications (98 new + 925 aged = 1,023 total) into one big animated counter. This creates FOMO for agents and managers by showing how many people are applying to work with the agency.

## Placement

Right after the welcome message and before the quick actions row. This is the first data point every user sees -- maximum visibility.

## Component: `TotalApplicationsBanner`

A new standalone component (`src/components/dashboard/TotalApplicationsBanner.tsx`) that:

1. Fetches two counts via separate queries:
   - `applications` table: `COUNT(*) WHERE terminated_at IS NULL`
   - `aged_leads` table: `COUNT(*)`
2. Displays the combined total with the existing `AnimatedCounter` component for a smooth count-up effect
3. Shows a breakdown row: "98 New Applicants + 925 Aged Leads"
4. Shows "today" and "this week" mini-badges for recency FOMO
5. Uses `framer-motion` entrance animation + subtle pulse on the number
6. Gradient background (primary-to-emerald) with a glowing effect
7. Fire/rocket icon to reinforce momentum
8. Visible to ALL roles (agents, managers, admins) -- everyone should feel the FOMO

## Visual Design

```text
┌─────────────────────────────────────────────────┐
│  🚀  Total Applications                        │
│                                                 │
│         1,023                                   │
│    (animated count-up, large bold text)          │
│                                                 │
│  98 New Applicants  •  925 Aged Leads           │
│                                                 │
│  [+4 today]  [+9 this week]    ← green badges   │
└─────────────────────────────────────────────────┘
```

- Gradient border (primary/emerald)
- GlassCard base with gradient overlay
- Number uses `text-4xl font-black` with gradient text
- Sub-counts in muted text
- Green pulse badges for today/this week counts
- Sound effect on mount ("whoosh")

## Technical Details

### Files

| File | Change |
|------|--------|
| `src/components/dashboard/TotalApplicationsBanner.tsx` | **NEW** -- fetches counts, renders animated FOMO banner |
| `src/pages/Dashboard.tsx` | Import and place `TotalApplicationsBanner` between welcome message and quick actions |

### Data Fetching

Uses `useQuery` with key `["total-applications-fomo"]`, refetches every 60 seconds to stay live. Two parallel Supabase `count` queries (head-only, no data transfer):

```
supabase.from("applications").select("*", { count: "exact", head: true }).is("terminated_at", null)
supabase.from("aged_leads").select("*", { count: "exact", head: true })
supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", todayISO)
supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", weekStartISO)
```

### No Database Changes

All data already exists in `applications` and `aged_leads` tables. RLS policies already allow admin/manager SELECT. For agents, the banner will use the edge function or a simple server count -- but since agents can view their own applications and aged_leads have manager-only RLS, we'll fetch counts via a lightweight approach: the banner shows the total for admins/managers who can see all data, and for agents it shows just their own application count + a motivational message.

Actually, to keep it simple and universal: admins see the full count (1,023), managers see their team + aged leads assigned to them, agents see their own leads. The FOMO effect works at every level.

