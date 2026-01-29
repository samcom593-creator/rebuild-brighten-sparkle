
# Front Page Carriers & Site-Wide Navigation Improvements

## Overview
This plan addresses two main issues:
1. The "Partnered with Top Carriers" section on the landing page only shows 6 carriers, which may deter potential applicants
2. The sidebar navigation is inconsistent across the site - AgentPortal uses a different navigation system than the rest of the dashboard

---

## Part 1: Expand Carrier Display

### Current State
The HeroSection shows only 6 carriers in a rotating banner:
- National Life Group
- American Amicable
- Aflac
- Ethos Life
- Mutual of Omaha
- American Home Life

### Solution
Expand to 20+ carriers and add "& 30+ More" indicator to show the full scope of partnerships.

### New Carrier List
```text
National Life Group, American Amicable, Aflac, Ethos Life, Mutual of Omaha,
American Home Life, Transamerica, Athene, Foresters, Americo, F&G, Prosperity,
American Equity, North American, Nationwide, American National, AIG,
Principal, Lincoln Financial, Prudential, John Hancock, Protective
```

### UI Changes
- Display rotating carrier names (as currently implemented)
- Add "& 30+ More Carriers" text below the rotating banner
- Keep the dot indicators but cap at 6 visible dots with a "+16" indicator

---

## Part 2: Consistent Sidebar Navigation

### Current Problem
The `AgentPortal` page uses a completely different navigation system:
- Custom header with Sheet-based mobile drawer
- No access to the collapsible sidebar that exists on Dashboard, Team, CRM, etc.
- Inconsistent experience when navigating between pages

### Solution
Wrap `AgentPortal` with `DashboardLayout` (which uses `SidebarLayout`) to ensure:
- Consistent left sidebar navigation across all pages
- Collapse/expand functionality everywhere
- Mobile hamburger menu that works the same on all pages

### Files to Modify

| File | Change |
|------|--------|
| `src/components/landing/HeroSection.tsx` | Expand carriers array to 20+ and add "& 30+ More" text |
| `src/pages/AgentPortal.tsx` | Wrap with DashboardLayout, remove custom header/navigation |

---

## Technical Implementation

### HeroSection.tsx Changes
```typescript
// Expand the carriers list
const carriers = [
  { name: "National Life Group", shortName: "NLG" },
  { name: "American Amicable", shortName: "AA" },
  { name: "Aflac", shortName: "AFLAC" },
  { name: "Ethos Life", shortName: "ETHOS" },
  { name: "Mutual of Omaha", shortName: "MoO" },
  { name: "American Home Life", shortName: "AHL" },
  { name: "Transamerica", shortName: "TRANS" },
  { name: "Athene", shortName: "ATH" },
  { name: "Foresters", shortName: "FOR" },
  { name: "Americo", shortName: "AMR" },
  { name: "F&G", shortName: "F&G" },
  { name: "Prosperity", shortName: "PROS" },
  { name: "American Equity", shortName: "AE" },
  { name: "North American", shortName: "NA" },
  { name: "Nationwide", shortName: "NW" },
  { name: "American National", shortName: "AN" },
  { name: "AIG", shortName: "AIG" },
  { name: "Principal", shortName: "PRIN" },
  { name: "Lincoln Financial", shortName: "LFG" },
  { name: "Prudential", shortName: "PRU" },
  { name: "John Hancock", shortName: "JH" },
  { name: "Protective", shortName: "PROT" },
];

// Add "& 30+ More" below the rotating banner
<p className="text-xs text-muted-foreground mt-2">
  & 30+ More Top-Rated Carriers
</p>
```

### AgentPortal.tsx Changes
- Import and wrap content with `DashboardLayout`
- Remove the custom header section (lines ~410-600)
- Remove the Sheet-based mobile navigation
- Keep all the content cards, leaderboards, and production entry functionality

```typescript
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

// Wrap the return content
return (
  <DashboardLayout>
    {/* Keep all existing content cards/sections */}
    <div className="space-y-6">
      {/* Hero section with quick stats */}
      {/* Production Entry */}
      {/* Leaderboard tabs */}
      {/* etc. */}
    </div>
  </DashboardLayout>
);
```

---

## Performance Notes

The existing sidebar implementation already handles:
- Smooth CSS transitions (200ms ease-out)
- LocalStorage persistence for sidebar state
- Mobile-specific handling to prevent layout glitches
- Desktop-only margin animations

No additional performance optimizations needed for the sidebar - the infrastructure is already in place and working well.

---

## Expected Outcome

1. **Landing Page**: Visitors see 22 carrier names rotating, plus "& 30+ More" indicating the full breadth of partnerships
2. **AgentPortal**: Uses the same collapsible sidebar as Dashboard, CRM, Team Directory, etc.
3. **Consistent Navigation**: Users can collapse/expand the sidebar from any authenticated page
4. **Mobile**: Same hamburger menu behavior across all dashboard pages
