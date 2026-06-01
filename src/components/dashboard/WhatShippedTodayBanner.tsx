import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, Rocket } from "lucide-react";

/**
 * WhatShippedTodayBanner — pinned to the very top of /dashboard so Sam
 * (and any admin reloading) sees explicit proof of what changed today
 * vs yesterday. Updates by editing the SHIPPED array on each commit.
 *
 * Why this exists: Sam reported on 2026-05-19 "everything still looks
 * the exact same as yesterday" despite 24+ commits shipping in 24h.
 * Browser cache + Vercel propagation hide most changes. This banner
 * makes the delta unmissable. Collapsible so it doesn't dominate the
 * page after he's read it.
 */

interface ShippedItem {
  ts: string;       // human readable
  label: string;
  detail: string;
  commit?: string;
}

// 2026-05-18 / 2026-05-19 receipts. Most-recent first. Update this on
// every meaningful ship so the dashboard always shows the latest delta.
const SHIPPED: ShippedItem[] = [
  {
    ts: "today",
    label: "perf: 4 performance fixes — batch queries, useMemo, kill 1s tick",
    detail: "AISummaryReport: 5 sequential count queries → Promise.all (parallel, ~5x faster). CourseProgressPanel: 5 .filter() passes per render → single useMemo loop (O(n) once, not O(5n)). BulkStageActions: N+1 serial loop per agent → single batch upsert + single batch insert + parallel edge fn calls; also memoized selectedAgents/canAdvance/canRevert. SupabaseHealthBanner: 1s setInterval that caused 3,600 banner re-renders/hr → isolated ElapsedSince + SecondsSince child components that only mount and tick when the banner is actually visible (during an outage).",
  },
  {
    ts: "today",
    label: "Overnight drain: PL-023 + PL-059 + PL-063 + PL-088 + PL-091 + PL-081 + Notion sync + morning brief rewrite",
    detail: "Single wave from the 2026-05-29 overnight build. PL-023 RecentActivationsPanel shipped on AgentCommandDashboard (v_recent_activations_alp view). PL-059 LeadCenter gets a source-breakdown panel (per-channel volume + contacted + close rate). PL-063 InactiveAgents gets CRM-grade Never-sold / Sold-≥1 / Sold-only-one tabs with live counts. PL-088 SMS milestone infra live (license_milestone_outbox + 6-template seed + trigger on applications.license_progress + send-license-milestone edge fn + cron @ 1 min) — fires the moment Twilio creds drop in vault. PL-091 xcel-gmail-pull edge fn deployed (cron @ 30 min, Gmail OAuth gated). PL-081 system-health-autopilot deployed (cron @ 5 min, reads 5 health views, auto-retries 3x/hr then pages Sam via Telegram). Notion live-sync edge fn + recruiting_pipeline_rollup + finance_snapshot RPCs + cron @ 30 min — gated on NOTION_TOKEN. Morning brief fully rewritten to plain-English Money/Recruiting/Content/Bots/What-broke/One-move sentences; chip cards retired.",
  },
  {
    ts: "today",
    label: "PL-025 Lapses 30d KPI now opens a drilldown modal on tap (policy + agent + client + lapsed_at)",
    detail: "AgentCommandDashboard's 'Lapses · 30d' StatRowCard is now interactive — a11y-correct (renders as a button when onClick is set, keyboard + screen-reader friendly), opens LapsesDrilldownModal with the 45 lapsed policies showing policy_number, client name + phone, face_amount, monthly_premium, lapsed_at (relative + absolute), and the writing agent. Shipped in commits 460fa0ae (interactive StatRowCard wiring) + 4837ab49 (LapsesDrilldownModal component).",
  },
  {
    ts: "today",
    label: "PL-051 Leaderboards: stronger top-3 podium contrast + per-row deal breakdown (shipped in 460fa0ae)",
    detail: "/dashboard/leaderboard top widget now scans clearly: #1 gets a gold ring + amber bg + glow shadow, #2 silver fill + ring, #3 bronze fill + ring. Production rows now spell out 'N deals · avg $X / deal' under each agent name so a manager can see if a leader is winning on volume or premium size. Other boards (recruiting / referrals / activity) keep their own breakdown shape. Code shipped in commit 460fa0ae alongside PL-076.",
  },
  {
    ts: "today",
    label: "PL-045 Geographic mix widget replaced with Contact-Freshness Ladder (real data)",
    detail: "/dashboard/client-pipeline had a 'Top 10 states' chart that rendered permanently empty because agentlink_clients.state is null for 100% of synced rows upstream. Same widget slot now shows a Contact-Freshness Ladder bar chart: Never / ≤7d / 8-30d / 31-60d / 60d+ buckets computed from last_contact_date. Real data, immediately actionable — surfaces the cold-pool size (currently ~1.6k untouched clients) so a manager can drain it. Header updated to 'Contact freshness / When were they last touched?' and old stateData useMemo removed.",
  },
  {
    ts: "today",
    label: "PL-076 IG -> Discord voice channel broadcaster + strict PII guard",
    detail: "New ig-voice-broadcast edge function ships sanitized one-liners to the team's Discord voice channel: 'Another deal from <First>.' / 'Another hire — <First>.' / 'Another applicant in — <First> just sent the link.' STRICT sanitization layer: rejects any agent_first_name carrying PII (phone, email, dollar amounts, 4+ digit runs), strips to first word only, alpha + hyphen + apostrophe only, max 32 chars. Webhook URL pulled from system_settings.discord_webhook_url_voice (registered as empty so the fn returns status='disabled' until Sam pastes the URL — never errors upstream callers). Allowed_mentions stripped on outbound Discord POST so a malicious name can't @everyone. Sam-only follow-up to flip live (Discord voice-channel webhook URL + edge-fn deploy) tracked in BLOCKERS.md.",
  },
  {
    ts: "today",
    label: "PL-093 Referrals: earnings tiles + v_referral_earnings_pending view live",
    detail: "/dashboard/referrals/mine now shows four earnings tiles above the referral list: Pending (bonus owed but not paid), Paid out (lifetime), Sent (total with won/open breakdown), and Win rate (closed-won/closed). Backed by new v_referral_earnings_pending view (per-agent rollup over v_agent_referrals: total_referrals, open/won/dead counts, bonus_owed/paid/pending in cents, last_referral_at). submit_referral RPC already wired on /dashboard/referrals/new — frontend verified, end-to-end live. Migration: supabase/migrations/20260529000200_pl093_v_referral_earnings_pending.sql.",
  },
  {
    ts: "today",
    label: "PL-098 Onboarding curriculum: 4 modules -> 15 modules live",
    detail: "onboarding_modules table was 4 rows tracking 205 onboarding_progress rows — barely a curriculum. Seeded 11 new modules covering the actual Apex training arc: Apex Story, Carriers & Products, Lead Sources, Dialer (ReadyMode), CRM (AgentLink + Pipeline), First Call Framework, Closing, Underwriting, Compliance (mandatory pass at 100), Commissions & Charge-backs, and the 6-Figure Path. order_index 4-14, all is_active=true, pass_threshold 80 default / 100 for Compliance. video_url currently points to Sam's @SamuelJamesHQ channel as a placeholder — swap each row's URL when the production recording drops. Migration saved at supabase/migrations/20260529000100_pl098_seed_onboarding_curriculum.sql.",
  },
  {
    ts: "today",
    label: "PL-AHO-WEB-006 Per-state Career landing pages with Google for Jobs JSON-LD (10 launch states)",
    detail: "New /careers/:state route serving 10 state-specific recruiting landing pages (FL, TX, CA, GA, AZ, NC, OH, TN, MI, PA). Each page emits Google for Jobs compatible JobPosting JSON-LD on mount: title='Life Insurance Agent — Remote in <State>', employmentType=CONTRACTOR, hiringOrganization=Apex Financial, jobLocation with PostalAddress + region, jobLocationType=TELECOMMUTE, baseSalary $60K-$250K/yr range, datePosted auto-stamps today, validThrough +60d. Page has hero CTA, stat tiles ($120K+ / 2-4 wk license / 22+ carriers), what-you-get list, requirements, bottom CTA, and cross-links to all other state pages for the internal link graph. New JsonLd helper component handles script-tag mount/cleanup so SPA route changes never leave stale schema behind. Eligible for the free Google for Jobs SERP slot for 'life insurance agent <state>' queries.",
  },
  {
    ts: "today",
    label: "PL-080 Charges Audit: compact, scannable table view (now default)",
    detail: "/dashboard/charges-audit was hard to digest — every charge rendered as a full motion-card. Added a compact Table view as the new default with a Table/Cards toggle: amount, customer + email, agent on record (rose-highlighted when name mismatches), inline flag badges (name, dup, unlinked, $$, ack, refund, or 'clean'), absolute timestamp + relative age, and a tight inline action cluster (ack, refund, strike, copy id, open in Stripe). Zebra-striped rows, alternating bg, hover row highlight. Cards view kept for full per-row detail.",
  },
  {
    ts: "today",
    label: "Telegram /register command + 7-type onboarding deeplink path live",
    detail: "Webhook now accepts /register <type> from inside any group to classify it (onboarding, lobby, licensing, seminar, training, wins, manager_alerts). Replaces the old 'Sam: classify this chat by updating telegram_groups.type' nudge that required Sam to drop into SQL. New group join message lists every valid type with one-liner descriptions. Sam-side path is now 2 taps: tap deeplink → name group → type /register onboarding. Wired to the existing nudge-runner.py drip cron so D1/D3/D7/D14 templates fire automatically once a group flips active. Persisted at supabase/functions/telegram-webhook/index.ts + /Users/samjames/business-ops/TELEGRAM-CHANNELS.md.",
  },
  {
    ts: "today",
    label: "PL-AHO-WEB-001 Apply quick-qualify path live for paid-social traffic",
    detail: "Visitors landing on /apply with ?source=ad or ?utm_medium=paid_social now see a 4-field Step 1: first name, phone, email, and licensed yes/no. Submitting that step writes an applications row with status=quick_qualified, preserves paid-social attribution, fires apply_quick_qualified analytics, saves the partial session, and moves them into the full application as Step 2. Standard traffic stays on the original 4-step application control.",
  },
  {
    ts: "today",
    label: "PL-086 Seminar form write path live: /seminar now writes registrations, stamps application seminar fields, and alerts the manager",
    detail: "The public SeminarPage no longer calls the mismatched browser RPC directly. It posts to the new seminar-register Edge Function, which validates the payload, calls the corrected register_for_seminar SECURITY DEFINER RPC, writes or updates seminar_registrations, stamps applications.seminar_date + seminar_registered_at + seminar_slot_at, logs confirmation/reminder rows, and sends the assigned hiring manager a Resend email with applicant contact info. Migration 20260525090000 also fixes the production RPC signature mismatch that caused the form to post without a durable registration.",
  },
  {
    ts: "today",
    label: "ReadyMode sync fixed end-to-end: manager-login pull is live (PL-077)",
    detail: "ReadyMode's Apex account does not expose a REST API key, so the old sync stayed in 'credentials missing' even with sync_enabled=true. readymode-sync now uses Edge-secret manager login credentials, pulls ReadyMode's authenticated /+CCS Reports/call_log/update JSON endpoint, normalizes call rows, and upserts into readymode_dialer_calls. system_settings now has readymode_auth_mode=browser_login + base URL + sync_enabled=true, and pg_cron runs readymode-sync-pull every 5 minutes. Live fill pulled 300 calls via browser_login and DB health shows current_mode=PULL, pull_enabled=true, ingest_24h=300, cron_jobs=1.",
  },
  {
    ts: "today",
    label: "PL-066 Schedule auto-fill LIVE: policy draft checks + post-test follow-ups now land on manager calendars with email summaries",
    detail: "New schedule-auto-populate edge function reads live book-of-business mirrors (agentlink_book_of_business when populated, carrier_policies as the current live fallback) and creates idempotent calendar_events rows with source='schedule-auto-populate'. It computes upcoming monthly policy draft checks, assigns each to the writing agent's manager schedule, and emails grouped manager summaries through Resend with retry/backoff. Applicants who are past their licensing test now get follow-up calendar events every 3 days through day 30. Migration 20260522000600_schedule_auto_populate.sql added the unique source/external_id guard, v_schedule_auto_events, schedule_auto_populate_tick(), and daily cron job apex-schedule-auto-populate at 12:11 UTC. Calendar page now reads those auto-filled events in Pipeline Dates and has an Auto-fill button for admin/manager refresh. Live run inserted 71 events: 41 draft checks and 30 post-test follow-ups; 7 manager summary emails sent after retrying two Resend 429s.",
  },
  {
    ts: "today",
    label: "Seminar funnel LIVE: Apply submission auto-books next Wed/Fri/Sun 7pm CT Zoom + sends confirmation email with .ics calendar + Telegram bot deep-link",
    detail: "PL-SEMINAR-FUNNEL shipped overnight. Migration 20260522000400_seminar_funnel.sql added four seminar_* columns to applications, six seminar_* system_settings keys (zoom_url / zoom_meeting_id / passcode / schedule_cron / host_name / from_email), fn_next_seminar_slot() returning the next Wed/Fri/Sun @ 19:00 America/Chicago timestamptz with at least 6h lead time, v_seminar_next_slots view (next six upcoming slots), and get_application_seminar_invite(uuid) RPC. New seminar-confirmation edge fn: loads the application row, calls fn_next_seminar_slot(), builds an RFC5545 .ics attachment (UID stable per application so updates and cancels can re-issue), sends a Resend email with the Zoom URL + passcode + Telegram bot deep-link + Add-to-Google-Calendar link + .ics attachment, stamps applications.seminar_invited_at + seminar_slot_at + seminar_zoom_link + seminar_ics_uid, idempotently inserts a seminar_registrations row, and logs to email_delivery_log. submit-application now fires it fire-and-forget after the insert, wrapped in try/catch so a failure never fails the parent submission. ApplicationConfirmation gained a Seminar Zoom Locked panel that polls get_application_seminar_invite RPC for about 40 seconds after mount and shows the locked slot plus Zoom URL with copy button plus Telegram CTA, on all three Apply success pages (generic / licensed / unlicensed) plus public /status/:id. Zoom URL is a placeholder until Sam swaps in his manager's recurring URL via the bot-sql one-liner documented in SEMINAR-TEST.md.",
  },
  {
    ts: "today",
    label: "APEX OS Week shipped overnight: /mentorship page LIVE on samueljameshq.vercel.app, $3K Stripe link for 1:1 created, /admin/sam Sam HQ dashboard with editable MUST/SHOULD/COULD checklist + 11 seeded Friday tasks",
    detail: "Five overnight ships before Sam wakes at 6 AM. (1) /mentorship landing page LIVE at samueljameshq.vercel.app/mentorship with all four tiers and live Stripe payment links: Apex Fit $497, Sales Academy $997, Inner Circle $2,500/qtr, and 1:1 $3,000/90d (new — dropped from $5K via Stripe API). (2) New $3,000 Stripe payment link minted (plink_1TZj0JC3Khd8IPVmuHyp5Ccq) and saved to system_settings.mentorship_payment_links; the legacy $5K link is archived as one_on_one_5k_legacy for audit trail. (3) /admin/sam Sam HQ shipped: editable MUST/SHOULD/COULD daily checklist that persists in Supabase, syncs across devices every 60s, plus a 7-day week strip, recent-hires panel, LEAKS surface (unclaimed applicants + policies missing premium + unreconciled commissions + InsuraCloud auth status), and a one-line BOTS strip. (4) sam_daily_tasks schema applied live, 11 Friday 2026-05-22 tasks seeded covering testing the mentorship buy flow, testing the seminar funnel end-to-end, recording one DJI short-form, the 9:30 AM CT morning meeting, and the food/protein anchor. (5) DM pitch bank persisted at /business-ops/apex-os-week/dm-pitch-bank/dm-pitch-bank.md with 12 templates across three buckets: cold fitness DMs at $497, warm mentorship upsells at $3K, and seminar invites for cold recruiting DMs.",
  },
  {
    ts: "today",
    label: "APEX Control: one-prompt command room shipped",
    detail: "Added an admin-only APEX Control page at /dashboard/apex-control and surfaced it in the dashboard sidebar. It turns Sam's credit-safe operating rules into a visual page: what to do when Claude is out of credits, what each AI lane handles, the current P0 background mode, device roles, and copy buttons for the exact Claude, Codex, cleanup, Gemini/Flow, and SD-card prompts. Also persisted the full prompt bank at /Users/samjames/business-ops/master-prompts/102-apex-one-prompt-system.md so Sam does not have to keep prompt fragments in Notes.",
  },
  // forbidden-allow: this entry documents prior banned phrasings; guard skips this block
  {
    ts: "today",
    label: "Career Pathway: carrier-count claim reconciled with live RPC (website-integrity-bot)",
    // forbidden-allow: receipts entry references prior banned phrasings; guard skips this line
    detail: "Audit pass #11 caught the carrier-count discrepancy. CareerPathwaySection had its stats banner already wired to landing_live_stats() showing 22 Carrier Partners, but Phase 2 Step 2 still had hardcoded marketing copy referencing the older inflated claim of fifty-plus carriers in both description + green-check benefit row. Two contradicting numbers on the same section of the same page. The canonical truth is 22 (HeroSection carriers[] list length + landing_live_stats RPC value). Fix: hoisted the static phases array into a buildPhases(carriers) factory called via useMemo inside the component, so Phase 2 Step 2 description + benefit interpolate the live carrier count. Same RPC pattern as Apply.tsx (pass #10) + CTASection (pass #9). Forbidden-language guard extended with three new bans for the carrier-inflation phrasings so the marketing larp can never silently re-ship.",
  },
  {
    ts: "today",
    label: "Apply page: trust ribbon now pulls live numbers from RPC instead of hardcoded stats (website-integrity-bot)",
    detail: "Audit pass #10 closed the third instance of the same fake-success disease (after the VSL Test fix in pass #8 + the closing-CTA fake-roster fix in pass #9). The /apply trust ribbon was rendering a hardcoded carrier count + active-agent count — when hiring + terminations move the agent roster (and they do, daily), the ribbon would lie. Rewired Apply.tsx to call landing_live_stats() via useQuery — same RPC pattern the LiveStatsCounterStrip + CTASection already use. Carrier + active-agent numbers now follow the database. Fallback values match LiveStatsCounterStrip so the ribbon never renders '0' or '...' on first paint. Forbidden-language guard extended with two new bans so the exact hardcoded strings can never silently re-ship. Sam-Reviews-Every-Application claim retained — that's true since PL-005 default-routes unknown referrers to Samuel James.",
  },
  {
    ts: "today",
    label: "Landing: killed SystemsSection + fixed fake-roster claim on closing CTA (website-integrity-bot)",
    detail: "Audit pass #9 found two more trust leaks on the public landing — same pattern as the VSL Test fix from pass #8. (1) SystemsSection (3-tab cluster of 12 generic SaaS feature cards) was wholesale corporate AI-larp that didn't drive an agent decision — purposeless UI per Check #2 of the Website Integrity contract. Pulled from Index.tsx, file deleted, lazy import removed. Landing now flows Benefits → Earnings → CareerPathway → ApexLeads → InstagramGrowth → CTA, all sections that show actual APEX systems and numbers. (2) CTASection's closing line previously claimed an inflated roster — APEX has ~95 active agents per landing_live_stats() RPC, not the four-digit number that was hardcoded. Replaced with the live number from the same RPC the LiveStatsCounterStrip uses ('{N}+ agents are running the APEX system right now') so the closing CTA can never overstate the roster again. (3) Headline rewritten to 'Ready to Run with the Standard?' — brand-bible voice instead of generic AI motivational filler. (4) Caught a real bonus leak in supabase/functions/send-followup-emails — the licensed-applicant follow-up email closed with an AI-tell motivational line; rewritten to brand-bible voice. (5) Extended check-forbidden-language.mjs with 13 new bans covering seamless-integration / inflated-roster / transform-X / elevate-X / unlock-your-potential / top-of-class / generic-SaaS patterns so none of these can silently re-ship, plus an explicit 'forbidden-allow' opt-in marker so receipts blocks can document prior bans without tripping the guard.",
  },
  {
    ts: "today",
    label: "Visual overhaul priority: CRM, Command Center, Hiring Pipeline, Seminar, and shared shell",
    detail: "Stripe was demoted out of the P0 lane. The visible website priority is now the app-wide visual overhaul: shared authenticated shell got the v4 command-room surface system, PageHeader lost the decorative orb treatment and now renders as a crisp operational command band, base cards gained stronger contrast/depth, CRM and Command Center got high-contrast headers + tighter KPI/filter/leaderboard surfaces, and Hiring/Seminar got rebuilt as readable operating boards with live status bands, upgraded metrics, denser filters, motion polish, and stronger empty/loading states.",
  },
  {
    ts: "today",
    label: "Landing: killed placeholder testimonial section (website-integrity-bot)",
    detail: "The success-story block on the public landing was wired to YouTube video YmlLSIwfGdE — oEmbed title fetched live came back as a VSL placeholder video by @SamuelJamesHQ. No named agent, no production number, no timeline — just a test clip masquerading as customer proof. Section pulled from Index.tsx, TestimonialsSection.tsx deleted (git preserves it for re-mount when a real recorded testimonial drops), and three placeholder phrasings added to check-forbidden-language.mjs so any future copy that names no agent gets blocked at build time. Public landing now flows BenefitsSection → EarningsSection → SystemsSection (real Apex data after audit pass #6) with zero fake proof in the middle.",
  },
  {
    ts: "today",
    label: "Deal posting: Apex → Discord + AgentLink in one shot (PL-074)",
    detail: "New post-deal edge fn. JWT-authed agent (or admin with agent_id override) POSTs a single JSON body and the fn (1) inserts a row into deals with status=submitted and source=apex_post_deal, (2) fires discord-webhook-notify with event=deal_closed so the deal hits #wins with milestone + streak detection, (3) mirrors to AgentLink via /deals POST when AGENTLINK_API_TOKEN is set (best-effort, never blocks the Apex write). Sam can now log a deal without leaving Apex.",
  },
  {
    ts: "today",
    label: "Landing stats: killed fake fluff numbers + wired real Apex counts (website-integrity-bot)",
    // forbidden-allow: receipts entry references prior banned phrasings; guard skips this line
    detail: "Two surgical fixes on apex-financial.org public landing. (1) SystemsSection dropped the fabricated '92% of agents report increased production / 14.3 hours saved / 3x faster onboarding' stat banner — those were unverifiable marketing larp that failed Sam's real-data-only rule. Section keeps the feature grid + Powered-by-APEX badge; the lying stats are gone. (2) CareerPathwaySection's four-card stat banner ('Premium / Lead Volume / Carriers / Active Agents') now pulls active_agents + carriers_partnered from landing_live_stats() RPC instead of lead_counter (which counted LEADS, not agents — mislabel), and the hardcoded carrier-count inflation (reality: 22) is replaced with the real number. Cards fall back to the canonical 95/22 if the RPC lags, so they never render '0' or '...' on first paint. Active Agents tile keeps the live-pulse dot + AnimatedCounter — but now powered by truth.",
  },
  {
    ts: "today",
    label: "Leaderboard activity: counts ReadyMode dialer pages (PL-053)",
    detail: "Activity board's 'primary' score was presentations + referrals + hours_called from daily_production only. Now ALSO adds 1 activity unit per ReadyMode dialer call (readymode_dialer_calls.call_started_at in window). Counter graceful-falls-back to daily_production when the dialer table lags — no breakage. As soon as the readymode-ingest fn flows calls in, dialer pages add to the activity score on every leaderboard tab.",
  },
  {
    ts: "today",
    label: "Sidebar surgery: Offers → CRM, AgentLink → bottom, Hiring Pipeline → Production (PL-034/035/036)",
    detail: "Three nav moves Sam asked for. (1) Offers no longer lives buried in Admin — moved into CRM next to Lead Center / Aged Leads so managers+agents browsing leads see package offers in the same group. (2) AgentLink Sync demoted to the bottom of Admin (just above Setup) — it's not daily-use. (3) Hiring Pipeline surfaced into PRODUCTION (was buried mid-RECRUITING) so it's visible at the top of nav for admins/managers. No duplicate listings.",
  },
  {
    ts: "today",
    label: "CRM segments: Live + Below $20k + Needs Follow-Up rewired (PL-055)",
    detail: "Three segments on /dashboard/crm were either too strict or empty: (1) Live filtered monthlyALP>=20000 and only stages live+evaluated — agents with <$20k production were hidden even though they ARE live; dropped the floor, expanded stages to in_field_training+evaluated+live+below_10k, all licensed non-deactivated/inactive agents now surface. (2) Below $20k used stage='below_10k' (0 agents have it as enum); replaced with the same stage set + monthlyALP < 20000 ALP-threshold filter. (3) Needs Follow-Up was 'uncontacted 6+ days'; now ALSO catches licensed low-producers (monthlyALP < $10k) per Sam's '<$10k/15d' spec, sorted lowest ALP first. Applied section's filter (stages=['applied']) is correctly wired — segment is empty because new-hire path skips that enum, not a bug in this page.",
  },
  {
    ts: "today",
    label: "Inbox: Push out to all (bulk-blast campaign button) — PL-069",
    detail: "Sam needed it this week. New 'Push out to all' button (emerald, top-right of /admin/inbox) opens a dialog with three campaigns: Reapply blast (warm 30d), Seminar invite blast (RSVPs last 14d), and Unlicensed outreach (cold + dormant unlicensed). Dry-run is default-on with audience count + JSON preview; live send shows a rose warning + 'SEND LIVE' button. Each campaign calls the matching existing edge fn (send-reapply-blast / send-seminar-invite-blast / send-bulk-unlicensed-outreach) which already handle dedupe via notification_log.metadata.campaign. Toast on success and auto-refreshes the inbox 1.5s later so Sam sees the audit rows land.",
  },
  {
    ts: "today",
    label: "Comp Tiers: 36 ghost-active agents removed (PL-075)",
    detail: "CompTiersSettings only filtered by is_deactivated=false + status='active'. 36 agents marked is_inactive=true were still listed because the third flag wasn't gated. Added .eq('is_inactive', false) so only the truly active roster shows in the comp editor.",
  },
  {
    ts: "today",
    label: "Calendly webhook → seminar + manager-call sync (PL-058)",
    detail: "New calendly-webhook edge fn ingests invitee.created and invitee.canceled events from Calendly. Classifies by event slug: seminar URLs → upsert into seminar_registrations + stamp applications.seminar_date / seminar_registered_at; 1on1/manager URLs → set applications.test_scheduled_date; exam URLs → set applications.exam_scheduled_at. Cancellations clear the same fields. Auth: shared secret in ?secret= query param + optional HMAC-SHA256 signature verification when CALENDLY_SIGNING_KEY is set. Sam subscribes at calendly.com/integrations/api_webhooks pointing at the function URL.",
  },
  {
    ts: "today",
    label: "Pre-licensing: manager downline + custom date range (PL-061)",
    detail: "Two changes on /dashboard/pre-licensing. (1) Recruit managers (non-admin) now see only their own recruits — student list filters to students whose assigned_agent_name or hiring_manager_name matches the manager's downline (resolved via useMyDownline → agents.display_name + profiles.full_name). Sam sees everything as before. Header badge shows 'your downline' tag for managers. (2) Filter strip gained a date-enrolled range picker (from/to date inputs + clear button), applied alongside the existing search / section / health filters.",
  },
  {
    ts: "today",
    label: "Pre-licensing green-bars headache fixed (PL-062)",
    detail: "Back-to-back green progress bars were unreadable. Each row now has alternating zebra tint (bg-card/60 ↔ bg-card/30), a colored left-border accent matching the health bucket, +12px row spacing (space-y-2 → space-y-3), and the Progress bar fill is now health-driven: completed=emerald, almost_done=cyan, in_progress=primary, just_started=amber, stalled=rose. No more wall of identical green.",
  },
  {
    ts: "today",
    label: "Pre-Licensing list is readable again (PL-062)",
    detail: "The /dashboard/pre-licensing student list was a wall of back-to-back identical-green progress bars — Sam called it 'a headache.' Three changes ship together: (1) row spacing bumped from space-y-2 (8px) to space-y-3 (12px) so rows breathe, (2) zebra striping via alternating bg-card/60 vs bg-card/30 + a left-border colored by health bucket so completed (emerald) / almost done (cyan) / in progress (primary) / just started (amber) / stalled (rose) each have a visible left-edge stripe, (3) the Progress bar's indicator color is now driven by health bucket via Tailwind arbitrary [&>div]:bg-X selectors so the variance between rows reads at a glance. Scanning 100+ students is no longer a sea of green.",
  },
  {
    ts: "today",
    label: "Course-paid → auto-signup for next seminar (PL-057)",
    detail: "When an applicant pays for the pre-license course, applications.course_purchased_at flips NULL→NOT NULL. New trigger fires: fn_next_seminar_date() picks the next Wed 7pm or Sat 10am CT (≥6h lead time), stamps applications.seminar_date + seminar_registered_at, inserts seminar_registrations with source='auto_course_paid' (dedupe by email+date), then pg_net→notify-seminar-signup edge fn emails the assigned manager (or Sam fallback) with the booked date + applicant contact. Closes the leak where managers forgot to manually move course-paid applicants onto a seminar.",
  },
  {
    ts: "today",
    label: "\"Add to Seminar\" quick action on agent pages (PL-056)",
    detail: "New <AgentActionsMenu /> reusable component (src/components/agent/AgentActionsMenu.tsx) ships an 'Add to Seminar' button with a Popover that lists the next 4 Apex seminar dates (Wed + Sat, computed in America/Chicago, no DB round trip). Click a slot → calls register_for_seminar RPC with the agent's first name + last name + email + phone + license_status, which atomically updates the agent's applications row AND creates a seminar_registrations entry tied to that application. Mounted today on /dashboard/agents/:id (AgentDetail header) — every agent profile page now has a one-click path from 'view agent' → 'in next week's seminar.' Empty-email and missing-phone are guarded with a clear error + the menu hides if the agent has no email on file. Reusable: same component drops into CRM, pipeline cards, dashboard popovers, call-center contacts in follow-up PRs without re-implementing the picker logic.",
  },
  {
    ts: "today",
    label: "Client detail drilldown — full AgentLink mirror (PL-046)",
    detail: "Per-client page at /dashboard/clients/<id> renders 9 sections from agentlink_clients + agentlink_beneficiaries + agentlink_contracts: Status & owner · Policies (carrier/policy#/face/premium + every contract row) · Financials (incomes, expenses, surplus, qualified/non-qualified, bank) · Needs analysis (objectives, retirement goals, legacy estate) · Beneficiaries · Referral source · Schedule (callback, next action, best time, timezone, channel) · Client care (occupation, address, DOB, physician, medical notes) · Notes (communication + reminders). DNC/DNE/DNT badges in header. Tap-to-call + email actions. Admin sees raw AgentLink payload. Pipeline rows are now clickable rows → cursor-pointer + onClick navigate. Closes PL-046.",
  },
  {
    ts: "today",
    label: "AgentLink sync prompt for agents without data (PL-047)",
    detail: "New <AgentLinkConnectionPrompt /> component embedded at the top of /dashboard/book-of-business and /dashboard/agent-pipeline (Client Pipeline). For non-admin users who have no agents.insuracloud_api_token + no agents.insuracloud_user_id set, surfaces a blue-tinted card with a one-tap 'Sync your AgentLink' CTA that deep-links to /dashboard/agent-link-sync. Auto-hides for admins (they use the agency-wide cookie path) and for already-connected agents so the prompt doesn't nag once configured. Reusable — same component drops into AgentCommandDashboard / MyDeals / any agent-facing surface that depends on AgentLink data.",
  },
  {
    ts: "today",
    label: "Recruiting stats now treat Sam James == Samuel James (PL-052)",
    detail: "Two agent rows (SJAMES01 with profile, SJAMES02 orphan duplicate) were splitting Sam's recruiting numbers across leaderboards. New canonical_agent_id column on agents + v_agent_canonical_map view lets every UI roll up duplicate identities to one row. Leaderboard.tsx (Production / Recruiting / Referrals / Activity boards) now canonicalizes before grouping — Sam's 4 recruiter apps + 279 assigned apps now show as one identity instead of two.",
  },
  {
    ts: "today",
    label: "Agent dashboard upgraded to true command center (PL-040)",
    detail: "Two new agent-facing cards above the recent-deals row: (1) Region Peers — top 5 MTD producers whose license_states overlap with yours, current agent highlighted with primary ring + 'you' label so you know exactly where you stand in your actual market not just agency-wide. (2) Chargeback Ledger — pulls v_agent_charge_rollup, shows clean-state with emerald check when total_charges=0, escalates to rose-border at-risk count + dupe count + last_charged_at + link to /dashboard/charges-audit. Together with the existing Commission Projected KPI tile + Next Step Card + Next Action panel, the agent dashboard now hits all 4 PL-040 must-haves (projected income, upcoming chargebacks, next-best-action, top-recruit/top-sales in own region).",
  },
  {
    ts: "today",
    label: "Chargebacks 30d verified + consolidated view (PL-024)",
    detail: "Sam: 'chargebacks 30d showing 0 — verify accuracy.' Audited deals.chargeback_at (0), lead_purchases.refunded_at (0), stripe_subscription_events.event_type ILIKE '%dispute%' (0). The dashboard's 0 is REAL, not a bug. Future-proofed: new v_chargebacks_30d UNIONs all 3 chargeback signal sources so when the first chargeback lands via Stripe dispute OR lead-pack refund OR a manual deals.chargeback_status flag, the KPI catches it regardless of path. v_ceo_command_center.chargebacks_30d now reads from the consolidated view. Migration 20260520020000 applied live + committed.",
    commit: "3f2532ca",
  },
  {
    ts: "today",
    label: "Book of Business: role-based scoping + period chargeback widget (PL-041 + PL-043)",
    detail: "PL-041 (Sam → entire agency, Manager → downline, Agent → own book) was already wired via agentScopeIds + my_downline_agent_ids RPC and the ProtectedRoute is open to all authed users — confirmed end-to-end so it's no longer 'locked by command center.' PL-043 adds a dedicated Chargebacks card (rose-tinted) above the filter row with a real date-range picker: defaults to last 30 days, plus 1-click 30d/90d/YTD presets and from/to date inputs. The card runs a separate Postgres query against deals (charged_back across policy_status_standard / pipeline_stage / status) filtered by status_updated_at within the chosen window, respecting the same role scope, and surfaces count + monthly-lost + ALP-lost totals + a collapsible per-policy list (client, agent, carrier, date, $/mo, $/ALP). Replaces the silent 'last 7 days = 0' that always returned nothing because chargebacks don't cluster that recently.",
  },
  {
    ts: "today",
    label: "Today page actuals are Sam-excluded + at-risk widgets ship names (PL-037 + PL-038)",
    detail: "The 'Actuals' number on /dashboard/today was pulling ALL submitted+active deals including Sam's own — so the displayed total drifted from the agency-only truth on the leaderboards. Switched every deal query (today/week/month/prior-week) to the canonical VALID_DEAL_STATUSES + .not('agent_id','in', SAM_AGENT_IDS) filter so the actuals match the metric-truth layer used by /admin/audit. The duplicate 'Actuals' panel below the KPI strip (was just restating weekAlp + pipeline) is now an 'At-Risk Agents (Last 7d)' card with two color-coded buckets — 'Profile not activated' (portal_password_set=false) and 'Live 7d · no sale' (zero posted deals in 7d) — each showing the top 3 names + a '+ N more' chip so Sam can act before they ghost. Refresh button is now wired to useQuery's refetch() with a 'last refresh · 2 min ago' relative timestamp next to it.",
  },
  {
    ts: "today",
    label: "Recent Hires panel on /dashboard (PL-017)",
    detail: "Just-hired agents with 0 production were invisible — the agency view's top-producers panel filters deals_mtd > 0 and there was no recent-hires surface anywhere. New 'Just hired · last 14 days' card on the agency dashboard reads v_recent_hires (excludes deactivated/inactive/ghost rows) and shows name, agent code, manager, days on team, and onboarding stage. 18 recently-hired agents now visible.",
  },
  {
    ts: "today",
    label: "Licensed-hires tile is now date-range aware (PL-020)",
    detail: "The 'Licensed' stat on /dashboard's Recruiting Pipeline was a single fixed all-time count. Replaced with a LicensedHiresRange tile that defaults to 'This month' and pops out a presets menu (This month / Last 30 days / This quarter / This year / All time) + a custom-range date picker. Counts applications by licensed_at between the chosen start/end dates so Sam can answer 'how many did we license this month?' directly from the dashboard.",
  },
  {
    ts: "today",
    label: "Role preview switcher: Sam-only + draggable (PL-015)",
    detail: "Top-right Agent/Manager/Admin view switcher was visible to every admin user — confusing on-staff admins who thought it was a feature. Restricted to Sam's email only (sam.com593@gmail.com / sam@apex-financial.org). Container is now framer-motion draggable with localStorage persistence (apex.role-preview-bubbles.pos) + viewport clamping so it can never get dragged offscreen. Drag handle (GripVertical icon) added on the left of the strip; tooltips updated to 'Drag to move · Sam-only role preview'. Click-vs-drag isolation via a ref-guarded onClickCapture so a drag doesn't accidentally toggle a role.",
  },
  {
    ts: "today",
    label: "Login: forgot-password landing page + phone-OTP end-to-end (PL-014)",
    detail: "Forgot password now reads the email via react-hook-form watch() (was racing with document.getElementById), hits the send-password-reset edge fn first, then falls back to native supabase.auth.resetPasswordForEmail() with redirectTo=/reset-password (always-on path). NEW /reset-password page handles the Supabase magic-link redirect: waits up to 3s for the SDK to exchange ?code= for a session, then prompts for + confirms a new password via supabase.auth.updateUser({password}), then bounces back to /login. Invalid/expired links show a clear error + Back-to-sign-in CTA. Phone OTP got a real E.164 normalizer with min-length 10-digit guard, deduplicated send+verify normalization, and a clear toast when Supabase Auth phone provider isn't configured ('Phone sign-in isn't configured yet — use email + Forgot password instead') so the button doesn't silently no-op. Backlog item PL-014 (P0) closed.",
  },
  {
    ts: "today",
    label: "Telegram bot: cloud-native nudge drain + inactivity sweep",
    detail: "telegram-drain edge fn now runs on Supabase pg_cron every 5 min — Telegram nudges fire 24/7, no laptop dependency. fn_telegram_queue_inactivity_nudges sweeps every 15 min for stuck stages (lobby >48h, applied_paid >5d, pre_license >7d) and queues nudges idempotently. Local Mac daemon stays as backup/dev. Same dedupe + ON CONFLICT guards across both paths.",
  },
  {
    ts: "today",
    label: "Telegram bot: admin broadcast button (one-click queued sends)",
    detail: "/dashboard/admin/telegram-bot now has a Broadcast tab — pick a stage filter (Lobby / Applied paid / Studying / Hired / etc.), pick a template, hit send. Inserts batched rows into telegram_scheduled_messages with per-broadcast dedupe so re-clicks within the minute no-op. Drain delivers within 5 min.",
  },
  {
    ts: "today",
    label: "Telegram bot: seminar reminders parallel-send",
    detail: "seminar-reminder-tick now queues T-24h and T-1h Telegram nudges alongside the existing email path. Matches telegram_users by email. Try/catch isolated so email send is never blocked by Telegram side.",
  },
  {
    ts: "today",
    label: "Next Step Engine v3 — compliance + auto-dispatch + funnel health",
    detail: "All 18 stage templates now CAN-SPAM compliant (unsubscribe link → /unsubscribe?u={{email}} pre-checked against email_unsubscribes pre-send) + TCPA STOP language on every SMS. Dispatcher gained agentlink_agents fallback for agents with empty profile rows (recovered 7 of 10 hard-fails). pg_net INSERT trigger on next_step_messages fires next-step-dispatch immediately — 0-60 min cron-nudge latency collapsed to seconds. New /admin/next-step/funnel-health page surfaces conversion-to-next-stage % + median time-in-stage + biggest-leak callout + 24h outbound message breakdown.",
  },
  {
    ts: "today",
    label: "Landing performance trimmed",
    detail: "Public home no longer pulls Framer Motion for the hero, nav, live counters, recent hires, or landing sections. CSS keyframes keep the polish while the motion runtime stays off the first-load path, with vendor chunks grouped tighter.",
  },
  {
    ts: "today",
    label: "Apply continue fixed + duplicate referral removed",
    detail: "Apply is back to 4 steps: agent credit is captured before submit, Continue Application routes straight to the success page, and manual referrers persist without a second referral screen.",
  },
  {
    ts: "today",
    label: "Apply submission unblocked",
    detail: "Applicants were stuck on step 5 with a red toast. Treat ALREADY_CLAIMED as success — they now land on /apply/success cleanly.",
    commit: "5e11e11e",
  },
  {
    ts: "today",
    label: "Unclaimed Leads card + XCEL Stalled card",
    detail: "319 status='new' applicants + 22 stalled pre-licensing students now live above this banner. One-tap Claim button.",
    commit: "b8324f4a",
  },
  {
    ts: "today",
    label: "SocialMediaBot crash fixed",
    detail: "21 React #31 crashes in 24h from passing icon components into ReactNode slots. All 5 EmptyState calls patched.",
    commit: "b0158068",
  },
  {
    ts: "today",
    label: "Live trust ribbon on /apply",
    detail: "Emerald-pulse ribbon at the top of /apply now pulls carrier + active-agent counts from landing_live_stats() RPC instead of the hardcoded numbers it shipped with — same fake-success pattern that just killed the CTASection lie about the roster size. White-shimmer skeleton also killed.",
    commit: "a79ee8f7",
  },
  {
    ts: "today",
    label: "Live counter strip on landing",
    detail: "3 animated count-up tiles below the public hero — Active agents · Apps · Carrier partners.",
    commit: "eb3594a9",
  },
  {
    ts: "yesterday",
    label: "Operating-system audit + 3 DB moves",
    detail: "v_xcel_pipeline view created (was missing — runtime-errored every load). Auto-advance trigger fixed 10 stuck licensed applicants. v_unclaimed_new_apps view + claim RPC.",
    commit: "ca3034d4",
  },
  {
    ts: "yesterday",
    label: "Tier-4 visible fixes",
    detail: "Killed white VSL screen, producing-agents 30d→10d, Activity+Referrals widget removed, Agency Command top widget rebuilt with gradient + amber-pulse live badge (no more green-on-green).",
    commit: "88c04ada",
  },
  {
    ts: "yesterday",
    label: "Tier-1/2/3 punch-list",
    detail: "License gate /schedule-call, IG Growth Buy CTA, Gold/Platinum auth-redirect, Sam-James name unify, Watch-demo gone, sidebar surgery (Conduct/Strikes/Accounts/Purchase Leads removed), Agent Pipeline → Client Pipeline rename, Notifications to bottom, Login white-bg killed.",
    commit: "0fdde41d",
  },
];

export function WhatShippedTodayBanner() {
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/12 via-primary/5 to-transparent p-4 sm:p-5 shadow-[0_0_60px_hsl(168_80%_50%/0.12)]"
    >
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-primary flex items-center justify-center shadow-[0_0_30px_hsl(168_80%_50%/0.4)] flex-shrink-0">
          <Rocket className="h-5 w-5 text-zinc-950" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Sparkles className="h-3 w-3" /> Shipped — receipts since you logged in last
          </div>
          <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight">
            {SHIPPED.length} platform changes live · {SHIPPED.filter(s => s.ts === "today").length} pushed today
          </h2>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="relative mt-4 space-y-2 overflow-hidden"
          >
            {SHIPPED.map((item, i) => (
              <motion.li
                key={item.commit ?? i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 rounded-xl border border-emerald-500/15 bg-zinc-900/40 px-3 py-2"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">{item.ts}</span>
                    {item.commit && (
                      <a
                        href={`https://github.com/samcom593-creator/rebuild-brighten-sparkle/commit/${item.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                      >
                        {item.commit}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{item.detail}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
