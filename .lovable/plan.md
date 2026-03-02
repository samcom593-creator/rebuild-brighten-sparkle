

# Apex Financial — Full System Upgrade Plan

This request spans 12 major sections including new features, rebuilds, audits, and automations. It is too large for a single implementation pass. Below is a phased breakdown.

---

## Phase 1 — System Integrity Audit + Income Fix (Sections 1 & 9)

**What**: Audit TypeScript errors, console errors, broken routes, dead buttons. Fix income calculation to use PST-enforced date ranges with divide-by-zero protection.

| File | Change |
|------|--------|
| All pages/components | Scan for unhandled promises, missing error boundaries |
| `src/pages/Dashboard.tsx` | Fix revenue-per-agent, per-day, per-hour formulas |
| `src/components/dashboard/EstimatedEarningsCard.tsx` | Use `dateUtils.ts` PST functions, guard zero denominators |
| `src/components/dashboard/PersonalStatsCard.tsx` | Same PST + zero-guard fixes |

---

## Phase 2 — Team Overview Dashboard (Section 2)

**What**: New admin-only Team Overview tab/page with aggregate metrics.

| Metric | Source |
|--------|--------|
| Total Active Agents | `agents` where status=active |
| Licensed vs Unlicensed | `agents` joined with `applications` |
| Onboarding / In Field / Active Producers | `agents.onboarding_stage` |
| 7-day / 30-day AOP | `daily_production` aggregated |
| Avg Close Rate | `daily_production` calculated |
| Activation Rate | Active agents with deals / total active |
| Retention Rate | Active agents / (active + deactivated last 90d) |
| Revenue per Agent | Total ALP / active agent count |

**UI**: Bar charts (Recharts), trend arrows, drill-down click filters, manager comparison toggle. New component `TeamOverviewDashboard.tsx` rendered as a collapsible section on `/dashboard` for admins, or a new route.

---

## Phase 3 — Pipeline Dashboard Rebuild (Section 3)

**What**: Upgrade `/dashboard/applicants` to CRM-style Kanban with columns: Applicants → Unlicensed → Licensed → Test Scheduled → Waiting on License → Active Agents → Dormant.

| File | Change |
|------|--------|
| `src/pages/DashboardApplicants.tsx` | Replace current list with Kanban layout |
| `src/components/pipeline/KanbanBoard.tsx` | Extend with lead score, last contact, next action, assigned manager, stage badge, timeline preview per card |
| New: `src/components/pipeline/PipelineCard.tsx` | Compact card component |
| DB | Log drag-and-drop stage changes to `lead_activity` |

---

## Phase 4 — Admin Calendar System (Section 4)

**What**: Full day planner with hour-by-hour blocks, drag-and-drop, color categories.

| Component | Details |
|-----------|---------|
| New DB table: `admin_calendar_blocks` | `id, user_id, title, start_time, end_time, category, completed, created_at` |
| New page or extend `/dashboard/calendar` | Hour grid (6AM-10PM), draggable blocks |
| Categories | Recruiting (blue), Sales (green), Content (purple), Admin (gray), Fitness (orange), Personal (pink) |
| Google Calendar sync | Generate `.ics` download + Google Calendar URL |
| AI Screenshot-to-Schedule | Upload image → call Lovable AI to parse text → create blocks |
| Day completion progress bar | Count completed / total blocks |
| Push/Email/SMS reminders | New edge function `send-calendar-reminder` |

---

## Phase 5 — Seminar Opt-In System (Section 5)

**What**: Weekly seminar registration, reminders, attendance tracking.

| Component | Details |
|-----------|---------|
| New DB table: `seminar_registrations` | `id, first_name, last_name, email, phone, license_status, source, registered_at, attended, follow_up_sent_at` |
| New sidebar item | "Weekly Seminar" for all users |
| Public landing page | `/seminar` — opt-in form |
| Admin dashboard | Registrant list, bulk email, manual add |
| Reminder automation | Edge functions for 24h, 1h, 15min reminders |
| Post-seminar follow-up | Auto-email after event |
| Analytics | Show rate, conversion rate |

---

## Phase 6 — Daily Check-In Automation (Section 6)

**What**: Daily automated check-in for applicants via push/email/SMS.

| Component | Details |
|-----------|---------|
| New DB table: `daily_checkins` | `id, application_id, response, responded_at, created_at` |
| New edge function: `send-daily-checkin` | Sends multi-channel message |
| Response handler | Updates `license_progress` based on response |
| Dashboard panel | Who checked in, who didn't, risk flags |
| Calendly integration | "Need help" response links to booking |

---

## Phase 7 — Social Growth Dashboard (Section 7)

**What**: Extend `/dashboard/growth` with before/after tracking, delta calculations, trend graphs.

| File | Change |
|------|--------|
| `src/pages/GrowthDashboard.tsx` | Add delta tracking, engagement rate, correlation charts |
| `manager_growth_stats` table | Already exists — add `engagement_rate` column |
| CSV import | Bulk import growth data |

---

## Phase 8 — Personal Multi-Offer Landing Page (Section 8)

**What**: New standalone `/links` page with three pathways (Fitness, Join Team, My Systems).

| File | Change |
|------|--------|
| `src/pages/LinksPage.tsx` | Rebuild with 3 CTA cards, conversion tracking |
| New DB table: `link_clicks` | Track pathway, timestamp, referrer |

---

## Phase 9 — UX Enhancement (Section 10)

**What**: Smooth hover glows, card elevation, confetti only on major wins, XP animations, micro-interactions.

| File | Change |
|------|--------|
| `src/index.css` | Add hover glow classes, card elevation utilities |
| Various components | Add framer-motion micro-interactions |
| Sound effects | Ensure toggle works, no overstimulation |

---

## Phase 10 — Calendly Strategy (Section 12)

**What**: Analysis + recommendation document. Centralized admin booking recommended for reporting visibility, with manager-specific Calendly links as optional override.

---

## Implementation Priority

Given output limits, I recommend implementing in this order across multiple messages:

1. **Phase 1** (Integrity + Income Fix) — foundational
2. **Phase 2** (Team Overview Dashboard) — highest admin value
3. **Phase 3** (Pipeline Rebuild) — CRM improvement
4. **Phase 5** (Seminar System) — new revenue feature
5. **Phase 4** (Calendar System) — complex, high-effort
6. **Phase 6** (Daily Check-In) — automation
7. **Phases 7-10** — incremental improvements

Each phase will be a separate implementation message. Shall I start with Phase 1 + Phase 2?

