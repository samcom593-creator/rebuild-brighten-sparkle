

## Master Prompt Implementation Plan

This is a large 19-section upgrade. Based on my audit, here's what's **already done** vs. **still needed**:

### Already Implemented (from previous work)
- Landing page ApexLeadsSection (Gold/Platinum Vet Leads)
- Automation Hub with toggle cards
- Instagram Automation page
- InboxPage exists
- Award Graphics with canvas-based generation
- Agent Flow page
- Vite chunking + lazy loading
- Syne + DM Sans fonts
- Growth Dashboard + Seminar Admin removed from sidebar
- Discord webhook in settings
- Lead purchase notification edge function

### Remaining Work (grouped into implementation phases)

---

### Phase 1: Database Migrations

Create migrations for:
1. **CRM stages** — Add `transfer` and `below_10k` to `onboarding_stage` enum (if not already in enum). Add constraint allowing: `applied, meeting_attendance, pre_licensed, transfer, in_field_training, below_10k, live, need_followup, inactive, evaluated, pending_review`
2. **`lead_purchase_requests` table** — if it doesn't exist yet (Dashboard.tsx references it with `as any`)
3. **`instagram_subscriptions` table** — if missing
4. **`automations_config` table** — if different from `automation_settings`
5. **`notification_log` columns** — add `subject`, `body`, `status`, `opened_at` if missing

---

### Phase 2: CRM Stages Update (Section 1)

**File: `src/pages/DashboardCRM.tsx`**
- Update `SECTIONS` array to include all 9 stages in order: applied → meeting_attendance → pre_licensed → transfer → in_field_training → below_10k → live → need_followup → inactive
- Color code each stage per spec (blue, purple, yellow, orange, teal, red, green, amber, gray)
- Add stage filter dropdown in CRM top bar
- Show colored pill badge on each agent card

---

### Phase 3: Profile Photo Requirement (Section 2)

- **`src/pages/DashboardCRM.tsx`**: Show "Photo Required" red badge on cards without avatar
- **`src/pages/OnboardingCourse.tsx`**: Before Module 1 unlocks, check `profiles.avatar_url`. Show full-screen upload prompt if missing

---

### Phase 4: Team Directory → Visual Org Chart (Section 3)

**File: `src/pages/TeamDirectory.tsx`** — Complete rebuild:
- Pyramid org chart: Sam (gold) → Managers (blue) → Team Leaders (teal) → Agents (green)
- Recursive `OrgNode` component with avatar, name, role badge, weekly ALP
- Connecting lines between levels
- Right-side Quick Reassign panel (agent dropdown → new manager dropdown → confirm)
- Role Promotion side panel on card click

---

### Phase 5: Course Catalog Netflix Rebuild (Section 4)

**File: `src/pages/OnboardingCourse.tsx`** — Major enhancements:
- Hero banner with current/next module + progress bar
- Module grid with lock/complete/current visual states
- Sequential unlock logic (photo → Module 1 → Module 2 → etc.)
- 80% video watch threshold before quiz
- Speed controls (already partially done)
- Notes panel alongside video
- Call Library tab (grid of recorded calls, search/filter)
- Completion certificate generation (PDF)

---

### Phase 6: Course Progress Optimization (Section 5)

**File: `src/pages/CourseProgress.tsx`**:
- 3 tabs: In Progress (default) / Completed / Not Started
- Hide deactivated/inactive agents
- Add columns: photo, modules complete, %, last activity, days since start, quiz avg, [Send Nudge]
- "Send Reminder to All Stalled" bulk action
- Manager-scoped filtering

---

### Phase 7: Inbox Timestamps + Cleanup (Section 6)

**File: `src/pages/InboxPage.tsx`**:
- Left panel with filter tabs (All/Email/SMS/Push)
- Prominent date/time formatting ("Today 9:32am", "Apr 3, 9:32am")
- Color left border by type
- Right panel: full message body, To, Sent, Status, Resend button
- Stats bar: emails/SMS sent today, open rate

---

### Phase 8: Daily Check-In + Remove Field Check-In (Sections 7 & 8)

- **DailyCheckin.tsx**: Add license check — redirect licensed agents to /agent-portal
- **Remove Field Check-In**: Delete `src/pages/FieldCheckin.tsx`, remove route from App.tsx, remove from GlobalSidebar.tsx

---

### Phase 9: Purchase Leads Stripe Integration (Section 9)

- Enable Stripe via the Stripe tool
- Create Stripe checkout sessions for Gold ($250) and Platinum Vet ($350) packages
- **PurchaseLeads.tsx**: Dark luxury card design, Stripe payment buttons
- Admin view: pending confirmations with Confirm/Decline buttons
- Webhook → creates `lead_purchase_requests` entry

---

### Phase 10: Aged Leads Design (Section 10)

**File: `src/pages/DashboardAgedLeads.tsx`**:
- Card grid layout instead of table
- Color by age: green (0-30), yellow (31-60), red (61+)
- Bulk actions, search/filter, pagination (25 per page)

---

### Phase 11: Dashboard Real Numbers (Section 11)

**File: `src/pages/Dashboard.tsx`**:
- Override earnings calculation: team ALP × agency_override_rate
- Remove all hardcoded numbers, replace with real Supabase queries
- Stat cards using proper queries (active agents, weekly ALP, applications, close rate)

---

### Phase 12: Auto-Promote Logic (Section 1 addendum)

**File: `supabase/functions/log-production/index.ts`**:
- After production submission, check if agent's total ALP ≥ $10,000
- If yes and stage is `below_10k`, auto-update to `live`

---

### Phase 13: Email/SMS Routing Fix (Section 13)

- In hire/contract edge functions: check license_status
- Licensed → portal onboarding email (no pre-licensing course)
- Unlicensed → pre-licensing + Day 1/3/7/14 sequence
- Fix all send times to 9:30am CST (15:30 UTC)

---

### Phase 14: Remaining Cleanup (Sections 14, 18, 19)

- Remove all hardcoded placeholder numbers across codebase
- Loading skeletons + pagination on heavy pages
- Page load animations (opacity + translateY)

---

### Technical Notes

- Stripe integration requires enabling via the Stripe tool first
- Database migrations needed before UI code for new enum values and tables
- The `onboarding_stage` enum likely needs `ALTER TYPE` rather than a CHECK constraint since it's a Postgres enum
- Total estimated files to create/modify: ~15-20 files
- This is a multi-step implementation that will be executed sequentially by phase

