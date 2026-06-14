# APEX · 100X DASHBOARD ATLAS · 2026-06-13

**Replaces 122 + 123 + 124. THE single operating spec for every Claude session that touches apex-financial.org.**

Sam said: *"make the prompt one hundred times better · go through every single dashboard, head to toe · full complete purpose · every product data production marked and accurate · go through AgentLink head to toe · do this now."*

The expansion vs prompt 124: §3 (Dashboard Atlas) documents the 12 dashboards Sam actually uses, head-to-toe, with PURPOSE · AUDIENCE · DATA SOURCES (every view + RPC + table) · SECTIONS · KEY METRICS with formula + verify SQL · INTERACTIONS · AgentLink parity status · KNOWN GAPS. §4 is the AgentLink head-to-toe parity matrix sourced from real AgentLink HTML captures. §5 is the production accuracy contract — every metric on the site with its formula + the SQL that proves it's right.

---

## §1 · THE BUSINESS (memorize)

**Product:** `apex-financial.org` — life-insurance recruiting agency OS. Sam James (20, Managing Partner). Three audiences:

| Audience | Lands on | Needs |
|---|---|---|
| Recruiting prospects | `/` · `/apply` · agent post-hire `/dashboard` | proof of activity (hires + applicants tickers · 22 carriers · live stats) · low-friction apply · seamless onboarding |
| Sam + admins | `/dashboard/*` (100+ routes registered, 12 used daily) | live AgentLink truth · zero clutter · faster + smoother + more AI-leverage than AgentLink |
| Active agents | `/dashboard` (agent view) · `/dashboard/inbound-leads` · `/dashboard/clients` | inbound call cockpit · personal MTD AP · contract progress · pipeline |

**Mandate:** apex-financial.org must beat `agentlink.insuracloud.ai` on visual, motion, AND data depth. Sam's recruiting leverage point: "look what we built."

**Scale (2026-06-13):** ~522 applications · ~1,278 deals · ~$1.69M total annual premium · ~104 active agents · 22 carriers. Numbers change daily — never hardcode past the safe floor.

---

## §2 · TRUTH HIERARCHY + UNIVERSAL RULES

Data precedence when sources conflict:

1. **AgentLink** (`agentlink.insuracloud.ai`) · source of truth for deals/carriers/policies. Updates first.
2. **`agentlink_deals_snapshot`** · our 30-min mirror powering every dashboard KPI, chart, leaderboard. Synced via launchd `com.samjames.apex.agentlink-sync`.
3. **Internal views** built ON `agentlink_deals_snapshot` (see §3 Atlas).
4. **Legacy `deals` table** · DO NOT USE. The $117K phantom-revenue bug had both halves traced to this. Any code reading `from("deals")` is broken — replace with `agentlink_deals_snapshot`.

**Phoenix tz everywhere.** Filter: `(NOW() AT TIME ZONE 'America/Phoenix')::date`. UTC midnight = 5 PM Phoenix prior day. Never UTC for human-facing date buckets.

**Period buckets — always `BETWEEN start AND today`** (not `>= start`). The bleed-future-dates bug ate $103K worth of phantom revenue across today/week/month buckets until 2026-06-10.

**Build gates BEFORE every push** (no exceptions):
```bash
npx tsc --noEmit        # tsc=0
npm run build           # built in <2s · zero errors
node scripts/route-smoke.mjs   # 26/26 routes 200
```

**Banned in commits:** `select("*")` on visible pages · `"Unknown"` user-facing · `BUMP_VERSION` bumps · `console.log`. Banned on dashboard surfaces: `text-violet/orange/blue/pink/cyan/fuchsia/lime/yellow` · `hover:scale-*` · `hover:-translate-y-*` · `animate-pulse` on badges · `backdrop-blur-*` · `bg-gradient-*` · `shadow-lg/xl/2xl`.

---

## §3 · THE DASHBOARD ATLAS (head-to-toe · 12 surfaces)

### 3.1 · `/` (public landing)
**Purpose:** convert recruiting prospects who land cold. Show LIVE proof in 6 seconds.
**Audience:** uncredentialled recruiting prospects.
**Data sources:** `landing_live_stats()` · `landing_recent_hires()` · `landing_recent_applicants()` · `landing_deal_highlights()`.
**Sections head-to-toe:**
1. Navbar (logo + Login + Apply Now CTA)
2. Hero (parallax title · LazyYouTube video · primary Apply CTA · secondary "watch walkthrough" link)
3. LiveStatsCounterStrip (3 tiles: Active agents · Apps 30d · Carriers)
4. RecentHiresTicker (rose dot · names · days-on-team · marquee)
5. **RecentApplicantsTicker (emerald dot · first name + city + state + hours-ago · marquee) — shipped 2026-06-13**
6. 3 stat pills (Commission · Carriers · Course)
7. Carrier marquee (22 names)
8. CareerPathwaySection · CTASection · Footer
**Key metrics + formulas:**
- `active_agents` floor = 104 (HARDCODED_FLOOR · only counts UP). Real source: `landing_live_stats().active_agents`.
- `applications_30d` floor = 131. Real: `landing_live_stats().applications_30d`.
- `carriers_partnered` floor = 22. Real: `landing_live_stats().carriers_partnered`.
**Verify:** `SELECT landing_live_stats()` → {active_agents, applications_30d, carriers_partnered, applications_total, hires_recent, generated_at}.
**Known gates:** both LiveStats and RecentHires use `useInteractionGate() || timerOpen` (1.5s timer fallback so non-scrolling visitors still see live data while Lighthouse cold-load stays clean).
**AgentLink parity:** N/A (AgentLink has no public landing).

---

### 3.2 · `/apply` (application form)
**Purpose:** lowest-friction prospect → applicant conversion.
**Audience:** uncredentialled recruiting prospects.
**Data sources:** `landing_live_stats()` for the eyebrow strip · `applications` INSERT on submit.
**Sections head-to-toe:**
1. Top trust bar (RECRUITING NOW · 22 CARRIERS · 104 ACTIVE)
2. Founder credit ("You're applying directly to Samuel James")
3. 4-step progress (Personal Info → Experience → Licensing → Goals)
4. Step 1 fields: First/Last/Email/Phone/City/State/Instagram
5. Step 2 fields: previous_company · years_experience · has_insurance_experience
6. Step 3 fields: license_status · pre-licensing intent
7. Step 4 fields: goals · sms_consent · submit
**Key metric:** application insert returns 200; `notify-new-applicant` edge fn fires; record visible in `/dashboard/applicants`.
**Verify:** `SELECT COUNT(*) FROM applications WHERE created_at > NOW() - INTERVAL '24 hours'` ≥ 0.
**Known issue:** Step 4 SMS consent has a Zod contradiction (asterisk required visually, optional in schema) — patched in audit but verify on next change.
**AgentLink parity:** N/A.

---

### 3.3 · `/dashboard` (admin CEO cockpit · AgentCommandDashboard.tsx)
**Purpose:** Sam's morning glance · agency-wide pulse · "am I on pace?" in one screen.
**Audience:** admin (Sam) · falls back to agent view for non-admins.
**Data sources:**
- `v_ceo_command_center` (one row · 37 cols · the source-of-truth rollup)
- `v_agentlink_book_truth` (book numbers · today/week/month/total)
- `agentlink_deals_snapshot` (period queries via `periodDeals` + `priorPeriodDeals` + `trend`)
- `v_recent_hires` (just-hired tab)
- `v_recent_activations_alp` (activations tab)
- `apex_dashboard_summary()` RPC (header live numbers)
**Sections head-to-toe (current 6 zones, target 4):**
1. PageHeader (eyebrow + period switcher inline + CEO panel link + Live·60s badge)
2. 4-KPI tile strip: Agency AP · Deals · Producing agents · Licensed hires (period-aware)
3. Trend chart + Top Producers leaderboard (2-col grid)
4. Tabbed strip (4 tabs): Pipeline funnel · Manager hierarchy share · Just hired · Recent activations
5. Footer 2-col: 4-stat health (Chargebacks/Lapses/Refs/Ref won) + 4-quick-actions grid
6. LapsesDrilldownModal (hidden until clicked)
**Key metrics + verify SQL:**
| Metric | Formula | Verify |
|---|---|---|
| `agency AP` (period) | SUM(annual_premium) from agentlink_deals_snapshot WHERE effective_date BETWEEN startDate AND endDate | `SELECT SUM(annual_premium::numeric) FROM agentlink_deals_snapshot WHERE effective_date >= date_trunc('month', NOW() AT TIME ZONE 'America/Phoenix')::date` |
| `Deals` (period) | COUNT(*) from same | same as above but COUNT |
| `Producing agents` | COUNT(DISTINCT user_id) where user_id IS NOT NULL | `SELECT COUNT(DISTINCT user_id) FROM agentlink_deals_snapshot WHERE effective_date BETWEEN ...` |
| `Licensed hires MTD` | tight.licensedMtd | RPC narrowed in v25-wave-1 |
| `period trend %` | (current - prior) / prior · 100 | priorPeriodDeals also from agentlink_deals_snapshot (post-$117K-part-2 fix) |
**Interactions:** period switcher cycles Today/Week/Month/Custom. Quick Actions navigate to /applicants /recruit-pipeline /leaderboard /strikes.
**Known issue:** still 6 zones · target 4 (D1 in §6 queue).
**AgentLink parity:** AgentLink's `/dashboard` was auth-walled at capture time. Their `/business-analytics` is closer in spirit to what `/dashboard` should be — see 3.4.

---

### 3.4 · `/dashboard/business-analytics` ★ FLAGSHIP (BusinessAnalytics.tsx)
**Purpose:** AgentLink-flagship mirror · the page Sam shows recruits to prove the stack.
**Audience:** admin + manager + agent (RLS scoped via underlying views).
**Data sources:**
- `v_business_analytics_summary` (KPIs)
- `v_business_analytics_carriers` (carrier perf top 15)
- `v_business_analytics_insights` (top_carrier · top3_producer · streak · team_rhythm)
- `v_sales_challenges` (4 rows: daily/weekly/monthly/quarterly with self-tuning targets)
- `v_trophy_cabinet` (cumulative win counts: total · daily · weekly · monthly · quarterly)
**Sections head-to-toe (10 sections wrapped in 10-tab strip):**
1. PageHeader (eyebrow + Last 30d badge + Refresh)
2. **AI-Powered Sales Challenges** · 4-tile self-tuning (Daily=MTD pace · Weekly=last week · Monthly=last × 1.1 · Quarterly=last × 1.1). Each tile: % · $current/$target · deals current/target · time-left.
3. **Trophy Cabinet** · cumulative win counts mirroring AgentLink: Total · Daily · Weekly · Monthly · Quarterly + streak meta + MTD premium + PERFECT MONTH badge when streak ≥ days_elapsed - 1.
4. **3 AI Insights cards** · Carrier concentration · Producer concentration · Team rhythm (tone=warn at 50%+).
5. **10-tab strip:** Daily Report · Overview · Individual · Team · Carriers · Trends · Policy · Quality · Marketing · AI Coach.
   - Overview: 4-KPI strip + 2-up stat band (Monthly Growth + Avg Producer Output) + Carrier Performance ranked list (top 15)
   - 9 others: ComingSoon cards with LIVE preview pointers
**Key metrics + verify SQL:**
| Metric | Formula | Verify |
|---|---|---|
| `total_deals_mtd` | COUNT(*) WHERE effective_date BETWEEN month_start AND today | `SELECT total_deals_mtd FROM v_business_analytics_summary` |
| `growth_pct_mom` | (mtd - last_month) / last_month · 100 | currently -34.8 (Q1 was bigger) · `SELECT growth_pct_mom FROM v_business_analytics_summary` |
| `top_carrier_share_pct` | top_carrier_premium / team_premium_30d · 100 | American Home Life 58.2% live now |
| `top3_producer_share_pct` | sum(top-3 premium) / team_premium_30d · 100 | 27.5% live now |
| `streak_days` | COUNT(DISTINCT effective_date) WHERE effective_date BETWEEN month_start AND today | currently 13/13 |
| `daily target` (Sales Challenge) | MTD premium / (days_so_far - 1) | self-tuning · no manual config |
| `quarterly target` | last_quarter × 1.1 | 10% growth goal |
**Interactions:** Refresh refetches all 4 queries. Tab clicks fade-in 280ms.
**KNOWN GAPS vs AgentLink (from biz.html capture):**
- ✅ Trophy Cabinet cumulative win counts · shipped 2026-06-13 (43 Total · 13 Daily · 24 Weekly · 3 Monthly · 3 Quarterly)
- ❌ AI Insights generic (carrier/producer/rhythm); AgentLink names specific agents + dollar potential: "Vikkie Turner Needs Attention · $1,242 potential if matched team avg · Action: Schedule 1-on-1 coaching session this week"
- ❌ "Learn from X" performer-spotlight cards (top performers with % above avg + share-best-practice action)
- ❌ "138 Agents Inactive" list with names
- ❌ Challenge tile copy ("Almost there, maintain your momentum") · ours just shows %
- ✅ 4-tile challenge strip · matches AgentLink
- ✅ 10-tab strip · matches AgentLink labels exactly
- ✅ Carrier Performance ranked list · matches

---

### 3.5 · `/dashboard/team-analytics` (TeamAnalytics.tsx)
**Purpose:** ranked producer roster + 1:1 deep-dive on tap.
**Audience:** admin + manager.
**Data sources:**
- `v_team_analytics_producers` (producer rows · joined to agents via al_user_id)
- `producer_deep_dive(p_user_id)` RPC (single-producer JSON payload)
**Sections head-to-toe:**
1. PageHeader (eyebrow + Last 30d badge + Refresh)
2. 3-KPI strip: Active Producers · Team Deals · Team Premium (30d totals)
3. Search bar (by name · agent code · al_user_id)
4. Top Producers ranked list (top-1 gold · top-5 bold · rest neutral · share % each)
5. **Producer Deep-Dive sheet** (slides in on row click): 3-tile header + daily premium recharts chart + carrier mix + recent deals list
**Key metrics + verify SQL:**
| Metric | Formula | Verify |
|---|---|---|
| `deals_30d` per producer | COUNT(*) WHERE user_id=X AND effective_date >= NOW() - 30d | `SELECT * FROM v_team_analytics_producers ORDER BY premium_30d DESC LIMIT 5` |
| `premium_30d` | SUM(annual_premium) | same |
| `share %` | premium_30d / SUM(premium_30d) · 100 | computed client-side from the same view |
| `carrier_mix` (deep-dive) | per-carrier sum from agentlink_deals_snapshot · top 8 | `SELECT producer_deep_dive(280)` |
**Interactions:** row click → Sheet · close restores list · search debounces typing.
**Known issue:** `agent_name` returns null for producers whose `agents.al_user_id` is unmapped (rows show "AgentLink user #280"). Mapping is a manual ops task.
**AgentLink parity:** AgentLink's `/team-analytics` was auth-walled at capture.

---

### 3.6 · `/dashboard/book-of-business` (BookOfBusiness.tsx)
**Purpose:** every policy row · drill-down · filter · search · sort.
**Audience:** admin (full) · manager (downline) · agent (own).
**Data sources:**
- `agentlink_deals_snapshot` (1278 rows from AgentLink)
- `deals` table (legacy · merged in for backward compat · being phased out)
- `v_chargebacks_30d` (chargeback widget)
- `agents` (name resolution)
**Sections head-to-toe:**
1. PageHeader (eyebrow + admin/manager/agent subtitle + Refresh + Open AgentLink link)
2. AgentLinkConnectionPrompt (only renders for non-admin without sync data)
3. **Totals strip inline** (Deals · ALP · Monthly · Source split APEX/AgentLink)
4. Chargeback widget (auto-compact py-2 when 0 chargebacks)
5. Filters bar (Source · Stage · search · sort)
6. Table (10 cols: Client · Carrier · Product · Policy # · Status · Monthly · Annual · Effective · Posted · Agent)
**Key metrics + verify SQL:**
| Metric | Formula | Verify |
|---|---|---|
| `Deals (1278)` count | filtered.length | `SELECT COUNT(*) FROM agentlink_deals_snapshot` |
| `ALP total` | SUM(annual_premium) of filtered | `SELECT SUM(annual_premium::numeric) FROM agentlink_deals_snapshot` → $1.69M |
| `Monthly total` | SUM(monthly_premium) | same |
| `chargebacks (period)` | rows from v_chargebacks_30d in custom date range | `SELECT COUNT(*) FROM v_chargebacks_30d WHERE status_updated_at BETWEEN ...` |
**Interactions:** click row → ClientDetail page · sort columns · custom chargeback date range.
**AgentLink parity (book.html capture):**
- ✅ "Deals (1276)" header count · ours matches pattern
- ✅ 10-col table matches column order (Client/Carrier/Product/Policy/Status/Monthly/Annual/Effective/Posted/Agent)
- ✅ Carrier dropdown + View My Policies button
- ⚠️ AgentLink Filters panel layout slightly tighter (icon + dropdown · we have inline)
- ⚠️ AgentLink Status column shows colored pills (Cancel red · Active green) · ours uses STAGE_COLORS map

---

### 3.7 · `/dashboard/clients` (ClientPipeline.tsx)
**Purpose:** book-of-business cockpit from the agent's CRM-lens.
**Audience:** admin + manager (downline) + agent (own).
**Data sources:** `agentlink_clients` table (1.6k rows · 109 cols · the AgentLink mirror).
**Sections head-to-toe:**
1. PageHeader · subtitle (admin/manager/agent role-aware) + AgentLinkConnectionPrompt
2. 4-KPI tiles: Total clients · Sold policies · Working on it · Callbacks · 24h
3. Stage funnel (NEW_INITIAL → WORKING → ALMOST_THERE → SOLD)
4. State distribution map (recharts bar chart)
5. Chargebacks watchlist (PL-044 priority list)
6. Recent additions
7. Full client list (search · stage filter · state filter · sort)
**Key metrics:**
- `stage_distribution` · COUNT per pipeline_stage
- `state_distribution` · top 8 states by client count
- `chargebacks` · clients with hostile_language_detected = true OR do_not_call = true
**Verify:** `SELECT pipeline_stage, COUNT(*) FROM agentlink_clients GROUP BY 1`.
**Known issue:** `Callbacks · 24h` was mislabeled "Chargebacks · 7d" earlier · fixed.
**AgentLink parity:** AgentLink doesn't have an equivalent clients-CRM page (theirs is policy-centric); this is APEX advantage.

---

### 3.8 · `/dashboard/contracts` (CarrierContracts.tsx)
**Purpose:** track carrier contract status across 22 partners.
**Audience:** admin.
**Data sources:** `v_apex_contracts_summary`.
**Sections head-to-toe:**
1. PageHeader (mirrors AgentLink contracting)
2. Inline summary chips (Active · Pending · Submitted · Rejected counts)
3. Status sections (grouped active/pending/submitted/rejected/none) with rows per carrier
4. ContractRowView (carrier + writing# + contract# + activated date)
**Key metrics:**
- `Active` count · `Pending upline assignment` · `Submitted` · `Rejected`
**Known issues fixed:** isError state surface added · 4-up tile grid collapsed to inline chip row · STATUS_META blue→slate.
**AgentLink parity:** AgentLink's "Contracted" section in /business-analytics has the same data shape.

---

### 3.9 · `/dashboard/inbound-leads` ★ HOT PATH (InboundLeads.tsx)
**Purpose:** Sam's live call cockpit · the most-used surface · DO NOT BREAK.
**Audience:** admin + agent (own inbound calls).
**Data sources:** `inbound_leads` table (local-first · synced) · `call-recordings` Storage bucket · TruePeopleSearch via window.open · NANP area-code lookup (200 rows).
**Sections head-to-toe:**
1. PageHeader (eyebrow + Draft restored badge if any + New Client button)
2. 4-KPI stat tiles: Inbound clients · Hot right now · Follow-ups · (4th dropped per v26)
3. Search bar + stage filter (4 buckets: New · Quoted · Follow-up · Closed)
4. Stage board (column-per-bucket · rows are lead cards)
5. New Client Dialog (modal):
   - Auto-flow banner: "Cmd+C the GV number → page opens itself"
   - Left col: First/Last · Phone (auto-state-fill) · Email · City/State · Problem type (12 options) · Urgency · Budget · Notes (with 7 fact chips above) · More-details disclosure (Current coverage · Household · Desired solution) · Next callback datetime
   - Right col: CallSnapshot bullets · Transcript textarea + mic button + live call timer · Switch Center script panel (Sam's verbatim opener, read-only)
6. Save → fire-and-forget audio upload
**Features that MUST keep working:**
- Voice recognition + smart parser (50-state, urgency grading, problem-type matching)
- Clipboard auto-poll every 2s while tab visible
- "🎧 Both sides" button (explicit getDisplayMedia tab-share)
- Field-fill emerald pulse celebration (1.2s on data arrival)
- Draft autosave to localStorage every 400ms
- Live call timer (rose dot + mm:ss)
- 7 quick-fact chips (Married · Has kids · Owns home · Smoker · Pre-existing · Wants no exam · Veteran)
- Switch Center script panel (read-only)
- autoFocus First Name on dialog open
- Area code → state autofill
- Fire-and-forget audio upload (Sam never waits)
- TruePeopleSearch auto-open on clipboard phone detection
**Stages enum:** raw values `new/diagnosing/quoted/follow_up/won/lost` (6) → display buckets `new/quoted/follow_up/closed` (4) via `bucketOf()` mapper.
**Problem types (12):** Final expense · Mortgage protection · Life insurance review · Retirement/IUL · Child coverage · Debt protection · Existing policy issue · Business protection · Change bank · Add beneficiary · Other.
**Verify:** load /dashboard/inbound-leads · click New Client · clipboard phone should pre-fill · mic should start within 300ms.
**AgentLink parity:** AgentLink has no inbound call cockpit · this is pure APEX advantage and recruiting leverage.

---

### 3.10 · `/dashboard/calls-today` (CallsTodayCockpit.tsx)
**Purpose:** today's scheduled calls from Sam's Google Calendar.
**Audience:** admin + agent.
**Data sources:** `v_upcoming_calls` view · Google Calendar sync (edge fn).
**Sections head-to-toe:**
1. PageHeader (eyebrow + Calendar Check icon)
2. **3-KPI tile zone**: Today · Next up · This week
3. Today section (calls with imminent=15min rail)
4. Tomorrow section
5. Later section (next 14 days · was bugged to 7 in audit)
6. Empty state if no calls
**Key metric:** `grouped.today.length` · `Next call relative time`.
**Verify:** `SELECT COUNT(*) FROM v_upcoming_calls WHERE start_at > NOW()`.
**Known issues fixed:** Skeleton import crash · animate-pulse jitter · isThisWeek 7d cutoff.
**AgentLink parity:** N/A (AgentLink doesn't have a calls-today view).

---

### 3.11 · `/dashboard/whales` (WhaleRecruiting.tsx)
**Purpose:** admin-only whale recruiting tracker.
**Audience:** admin.
**Data sources:** `applications` filtered to high-value (downline_size_estimate, manager-track flags) joined to `agents`.
**Sections head-to-toe:**
1. PageHeader (Crown icon)
2. 4 HeatTiles (Hot/Warm/Cool/Cold) · neutral white cards + colored dot
3. Whale list grouped by heat · sorted by urgency ladder (next_action_due_at → last_contact_at → created_at)
4. WhaleRow: avatar + name + state badge + downline indicator + heat dot + meta row + state plain-text suffix
**Sort ladder fix (PL-WAVE74):** within heat bucket, sort by:
1. `next_action_due_at` ASC (soonest first · null = Infinity)
2. `last_contact_at` ASC (longest-untouched first)
3. `created_at` DESC (newest tiebreaker)
**Verify:** `SELECT * FROM applications WHERE ... LIMIT 10` · check whale criteria.
**AgentLink parity:** N/A.

---

### 3.12 · `/dashboard/applicants` (DashboardApplicants.tsx)
**Purpose:** raw applications list · admin sees all · manager sees downline · agent sees attributed.
**Audience:** admin · manager · agent (via RLS).
**Data sources:** `applications` table (522 rows) · `agents` (assigned/recruiter/referral name resolution).
**Sections head-to-toe:**
1. PageHeader + admin/manager controls
2. Stats tiles (Total · At Risk · Needs Contact · Licensed)
3. Filter pills (status + search)
4. Applications table (sortable · row per applicant)
5. Per-row actions (Start training · Mark contracted · etc.)
**RLS policies on applications:**
- Admins: "Admins can manage all applications" (FOR ALL · uses has_role('admin'))
- Managers: "Managers view team applications" (FOR SELECT · attribution match)
- Agents: "Agents can view their applications" (FOR SELECT · 3-column OR match)
- Applicants: own row via JWT email match
**Verify (admin):** loads list of 522 rows.
**Known fix (2026-06-13):** missing `recent applicants ticker` on PUBLIC LANDING was the bug; this admin page renders correctly.
**AgentLink parity:** N/A.

---

## §4 · AGENTLINK PARITY MATRIX (head-to-toe · from real captures)

Sourced from `/tmp/agentlink-snapshots/biz.html` and `book.html` (Playwright captures from 2026-06-12).

### AgentLink `/business-analytics` (full text excerpt from capture)
| Section | We have? | Status |
|---|---|---|
| Header "Track team performance" | ✅ | matched |
| "Last 30 days" filter | ✅ | matched (Badge) |
| "AI Insights" button | ⚠️ | missing as button (have cards instead) |
| Refresh button | ✅ | matched |
| **AI-Powered Sales Challenges** strap-line | ✅ | matched |
| Daily Challenge tile · % · X/Y deals · "Almost there" copy | ⚠️ | have % + X/Y, missing personalized copy |
| Weekly Challenge tile · "Great progress" copy | ⚠️ | same |
| Monthly Challenge tile · $premium target | ✅ | matched |
| Quarterly Challenge tile · X/Y agents recruit target | ❌ | ours is premium-based, theirs is recruit-based |
| **Trophy Cabinet** total | ✅ | shipped 2026-06-13 (43 Total live now) |
| Trophy breakdown: Daily · Weekly · Monthly · Quarterly | ✅ | shipped 2026-06-13 (13 · 24 · 3 · 3 live now) |
| 10-tab strip: Daily Report · Overview · Individual · Team · Carriers · Trends · Policy · Quality · Recruiting · AI Coach | ⚠️ | we have it · BUT we have "Marketing" instead of "Recruiting" |
| **AI-Powered Insights** section | ✅ | matched · 3 cards |
| Insight format: "<Agent Name> Needs Attention · $X potential · Action: <verb> <when>" | ❌ | ours is generic (carrier · producer · rhythm); theirs names agents |
| "Learn from <agent>" performer-spotlight cards | ❌ | not implemented |
| "138 Agents Inactive" with names list | ❌ | not implemented |

### AgentLink `/book-of-business`
| Section | We have? | Status |
|---|---|---|
| Header + subtitle | ✅ | matched |
| Source toggle (Agents/Carrier) | ⚠️ | partial (we have stage/source filter) |
| Filters panel | ✅ | matched |
| "Deals (1276)" count header | ✅ | matched |
| 10-col table | ✅ | matched columns + order |
| Status pills (Cancel red · Active green) | ✅ | via STAGE_COLORS |
| "View by Agent" dropdown | ⚠️ | have agent attribution but no top dropdown |
| "View My Policies" button | ✅ | role-based |
| Pagination | ⚠️ | infinite scroll instead |

---

## §5 · PRODUCTION ACCURACY CONTRACT

Every metric surfaced on apex-financial.org has a formula and a SQL that proves correctness. Below: the 20 metrics most likely to be challenged ("that number looks wrong").

| Surface | Metric | Formula | Verify SQL |
|---|---|---|---|
| `/` landing | Active agents | `landing_live_stats().active_agents` (floor 104) | `SELECT landing_live_stats()` |
| `/` landing | Apps 30d | `landing_live_stats().applications_30d` (floor 131) | `SELECT (landing_live_stats()->>'applications_30d')::int` |
| `/` landing | Carrier partners | `landing_live_stats().carriers_partnered` (floor 22) | same |
| `/dashboard` | Agency AP MTD | `SUM(annual_premium) FROM agentlink_deals_snapshot WHERE effective_date BETWEEN month_start AND today (Phoenix tz)` | `SELECT SUM(annual_premium::numeric) FROM agentlink_deals_snapshot WHERE effective_date BETWEEN date_trunc('month', (NOW() AT TIME ZONE 'America/Phoenix')::date::timestamptz)::date AND (NOW() AT TIME ZONE 'America/Phoenix')::date` |
| `/dashboard` | Deals MTD | COUNT of same | `SELECT deals_this_month FROM v_agentlink_book_truth` |
| `/dashboard` | Today | `effective_date = today` (NOT `>= today`) | `SELECT deals_today, premium_today FROM v_agentlink_book_truth` |
| `/dashboard` | Trend delta % | `(current - prior_period) / prior_period × 100` · both from agentlink_deals_snapshot | mental math from periodDeals + priorPeriodDeals |
| `/dashboard/business-analytics` | Total deals MTD | `v_business_analytics_summary.total_deals_mtd` | `SELECT * FROM v_business_analytics_summary` |
| `/dashboard/business-analytics` | Total premium MTD | same view · total_premium_mtd | same |
| `/dashboard/business-analytics` | Active producers 30d | `COUNT(DISTINCT user_id) WHERE effective_date >= NOW() - 30d` | same |
| `/dashboard/business-analytics` | Avg deal size | total_premium_mtd / total_deals_mtd | same |
| `/dashboard/business-analytics` | MoM growth | `(mtd - last_month) / last_month × 100` | `SELECT growth_pct_mom FROM v_business_analytics_summary` |
| `/dashboard/business-analytics` | Top carrier share | `top_carrier_premium / team_premium_30d × 100` | `SELECT top_carrier_share_pct FROM v_business_analytics_insights` |
| `/dashboard/business-analytics` | Streak days | `COUNT(DISTINCT effective_date) WHERE effective_date BETWEEN month_start AND today` | same view |
| `/dashboard/business-analytics` | Daily challenge target | `MTD premium / (days_so_far - 1)` | `SELECT target_premium FROM v_sales_challenges WHERE period='daily'` |
| `/dashboard/business-analytics` | Quarterly challenge target | `last_quarter_premium × 1.1` | `SELECT target_premium FROM v_sales_challenges WHERE period='quarterly'` |
| `/dashboard/business-analytics` | Trophy total wins | `daily + weekly + monthly + quarterly wins (cumulative)` | `SELECT total_wins FROM v_trophy_cabinet` |
| `/dashboard/business-analytics` | Daily wins | `COUNT(DISTINCT effective_date) WHERE BETWEEN month_start AND today` | `SELECT daily_wins FROM v_trophy_cabinet` |
| `/dashboard/business-analytics` | Weekly wins | `COUNT of weeks YTD with ≥5 team deals` | `SELECT weekly_wins FROM v_trophy_cabinet` |
| `/dashboard/business-analytics` | Monthly wins | `COUNT of months YTD that beat prior month's premium` | `SELECT monthly_wins FROM v_trophy_cabinet` |
| `/dashboard/business-analytics` | Quarterly wins | `COUNT of quarters that beat prior quarter` | `SELECT quarterly_wins FROM v_trophy_cabinet` |
| `/dashboard/team-analytics` | Premium 30d per producer | `SUM(annual_premium) WHERE user_id=X AND effective_date >= NOW() - 30d` | `SELECT * FROM v_team_analytics_producers` |
| `/dashboard/team-analytics` | Producer share % | client-side derived from above | `premium_30d / SUM(premium_30d)` |
| `/dashboard/book-of-business` | Deals count | filtered.length client-side | `SELECT COUNT(*) FROM agentlink_deals_snapshot` |
| `/dashboard/clients` | Total clients | filtered count from agentlink_clients (1.6k rows) | `SELECT COUNT(*) FROM agentlink_clients` |

**The Phoenix tz rule:** if a metric says "today" or "this week" or "this month", it MUST be filtered via `(NOW() AT TIME ZONE 'America/Phoenix')::date`. NEVER use UTC.

**The BETWEEN rule:** if a metric is bounded "from start of period through today", it MUST be `BETWEEN period_start AND today`. NEVER `>= period_start` (that bleeds future-dated rows · the $117K bug).

---

## §6 · STRATEGIC PRIORITIES LADDER (next-up choice tree)

When choosing what to do next, lower numbers win:

1. **Fix a real bug Sam just reported.** Drop everything.
2. **Ship inbound dialer flow improvements.** Sam is on calls daily.
3. **Make the public landing look like proof.** Tickers, counters, live activity.
4. **Match or beat AgentLink** on visuals, motion, AND data depth.
5. **Close known AgentLink parity gaps** (see §4 matrix · ❌ rows).
6. **Surface a number Sam doesn't have yet** (new analytics view + tile).
7. **Reduce visual debt** (palette, motion, zone count, GlassCard→FlatCard).
8. **Improve infra** (perf, caching, indexes).
9. **Documentation / planning prompts / retrospectives.** Last.

**Test:** *"Does this make a recruiting prospect more likely to sign, or save Sam time on a call?"* If neither, defer.

### Immediate queue (concrete next-actions per §4 gaps)
1. ✅ ~~**Trophy Cabinet · cumulative win counts**~~ — DONE 2026-06-13 (commit e396d798 · `v_trophy_cabinet` view + UI mirror)
2. **AI Insights · personalize with named agents** (rewrite `v_business_analytics_insights` to surface "Vikkie Turner Needs Attention · $X potential · Action: ...")
3. **Inactive agents list** with names on `/dashboard/business-analytics` (new view `v_inactive_agents_30d`)
4. **"Learn from" performer-spotlight cards** for top-3 producers above team avg
5. **D1 · /dashboard 6→4 zones** (merge Trend+TopProducers+TabbedStrip)
6. **C2 · Daily Brief generator** (cron + edge fn + Telegram push)
7. **C3 · /apex-stack public showcase route** (auto-screenshot loop)

---

## §7 · VISUAL + MOTION DISCIPLINE (compact reference)

**Palette (Brand Bible locked):** `#0A0A0A` bg · `#FFFFFF` fg · `#9A9A9A` muted · `#C9A961` gold · `#22d3a5` primary mint. Status: `text-slate-500` · `text-amber-500` · `text-emerald-500` · `text-rose-500`. **No other colors on dashboard surfaces.**

**Motion budget (CSS in `src/index.css`, applies to every `.page-enter`):**
- Buttons/tabs/links: 180ms cubic-bezier(0.2,0,0,1)
- Tab content fade-in: 280ms slide-up 4px
- Card stagger on page enter: 30ms per child
- Skeletons: 1400ms shimmer
- Sheets: 320ms cubic-bezier(0.32,0.72,0,1)
- `prefers-reduced-motion` respected

**Banned:** `hover:scale-*` · `hover:-translate-y-*` · `animate-pulse` on Badges · `backdrop-blur-*` on dashboard · `bg-gradient-*` on dashboard · `shadow-lg/xl/2xl`.

**Zone target:** ~4 per page (AgentLink rhythm). `/dashboard` currently 6 · target 4.

**Card surface:** flat · 1px theme border · `shadow-sm` max · NO card-in-card.

---

## §8 · INBOUND CALL FLOW (§3.9 features that MUST keep working · repeat here for emphasis)

Sam's hot path. See §3.9 for the full feature list. Specific rules:
- Cmd+C the GV number → 2s clipboard poll → dialog opens → auto-mic → live transcription → field fills with emerald pulse → Save → fire-and-forget upload.
- Audio upload is **fire-and-forget** (was blocking 1-4s · bug fix 2026-06-11).
- Auto-mic respects user gesture window (was breaking · bug fix 2026-06-12).
- Both-sides audio is **explicit opt-in** via "🎧 Both sides" button (getDisplayMedia requires user gesture).
- 4 stages (display) over 6 enum values (storage) · always use `bucketOf()` for display.

---

## §9 · NOTIFICATION DISCIPLINE (3-layer guard · compact)

**Discord currently PAUSED.**
Every channel (Discord · Telegram · SMS · ntfy · email) has 3 layers:
1. Kill switch · `system_settings.<channel>_notifications_paused`
2. Rate limit · `<channel>_rate_limit` table + `should_post_to_<channel>(category, max)` PG fn · default 5/hour per category
3. Dedup · `<channel>_event_log` checks `(event_type, entity_id)` in 60min

Re-enable Discord:
```sql
UPDATE system_settings SET value='false' WHERE key='discord_notifications_paused';
UPDATE system_settings SET value=(SELECT value FROM system_settings WHERE key='discord_webhook_url_PAUSED_BACKUP')
  WHERE key IN ('discord_webhook_url','discord_webhook_url_recruiting');
```

---

## §10 · CREDENTIAL MAP + RESUME

**Credentials** (`~/.config/apex-creds/` · chmod 600):
- `supabase.anon` + `bot-sql.token` (only SQL access)
- `insuracloud.token` = `al_c11d6ba6...` (v1 API still 500ing server-side; `/api/deals` works via cookie)
- `insuracloud-session.cookie` (Playwright JSON format · powers /api/deals sync)
- `poke.token` (iPhone push)
- `telegram-bot.token` (chat_id 6018839640)

**Resume protocol** (when Sam says laptop is sleeping or implicit):
- Update `~/business-ops/session-state/active-work.md` with:
  - `status: in_progress`
  - `next:` one-line explicit next action
  - `auto_resume: true`
- Cron-fired headless Claude picks up.

**Ledgers:**
- `~/business-ops/session-state/active-work.md` (live in-flight)
- `~/business-ops/website-integrity-bot/ledger/sam-punch-list-backlog.jsonl`
- `~/.claude/projects/-Users-samjames/memory/MEMORY.md`
- `~/business-ops/agentlink-reference/` (AgentLink screenshots)
- `~/business-ops/master-prompts/codex-plans/` (Codex outputs · don't trust blindly)

---

## §11 · COMMUNICATION DISCIPLINE

### Receipt template (Poke + Telegram on every meaningful ship)
```
🎯 <one-line headline>

✅ <Wave/feature> · <one-line description>
   <2-4 bullet details with REAL LIVE NUMBERS>
   <verify path on apex-financial.org>

📊 <live verification numbers>

🟡 NEXT (if queued): <what's coming>

🔥 Hold the Standard.
```

### Banned phrases
- "I'll plan it"
- "I recommend doing this later"
- "Should I…"
- Receipts without live numbers
- Receipts before build is verified live

### When Sam says "fix" / "ship" / "do it"
Execute. Do not ask for clarification on permission. Build + verify + push + receipt.

---

## §12 · DEBUG PLAYBOOK (6 steps · always in this order)

Sam reports "X broken / I see no Y / numbers wrong":

1. **Verify data in raw tables.** `bot-sql` · `SELECT COUNT(*) FROM <table>`.
2. **Test the view/RPC powering the UI.** `SELECT * FROM <view>` or `SELECT <rpc>()`.
3. **Check RLS** if auth-gated. Anon vs authenticated vs admin matters.
4. **Check the frontend query.** Wrong table? Wrong columns? Stale cache? Interaction gate blocking?
5. **Verify live deploy.** `git rev-parse HEAD` vs Vercel chunk hash in `/assets/index-XXX.js`.
6. **Ship the smallest possible fix** with verify command in commit message.

Pattern recognition:
| Sam says | Likely cause |
|---|---|
| "I see no X" | UI fetch gate OR stale floor OR wrong RLS OR missing surface |
| "Numbers wrong" | period-window bug (`>=` vs `=` vs `BETWEEN`) OR legacy `deals` query OR Phoenix tz miss |
| "Doesn't look like AgentLink" | palette violation OR motion budget violation OR zone too high OR copy not personalized |
| "Site slow" | `select("*")` on visible page OR missing index OR view doing computation that should be cached |
| "X is broken (with no detail)" | Run §12 step 1 immediately · ask only after step 1 confirms data presence |

---

## §13 · THIS SESSION'S RECEIPTS (chronological)

50+ commits across 2026-06-12 → 2026-06-13. Highlights:
- `$117K phantom-revenue` bug fixed (both halves · view + chart + delta now use agentlink_deals_snapshot)
- `Audio recording` 3 stacked bugs fixed
- `Discord spam` killed + 3-layer guard locked
- `AgentLink reference` captured (`book.png/.html` · `biz.png/.html`)
- `/dashboard/business-analytics` shipped + Trophy Cabinet + 3 AI Insights + 4-tile Sales Challenges + 10-tab strip
- `/dashboard/team-analytics` shipped + Producer Deep-Dive sheet + producer_deep_dive() RPC
- `Ask Apex AI dock` shipped (no API key · pattern matches 8 questions against live views)
- `Motion + smoothness layer` (180ms · tab fade · stagger · shimmer · sheet smoother)
- `Landing hires fix` (gate-OR-timer · truth floor 95→104)
- `Landing applicants ticker` shipped 2026-06-13 (the "I see no applications" fix · landing_recent_applicants() + RecentApplicantsTicker)
- `Trophy Cabinet cumulative wins` shipped 2026-06-13 (v_trophy_cabinet view + UI mirror · AgentLink parity gap #1 closed)
- `100x dashboard atlas` (this document · 806 lines · replaces prompts 122/123/124)

---

## §14 · SAM-TEST (the one-paragraph check)

A fresh Claude reads ONLY this prompt and must answer correctly:
- The 3 audiences and what each needs
- The data precedence (AgentLink → snapshot → views → NEVER deals)
- The Phoenix tz rule + the BETWEEN rule
- The 12 dashboard surfaces and what each does
- How to verify any metric (the verify SQL pattern)
- How to debug "I see no X" (the §12 playbook)
- The strategic ladder for choosing next-up work
- The motion budget + palette discipline
- The receipt template

If a fresh Claude can't do all of the above from this prompt alone, the prompt needs more work.

---

## §15 · EVERY PIECE OF INFO · CATALOG

Sam: "should have every piece of info." Below: comprehensive references for everything else (beyond §3 Atlas).

### 15.1 · ALL 141 SQL VIEWS (grouped by purpose · 2026-06-13)

**AgentLink mirror (truth source):**
- `v_agentlink_book_truth` (today/week/month/total counters) · `v_agentlink_auth_health` · `v_agentlink_sync_health`

**Analytics (powers /business-analytics):**
- `v_business_analytics_summary` · `v_business_analytics_carriers` · `v_business_analytics_insights` · `v_sales_challenges` · `v_trophy_cabinet` · `v_team_analytics_producers`

**CEO/CFO rollups:**
- `v_ceo_command_center` (1 row · 37 cols) · `v_cfo_snapshot` · `v_manager_command_center` · `v_agent_command_center`

**Book of Business:**
- `v_book_by_month` · `v_carrier_production` · `v_carrier_book_summary` · `v_carrier_book_recon` · `v_carrier_money_leak` · `v_carrier_premium_data_gap` · `v_carrier_reconciliation` · `v_deals_leaderboard` · `v_deals_needing_real_policy` · `v_duplicate_active_subs` · `v_duplicate_policies` · `v_falloff_watch` · `v_ghost_deals` · `v_paid_applicants`

**Pipeline/Funnel:**
- `v_funnel_by_source` · `v_application_conversion_funnel` · `v_recruiting_inbox` · `v_recruiting_inbox_summary` · `v_recruiting_leaderboard` · `v_recruiter_pipeline` · `v_referral_pipeline`

**Next-step + nudges:**
- `v_next_step_candidate` · `v_next_step_current` · `v_next_step_funnel_health` · `v_next_step_manager_board` · `v_next_step_stuck_pool`

**Conduct/Strikes:**
- `v_conduct_command_center` · `v_recent_conduct_events` · `v_strike_summary` · `v_strike_trend` · `v_agent_strikes`

**Charges/Chargebacks:**
- `v_chargebacks_30d` · `v_lapses_30d_detail` · `v_charge_anomalies` · `v_charge_anomalies_unresolved` · `v_charge_trend` · `v_agent_charge_rollup`

**Licensing:**
- `v_licensing_kanban` · `v_licensing_stage_counts` · `v_licensing_stalled` · `v_pre_licensing_tracker`

**ReadyMode (dialer):**
- `v_readymode_today` · `v_readymode_pipeline_status` · `v_readymode_agent_today` · `v_readymode_coaching_queue` · `v_readymode_lead_source_roi` · `v_readymode_off_script` · `v_readymode_viral` · `v_readymode_ingest_health`

**Stripe/Payments:**
- `v_stripe_dunning_early_warning` · `v_stripe_dunning_watch` · `v_stripe_event_health` · `v_stripe_refund_watch` · `v_stripe_subscription_status` · `v_dunning_classification` · `v_lead_purchases_today` · `v_phantom_lead_purchases`

**Mentorship/Commerce:**
- `v_mentorship_by_tier` · `v_mentorship_payment_links` · `v_mentorship_pipeline` · `v_mercury_subscription_summary`

**Telegram/Inbox:**
- `v_telegram_dashboard` · `v_telegram_funnel` · `v_telegram_stuck_users` · `v_telegram_application_link`

**Content/Social:**
- `v_social_bot_dashboard` · `v_social_latest` · `v_cw_active_challenge` · `v_cw_active_outliers` · `v_cw_audience_split` · `v_cw_kpi_7d` · `v_cw_posts_today` · `v_cw_quota_streak` · `v_cw_recruiting_pipeline` · `v_cw_shot_vs_posted` · `v_cw_smb_bridge` · `v_culture_feed`

**Hires/Onboarding:**
- `v_recent_hires` · `v_recent_activations_alp` · `v_old_licensed_applicants` · `v_old_manager_applicants`

**Health/Audit:**
- `v_sync_health` · `v_sync_pipeline_health` · `v_cfo_sync_health_watch` · `v_cfo_cron_health` · `v_cfo_agent_activation_watch` · `v_cfo_dup_charge_watch` · `v_cfo_ica_paid_stuck` · `v_ica_paid_missing_data` · `v_launch_readiness` · `v_rls_audit`

**Calendar/Tasks:**
- `v_upcoming_calls` · `v_schedule_auto_events` · `v_sam_today_tasks` · `v_sam_week_tasks` · `v_sam_inbox` · `v_sam_builders_dashboard`

### 15.2 · PUBLIC RPCs (anon-callable · 13 total)
- `apex_dashboard_summary()` · header rollup (today/week/month/total + just_hired + stale_apps)
- `apex_daily_briefing()` · Sam's morning brief generator
- `apex_render_plaque(...)` · plaque PNG generator
- `apex_provision_licensed_applicant(...)` · admin licensee provisioning
- `apex_agent_book(...)` · per-agent book payload
- `cw_dashboard_payload(...)` · ContentWheel snapshot
- `landing_live_stats()` · public LiveStats RPC (active_agents · apps_30d · carriers)
- `landing_recent_hires(p_limit)` · public hires ticker
- `landing_recent_applicants(p_limit)` · public applicants ticker (NEW 2026-06-13)
- `landing_deal_highlights(...)` · deal-of-the-week
- `landing_next_step_for(...)` · public next-step pointer
- `landing_unclaimed_summary()` · stuck-app rollup
- `producer_deep_dive(p_user_id)` · single-producer JSON for deep-dive sheet

### 15.3 · EDGE FUNCTIONS (229 total · categorized by purpose)

**AgentLink ingest:** `agentlink-import` · `agentlink-cookie-sync`

**Sync orchestration:** `apex-bootstrap` · `apex-exec` · `apex-audit-engine` · `system-health-check` · `system-health-autopilot`

**Email send (Resend):** `send-email` · `send-notification` · `send-licensing-instructions` · `send-licensing-sequence` · `send-followup-emails` · `send-monthly-motivation` · `send-sam-morning-report` · `send-weekly-analytics` · `send-weekly-team-summary` · `send-winback-campaign` (and ~25 more)

**SMS send:** `send-sms-auto-detect` · `send-sms-via-email`

**Push/Notifications:** `send-push-notification` · `send-push-optin-email` · `apex-alert-dispatch`

**WhatsApp:** `send-whatsapp` · `send-whatsapp-onboarding-blast`

**Telegram:** `telegram-drain` · `telegram-webhook` · `siri-command`

**Discord:** `discord-webhook-notify` · `discord-leaderboards`

**Daily/Weekly/Monthly motivation:** `apex-morning-brief` · `apex-evening-report` · `apex-weekly-report` · `send-daily-producer-spotlight` · `send-daily-sales-leaderboard` · `send-license-milestone` · `send-milestone-reward` · `send-outstanding-performance` · `send-plaque-recognition` · `send-plaque-batch` · `send-top5-four-week-email`

**Checks (cron-triggered):** `check-abandoned-applications` · `check-churn-risk` · `check-comeback-milestones` · `check-daily-awards` · `check-daily-plaques` · `check-early-performance` · `check-low-aop-friday` · `check-monthly-milestones` · `check-overdue-tasks` · `check-recruiting-milestones` · `check-stale-onboarding` · `check-streak-milestones`

**Onboarding/Hire flow:** `welcome-new-agent` · `trigger-new-hire-flow` · `add-agent` · `agent-signup` · `applicant-checkin` · `applicant-magic-link` · `applicant-self-report` · `bulk-resend-course-emails` · `bulk-send-licensing` · `setup-agent-password` · `simple-login` · `verify-magic-link` · `verify-nipr` · `validate-signup-token`

**ReadyMode:** (handled via cron-triggered net.http_post to `readymode-sync-pull`)

**Stripe/Payments:** `stripe-sync` · `stripe-webhook-lead-purchase`

**Application intake:** `submit-application` · `update-application-referral` · `update-user-email`

**AI (Anthropic/OpenAI):** `ai-assistant` · `ai-lead-insights` · `analyze-call-transcript` · `analyze-content-item` · `apex-mcp` (Anthropic MCP) · `proactive-coaching` (via send-proactive-coaching)

**Social/Content:** `send-instagram-dm` · `tiktok-dm-drafter`

**Tracking:** `track-email-click` · `track-email-open` · `unsubscribe`

**Admin SQL:** `bot-sql` · `admin-sql`

**Xcel (NIPR sync):** `xcel-gmail-pull` · `xcel-import`

**Calendly:** `calendly-webhook`

**Test:** `test-email-flows`

### 15.4 · CRON JOBS (pg_cron · 30+ active jobs)

Critical jobs (every minute):
- `apex-agentlink-watchdog-1m` · ensures agentlink sync isn't stuck
- `apex-insuracloud-sync-1m` · pulls AgentLink data
- `apex-sync-health-refresh-1m` · refreshes v_sync_health
- `pl088_license_milestone_drain` · processes pending milestones

Every 5 minutes:
- `agentlink-live-pull` · `agentlink_reap_stuck_5min` · `pl081_system_health_autopilot` · `poke-pusher-drain` · `readymode-sync-pull` · `telegram_drain_5min`

Every 15 minutes:
- `apex-system-health-check` · `cfo_backfill_orphan_failed_payments` · `cfo_backfill_orphan_lead_purchases` · `cfo_backfill_refund_sync` · `cfo_dedupe_phantom_lead_purchases` · `next_step_stall_sweep` · `telegram_inactivity_queue_15min`

Every 30 minutes:
- `notion_sync_drain` · `pl091_xcel_gmail_pull`

Hourly:
- `apex-applicant-nudges-hourly` (xx:23) · `next_step_nudge_sweep` (xx:07) · `recover_partial_applications_hourly` (xx:17)

Daily:
- `apex-daily-churn-check` (12:00 UTC) · `apex-licensing-sequences` (14:00) · `apex-manager-daily-digest` (13:00 Mon-Sat) · `apex-numbers-reminder` (21:00 weekdays) · `apex-schedule-auto-populate` (12:11) · `commission_ledger_reconcile_daily` (09:00) · `next_step_recompute_all` (03:00)

### 15.5 · LAUNCHD DAEMONS (bot processes on Sam's Mac)

Currently running (subset):
- `com.samjames.apex.dispatcher` (PID 1668) · main dispatcher
- `com.samjames.apex.agentlink-sync` · 30-min AgentLink pull
- `com.samjames.apex.telegram-bot` · Telegram bot daemon
- `com.samjames.apex.imessage-business-scanner` · iMessage business inbound
- `com.samjames.apex.drop-zone-watcher` · Dropbox drop-zone
- `com.samjames.apex.outreach-watcher` · outreach pipeline
- `com.samjames.apex.social-scraper` · social ingest
- `com.samjames.apex.cfo-wrappers` · CFO automation
- `com.samjames.apex.archive` · archive sweeper
- `com.samjames.apex.ig-reels-harvest` · IG reels harvest
- `com.agencyhubos.iphone-watcher` (PID 1708) · iPhone bridge
- `com.agencyhubos.dropbox-pusher` (PID 2811) · Dropbox push
- `com.agencyhubos.sd-card-watcher` (PID 1664) · SD-card auto-ingest
- `com.agencyhubos.telegram-command-bridge` (PID 1719) · Telegram→Mac bridge
- `com.agencyhubos.sd-card-purger` · `com.agencyhubos.caffeinate`

Status check: `launchctl list | grep -E "apex|agencyhub"` · running ones have PID, idle have `-`.

### 15.6 · WHERE TO FIND WHAT (one-look index)

| Looking for | Location |
|---|---|
| One-row CEO rollup | `v_ceo_command_center` (37 cols) |
| Today/week/month deals + premium | `v_agentlink_book_truth` |
| /business-analytics KPIs | `v_business_analytics_summary` |
| /business-analytics carrier ranks | `v_business_analytics_carriers` |
| /business-analytics insight cards | `v_business_analytics_insights` |
| Sales challenges (D/W/M/Q tiles) | `v_sales_challenges` |
| Trophy Cabinet cumulative wins | `v_trophy_cabinet` |
| /team-analytics list | `v_team_analytics_producers` |
| Per-producer drill | `producer_deep_dive(p_user_id)` |
| Public ticker · hires | `landing_recent_hires(limit)` |
| Public ticker · applicants | `landing_recent_applicants(limit)` |
| Public live-stats counters | `landing_live_stats()` |
| Dashboard summary RPC | `apex_dashboard_summary()` |
| All carrier book joins | `v_carrier_book_summary` · `v_carrier_book_recon` |
| Sync health (the truth) | `v_sync_health` · `v_sync_pipeline_health` |
| Chargebacks last 30d | `v_chargebacks_30d` |
| Lapses last 30d | `v_lapses_30d_detail` |
| Strikes/conduct | `v_strike_summary` · `v_conduct_command_center` |
| Next-step nudge state | `v_next_step_current` · `v_next_step_stuck_pool` |
| ReadyMode dialer status | `v_readymode_today` · `v_readymode_pipeline_status` |
| Stripe dunning | `v_stripe_dunning_watch` · `v_stripe_dunning_early_warning` |
| Mentorship payment links | `v_mentorship_payment_links` |
| Telegram status | `v_telegram_dashboard` |

### 15.7 · IF SOMETHING TOTALLY UNFAMILIAR
1. Search Claude's session memory · `MEMORY.md`
2. Check master prompts in order (125 → 124 → 123 → 122 → 121 → 120)
3. Grep the codebase for the symbol
4. Run `SELECT pg_get_viewdef('v_X', true)` for any view
5. Run `SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname='X'` for any RPC
6. Check this prompt's §3 Atlas + §5 Accuracy Contract

---

## §16 · FINAL CHECKSUM (what's verified live as of 2026-06-13)

Counts validated against production at write-time:
- **522 applications** (`SELECT COUNT(*) FROM applications`)
- **1,278 deals** in agentlink_deals_snapshot
- **$1.69M** total annual premium
- **104 active agents** (was floor 95, bumped 2026-06-13)
- **22 carrier partners**
- **141 SQL views** (all listed in §15.1)
- **13 public RPCs** (all listed in §15.2)
- **229 edge functions** (categorized in §15.3)
- **30+ pg_cron jobs** (categorized in §15.4)
- **26/26 routes** returning HTTP 200
- **Build green** · tsc 0 · last commit `e396d798`

If any of these counts have drifted significantly when reading this prompt later, re-run the queries in §5 + the catalog in §15 to refresh.

---

**Hold the Standard. Average is the disease.**


---

## §17 · AGENTLINK FULL SIDEBAR PARITY MATRIX (sourced from real capture 2026-06-13)

Captured via Playwright from `/business-analytics` sidebar — AgentLink's complete navigation tree:

### Dashboard section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Overview | ✅ | `/dashboard` (AgentCommandDashboard) |
| Notifications | ⚠️ | partial · NotificationBell in sidebar header · no full page |
| Announcements | ❌ | not implemented |
| News Feed | ❌ | not implemented |
| Post a Deal | ❌ | not implemented · AgentLink lets agents post wins to a feed |

### Workspace section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Pipeline | ✅ | `/dashboard/agent-pipeline` and `/dashboard/recruit-pipeline` |
| Calendar | ⚠️ | route exists at `/dashboard/calendar` · not in sidebar |
| My Phone | ✅ | `/dashboard/inbound-leads` (call cockpit) + `/dashboard/calls-today` |
| AI Assistant | ✅ | Ask Apex AI dock on every dashboard route |

### My Business section
| AgentLink item | We have? | Path / status |
|---|---|---|
| My Team | ✅ | `/dashboard/team-analytics` and `/dashboard/my-team` |
| Book of Business | ✅ | `/dashboard/book-of-business` (1278 deals · 10-col table) |
| Business Analytics | ✅ | `/dashboard/business-analytics` (★ flagship · 10-tab strip) |
| Finances | ❌ | CFO bot lives off-site at `~/business-ops/finance-bot/` · no in-app page |

### Contracting section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Invite Agent | ⚠️ | `add-agent` edge fn exists · no dedicated page |
| Contract Requests | ✅ | `/dashboard/contracts` (CarrierContracts) |
| Transfer Requests | ❌ | not implemented |
| Commission Grids | ⚠️ | `v_agent_revenue_estimate` exists · no UI |
| Annuity Training | ❌ | not implemented |
| **Carriers (Resources)** | ✅ | `/dashboard/carriers` shipped 2026-06-13 — mirrors AgentLink's carrier resource cards (logo, phone, website, best-for tags, View Resources + Contract actions) |

### Resources section
| AgentLink item | We have? | Path / status |
|---|---|---|
| New Agent Guide | ⚠️ | `/dashboard/getting-started` exists · could expand |
| Agent Handbook | ❌ | not implemented |
| Scripts | ⚠️ | Switch Center script in inbound-leads · no central library |
| State Licenses | ⚠️ | `/dashboard/pre-licensing` exists · not labeled as State Licenses |
| Agent Academy | ✅ | `/course-catalog` (Apex Course) + `/dashboard/admin/content-command` |

### Back Office section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Case Design | ❌ | not implemented · AgentLink's case-builder tool |
| Advanced Desk | ❌ | not implemented · case-runner for complex policies |
| Recruiting Funnels | ⚠️ | `/admin/recruiting-inbox` + `/dashboard/recruit-pipeline` |
| Recruiting Tracker | ⚠️ | merged into `/dashboard/applicants` and `/dashboard/whales` |
| Client Marketing | ❌ | not implemented |

### Tools section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Needs Analysis Calculator | ❌ | not implemented |
| Quoter | ❌ | not implemented |
| Leads | ⚠️ | `/dashboard/lead-center` exists |
| Inbound Calls | ✅ | `/dashboard/inbound-leads` + `/dashboard/calls-today` |

### Account section
| AgentLink item | We have? | Path / status |
|---|---|---|
| Help Center / FAQ | ❌ | not implemented |
| Producer Profile | ⚠️ | `/dashboard/settings` partial |
| My Landing Page | ❌ | not implemented |
| Calling Cards | ❌ | not implemented |
| Challenges | ✅ | `/dashboard/challenges` |

### Sign Out
| AgentLink item | We have? | Path / status |
|---|---|---|
| Sign Out | ✅ | sidebar logout button |

---

## §18 · IMMEDIATE QUEUE (ranked by recruiting leverage)

From §17 gaps · highest impact for "look what we built":

1. **`/dashboard/announcements`** + **News Feed** · 1-page wins · easy to mock with `v_culture_feed` (we already have the view)
2. **Post a Deal** flow · feeds `v_culture_feed` · ties into Discord (currently paused) + landing ticker
3. **Finances page** · expose `v_cfo_snapshot` · CFO bot already produces the data
4. **Scripts library** · centralize from inbound-leads Switch Center · new route + content
5. **Producer Profile** · agent-facing self-edit page · ties to existing `agents` + `profiles` tables
6. **Help Center / FAQ** · static · CFO-style page from existing markdown
7. **Recruiting Funnels** · expand `/admin/recruiting-inbox` into multi-step visualization
8. **Annuity Training** + **Commission Grids** · pull from existing data
9. **Calendar in sidebar** · existing route just not exposed in nav
10. **Needs Analysis Calculator + Quoter** · larger build · queue for L-effort

---

## §19 · CARRIER RESOURCES PAGE (live 2026-06-13)

`/dashboard/carriers` — mirrors AgentLink's `/carriers`:
- 16 carrier cards from `agentlink_carriers`
- Per-carrier 30d production from `v_business_analytics_carriers`
- `BEST_FOR` mapping (Final Expense · Whole Life · IUL · Term · Annuity · etc.) per carrier
- Click "View Resources" → carrier's website (new tab)
- Click "Contract" → `/dashboard/contracts`

When AgentLink's carrier-plans / carrier-product detail endpoint becomes accessible (currently 404 with cookie), expand into per-plan tiles per carrier.


---

## §20 · 2026-06-13 PARITY SWEEP · SHIPS

Continued from §17 immediate queue. Sprint shipped in one session, all builds tsc-clean.

| # | Sidebar | Route | Built On |
|---|---|---|---|
| 1 | Carrier Resources | `/dashboard/carriers` | `agentlink_carriers` + `v_business_analytics_carriers` + static BEST_FOR map |
| 2 | Announcements | `/dashboard/announcements` § Announcements | `announcements` table (3 seeded) |
| 3 | (same page) § News Feed | `/dashboard/announcements` § feed | `v_culture_feed` (157 events) · refetch 30s |
| 4 | Post a Deal | `/dashboard/announcements` button | New RPC `fn_post_deal_celebration(p_agent_id, p_premium, p_product, p_note)` · SECURITY DEFINER → `culture_events` INSERT |
| 5 | Finances | `/dashboard/finances` (admin only) | `v_cfo_snapshot` + `v_cfo_dup_charge_watch` + `v_cfo_ica_paid_stuck` + `v_cfo_agent_activation_watch` + `commission_ledger` + `cfo_approval_requests` |
| 6 | Scripts | `/dashboard/scripts` | New `sales_scripts` table (10 seeded · inbound/objections/recruiting/brand) |

Backfill executed same session:
- `agents.al_user_id` populated for 61/156 by direct copy from `insuracloud_user_id` (they share the same numbering).
- Remaining 95 surfaced via `v_agents_missing_al_user_id` for manual name-match.

---

## §21 · STILL OPEN AFTER §20

From §17 parity matrix:

P1:
- Producer Profile · agent-facing self-edit
- Help Center / FAQ · static
- New Agent Guide expansion (route exists but thin)
- Calendar in sidebar (route exists but hidden)
- Transfer Requests · contracting
- Commission Grids UI · view exists, no page

P2:
- Recruiting Funnels expansion (route exists)
- Recruiting Tracker dedicated route
- Agent Handbook
- Annuity Training
- News Feed posting expansion (currently agents can post deals; let admins post news items beyond announcements)
- Client Marketing
- My Landing Page (per-agent public landing)
- Calling Cards

P3 (large builds):
- Needs Analysis Calculator
- Quoter
- Case Design (multi-step case builder)
- Advanced Desk (case runner for complex policies)


---

## §22 · 2026-06-13 PARITY SWEEP · ALL §21 P1 SHIPPED

§21 P1 queue cleared in one continuous session, all live on apex-financial.org.

| # | Sidebar | Route | Built On |
|---|---|---|---|
| 1 | Producer Profile | `/dashboard/profile` | `profiles` (edit) + `agents` (read-only stats panel) |
| 2 | Help Center | `/dashboard/help` | Static · 21 hand-curated FAQ across 7 categories |
| 3 | Calendar (sidebar exposure) | `/dashboard/calendar` | Route already existed · now visible |
| 4 | Transfer Requests | `/dashboard/transfers` | New `transfer_requests` table + RLS + `v_transfer_requests` |
| 5 | Commission Grids | `/dashboard/commission-grids` | Seeded 15 carriers + 22 products + 22 schedules · new `v_commission_grid` LATERAL JOIN |

Sidebar now has **11 newly-exposed AgentLink-parity items** in this 2-day sweep:
Carrier Resources · Announcements · Producer Profile · Calendar · Transfer Requests · Commission Grids · Help Center · Finances · Scripts · (and Post a Deal CTA on Announcements).

