

# Comprehensive Enhancement Plan: Navigation, UI Design & Role-Based Access

## Overview

This plan addresses multiple interconnected enhancements across navigation, visual design, role-based permissions, and feature additions based on your detailed feedback.

---

## 1. Apex Financial Logo → Dashboard Navigation

**Current State:** The Apex Financial logo in the sidebar links to `/dashboard`

**Issue:** When clicking "Apex Financial" (the logo), it should take users to the dashboard

**Fix Required:** 
- File: `src/components/layout/GlobalSidebar.tsx` (lines 172-187)
- The logo already links to `/dashboard` via the `<Link to="/dashboard">` wrapper
- **VERIFIED**: This is already implemented correctly. The Crown icon with "APEX Financial" text links to `/dashboard` in both expanded and collapsed states.

---

## 2. Team Hierarchy with Production Numbers & Premium UI Redesign

**Current State:** Team Hierarchy shows basic agent info (name, email, stage, course progress, manager) without production data. The table-based layout looks "boring."

**Enhancement:**

### 2a. Add Production Data to Team Hierarchy

**File:** `src/components/dashboard/TeamHierarchyManager.tsx`

**Changes:**
1. Extend `AgentHierarchyEntry` interface to include:
   ```typescript
   weeklyAlp: number;
   weeklyDeals: number;
   monthlyAlp: number;
   monthlyDeals: number;
   ```

2. Fetch production data in `fetchHierarchy()` by joining `daily_production` table

3. Display production in a visually appealing format with week/month numbers

### 2b. Premium Card-Based UI Redesign

Replace the boring table with a premium card grid layout:

```text
┌─────────────────────────────────────────────────────┐
│  [Avatar] Samuel James (You)              MGR       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ $45,200 │ │  12     │ │$125,000 │ │  38     │   │
│  │  Week   │ │ Deals   │ │ Month   │ │ Deals   │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│  Reports to: — | Stage: Admin                       │
│  [Edit Profile] [Add to Course]                     │
└─────────────────────────────────────────────────────┘
```

**Design Principles:**
- Card-based layout with subtle gradients
- Animated number displays that count up
- Week/Month production prominently displayed
- Rank badges for top producers
- Glassmorphism effects with subtle borders

---

## 3. Plaque Design Enhancement

**Current State:** Plaques are functional but could be more premium and shareable

**File:** `supabase/functions/send-plaque-recognition/index.ts`

**Enhancements:**

### 3a. Cleaner Plaque Design

Update `generatePlaqueHTML()` to create a cleaner, more minimalist design:
- Remove excessive gradient effects
- Use cleaner typography (serif for name, sans-serif for labels)
- Add subtle gold/silver/platinum border based on achievement tier
- Ensure "APEX FINANCIAL" branding is prominent but tasteful
- Keep the design simple enough to be screenshot-worthy

### 3b. Manager Tagging in Recognition

The plaque system already sends emails to both the agent AND their manager. However, we should ensure:
- Manager's email includes clear attribution
- If the agent has Instagram, include it in the email for easy tagging
- Add a "Share to Instagram" deep link in the email

**Files to Update:**
- `supabase/functions/send-plaque-recognition/index.ts` - Include Instagram handle in plaque data
- Fetch Instagram handle from profile when sending plaque

---

## 4. Role-Based Navigation Access Control

**Current State:** Sidebar shows different items based on role, but permissions need tightening

**File:** `src/components/layout/GlobalSidebar.tsx`

### 4a. Updated Permission Matrix

| Route | Admin | Manager | Agent |
|-------|-------|---------|-------|
| Dashboard | ✅ | ✅ | ✅ |
| Log Numbers | ✅ | ✅ | ✅ |
| Course Progress | ✅ | ✅ | Own only |
| Pipeline | ✅ | ✅ | ❌ |
| Agent Portal | ✅ | ✅ | ✅ (own) |
| CRM | ✅ | ✅ | ❌ |
| Aged Leads | ✅ | ❌ | ❌ |
| Command Center | ✅ | ❌ | ❌ |
| Accounts | ✅ | ❌ | ❌ |
| Settings | ✅ | ✅ | ✅ |

### 4b. Code Changes

```typescript
const navItems = useMemo(() => {
  const items = [];

  // All users
  items.push({ icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" });
  items.push({ icon: Edit3, label: "Log Numbers", href: "/numbers" });

  // Admin ONLY
  if (isAdmin) {
    items.push({ icon: Crown, label: "Command Center", href: "/dashboard/command" });
    items.push({ icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads" });
    items.push({ icon: UserCog, label: "Accounts", href: "/dashboard/accounts" });
  }

  // Admin + Manager
  if (isAdmin || isManager) {
    items.push({ icon: BarChart3, label: "Course Progress", href: "/course-progress" });
    items.push({ icon: Users, label: "Pipeline", href: "/dashboard/applicants" });
    items.push({ icon: BarChart3, label: "Agent Portal", href: "/agent-portal" });
    items.push({ icon: Briefcase, label: "CRM", href: "/dashboard/crm" });
  }

  // Agent only (personal portal)
  if (isAgent && !isAdmin && !isManager) {
    items.push({ icon: BarChart3, label: "My Portal", href: "/agent-portal" });
    items.push({ icon: BarChart3, label: "My Course", href: "/onboarding-course" });
  }

  // All users
  items.push({ icon: Settings, label: "Settings", href: "/dashboard/settings" });

  return items;
}, [isAdmin, isManager, isAgent]);
```

---

## 5. Enhanced "Add Person" Modal

**Current State:** InviteTeamModal only collects name, email, phone

**File:** `src/components/dashboard/InviteTeamModal.tsx`

### 5a. Add Contracting Link Feature

Add a new section for custom contracting/onboarding links:

```typescript
interface SavedLink {
  id: string;
  name: string; // e.g., "SilverScript Contracting"
  url: string;
  createdAt: string;
}

// State
const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
const [newLinkName, setNewLinkName] = useState("");
const [newLinkUrl, setNewLinkUrl] = useState("");
```

### 5b. License Status Selection

Add toggle for licensed vs unlicensed:

```tsx
<div className="space-y-2">
  <Label>License Status</Label>
  <div className="flex gap-3">
    <Button
      variant={licenseStatus === "licensed" ? "default" : "outline"}
      onClick={() => setLicenseStatus("licensed")}
      className="flex-1"
    >
      Licensed
    </Button>
    <Button
      variant={licenseStatus === "unlicensed" ? "default" : "outline"}
      onClick={() => setLicenseStatus("unlicensed")}
      className="flex-1"
    >
      Unlicensed
    </Button>
  </div>
</div>
```

### 5c. Send Course Toggle

```tsx
<div className="flex items-center justify-between">
  <Label>Send Onboarding Course</Label>
  <Switch checked={sendCourse} onCheckedChange={setSendCourse} />
</div>
```

### 5d. Database Table for Saved Links

Create new table `contracting_links`:
```sql
CREATE TABLE contracting_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Replace Manager Leaderboard with Invitation Tracker

**Current State:** Dashboard shows Manager Leaderboard which user wants replaced

**File:** `src/pages/Dashboard.tsx`

### 6a. Create InvitationTracker Component

**New File:** `src/components/dashboard/InvitationTracker.tsx`

Features:
- Shows pending invitations (sent but not accepted)
- Shows accepted invitations with date
- Real-time updates via Supabase subscription
- When accepted, shows agent entered their email, phone, created password, and optionally Instagram

```tsx
interface InvitationStatus {
  id: string;
  agentName: string;
  email: string;
  sentAt: string;
  acceptedAt: string | null;
  hasCompletedProfile: boolean;
  hasInstagram: boolean;
}

// Component shows:
// ✓ John Smith - Accepted (2 hours ago)
// ⏳ Jane Doe - Pending (sent 1 day ago)
// ✓ Mike Johnson - Accepted, Profile Complete
```

### 6b. Replace in Dashboard

```tsx
// Line 362: Replace ManagerLeaderboard with:
{(isManager || isAdmin) && <InvitationTracker />}
```

---

## 7. My Team Page Enhancement

**Current State:** My Team (TeamDirectory.tsx) is slow and was removed from sidebar

**Note:** The "My Team" link was already removed from sidebar per previous changes. The user now wants a version that shows week/monthly numbers in an appealing format similar to the main dashboard.

### 7a. Option A: Keep Removed, Use Command Center Team Hierarchy

Since the "My Team" link was removed and the Team Hierarchy Manager already exists in Command Center, we can enhance that component instead (covered in Section 2).

### 7b. Option B: Restore Simplified My Team

If user wants "My Team" restored for managers, create a lightweight version that:
- Only fetches the manager's direct reports
- Shows week/month numbers in the same font style as the main dashboard stats
- Uses the AnimatedNumber component for the counting effect

---

## 8. Log Numbers Screen Enhancement

**Current State:** LogNumbers.tsx has a functional but potentially "squarish" design

**File:** `src/pages/LogNumbers.tsx`

### 8a. Premium Fintech Design Updates

- Add subtle gradient backgrounds
- Use rounded corners instead of square
- Implement glassmorphism effects
- Make the Apex logo more prominent
- Add "Powered by Apex Financial" footer in premium styling
- Ensure numbers are screenshot-worthy

### 8b. Design Mockup

```text
┌────────────────────────────────────────────┐
│            [Apex Logo]                     │
│         Apex Daily Numbers                 │
│       Daily production entry               │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │  [Search Box with rounded corners]   │  │
│  │  Enter your name or email            │  │
│  └──────────────────────────────────────┘  │
│                                            │
│            ·  ·  ·                         │
│     Powered by APEX FINANCIAL              │
└────────────────────────────────────────────┘
```

---

## 9. Agent Acceptance Flow

**Current State:** When an invite is accepted, agents enter their info

**Enhancement:** Ensure acceptance flow collects:
1. Email (required)
2. Phone number (required)
3. Password (required)
4. Instagram handle (optional)

**File:** `src/pages/AgentSignup.tsx` or the magic link landing page

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/layout/GlobalSidebar.tsx` | Tighten role-based navigation permissions |
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add production data, redesign to premium card layout |
| `src/components/dashboard/InviteTeamModal.tsx` | Add license status, course toggle, saved links |
| `src/pages/Dashboard.tsx` | Replace ManagerLeaderboard with InvitationTracker |
| `src/pages/LogNumbers.tsx` | Premium fintech design updates |
| `supabase/functions/send-plaque-recognition/index.ts` | Cleaner plaque design, Instagram integration |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/components/dashboard/InvitationTracker.tsx` | Track pending/accepted invitations |

## Database Changes

| Table | Change |
|-------|--------|
| `contracting_links` | New table for saved contracting links per manager |

---

## Expected Outcomes

1. **Apex Financial logo navigates to dashboard** - Already working, verified
2. **Team Hierarchy shows production** - Week/month ALP and deals displayed beautifully
3. **Premium UI throughout** - Card-based layouts, animations, gradients, glassmorphism
4. **Clean shareable plaques** - Professional design agents can screenshot and share
5. **Manager recognition** - Managers tagged in all agent achievements
6. **Strict role permissions** - Agents see only Dashboard, Log Numbers, Portal, Course
7. **Enhanced invite modal** - License status, course toggle, saved contracting links
8. **Live invitation tracking** - See who accepted invites and their profile status
9. **Premium Log Numbers screen** - High-tech fintech aesthetic, screenshot-worthy

