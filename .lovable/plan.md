

# Apex Financial CRM Expansion: Agent Pipeline, Kanban Board, Interview Scheduling & Auto-Alerts

## Understanding the Current System

After thorough code review, here is what already exists:

**Already built (do NOT rebuild):**
- `applications` table with `assigned_agent_id`, `status`, `license_progress`, `contacted_at`, `last_contacted_at`, `notes`
- `agents` table with `invited_by_manager_id` (manager hierarchy), `user_id`, `license_status`
- `user_roles` table with `admin | manager | agent` roles (correctly separated, no escalation risk)
- `contact_history` table for activity logging
- `DashboardApplicants.tsx` — manager/admin pipeline page (full featured)
- `DashboardCRM.tsx` — agent CRM with kanban-capable cards
- `CallCenter.tsx` — mobile-optimized lead calling tool
- `LeadCenter.tsx` — admin lead management
- `InterviewRecorder.tsx` — AI call transcription + summary
- `QuickEmailMenu.tsx` — multi-template email system with preview + edit
- `LicenseProgressSelector.tsx` — stage advancement widget
- `ResendLicensingButton.tsx` — course link sender
- `RecruiterDashboard.tsx` (Aisha's page) — unlicensed kanban with XP gamification
- RLS policies on `applications`: agents see their `assigned_agent_id` records, managers see their team's records

**What the request adds (the gaps):**
1. Agent Pipeline page (agents currently see CRM but not their own applicant pipeline)
2. Kanban board on the Pipeline page (table + kanban toggle)
3. Interview scheduling UI integrated into Call Center, Pipeline, and Lead Center
4. Google Calendar / Calendly integration for scheduled interviews
5. Automatic low-AOP email alerts (agents below $5k AOP by Friday)
6. CC emails to referring agent + manager on all applicant events

---

## Scope Decision (What We Build vs. What Already Exists)

This request has significant overlap with existing features. Rather than rebuilding everything from scratch, we will:

- **ADD** a dedicated Agent Pipeline page (`/agent-pipeline`) built on top of the same `applications` data Aisha's RecruiterDashboard uses, but for all agents
- **ADD** a Kanban view toggle to `DashboardApplicants.tsx` (manager pipeline)
- **ADD** an Interview Scheduler component usable from Call Center, Pipeline, Lead Center
- **ADD** Google Calendar link generation + Calendly embed option for interview scheduling
- **ADD** an edge function for the Friday AOP auto-alert emails
- **EXTEND** existing email functions to CC the `assigned_agent_id`'s profile email on all outreach
- **NOT REBUILD** the entire CRM — it already handles roles, hierarchy, CC logic, and pipeline management

---

## Part 1: Database Schema Additions

One migration adds two new tables and one column:

```sql
-- Table: scheduled_interviews
-- Tracks interviews scheduled from anywhere in the system
CREATE TABLE public.scheduled_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  scheduled_by uuid NOT NULL,  -- user_id of who scheduled
  interview_date timestamptz NOT NULL,
  interview_type text DEFAULT 'video', -- 'video' | 'phone' | 'in_person'
  calendar_event_id text,  -- Google Calendar event ID if integrated
  calendly_event_uri text, -- Calendly event URI if booked via Calendly
  meeting_link text,       -- Zoom/Meet/Teams link
  notes text,
  status text DEFAULT 'scheduled', -- 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.scheduled_interviews ENABLE ROW LEVEL SECURITY;

-- RLS: Admins see all, managers see their team's, agents see their own
CREATE POLICY "Admins manage all interviews" ON public.scheduled_interviews
  FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers see team interviews" ON public.scheduled_interviews
  FOR SELECT USING (
    has_role(auth.uid(), 'manager') AND application_id IN (
      SELECT id FROM applications WHERE assigned_agent_id IN (
        SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
      )
    )
  );

CREATE POLICY "Agents see their interviews" ON public.scheduled_interviews
  FOR SELECT USING (
    application_id IN (
      SELECT id FROM applications WHERE assigned_agent_id = get_agent_id(auth.uid())
    )
  );

-- Add interview_scheduled status to applications if not exists
-- (applications.status already has 'interview' as a valid enum value — confirmed in types.ts)
```

No new `pipeline_stages` table needed — `license_progress` enum already covers the Kanban stages perfectly and matches what Aisha's dashboard uses.

---

## Part 2: New Edge Functions

### `schedule-interview/index.ts`
Handles creating a scheduled interview, sending confirmation email to applicant, CC'ing manager and assigned agent, and optionally generating a Google Calendar event link.

**Triggered from:** Call Center, Pipeline, Lead Center schedule buttons.

**Email sends:**
- To: applicant email
- CC: assigned agent profile email + manager profile email + admin (`info@apex-financial.org`)
- Body: Interview confirmation with date/time, meeting link, and a Calendly reschedule link

**Google Calendar:** Generates a Google Calendar "add to calendar" URL (no OAuth required — uses the public `calendar.google.com/calendar/render?action=TEMPLATE` URL format). For full Calendly integration, embeds Calendly widget URL.

### `check-low-aop-friday/index.ts`
A cron edge function that runs every Friday at 4pm CST. Checks all active agents' AOP for the current week. Any agent below $5,000 AOP triggers an automated email to them + CC to their manager + admin with encouragement and a link to schedule a coaching call.

---

## Part 3: New UI Components

### `src/components/dashboard/InterviewScheduler.tsx`
A reusable modal/drawer component that can be triggered from anywhere. Props:
- `applicationId`
- `applicantName`
- `applicantEmail`
- `managerId`

UI includes:
- Date/time picker
- Interview type selector (Video Call / Phone / In Person)
- Meeting link input (pre-fill with Apex Zoom/Meet)
- Notes field
- "Generate Calendar Link" button (builds `calendar.google.com` URL)
- "Send Calendly Link Instead" button (sends scheduling email with Calendly embed)
- Submit → calls `schedule-interview` edge function

### `src/components/pipeline/KanbanBoard.tsx`
Shared Kanban board component using `@dnd-kit/core` (already installed). Works for both agent pipeline and manager pipeline. Props:
- `applications: Application[]`
- `onStageChange: (id, newStage) => void`
- `onCardClick: (application) => void`
- `readOnly?: boolean`

Columns map to existing `license_progress` enum values:
1. Needs Outreach (`unlicensed`)
2. Course Started (`course_purchased`, `finished_course`)
3. Test Phase (`test_scheduled`, `passed_test`)
4. Final Steps (`fingerprints_done`, `waiting_on_license`)
5. Licensed ✓ (`licensed`)

Cards show: name, phone, last contacted badge (color coded), stage selector shortcut, email button, schedule interview button.

### `src/pages/AgentPipeline.tsx`
Agent-specific pipeline page. Fetches applications where `assigned_agent_id = current agent's ID`. Includes:
- Stat bar (total, needs contact, in progress, licensed)
- Table view / Kanban view toggle
- Search + filter
- Card actions: Email, Call, Schedule Interview, Voice Note (InterviewRecorder), License Progress Selector
- Accessible at `/agent-pipeline`
- Shown in sidebar for all agents (not just Aisha)

---

## Part 4: Enhancements to Existing Pages

### `DashboardApplicants.tsx` (Manager Pipeline)
Add a **Kanban view toggle** at the top. When toggled to Kanban, renders `KanbanBoard.tsx` instead of the current card grid. Table/list view stays as-is.

Also add an **"Schedule Interview" button** on each applicant card that opens `InterviewScheduler`.

### `CallCenter.tsx`
Add a **"Schedule Interview"** action button in the actions bar (alongside existing "No Pickup", "Contacted", etc.). Opens `InterviewScheduler` modal for the current lead.

### `LeadCenter.tsx`
Add a **"Schedule Interview"** button in each lead row's action dropdown. Opens `InterviewScheduler`.

### `GlobalSidebar.tsx`
Add **"My Pipeline"** nav item visible to all agents (not just Aisha/admin) linking to `/agent-pipeline`.

---

## Part 5: Auto-Alert Cron Setup

SQL to set up the Friday AOP check cron job (using pg_cron + pg_net, already in the system):

```sql
SELECT cron.schedule(
  'friday-low-aop-check',
  '0 22 * * 5',  -- Friday 4pm CST = 10pm UTC
  $$
  SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/check-low-aop-friday',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <anon_key>"}'::jsonb,
    body := '{"time": "friday_check"}'::jsonb
  );
  $$
);
```

---

## Summary of All Files Changed

| File | Action | Description |
|------|--------|-------------|
| Migration | NEW | `scheduled_interviews` table with RLS |
| `supabase/functions/schedule-interview/index.ts` | NEW | Schedules interview, sends confirmation emails with CC |
| `supabase/functions/check-low-aop-friday/index.ts` | NEW | Friday AOP check cron, sends auto-alert emails |
| `src/components/dashboard/InterviewScheduler.tsx` | NEW | Reusable interview scheduling modal |
| `src/components/pipeline/KanbanBoard.tsx` | NEW | Shared drag-and-drop Kanban using @dnd-kit |
| `src/pages/AgentPipeline.tsx` | NEW | Agent-specific pipeline page (table + kanban toggle) |
| `src/pages/DashboardApplicants.tsx` | EDIT | Add Kanban toggle + Schedule Interview button |
| `src/pages/CallCenter.tsx` | EDIT | Add Schedule Interview action button |
| `src/pages/LeadCenter.tsx` | EDIT | Add Schedule Interview to lead row actions |
| `src/components/layout/GlobalSidebar.tsx` | EDIT | Add "My Pipeline" link for all agents |
| `src/App.tsx` | EDIT | Register `/agent-pipeline` route |
| `supabase/config.toml` | EDIT | Register new edge functions |

---

## What Is NOT Included (Out of Scope / Already Exists)

- **Referral profile request/approval flow**: The `applications.referral_source` field already captures this. Full referral agent registration as a dropdown would require a new `referral_profiles` table and approval admin UI — this is a separate large feature that can be tackled next
- **Rebuilding the existing CRM/Pipeline pages**: They already work correctly with proper RLS
- **Full Google Calendar OAuth integration**: Calendar links are generated as URL templates (no OAuth needed). Full two-way sync requires Google API credentials and is a separate connector setup
- **Calendly webhook integration**: Calendly embed links are sent in emails; full webhook sync is a separate connector
- **Notification bell in-app**: Would require a new `notifications` table + realtime subscription — separate feature
- **Duplicate applicant merge**: Already has a DuplicateMergeTool in admin

