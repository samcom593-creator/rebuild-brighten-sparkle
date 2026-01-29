

## Course Progress Monitoring + CRM Integration

### Overview

Create a dedicated, comprehensive course progress monitoring dashboard that integrates seamlessly with the CRM, providing real-time visibility into agent coursework completion, module-by-module tracking, and quick actions for admin intervention.

---

### What You're Getting

**1. Enhanced Course Progress Dashboard (New Page)**
A dedicated admin-only page at `/course-progress` with:
- Full-width table view of ALL agents in coursework
- Module-by-module breakdown (which specific modules passed/failed)
- Last activity timestamp with "stale" indicators (inactive > 3 days)
- Direct "Send Reminder" action per agent
- Quick "Push to CRM" action for agents ready for field training
- Filter by: All / Not Started / In Progress / Stalled / Complete

**2. CRM Integration - Course Status Column**
Add course progress indicators directly in the existing CRM view:
- Progress bar visible on each agent card in "In Course" column
- Module count badge (e.g., "2/5 modules")
- "Stalled" warning badge if no activity in 3+ days
- One-click action to send coursework reminder email

**3. Command Center Enhancement**
Expand the existing CourseProgressPanel with:
- Summary stats row: Not Started / In Progress / Stalled / Complete
- Click any stat to filter the list
- "Send Bulk Reminder" button for all stalled agents
- Export course progress to clipboard

---

### Technical Implementation

#### A) New CourseProgressPage Component

**File:** `src/pages/CourseProgress.tsx`

Full-featured table with:
- Agent name, email, manager
- Each module as a column with pass/fail status
- Overall % complete with progress bar
- Last activity date with color coding
- Quick actions: Send Reminder, View Profile, Push to Field Training

#### B) CRM Course Status Integration

**File:** `src/pages/DashboardCRM.tsx`

For agents in "onboarding" or "training_online" stage:
- Fetch their `onboarding_progress` records
- Display progress bar + module count
- Add "stalled" indicator if `lastActivity > 3 days ago`
- Add "Send Reminder" button

Data query addition:
```typescript
// Fetch course progress for In Course agents
const inCourseAgentIds = agents
  .filter(a => ["onboarding", "training_online"].includes(a.onboardingStage))
  .map(a => a.id);

const { data: courseProgress } = await supabase
  .from("onboarding_progress")
  .select("agent_id, module_id, passed, completed_at")
  .in("agent_id", inCourseAgentIds);
```

#### C) Enhanced CourseProgressPanel

**File:** `src/components/admin/CourseProgressPanel.tsx`

Add:
- Summary stats bar with click-to-filter
- Module name display (join with `onboarding_modules.title`)
- "Send Reminder" action per agent
- "Send All Reminders" bulk action
- Stale indicator (amber for 3+ days, red for 7+ days)

#### D) Course Reminder Edge Function

**File:** `supabase/functions/send-course-reminder/index.ts`

Email template with:
- Personalized greeting
- Current progress stats
- Direct link to course
- Encouragement message

#### E) Navigation Update

**File:** `src/components/layout/GlobalSidebar.tsx`

Add "Course Progress" link under Admin section (admin-only visibility)

---

### UI/UX Details

**Course Progress Table Layout:**

```text
+-------------+----------------+--------+----------+----------+----------+-----------+-----------+
| Agent       | Manager        | Stage  | Module 1 | Module 2 | Module 3 | Progress  | Actions   |
+-------------+----------------+--------+----------+----------+----------+-----------+-----------+
| Obi Ifedora | Samuel James   | Course | ✓ Pass   | ✓ Pass   | ◯ Not    | 66% ▓▓▓░░ | [Remind]  |
| KJ Vaughns  | Samuel James   | Course | ✓ Pass   | ◯ Not    | —        | 33% ▓░░░░ | [Remind]  |
| New Agent   | Obi Ifedora    | Onbrd  | —        | —        | —        | 0% ░░░░░  | [Enroll]  |
+-------------+----------------+--------+----------+----------+----------+-----------+-----------+
```

**Stalled Indicators:**
- 3+ days inactive: Amber "Stalled" badge
- 7+ days inactive: Red "At Risk" badge with automatic manager notification option

**CRM Card Enhancement:**

```text
┌──────────────────────────────────────┐
│ Obi Ifedora                          │
│ obi@email.com                        │
├──────────────────────────────────────┤
│ Course: 66% ▓▓▓▓░░ (2/3 modules)     │  ← NEW
│ Last active: 2 days ago              │  ← NEW
├──────────────────────────────────────┤
│ [Onboarding → Course → Field → Live] │
└──────────────────────────────────────┘
```

---

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/CourseProgress.tsx` | Create | Full course monitoring dashboard |
| `src/pages/DashboardCRM.tsx` | Modify | Add progress bar to In Course agents |
| `src/components/admin/CourseProgressPanel.tsx` | Modify | Add stats bar, bulk actions, module names |
| `src/components/layout/GlobalSidebar.tsx` | Modify | Add nav link to course progress |
| `supabase/functions/send-course-reminder/index.ts` | Create | Reminder email function |
| `src/App.tsx` | Modify | Add route for /course-progress |

---

### Database Queries

**Course Progress with Module Names:**
```sql
SELECT 
  a.id as agent_id,
  p.full_name,
  p.email,
  a.onboarding_stage,
  a.invited_by_manager_id,
  om.title as module_title,
  om.order_index,
  op.passed,
  op.completed_at,
  op.video_watched_percent
FROM agents a
JOIN profiles p ON p.user_id = a.user_id
LEFT JOIN onboarding_progress op ON op.agent_id = a.id
LEFT JOIN onboarding_modules om ON om.id = op.module_id
WHERE a.onboarding_stage IN ('onboarding', 'training_online')
  AND a.is_deactivated = false
ORDER BY p.full_name, om.order_index
```

---

### Expected Outcome

After implementation:
- Single dashboard to see ALL agents' course progress at a glance
- Know exactly which modules each agent has/hasn't completed
- Instant visibility into who is stalled and needs attention
- One-click reminder emails to push agents forward
- CRM cards show progress directly without navigating away
- Bulk actions for efficiency when managing multiple agents

