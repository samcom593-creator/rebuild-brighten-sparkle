
# APEX Billionaire Level System Upgrade

## Phase 1: Database Migrations (must run first)
- Add columns to `notification_log`: `subject`, `body`, `notification_type`, `opened_at`, `agent_id` + indexes
- Create `lead_purchase_requests` table (agent_id, package_type, amount_paid, payment_method, transaction_id, status, confirmed_at, notes)
- Create `automation_settings` table (name, schedule, enabled, last_run_at, last_status)

## Phase 2: Communication Inbox (`/dashboard/inbox`)
- New page: email-client layout with left panel (message list) + right panel (detail view)
- Filter by Email/SMS/Push, search by agent, date range
- Stats bar: emails today, SMS today, delivery rate, opens
- Realtime Supabase subscription on notification_log
- Resend button on failed messages
- Add to sidebar with Mail icon

## Phase 3: CRM Overhaul
- Full filter bar: Stage / License / Manager / AI Score / Performance / Stalled
- Sort by: Name, ALP, Date, AI Score, Days in stage
- Bulk select with bulk actions (move stage, reassign, email, SMS, deactivate)
- Pagination at 25/page
- Search covers phone + Instagram
- Quick Stats bar above table
- Inline manager reassignment per agent
- "Manager" column with click-to-change

## Phase 4: Lead Purchase System
- APEX Leads section on landing page (2 packages: Standard $250, Premium $350)
- Purchase confirmation flow with payment tracking
- Admin "Pending Purchases" card on dashboard
- `notify-lead-purchase` edge function to alert Sam

## Phase 5: Hierarchy Management
- Visual org chart (Sam → Managers → Agents)
- Quick reassign panel with confirmation
- Bulk operations (reassign, promote, demote, deactivate)
- Add "Team Structure" to sidebar (admin only)

## Phase 6: Growth Dashboard Overhaul
- Tab 1: Pipeline funnel with conversion rates per stage
- Tab 2: Recruiter leaderboard (managers ranked by team production)
- Tab 3: Social growth charts (Instagram tracking)
- Tab 4: Retention analytics (30/60/90 day retention, churn by manager)

## Phase 7: Seminar Dashboard Overhaul
- Countdown timer to next seminar
- Schedule new seminar with auto invite blast
- Registrant list with AI scores + follow-up buttons
- Analytics tab (attendance rate, conversion, best day)

## Phase 8: Course System Upgrade
- Sequential module unlocking
- 80% video watch gate before quiz
- Playback speed controls (0.5x-2x)
- Agent notes panel per module
- Completion certificate (canvas-generated PDF)
- Admin progress table with filters

## Phase 9: Automation Hub (`/dashboard/automation`)
- New page showing all automated workflows
- Toggle on/off per automation
- "Run Now" manual trigger
- Last run timestamp + status
- Automation log table

## Phase 10: Daily Producer Spotlight
- `send-daily-producer-spotlight` edge function
- Moody premium email template with agent photo
- SMS version to all agents
- Achievement detection logic (40K in 90 days, Diamond Week, streaks)

## Phase 11: Visual Polish
- Sidebar redesign with proper nav sections
- Consistent page headers across all dashboard pages
- Landing page hero refinement

## Implementation Order
Phases 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11
(Database first, then features in order of impact)
