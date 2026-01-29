

## Admin Course Management + My Team Dashboard Enhancements

Based on exploring your codebase, I understand exactly what you need. Here's the implementation plan:

---

### What You're Getting

**1. Course Questions Viewer (Admin-Only)**
- A dedicated section in the Admin Panel where you can see ALL course questions at a glance
- View organized by module with question text, correct answers, and explanations visible
- Quick reference to confirm quiz content before enrolling agents

**2. "Add to Course" Button**
- One-click action to create an agent's login and enroll them in the onboarding course
- Button visible in multiple places:
  - Team Hierarchy Manager (next to each agent)
  - Managers Panel (in the team member list)
  - Agent Management table
- Sends the agent their login credentials automatically

**3. Enhanced My Team Dashboard**
- Clear visualization of who reports to whom
- Manager → Agent relationship shown at a glance
- Sortable by manager, stage, or name
- Quick actions for reassigning agents between managers
- Active agent count per manager
- Visual indicators for:
  - Onboarding stage (Coursework, Field Training, Live)
  - Course progress percentage
  - Last activity

---

### Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/QuizQuestionsAdmin.tsx` | Add full question preview mode (show questions with answers) |
| `src/components/dashboard/TeamHierarchyManager.tsx` | Add "Add to Course" button + course progress column |
| `src/components/dashboard/ManagersPanel.tsx` | Add "Enroll" action for team members |
| `src/pages/TeamDirectory.tsx` | Redesign for clear manager→agent hierarchy visualization |
| `src/components/dashboard/AddToCourseButton.tsx` | NEW - Reusable button component for course enrollment |
| `supabase/functions/enroll-agent-course/index.ts` | NEW - Backend function to create login + enroll in course |

---

### Technical Implementation

#### A) Course Questions Full View (QuizQuestionsAdmin)

Current behavior: Accordion view with truncated questions and just option counts.

New behavior:
- Add "Show All Questions" toggle button
- When enabled, display full question text, all options, correct answer highlighted, and explanations
- Export option to copy all questions as text (for review)

```text
┌─────────────────────────────────────────────────────┐
│ Quiz Questions Manager         [👁️ Show Answers]    │
├─────────────────────────────────────────────────────┤
│ ▼ Getting Started: Your First Week (5 questions)    │
│                                                     │
│   Q1: What is the most important mindset...         │
│   ├─ A) Close deals fast                            │
│   ├─ ✓ B) Learn and stay coachable ← CORRECT       │
│   ├─ C) Avoid mistakes                              │
│   └─ D) Work independently                          │
│   📝 Explanation: The first week is about...        │
│                                                     │
│   Q2: How should you approach daily training...     │
│   ...                                               │
└─────────────────────────────────────────────────────┘
```

#### B) "Add to Course" Component

Creates a reusable button that:
1. Checks if agent already has course access
2. If not, generates login credentials via existing `send-agent-portal-login` function
3. Creates `onboarding_progress` record for Module 1
4. Updates agent's `onboarding_stage` to `"training_online"`
5. Shows success toast with confirmation

#### C) Team Hierarchy Enhanced View

Redesign TeamDirectory for admin/manager view:

```text
┌─────────────────────────────────────────────────────────┐
│ My Team                        [Filter ▼] [Refresh]     │
├─────────────────────────────────────────────────────────┤
│ ┌─ Samuel James (You) ─────────────────────────────────┐│
│ │  ├─ Obiajulu Ifediora    Onboarding    [Enroll]      ││
│ │  ├─ KJ Vaughns           Onboarding    [Enroll]      ││
│ │  ├─ Donavon Brikho       Field Train   60% ▓▓▓▓░░    ││
│ │  ├─ Joe Intwan           Field Train   80% ▓▓▓▓▓▓░░  ││
│ │  └─ Aisha Kebbeh         Live          ✓ Complete    ││
│ └──────────────────────────────────────────────────────┘│
│                                                         │
│ ┌─ Obiajulu Ifediora ──────────────────────────────────┐│
│ │  └─ Chukwudi Ifediora    Live          ✓ Complete    ││
│ └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

Features:
- Tree view showing hierarchy
- Course progress bars for agents in coursework
- Quick "Enroll" button for agents without course access
- Reassign dropdown to move agents between managers
- Stage badges with color coding

---

### Database Query for Course Progress

I'll add a query to fetch onboarding progress alongside agent data:

```sql
SELECT 
  a.id,
  a.onboarding_stage,
  p.full_name,
  (SELECT COUNT(*) FROM onboarding_progress op 
   WHERE op.agent_id = a.id AND op.passed = true) as modules_completed,
  (SELECT COUNT(*) FROM onboarding_modules 
   WHERE is_active = true) as total_modules
FROM agents a
JOIN profiles p ON p.user_id = a.user_id
WHERE a.status = 'active'
```

---

### Enrollment Flow

When admin clicks "Add to Course":

1. **Check existing access**
   - If agent already has `onboarding_progress` records → show "Already enrolled"
   
2. **Generate credentials**
   - Call `send-agent-portal-login` edge function
   - This sends magic link email to agent
   
3. **Initialize course**
   - Set agent's `onboarding_stage` to `"training_online"`
   - Create first `onboarding_progress` record (started_at = now)
   
4. **Show confirmation**
   - Toast: "✓ [Agent Name] enrolled in course. Login sent to [email]"

---

### Summary

After implementation:
- You can view ALL quiz questions with answers from Admin Panel
- One-click "Enroll in Course" button creates login + starts course
- My Team shows clear manager→agent relationships
- Course progress visible for each agent
- Easy reassignment between managers

