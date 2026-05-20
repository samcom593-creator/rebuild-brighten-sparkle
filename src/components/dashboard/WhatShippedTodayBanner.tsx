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
    label: "Landing stats: killed fake fluff numbers + wired real Apex counts (website-integrity-bot)",
    detail: "Two surgical fixes on apex-financial.org public landing. (1) SystemsSection dropped the fabricated '92% of agents report increased production / 14.3 hours saved / 3x faster onboarding' stat banner — those were unverifiable marketing larp that failed Sam's real-data-only rule. Section keeps the feature grid + Powered-by-APEX badge; the lying stats are gone. (2) CareerPathwaySection's four-card stat banner ('Premium / Lead Volume / Carriers / Active Agents') now pulls active_agents + carriers_partnered from landing_live_stats() RPC instead of lead_counter (which counted LEADS, not agents — mislabel), and the hardcoded '50+ Carriers' (reality: 22) is replaced with the real number. Cards fall back to the canonical 95/22 if the RPC lags, so they never render '0' or '...' on first paint. Active Agents tile keeps the live-pulse dot + AnimatedCounter — but now powered by truth.",
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
    detail: "Emerald-pulse ribbon at the top: '22 carriers · 95 active agents · Sam reviews every application'. White-shimmer skeleton killed too.",
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
