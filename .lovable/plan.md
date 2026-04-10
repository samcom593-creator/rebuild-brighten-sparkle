

# APEX Financial Maximum Rebuild Plan

This is a comprehensive 14-part overhaul covering visual identity, CRM, communications, training, calendar, content library, automation, and global fixes. Many features already partially exist; this plan addresses what's missing or broken.

---

## Current State Assessment

**Already implemented (partially or fully):**
- CRM stages (Below 10K, Transfer, Live) with ALP logic
- Agent cards with photos and AI score badges
- Filter bar (stage, license, manager, AI score)
- Manager isolation via `invited_by_manager_id`
- Inbox page with timestamps and delivery status
- Automation Hub with toggle cards
- Team Hierarchy with promote/demote
- Sidebar structure (Growth Dashboard and Field Check-In removed)
- Syne + DM Sans fonts loaded in `index.html`
- Lazy loading and manual chunks in Vite config
- `lead_purchase_requests` table exists
- Purchase Leads page with Venmo/CashApp

**Missing or needs building:**
- Content Library page (`/dashboard/content`) — does not exist
- Course Catalog Netflix-style rebuild (`/course-catalog` route) — currently uses `/onboarding-course`
- Call Library tab — not built
- Completion certificate generation and auto-email
- Google Calendar OAuth integration
- Stripe checkout session edge function
- APEX Leads section on landing page
- `system_settings` table for earnings override rate
- Discord webhook URL in Settings page
- Daily check-in WhatsApp redirect for unlicensed
- Agent Portal → Agent Dashboard rename (partially done, `/agent-portal` still exists)
- CSS global styles from Part 1 (glass-card, hover transitions, etc.)
- Vite `build.target: 'esnext'` and framer-motion/date-fns chunks

---

## Implementation Phases

### Phase 1: Visual Identity & CSS Foundation
- Add Part 1 CSS rules to `index.css`: glass-card styles, universal hover transitions, button primary styles
- Add `build.target: 'esnext'` and additional manual chunks (framer-motion, date-fns) to `vite.config.ts`

### Phase 2: Landing Page — APEX Leads Section
- Create `src/components/landing/ApexLeadsSection.tsx` with Standard ($250) and Premium ($350) lead package cards
- Add trust signals row and "How it works" steps
- Wire purchase buttons to Stripe checkout (Phase 5)
- Add section to Index page between CareerPathway and CTA

### Phase 3: Database Migrations
- Create `system_settings` table (key TEXT PRIMARY KEY, value TEXT, updated_at)
- Insert `sam_override_rate = 0.03`
- Add `discord_webhook_url` column or use `system_settings` for it
- Ensure `lead_purchase_requests` has all needed columns

### Phase 4: CRM Enhancements
- Add bulk actions toolbar (select all, bulk email/SMS/move stage/assign/deactivate)
- Add "Pending Lead Confirmations" admin banner with confirm/decline buttons
- Add pagination (24 cards per page)
- Polish agent card hover states (lift + green glow)

### Phase 5: Stripe Checkout Integration
- Create `supabase/functions/create-checkout-session/index.ts` edge function
- Accept package_type + agent_id, create Stripe checkout session, return URL
- On success: insert `lead_purchase_request`, notify Sam via SMS + email
- Wire Purchase Leads page and landing page buttons to this function

### Phase 6: Training Academy — Netflix-Style Course Catalog
- Rebuild `OnboardingCourse.tsx` as Netflix-style catalog with hero banner, 3-column grid
- Add locked/unlocked/completed visual states with overlays
- Add Call Library tab with search/filter (Sales Calls, Recruiting, Training, Live Replays)
- Add completion certificate generation (HTML canvas → PDF)
- Create edge function to email certificate to agent + Sam
- Add `/course-catalog` route (redirect from `/onboarding-course`)

### Phase 7: Content Library (New Page)
- Create `src/pages/ContentLibrary.tsx` at `/dashboard/content`
- Grid view for uploaded content (videos/photos) with tags
- Social post generator (caption + hashtags + download)
- Award graphics generator using HTML Canvas (5 templates)
- Add to sidebar under CONTENT section

### Phase 8: Calendar Rebuild
- Rebuild `CalendarPage.tsx` with proper week grid view (7 columns × hourly rows)
- Add drag-to-create and drag-to-move events
- Auto-populate APEX events from DB (interviews, exam dates, milestones)
- Add Google Calendar connect button (OAuth flow via edge function)
- Add sidebar with mini month navigator and upcoming events

### Phase 9: Communications & Inbox Polish
- Ensure email-client style layout with left panel (35%) and right panel (65%)
- Add unread badge count to sidebar Inbox item
- Verify resend button works on failed messages

### Phase 10: Global Fixes
- Fix earnings calculation to use `system_settings.sam_override_rate`
- Complete "Agent Portal" → "Agent Dashboard" rename globally
- Fix pre-licensing email routing in `notify-agent-contracted` to send YOUR course link for licensed agents
- Daily check-in: redirect licensed agents to `/agent-dashboard`, add WhatsApp link after submit for unlicensed
- Add Discord webhook URL field to Settings page (admin)
- Wire `discord-webhook-notify` to read from `system_settings` instead of `profiles`

### Phase 11: Daily Producer Spotlight Enhancement
- Update `send-daily-producer-spotlight` with the 5-tier achievement detection logic
- Add moody email template with agent photo overlay
- Add SMS blast via `send-sms-auto-detect`
- Log all sends to `notification_log`

### Phase 12: Mobile Optimization
- Bottom nav bar on Agent Dashboard: Home | Numbers | Leaderboard | Awards | Profile
- Large tap targets (48px min), swipe gestures on Call Center
- `inputmode="decimal"` on number inputs in Numbers page

### Phase 13: Sidebar Polish
- Apply luxury dark gradient background
- Green pulsing live indicator dot next to "APEX" logo
- Active item: teal text + 2px left border
- Section headers: 10px uppercase with letter-spacing

### Phase 14: Cleanup & QA
- Remove all remaining placeholder/hardcoded numbers
- Verify all alert banners use real DB queries
- Ensure all email cron schedules use `'30 15 * * *'` (9:30am CST)

---

## Technical Details

**New files to create:**
- `src/pages/ContentLibrary.tsx`
- `src/components/landing/ApexLeadsSection.tsx` (may already exist — needs verification/rebuild)
- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/send-completion-certificate/index.ts`

**Database migrations:**
- `system_settings` table
- Indexes on `notification_log` if missing

**Edge function secrets needed:**
- `STRIPE_SECRET_KEY` (already set)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (needed for Calendar OAuth)

**Files with major edits:**
- `src/index.css` — add glass-card and global hover styles
- `src/pages/DashboardCRM.tsx` — bulk actions, pagination, lead confirmation panel
- `src/pages/OnboardingCourse.tsx` — Netflix-style rebuild with call library
- `src/pages/CalendarPage.tsx` — week grid rebuild
- `src/pages/Settings.tsx` — Discord webhook URL field
- `src/pages/DailyCheckin.tsx` — licensed redirect + WhatsApp link
- `src/components/layout/GlobalSidebar.tsx` — visual polish + Content Library link
- `vite.config.ts` — build optimizations

This is approximately 8-10 implementation rounds. Shall I begin with Phase 1 (Visual Identity + CSS) and Phase 3 (Database migrations), then proceed sequentially?

