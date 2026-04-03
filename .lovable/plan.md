
# APEX Elite Checklist — Full Implementation Plan

## Already Complete ✅
1. ✅ Syne + DM Sans fonts loading
2. ✅ Electric green (#22d3a5) primary accent
3. ✅ Landing page hero with animated counter
4. ✅ Commission calculator component
5. ✅ CRM AI score badge on applicants
6. ✅ CRM Hot Leads filter
7. ✅ score-applicant edge function deployed
8. ✅ ai_score columns on applications table

## Batch 1: Database Migrations (must run first)
- Create `field_checkins` table (GPS lat/lng, client name, outcome, voice notes, offline queue)
- Create `churn_risk_alerts` table (agent_id, risk_score, risk_factors, resolved_at)
- Both with RLS policies

## Batch 2: Edge Functions (3 new functions)
- `check-churn-risk` — daily risk scoring based on production gaps, attendance, login frequency
- `send-licensing-sequence` — multi-step drip emails for unlicensed recruits
- `send-proactive-coaching` — AI-powered coaching emails based on agent performance

## Batch 3: New Pages + Routes
- `/field-checkin` — GPS check-in page with client form, outcome selector, offline localStorage queue
- `/agent-flow` — dual-flow page showing Licensed vs Unlicensed onboarding paths

## Batch 4: Dashboard Upgrades
- System Health Monitor card on main dashboard
- Churn Risk Banner on dashboard (pulls from churn_risk_alerts)
- Real-time Achievement Feed card
- Page transition animations (framer-motion fade+slide on all page routes)

## Batch 5: Agent Portal + Leaderboard
- Mobile bottom nav bar for agent portal
- Leaderboard real-time Supabase subscription (postgres_changes)
- Animated number updates on leaderboard (already have AnimatedNumber component)

## Batch 6: Apply Page + Profile Upload
- VSL gate on Apply page (70% video watch required before form appears)
- Face detection + auto-crop on AvatarUpload (using canvas-based approach, no face-api.js)

## Batch 7: Sharing + Performance
- Achievement share graphics with Instagram Story download
- Vite chunk splitting config (separate vendor, ui, dashboard chunks)
- All buttons use Syne font-weight 700 (CSS rule)
- Mobile layout optimizations for agent portal, call center, CRM, numbers

## Implementation Order
1. Migrations (Batch 1) — must be approved before code
2. Edge Functions (Batch 2) — deploy in parallel
3. New Pages + Routes (Batch 3)
4. Dashboard + Agent Portal (Batch 4+5)
5. Apply VSL + Avatar (Batch 6)
6. Sharing + Performance (Batch 7)
