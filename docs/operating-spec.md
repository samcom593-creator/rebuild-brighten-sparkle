# APEX FINANCIAL · 125 · DASHBOARD ATLAS — v4 · CANONICAL OPERATING SPEC
*Written from scratch 2026-06-14 after Sam's two-part course correction:*
*(1) **LESS IS MORE** — every nav point must earn its slot, no clutter, audience-tiered.*
*(2) **BILLION-DOLLAR AESTHETIC** — what remains must look revolutionary, premium, smooth.*

> **Hold the Standard. Average is the disease.**

---

## §0 · The Two Philosophies (read first, always)

This spec rests on two non-negotiable rules. Every PR, every dashboard, every sidebar item is judged against BOTH.

### §0.1 · LESS IS MORE (the editorial rule)

> *"This is just be perfect. Use actual logic. For a high-level agency."*
> *"It should be less than half of what we had."*
> *"Make this shit actually practical."*
> — Sam, 2026-06-14

- Every sidebar entry must answer: "Who uses this daily? What problem does it solve right now?"
- If a page is empty, doesn't load real data, or is "for show" — it gets killed or hidden.
- No screen ships with blank space. Empty space is wasted recruiting leverage.
- Applications and Leaks are always the highest-priority surface. Everything else is supporting.
- Three audience tiers, in order: **Owner (Sam) · Manager (franchise) · Agent (producer)**. Each tier sees only what THAT tier acts on.

### §0.2 · BILLION-DOLLAR AESTHETIC (the visual rule)

> *"Make it look like a million or maybe a billion dollar software."*
> *"Very, very high level of expertise at AI technology."*
> *"Revolutionary. UI effects, sound effects, the bubbles, etcetera. Still extremely smooth."*
> — Sam, 2026-06-14

- The pages that survive the editorial cut must be **gorgeous**. Premium materials, not commodity components.
- **Motion budget**: every interactive element transitions at 180–220ms cubic-bezier. Page mounts use a 250ms fade+rise. No instant jumps. No janky reflows. No animate-pulse on Badges (Sam's permanent ban).
- **Glass + glow restraint**: glassmorphism allowed on hero panels only. 1 glow accent per page max. No rainbow.
- **Sound**: subtle UI sounds on (a) deal posted to feed, (b) lead picked up, (c) major milestones. Library: `/sounds/`. Never on routine clicks. Toggle in `/dashboard/settings`.
- **AgentLink-data-depth**: every panel that could pull richer AgentLink data should. Density beats sparseness — but density is not clutter, it is **information per pixel**.
- **AI-tech feel**: subtle agent-status "🟢 LIVE" dots, "as of X min ago" timestamps, real-time refetch pulses (NOT badge pulses), Ask Apex AI dock always one keystroke away.

### §0.3 · The conflict-resolution rule

When LESS IS MORE and BILLION-DOLLAR conflict — **less wins on COUNT, billion wins on QUALITY**. We ship fewer pages, but the ones we ship are world-class.

---

## §1 · Audience Tiering (the 3-tier mental model)

### §1.1 · Owner (Sam)
- Single user. The whole agency reports up to this view.
- Daily flow: glance at leaks · check apps · respond to commitment requests · confirm production · push the next move.
- Owner-only surfaces: Finances (CFO snapshot), Builders + Managers downline matrix, Admin Settings, Whales (high-value applicants).
- Sam's view aggregates ALL franchise data. He sees totals, leaks across all sub-trees.

### §1.2 · Manager (franchise operator)
- Multiple users (current Apex managers + downline-builder upgrades).
- Daily flow: check their funnel · convert their inbound · grow their downline · review their team's production.
- Manager surfaces: My Team, Production (their tree), Recruiting Inbox (their sub-tree), Commission Grids, Carriers, Scripts.
- Manager view is ALWAYS scoped to their downline. They never see other manager's data unless Sam explicitly grants.

### §1.3 · Agent (producer)
- Largest user count.
- Daily flow: take inbound calls · use scripts · pull quotes mid-call · post wins · review their own production.
- Agent surfaces: Inbound Leads, Calls Today, Production, Business Analytics (personal), Scripts, Carriers, Commission Grids, Book of Business.
- Agent view is ALWAYS scoped to their own data. Cross-agent leaderboards are aggregate-only.

---

## §2 · Sidebar (the new map · post-2026-06-14 slim)

### §2.1 · Owner (Sam) sidebar
**PRIMARY (5 items · daily flow)**
1. Command Center · `/dashboard`
2. **Applications** · `/dashboard/applicants` ← hoisted (Sam's directive)
3. Inbound Leads · `/dashboard/inbound-leads`
4. Calls Today · `/dashboard/calls-today`
5. Contracts · `/dashboard/contracts`
6. Production · `/dashboard/leaderboard`

**MORE (14 items · weekly/leak-detect cadence)**
- Recruiting Inbox · Recruiting Funnels · Recruiting Tracker · Whales
- Book of Business · Business Analytics
- Finances · CFO · Commission Grids
- Team Analytics · Builders + Managers
- Announcements · Scripts · Carriers
- Admin

### §2.2 · Manager (franchise) sidebar
**PRIMARY (5 items)**
1. Command Center
2. **Applications** ← hoisted
3. Inbound Leads
4. Calls Today
5. My Team
6. Production

**MORE (9 items)**
- Recruiting Inbox · Recruiting Funnels · Recruiting Tracker
- Book of Business · Business Analytics · Commission Grids
- Announcements · Scripts · Carriers

### §2.3 · Agent (producer) sidebar
**PRIMARY (5 items)**
1. Command Center
2. Inbound Leads
3. Calls Today
4. Production
5. Business Analytics
6. Announcements

**MORE (6 items)**
- Book of Business · Scripts · Carriers · Commission Grids
- Apex Course · Licensing

### §2.4 · KILLED from all sidebars (live routes survive · hidden from nav)
- Calling Cards · Client Marketing · My Landing Page (settings) · Annuity Training · Agent Handbook · Help Center · Needs Analysis · Quoter · Producer Profile · Transfer Requests · Calendar duplicate · Social tab · Content tab

These routes still exist for deep-linking and for the agents who genuinely use them, but they are NOT shown in main nav. They're accessible via:
- Avatar dropdown (Producer Profile, Calling Cards, My Landing Page)
- Help icon footer (Help Center, Handbook, Annuity Training)
- In-call dialer dock (Needs Analysis, Quoter)
- Admin settings hub (Transfer Requests, Calendar, Social, Content)

---

## §3 · The Front Dashboard (`/dashboard`) · what loads first

After Sam's 2026-06-14 reorg, the Owner Command Center renders in this exact order. **No blank space. Every band earns its pixels.**

1. **PageHeader** — eyebrow + title + period switcher + CEO panel link
2. **§A · LIVE LEAKS strip** ← NEW · reads `v_cfo_snapshot` every 5 min
   - Ghost AP at risk · ICA paid stuck · Walked commission · Dup charges open · Idle active agents · Sync status (ICA + AgentLink)
   - Rose-tinted border. Clickable to `/dashboard/finances`.
3. **§B · ACTIVE APPLICATIONS · LIVE panel** ← NEW · reads `applications` table every 60s
   - 25 newest active applications · 3-col grid · stage badge color-coded
   - Sam's mandate: applications are always the highest-priority surface
4. **4 KPI Tiles** — Agency AP · Deals · Producers · Licensed hires (period-aware)
5. **Trend chart + Top producers leaderboard** (2:1 grid)
6. **Tabbed strip** — Pipeline · Managers · Just Hired · Activations
7. **AgentLink summary footer** — whole-book totals from `v_agentlink_book_truth`

Total zones: 7 (down from 11 pre-cleanup). Density per zone is HIGHER than before, not lower.

---

## §4 · Truth Hierarchy (DO NOT VIOLATE)

When numbers conflict, this is the order:

1. **AgentLink** (`agentlink.insuracloud.ai`) — carrier system of record. Field commission computed here. Never override.
2. **`agentlink_deals_snapshot`** — 30-min synced mirror. Single canonical query target for production. NEVER `deals` legacy table.
3. **`v_*` views over the snapshot** — pre-joined. Use in React queries. Don't recompute in JS.
4. **CFO bot snapshot (`v_cfo_snapshot`)** — financial-health rollup. Authoritative for ghost-AP, idle agents, sync status, mentorship revenue.
5. **The dashboards** — projections. They render data; they never produce it.

If dashboard says X and AgentLink says Y, dashboard is wrong. Fix sync first.

**Phoenix tz rule**: every "today/week/month" query anchors to `(NOW() AT TIME ZONE 'America/Phoenix')::date`.
**BETWEEN rule**: date windows use `BETWEEN start AND today`, never `>=`. (Past bug: $117K phantom revenue.)

---

## §5 · Tech Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind + Radix UI. `npm run build` <3s. Chunks are content-hashed; **NEVER bump `BUMP_VERSION`** per commit.
- **Backend**: Supabase `xrzweoneiieddzxogewk` (us-east-1). PostgreSQL + RLS. Edge functions deno-checked locally before deploy.
- **Auth**: `profiles.user_id = auth.uid()`. `agents.user_id = auth.uid()`. `agents.al_user_id` = AgentLink ID. 61/156 backfilled 2026-06-13. Remaining 95 → `v_agents_missing_al_user_id` view.
- **bot-sql**: edge fn `/functions/v1/bot-sql`. Token `~/.config/apex-creds/bot-sql.token`. POST body `{"query": "..."}` (NOT `{"sql": ...}`).
- **Build gates**: `npx tsc --noEmit` = 0, `npm run build` ✓, route-smoke 26/26 healthy.
- **Commits**: NEVER `--no-verify` unless authorized. Always `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## §6 · Visual System (the billion-dollar layer)

### §6.1 · Palette (unchanged from v3 · still the law)
- **slate** · surfaces, neutral text, borders
- **amber** · featured / Announcements / admin highlights · the APEX accent
- **emerald** · money / success / closed deals · positive metrics
- **rose** · anomalies / errors / walked commission / ghost AP / leaks
- **white / black** · backgrounds (light/dark)

No other top-level palettes on dashboards. Pink IG, indigo accent secondaries only on source data.

### §6.2 · Typography
- Headers: Tailwind `font-bold` size 15–22 by hierarchy.
- Numerals: **`tabular-nums` EVERYWHERE**. Non-tabular = unprofessional.
- Body 12–14. Uppercase labels 11. `tracking-wider` ONLY on uppercase labels and eyebrows.

### §6.3 · Motion budget (the smoothness rule)
- Standard transition: 180ms cubic-bezier (`transition-base` utility).
- Page mount: 250ms fade+rise (`page-enter` utility on top-level wrapper).
- Hover lift: `translate-y-0.5` + `shadow-lg` on cards.
- **NEVER `animate-pulse` on Badges**. Permanent ban.
- Skeleton loaders on initial mount, NEVER on refetch.
- Refetch indicator: a subtle 1px progress bar at top of refreshing card (NOT the whole card pulsing).

### §6.4 · Glass + glow (restraint)
- Glassmorphism (`backdrop-blur-xl bg-white/[0.04]`) allowed on hero panels ONLY.
- 1 glow accent per page max (`shadow-[0_0_40px_hsl(var(--primary)/0.15)]` on the page's single most important card).
- Never combine glass + glow on the same element.

### §6.5 · Numbers + status
- Currency compact: `$1.2K` / `$1.5M`. Tables: `$1,234,567`.
- Percentages: 1 decimal unless precision matters.
- Negative deltas rose, positive emerald, zero slate.
- **Never `Unknown` user-facing** — use `"—"` or hide the row.
- "LIVE" indicators use a 2-frame dot pulse (NOT animate-pulse) and "as of X min ago" timestamp.

### §6.6 · Sound design (subtle · toggleable)
- Library at `/sounds/`:
  - `deal-posted.mp3` — celebratory swell, 800ms, plays in News Feed when a new culture_event arrives
  - `lead-picked-up.mp3` — short click + chime, plays in Inbound Leads cockpit when an agent claims a lead
  - `milestone.mp3` — long rise, plays when a major recruiting milestone fires (new hire · 100k month)
- All sounds normalized to −14 LUFS. Default OFF. Toggle in `/dashboard/settings`.
- NO sound on routine clicks, navigations, or refetches.

### §6.7 · Voice
- Direct · faith-aware (Christian · never performative) · anti-soft.
- BANNED: "delve" · "tapestry" · "in the realm of" · "it's not just X, it's Y" · em-dash spam.
- Sales copy: Brand Bible alignment. "Hold the Standard. Average is the disease."
- Never use Braxton for content. **SACRED**.

---

## §7 · Production Accuracy Contract

Every number satisfies ALL 7 rules:

1. Phoenix tz: `(NOW() AT TIME ZONE 'America/Phoenix')::date`
2. BETWEEN start AND today (NEVER `>=`)
3. `agentlink_deals_snapshot` source (NEVER `deals` legacy)
4. Pre-built `v_*` views for joins (NEVER recompute in JS)
5. Null-safe: render `"—"` not `"null"` or `"Unknown"`
6. Idempotent: re-rendering same row never changes value
7. Tabular: every numeric column has `tabular-nums`

Wrong-number debug (5 checks):
1. Phoenix tz applied?
2. BETWEEN not `>=`?
3. View vs raw table?
4. `al_user_id` join (61/156 backfilled · `v_agents_missing_al_user_id`)?
5. Cron stale (`v_cfo_cron_health`)?

---

## §8 · Pages We Kept · Why Each Earned Its Slot

This is the editorial defense for every page that survived the 2026-06-14 cut. If a page is not on this list, it's killed or hidden.

### Owner (Sam) views — surfaces only Sam touches
| Page | Why kept |
|---|---|
| **Command Center** `/dashboard` | Sam's home view · LEAKS + APPLICATIONS · everything ladders from here |
| **Finances · CFO** `/dashboard/finances` | Ghost AP · walked · stuck · idle · sync · the daily leak audit |
| **Builders + Managers** `/dashboard/managers` | Franchise downline matrix · Sam's leverage view |
| **Whales** `/dashboard/whales` | High-value applicants needing personal touch from Sam |
| **Admin** `/dashboard/command` | The settings hub that aggregates everything below daily flow |

### Recruiting flow — where the agency grows
| Page | Why kept |
|---|---|
| **Applications** `/dashboard/applicants` | Sam's #1 priority · hoisted to PRIMARY · every role sees this |
| **Recruiting Inbox** `/admin/recruiting-inbox` | Where DMs and form submits land |
| **Recruiting Funnels** `/dashboard/recruiting-funnels` | Conversion drop-off analysis |
| **Recruiting Tracker** `/dashboard/recruiting-tracker` | Per-recruiter scorecard + leaderboard |

### Daily production — where the money happens
| Page | Why kept |
|---|---|
| **Inbound Leads** `/dashboard/inbound-leads` | The call cockpit · daily flow |
| **Calls Today** `/dashboard/calls-today` | Today's dial sheet |
| **Contracts** `/dashboard/contracts` | Agent-side carrier request flow |
| **Production** `/dashboard/leaderboard` | Real-time deal stream + leaderboard |
| **Book of Business** `/dashboard/book-of-business` | 1278 deals · per-agent slice |
| **Business Analytics** `/dashboard/business-analytics` | Flagship · 10-tab strip · Trophy Cabinet · Recruiting tab |
| **Team Analytics** `/dashboard/team-analytics` | Downline production view |

### Reference (kept thin)
| Page | Why kept |
|---|---|
| **Carriers** `/dashboard/carriers` | 16 partner cards + contact + Best-For tags |
| **Scripts** `/dashboard/scripts` | 10 sales scripts · inbound/objections/recruiting/brand |
| **Commission Grids** `/dashboard/commission-grids` | 22 products × 4 health tiers · live FY% data |
| **Announcements** `/dashboard/announcements` | Pinned announcements + News Feed + Post a Deal |
| **Apex Course** `/course-catalog` | Lovable course content (agent training) |
| **Licensing** `/dashboard/pre-licensing` | Pre-license milestones |

### Hidden routes (not in nav · accessible via context)
| Page | Access path |
|---|---|
| Producer Profile `/dashboard/profile` | Avatar dropdown |
| Calling Cards `/dashboard/calling-cards` | Avatar dropdown |
| My Landing Page `/dashboard/landing-page` | Avatar dropdown (settings) |
| `/agent/:userId` (PUBLIC) | Direct link share · stays live for prospects |
| Agent Handbook `/dashboard/handbook` | Help icon footer |
| Help Center `/dashboard/help` | Help icon footer |
| Annuity Training `/dashboard/annuity-training` | Help icon footer |
| Needs Analysis `/dashboard/needs-analysis` | Dialer dock during call |
| Quoter `/dashboard/quoter` | Dialer dock during call |
| Transfer Requests `/dashboard/transfers` | Admin settings hub |
| Calendar `/dashboard/calendar` | Already in cockpit / inline |

---

## §9 · Anti-Bloat Checklist (run before adding ANY page)

Before adding a new page or sidebar item, answer ALL:

1. **Audience**: Owner · Manager · Agent · or all? If "all", probably wrong.
2. **Frequency**: Daily · weekly · monthly · rare? If "rare", it doesn't belong in nav.
3. **Replaces or duplicates**: Is there an existing surface that should absorb this instead of a new page?
4. **Data**: Is the data real, live, and meaningful? If empty on day-1, the page is mid.
5. **One-line purpose**: Can you write a single sentence explaining what action this page enables?
6. **Removal test**: If we ship this and nobody opens it for 2 weeks, can we delete it?

If any answer is shaky, the page does NOT ship in nav. It can ship as a deep-link-only route or as a sub-section of an existing page.

---

## §10 · Notification Discipline

**Sanctioned channels**
- **ntfy.sh** `sams-agent-yrkv9kbqp9e987nb` — phone push, "glance and act" alerts.
- **Telegram bot** `@ApexOnboardbot` chat `6018839640` — receipts, ship logs, rollups.
- **Poke** `https://poke.com/api/v1/inbound/api-message` — rich scrollable receipts.

**Banned**
- osascript Messages.app / Mail.app / Reminders.app (memory `feedback_avoid_macos_prompts`)
- Todoist (deprecated by Sam)
- Auto-draft emails (memory `feedback_no_email_drafts`) **SACRED**
- Manager-candidate pings (memory `feedback_no_manager_candidate_updates`)

**Cadence**
- Receipts on every meaningful commit
- End-of-day rollup
- NO heartbeat / "still here" noise

---

## §11 · Credentials Map

Everything Sam needs is on disk · stop asking him where it is.

| Service | Location | Notes |
|---|---|---|
| bot-sql token | `~/.config/apex-creds/bot-sql.token` | POST `{"query": "..."}` |
| bot-sql URL | `~/.config/apex-creds/bot-sql.url` | |
| Telegram bot | `~/.config/apex-creds/telegram-bot.token` | Chat `6018839640` |
| Poke | `~/.config/apex-creds/poke.token` | 90-day expiry |
| ntfy topic | memory · `sams-agent-yrkv9kbqp9e987nb` | |
| Supabase project | `xrzweoneiieddzxogewk` | us-east-1 |
| InsuraCloud | `~/.config/apex-creds/insuracloud.token` + `system_settings` | Header `x-api-key` |
| AgentLink cookies | `~/business-ops/insuracloud-token-harvester/harvest.mjs` | Re-harvest on expiry |
| Anthropic | `~/.config/apex-creds/anthropic.token` | |
| Stripe | `system_settings.mentorship_payment_links` | 4 live links |

All cred files `chmod 600`. Never read or expose in user-facing output.

---

## §12 · Communication With Sam

- Direct · terse · receipts-first. Memory `feedback_no_oversell.md`.
- Phone-friendly markdown: short paragraphs, bold one-liner lead-ins for multi-topic.
- Multi-channel notifications get a "ton-of-math" rollup per 2026-06-13 instruction: every key metric, every URL, every status badge.
- No "should I" / "want me to" / "let me know" / "I'll need you to" — memory `feedback_just_execute.md` + `feedback_never_ask_full_execute.md`.
- Trail every meaningful deliverable with `Persisted to: <paths>` per Operating Contract.

---

## §13 · Debug Playbook

### §13.1 · Wrong number
1. Phoenix tz applied?
2. BETWEEN window not `>=`?
3. View vs raw table?
4. `v_cfo_cron_health` last refresh?
5. AgentLink sync OK? `v_agentlink_sync_health` + `v_insuracloud_auth_health`.

### §13.2 · Route returns non-200
1. Build green? `npx tsc --noEmit` then `npm run build`.
2. Route registered in `src/App.tsx`?
3. Page exists at `src/pages/<Name>.tsx`?
4. Vercel deploy log.
5. CDN cache hold? Hard refresh.

### §13.3 · Profile shows "User #X" not name
The `agents.al_user_id` gap. 61/156 backfilled. Remaining 95 manual:
```sql
SELECT * FROM v_agents_missing_al_user_id;
```

### §13.4 · Notification didn't fire
1. Token file `~/.config/apex-creds/<service>.token`?
2. `chmod 600`?
3. Try Python notify script via Bash.
4. Telegram returns 200 even on bad chat_id — verify on phone.
5. Poke token 90-day expiry.

---

## §14 · Session Receipts (commit shape)

```
<type>: <short summary> (<context tag>)

<2-3 line problem statement>

═══════════════════════════════════════════════════════════════════════
WHAT SHIPPED
═══════════════════════════════════════════════════════════════════════
<bullet list>

═══════════════════════════════════════════════════════════════════════
ROUTING + SIDEBAR (if applicable)
═══════════════════════════════════════════════════════════════════════
<route registered · sidebar entries>

Cache: BUMP_VERSION NOT touched.
Verified: tsc 0, build ✓ (XXX precache · X.XMB).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

After every commit:
1. Push origin/main.
2. Wait HTTP 200 on deployed route.
3. Append `~/business-ops/session-state/active-work.md`: status done + Persisted to.
4. Receipt to Sam · Poke + Telegram (+ ntfy for urgent).

---

## §15 · The Data Layer (canonical sources)

### §15.1 · Core tables
| Table | Rows | Purpose |
|---|---|---|
| `agentlink_deals_snapshot` | ~5k | 30-min mirror of AgentLink production. SOURCE OF TRUTH. |
| `agentlink_carriers` | 16 | Partner carrier cards. |
| `applications` | 523+ | The recruiting pipeline. New 405 · contacted 325 · paid 42. |
| `agents` | 156 | Internal records. 61/156 with `al_user_id`. |
| `profiles` | ~200 | Per-user editable. |
| `announcements` | 3 | Active. Pinned + News Feed. |
| `culture_events` | 157 | Deal celebrations → `v_culture_feed`. |
| `sales_scripts` | 10 | Inbound · objections · recruiting · brand. |
| `transfer_requests` | 0 | Upline change. |
| `qe_carriers · qe_products · qe_commission_schedules` | 15 · 22 · 22 | Commission grids data. |
| `commission_ledger` | 113 | Real commission rows. |
| `cfo_approval_requests` | 1 pending | CFO-flagged. |

### §15.2 · Critical views
`v_cfo_snapshot` (front-page leaks) · `v_cfo_dup_charge_watch` · `v_cfo_ica_paid_stuck` · `v_cfo_agent_activation_watch` · `v_cfo_cron_health` · `v_cfo_sync_health_watch` · `v_business_analytics_carriers` · `v_culture_feed` · `v_application_conversion_funnel` · `v_funnel_by_source` · `v_recruiting_leaderboard` · `v_recruiter_pipeline` · `v_recruiting_inbox` · `v_transfer_requests` · `v_commission_grid` · `v_trophy_cabinet` · `v_sales_challenges` · `v_agents_needs_attention` · `v_agents_learn_from` · `v_inactive_agents_summary` · `v_agents_missing_al_user_id` · `v_insuracloud_sync_health` · `v_insuracloud_auth_health` · `v_agentlink_sync_health` · `v_ceo_command_center`

### §15.3 · RPCs
- `apex_dashboard_summary()` — single-roundtrip dashboard hero data.
- `fn_post_deal_celebration(agent_id, premium, product, note)` — Post a Deal flow.
- `landing_recent_applicants(limit)` · `landing_live_stats()` · `landing_recent_hires()` · `landing_unclaimed_summary()` — landing page RPCs.
- `producer_deep_dive(user_id)` — Producer Profile modal.
- `get_application_status(application_id)` — public `/status/:id`.
- `fn_recover_stale_applicant(application_id)` — admin recovery.

### §15.4 · Edge functions
- `bot-sql` — admin SQL gateway.
- `insuracloud-sync` — guards against HTML masquerade · writes `status='auth_failed'` instead of fake success (2026-05-19 fix).
- `agentlink-fake-success-reaper` — sweeps zombie sync rows.
- `next-step-dispatch` — Telegram → SMS → Email fallback (19-stage pipeline).
- `add-agent` — programmatic agent creation.

### §15.5 · Cron jobs (launchd + pg_cron)
- pg_cron: 3 jobs for Next Step Engine pipeline.
- `com.samjames.apex.finance-bot` — CFO scan + snapshot, hourly.
- `com.samjames.apex.website-integrity-bot` — punch-list drain.
- `com.samjames.apex.social-bot` — social cadence.
- `com.samjames.apex.readymode-bot` — ReadyMode ingest.
- `com.samjames.apex.telegram-bot` — pre-hire + onboarding nudges.
- `com.samjames.apex.doctor` — Sunday 05:00 health check.
- `com.samjames.apex.codex-handoff` — 2hr P0 backlog drain (credit-smart gated).
- Daily 04:00 archive of done active-work entries.

---

## §16 · 30-Second Sam-Test (12 Q · the new version with editorial layer)

A fresh Claude session must answer all in 30 seconds:

1. The two philosophies that govern every PR? _**LESS IS MORE** + **BILLION-DOLLAR AESTHETIC**._
2. The 3 audience tiers? _Owner (Sam) · Manager (franchise) · Agent (producer)._
3. The PRIMARY-row item Sam hoisted as highest-priority? _**Applications**._
4. The two front-Dashboard panels added 2026-06-14? _LIVE LEAKS strip + ACTIVE APPLICATIONS panel._
5. Source of truth for production? _AgentLink → `agentlink_deals_snapshot`._
6. Phoenix tz pattern? _`(NOW() AT TIME ZONE 'America/Phoenix')::date`._
7. Date-window rule? _BETWEEN start AND today · NEVER `>=`._
8. Allowed palette? _slate · amber · emerald · rose · white/black._
9. Allowed motion budget? _180ms standard transitions · 250ms page mounts · NO animate-pulse on Badges._
10. Sound design rule? _Subtle · normalize to −14 LUFS · default OFF · NEVER on routine clicks._
11. The 4 hard limits? _Move money to 3rd party · unsolicited outbound · irreversible deletes · cards._
12. Where does the fix live after this chat dies? _`Persisted to:` block in the wrap._

---

## §17 · Open Punch-List (next sprint)

Filtered through both editorial + visual lenses:

- **Front-Dashboard density polish**: animate the LEAKS strip with a 1px refetch-progress bar; tune empty-state copy on the APPLICATIONS panel.
- **Sound library**: record 3 production-grade sounds (deal-posted, lead-picked-up, milestone) at −14 LUFS.
- **Glass hero on `/dashboard/business-analytics`**: convert the Trophy Cabinet header to a `backdrop-blur-xl` glassmorphic hero panel for premium feel.
- **Glow accent**: identify the ONE most important card per page; apply `shadow-[0_0_40px_hsl(var(--primary)/0.15)]` glow.
- **`agents.al_user_id`** remaining 95 backfill — build admin UI under Admin settings.
- **AgentLink data depth**: pull richer fields from `agentlink_deals_snapshot` (effective_date · status · carrier_id · product_id) into the Book of Business filter strip.
- **Quoter + Needs Analysis** dialer-dock integration (Sam's directive: these belong IN the call, not as nav items).
- **Annuity-training quiz** to gate "complete" (currently self-mark).
- **Avatar dropdown** with Producer Profile · Calling Cards · My Landing Page · Sign Out (current: Sign Out only).

---

## §18 · Persisted-to Block (what owns this spec after the chat dies)

- **This file**: `/Users/samjames/business-ops/master-prompts/125-apex-100x-dashboard-atlas.md`
- **v3 backup**: `…/125-apex-100x-dashboard-atlas.md.bak.v3.2026-06-14`
- **v2 backup (original sweep history)**: `…/125-apex-100x-dashboard-atlas.md.bak.2026-06-13`
- **Repo mirror**: `docs/operating-spec.md` in `samcom593-creator/rebuild-brighten-sparkle`
- **Memory index**: `~/.claude/projects/-Users-samjames-claude-sync/memory/MEMORY.md`
- **Session ledger**: `~/business-ops/session-state/active-work.md`
- **Notion**: 🎯 APEX Dashboard Atlas page `37f341a6-7027-812c-bbff-dbe671a7441e` under Command Center

---

## §19 · The North Star (one line · last word)

Every line of code, every sidebar item, every dashboard tile, every cron, every notification — exists to make Sam more leveraged, more accurate, and more dangerous as a 20-year-old solo operator on a billion-dollar trajectory · AND to make the surface that does it look like the most expensive piece of software in the industry while staying ruthlessly practical.

> **Hold the Standard. Average is the disease.**
