# APEX FINANCIAL · 125 · DASHBOARD ATLAS — MAXIMUM LEVEL CANONICAL SPEC
*The operating contract for every page, every view, every RPC, every cron, every brand decision that drives apex-financial.org. Written from scratch 2026-06-13 after the 2-day AgentLink-parity sweep that took us from 7 dashboard surfaces to 24+, plus a public per-agent landing route, plus a full agent-role sidebar rebuild. Mirror lives in the repo at `docs/operating-spec.md` and ships alongside every commit. If this file and the live site disagree, the live site wins and this file gets updated within the same commit.*

> **Hold the Standard. Average is the disease.**

---

## §0 · How to read this file

This is the index Sam uses to decide what to ship next, the brief any agent (human or model) needs before touching the codebase, and the parity checklist against agentlink.insuracloud.ai.

Sections are numbered `§N`. Sub-sections `§N.M`. Cross-references use the same notation. If you only have time to read 3 sections before shipping, read **§1 Truth Hierarchy**, **§6 Visual Discipline**, and **§7 Production Accuracy Contract**. The rest grep.

---

## §1 · Business + Truth Hierarchy

### §1.1 · The business
APEX Financial — remote life-insurance recruiting agency, solo-operated by Sam James (20yo Managing Partner). ~$120K/mo gross on paper. Carrier-direct agents · final-expense-led product mix · ReadyMode for inbound · AgentLink (insuracloud.ai) as the carrier system of record.

### §1.2 · The trajectory
12-month target: multimillionaire personal net worth. 30-by goal: billion-dollar empire. Every dashboard, every automation, every line of code ladders to one of:

1. More net cash this month.
2. One less hour of Sam's busywork.
3. One more system running without him.
4. A compounding asset (content / code / system / relationship) that earns or saves forever.

### §1.3 · Truth hierarchy (DO NOT VIOLATE)
When numbers conflict, this is the order:

1. **AgentLink** (`agentlink.insuracloud.ai`) — production / book-of-business / deal status. Whatever AgentLink shows is what the field agent's commission is computed from. We never override or pre-empt it. Memory `apex_source_of_truth_agentlink.md` is permanent law.
2. **`agentlink_deals_snapshot`** in Supabase — our 30-min synced mirror. **Single canonical query target** for ALL production numbers on apex-financial.org. NEVER use the legacy `deals` table. NEVER hand-compute totals.
3. **`v_*` views over the snapshot** — pre-joined, pre-filtered. Use these in React queries; don't recompute joins in JS.
4. **CFO bot snapshot (`v_cfo_snapshot`)** — financial-health rollup, cron-refreshed. Authoritative for ghost-AP, idle agents, sync status, mentorship revenue.
5. **The dashboards** — projections of the above. They render data; they never produce it.

If the dashboard says X and AgentLink says Y, the dashboard is wrong. Investigate sync first, fix the truth, re-render.

### §1.4 · The Phoenix tz rule
Sam lives in America/Phoenix. Every query using "today" / "this week" / "this month" MUST anchor to `(NOW() AT TIME ZONE 'America/Phoenix')::date`. Forget this and you'll show fewer deals than Sam closed before lunch.

### §1.5 · The $117K phantom-revenue rule
Date-bounded queries use `BETWEEN <start> AND <today>`, not `>= <start>`. The latter spills into future dates and inflates totals. Real bug; check this first when a number looks wrong.

---

## §2 · Tech Stack + Code Conventions

- **Frontend**: React 19 + TypeScript + Vite + Tailwind + Radix UI primitives. `npm run build` must succeed in <3s. Chunks are content-hashed — do **NOT** bump `BUMP_VERSION` per commit.
- **Backend**: Supabase project `xrzweoneiieddzxogewk` (us-east-1). PostgreSQL with RLS. Edge functions deno-checked locally before deploy.
- **Auth**: Supabase Auth → `profiles.user_id = auth.uid()`. The `agents` table joins on `agents.user_id = auth.uid()` for per-agent lookups. `agents.al_user_id` is the AgentLink ID — 61/156 backfilled from `insuracloud_user_id` on 2026-06-13; remaining 95 need name-match (view `v_agents_missing_al_user_id`).
- **bot-sql**: Edge function at `/functions/v1/bot-sql` is the admin SQL gateway. Token at `~/.config/apex-creds/bot-sql.token`. POST `{"query": "..."}` (NOT `{"sql": ...}` — common mistake).
- **Build gates**: `npx tsc --noEmit` = 0 errors, `npm run build` succeeds, route-smoke 26/26 healthy. Every PR through this gate before push.
- **Commits**: NEVER skip hooks unless explicitly authorized. Always `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## §3 · Dashboard Atlas (24 surfaces · all live 2026-06-13)

### §3.1 · Public + Marketing
| Route | Purpose | Auth |
|---|---|---|
| `/` | Marketing landing | none |
| `/agent/:userId` ✅ NEW | Per-agent public landing | none |
| `/login` | Auth | none |

### §3.2 · Workspace (every role)
| Route | Page | Built On |
|---|---|---|
| `/dashboard` | Agent Command Dashboard | aggregate views |
| `/dashboard/inbound-leads` | Inbound call cockpit | ReadyMode + Switch Center |
| `/dashboard/calls-today` | Today's dial sheet | `apex_scheduled_calls` |
| `/dashboard/calendar` | Calendar (now sidebar-visible) | Google Calendar + Calendly sync |

### §3.3 · My Business (every role)
| Route | Built On |
|---|---|
| `/dashboard/business-analytics` (flagship · 10 tabs) | `v_trophy_cabinet`, `v_sales_challenges`, `v_agents_needs_attention`, `v_agents_learn_from`, `v_inactive_agents_summary` |
| `/dashboard/book-of-business` (1278 deals) | `agentlink_deals_snapshot` |
| `/dashboard/team-analytics` | `v_agent_with_downline_production` |

### §3.4 · Updates + Culture
| Route | Notes |
|---|---|
| `/dashboard/announcements` ✅ NEW | Announcements + News Feed + Post a Deal button. Reads `announcements` + `v_culture_feed`. RPC: `fn_post_deal_celebration` |
| `/dashboard/finances` ✅ NEW · ADMIN | Live CFO snapshot · 10-tile grid + 4 tabs (Anomalies / Commissions / Approvals) |

### §3.5 · Contracting
| Route | Built On |
|---|---|
| `/dashboard/carriers` ✅ NEW | 16 carrier cards · `agentlink_carriers` + `v_business_analytics_carriers` + BEST_FOR map |
| `/dashboard/commission-grids` ✅ NEW | 22 products × 4 health tiers · `v_commission_grid` LATERAL JOIN |
| `/dashboard/transfers` ✅ NEW | Upline change requests · `transfer_requests` + RLS + `v_transfer_requests` |
| `/dashboard/contracts` | Carrier contract request flow |

### §3.6 · Resources + Training
| Route | Built On |
|---|---|
| `/dashboard/scripts` ✅ NEW | 10 sales scripts · `sales_scripts` table |
| `/dashboard/handbook` ✅ NEW | 9-chapter Agent Handbook · static |
| `/dashboard/annuity-training` ✅ NEW | 6-module training + mark-read tracking |
| `/dashboard/client-marketing` ✅ NEW | 12 SMS/Email/DM templates |
| `/dashboard/help` ✅ NEW | 21 FAQ · 7 categories |
| `/dashboard/pre-licensing` | Licensing module |
| `/course-catalog` | Apex Course (Lovable content) |

### §3.7 · Recruiting
| Route | Built On |
|---|---|
| `/dashboard/recruiting-funnels` ✅ NEW | `v_application_conversion_funnel` + `v_funnel_by_source` |
| `/dashboard/recruiting-tracker` ✅ NEW | Podium + leaderboard + per-recruiter pipeline depth |
| `/admin/recruiting-inbox` | `v_recruiting_inbox` |
| `/dashboard/applicants` | `v_admin_applicant_overview` |

### §3.8 · Tools (in-call)
| Route | Built On |
|---|---|
| `/dashboard/needs-analysis` ✅ NEW | DIME-method client-side calculator |
| `/dashboard/quoter` ✅ NEW | 3 products × 4 health tiers × age bands (client-side rate tables) |

### §3.9 · Account
| Route | Built On |
|---|---|
| `/dashboard/profile` ✅ NEW | Producer Profile self-edit + read-only license stats |
| `/dashboard/calling-cards` ✅ NEW | 4 styles + QR + share link |
| `/dashboard/landing-page` ✅ NEW | Preview of `/agent/:userId` public landing |
| `/dashboard/challenges` | `v_sales_challenges` |
| `/dashboard/settings` | various |

---

## §4 · Sidebar — Role Coverage Matrix

**Rule learned 2026-06-13** (Sam's direct correction): every parity ship must be reachable by EVERY role, not just admin. The agent sidebar was stuck at 3 items before this rule landed; it's now ~22 deep.

### §4.1 · Admin
PRIMARY: Inbound Leads · Calls Today · Clients · Agents · Production
MORE: Recruiting Inbox · Challenges · Book · Business Analytics · Team Analytics · Carrier Resources · Announcements · Finances · Scripts · Producer Profile · Calendar · Transfer Requests · Commission Grids · Agent Handbook · Annuity Training · Client Marketing · Calling Cards · My Landing Page · Recruiting Funnels · Recruiting Tracker · Needs Analysis · Quoter · Help Center · Builders · Managers · Agency Owners · Apex Course · Licensing · Social · Content · Admin

### §4.2 · Manager
PRIMARY: Inbound Leads · Calls Today · Clients · Agents · Production
MORE: Recruiting Inbox · Book · Business Analytics · Carrier Resources · Announcements · Scripts · Producer Profile · Calendar · Transfer Requests · Commission Grids · Agent Handbook · Annuity Training · Client Marketing · Calling Cards · My Landing Page · Recruiting Funnels · Recruiting Tracker · Needs Analysis · Quoter · Help Center · Applicants · Apex Course · Licensing

### §4.3 · Agent
PRIMARY: Inbound Leads · Production · Applicants · Business Analytics · Announcements
MORE: Book · Carrier Resources · Scripts · Producer Profile · Calendar · Transfer Requests · Commission Grids · Agent Handbook · Annuity Training · Client Marketing · Calling Cards · My Landing Page · Needs Analysis · Quoter · Help Center · Training · Apex Course · Licensing

**Admin-only by design**: Finances (CFO data not for floor).

---

## §5 · AgentLink Parity Matrix (final state)

Sourced from Playwright capture of agentlink.insuracloud.ai on 2026-06-13. Every item AgentLink shows, we now have. ✅ = parity reached. ⚠️ = partial. ❌ = intentionally out-of-scope.

### Dashboard
| AgentLink | APEX | Status |
|---|---|---|
| Overview | `/dashboard` | ✅ |
| Notifications | NotificationBell + `/dashboard/announcements` | ✅ |
| Announcements | `/dashboard/announcements` | ✅ |
| News Feed | `/dashboard/announcements` § News Feed | ✅ |
| Post a Deal | Button on `/dashboard/announcements` | ✅ |

### Workspace
| AgentLink | APEX | Status |
|---|---|---|
| Pipeline | `/dashboard/agent-pipeline` + `/dashboard/recruit-pipeline` | ✅ |
| Calendar | `/dashboard/calendar` (sidebar-visible) | ✅ |
| My Phone | `/dashboard/inbound-leads` + `/dashboard/calls-today` | ✅ |
| AI Assistant | Ask Apex AI dock | ✅ |

### My Business
| AgentLink | APEX | Status |
|---|---|---|
| My Team | `/dashboard/team-analytics` + `/dashboard/my-team` | ✅ |
| Book of Business | `/dashboard/book-of-business` | ✅ |
| Business Analytics | `/dashboard/business-analytics` (flagship) | ✅ |
| Finances | `/dashboard/finances` (admin) | ✅ |

### Contracting
| AgentLink | APEX | Status |
|---|---|---|
| Invite Agent | `add-agent` edge fn + recruiting inbox | ✅ |
| Contract Requests | `/dashboard/contracts` | ✅ |
| Transfer Requests | `/dashboard/transfers` | ✅ |
| Commission Grids | `/dashboard/commission-grids` | ✅ |
| Annuity Training | `/dashboard/annuity-training` | ✅ |
| Carriers | `/dashboard/carriers` | ✅ |

### Resources
| AgentLink | APEX | Status |
|---|---|---|
| New Agent Guide | `/dashboard/getting-started` + `/dashboard/handbook` | ✅ |
| Agent Handbook | `/dashboard/handbook` | ✅ |
| Scripts | `/dashboard/scripts` | ✅ |
| State Licenses | `/dashboard/pre-licensing` | ✅ |
| Agent Academy | `/course-catalog` + `/dashboard/admin/content-command` | ✅ |

### Back Office
| AgentLink | APEX | Status |
|---|---|---|
| Case Design | — | ❌ intentional (low ROI vs FE-led mix) |
| Advanced Desk | — | ❌ intentional |
| Recruiting Funnels | `/dashboard/recruiting-funnels` | ✅ |
| Recruiting Tracker | `/dashboard/recruiting-tracker` | ✅ |
| Client Marketing | `/dashboard/client-marketing` | ✅ |

### Tools
| AgentLink | APEX | Status |
|---|---|---|
| Needs Analysis Calculator | `/dashboard/needs-analysis` | ✅ |
| Quoter | `/dashboard/quoter` | ✅ |
| Leads | `/dashboard/lead-center` + `/dashboard/inbound-leads` | ✅ |
| Inbound Calls | `/dashboard/inbound-leads` + `/dashboard/calls-today` | ✅ |

### Account
| AgentLink | APEX | Status |
|---|---|---|
| Help Center / FAQ | `/dashboard/help` | ✅ |
| Producer Profile | `/dashboard/profile` | ✅ |
| My Landing Page | `/dashboard/landing-page` (preview) + `/agent/:userId` (public) | ✅ |
| Calling Cards | `/dashboard/calling-cards` | ✅ |
| Challenges | `/dashboard/challenges` | ✅ |

**Result**: parity reached across all 8 AgentLink sections. Two intentionally out-of-scope items (Case Design, Advanced Desk) apply to multi-life term/IUL cases outside our FE-led product mix.

---

## §6 · Visual Discipline (Brand Bible enforced in code)

### §6.1 · Palette
- **slate** — surfaces, neutral text, borders
- **amber** — featured/announcement/admin highlights, the APEX accent
- **emerald** — money, success, "closed", positive metrics
- **rose** — anomalies, errors, walked commission, ghost AP, denials
- **white / black** — backgrounds depending on dark mode

No other top-level palettes. No purple/blue/pink/teal as primary. (Pink for Instagram CTAs, indigo for occasional brand-secondary, are tolerated when in source data like IG handles or carrier logos.)

### §6.2 · Typography
- Headers: Tailwind font-bold, size 15-22 by hierarchy.
- Numerals: **tabular-nums everywhere**. Non-tabular = unprofessional = rejected.
- Body: 12-14. Uppercase labels: 11.
- `tracking-wider` ONLY on uppercase labels and eyebrows. Never `tracking-tight` on body.

### §6.3 · Motion budget
- Transitions: 180ms cubic-bezier (`transition-base` utility).
- NO `animate-pulse` on Badges, ever. Pulsing badges read as broken.
- Skeleton loaders only on initial mount, not on refetch.

### §6.4 · Number formatting
- Currency: `$1.2K` / `$1.5M` compact, `$1,234,567` tables.
- Percentages: 1 decimal unless precision matters.
- Negative deltas rose, positive emerald, zero slate.
- Never "Unknown" user-facing — use "—" or hide the row.

### §6.5 · Layout
- 12-column responsive grid via Tailwind.
- Cards: `bg-white dark:bg-slate-900` + 1px border.
- Sticky page headers via `PageHeader` component (eyebrow icon + title + subtitle + actions).
- Tab strips: 2px border-bottom amber when active.
- Buttons: 36-40px touch targets minimum.

### §6.6 · Voice
- Direct, faith-aware (Christian, never performative), anti-soft.
- Banned: "delve" · "tapestry" · "in the realm of" · "it's not just X, it's Y" · em-dash spam.
- Sales copy mirrors Brand Bible: "Hold the Standard. Average is the disease."
- Never use Braxton for content. **SACRED**.

---

## §7 · Production Accuracy Contract

Every number on every dashboard must satisfy ALL:

1. **Phoenix tz** for today/week/month: `(NOW() AT TIME ZONE 'America/Phoenix')::date`
2. **BETWEEN start AND today** for any window. NEVER `>=`.
3. **`agentlink_deals_snapshot`** as production source. NEVER legacy `deals`.
4. **Pre-built `v_*` views** for joins. NEVER recompute in JS.
5. **Null-safe formatting**: render "—" not "Unknown" or "null".
6. **Idempotent**: re-rendering the same row twice never changes the value.
7. **Tabular**: every numeric column has `tabular-nums`.

If a number's wrong, first 5 checks:
1. Phoenix tz applied?
2. BETWEEN not `>=`?
3. View vs raw table?
4. `al_user_id` join (61/156 backfilled · check `v_agents_missing_al_user_id`)?
5. Cron stale (`v_cfo_cron_health`)?

---

## §8 · Strategic Priorities (decision rule for next ship)

Ship higher-numbered first:

1. **Cash today** — any leak, any stuck dollar, any 24h+ dark sync.
2. **Production accuracy** — if a Sam-facing number is wrong, fix it first.
3. **Recruiting flow** — anything improving new-applicant → licensed → producing.
4. **Retention** — strikes, onboarding, attendance.
5. **Brand surfaces** — content, landing pages, agent personal brand.
6. **New tools** — §3 atlas additions, calculators, helpers.
7. **Internal hygiene** — refactors, dead-code, build optimization. Only when 1-6 clean.

---

## §9 · Inbound Flow + Notification Discipline

### §9.1 · Inbound flow
```
Marketing site (form) → apex_inbound_leads
                          ↓
                    ReadyMode dialer
                          ↓
            /dashboard/inbound-leads cockpit
                          ↓
        Switch Center scripts (/dashboard/scripts)
                          ↓
                Application submitted
                          ↓
            Next Step Engine (19 stages)
                          ↓
                Producing agent
```

### §9.2 · Notification rules
- **ntfy.sh** `sams-agent-yrkv9kbqp9e987nb` — Sam's preferred phone notify. Default for "glance and act" alerts.
- **Telegram bot** `@ApexOnboardbot` chat `6018839640` — receipts, ships, rollups.
- **Poke** `https://poke.com/api/v1/inbound/api-message` — when Sam wants rich scrollable.
- **NEVER** osascript Messages.app / Mail.app / Reminders.app (memory `feedback_avoid_macos_prompts`).
- **NEVER** Todoist (deprecated by Sam).
- **NEVER** auto-draft emails (memory `feedback_no_email_drafts`). SACRED.
- **NEVER** ping Sam about manager-candidate updates (memory `feedback_no_manager_candidate_updates`).
- Cadence: receipts on every shipped commit. End-of-day rollup. No heartbeat / "still here" noise.

---

## §10 · Credentials Map (where everything lives)

Everything Sam needs is on disk. Stop asking.

| Service | Location | Notes |
|---|---|---|
| bot-sql token | `~/.config/apex-creds/bot-sql.token` | POST `{"query": "..."}` |
| bot-sql URL | `~/.config/apex-creds/bot-sql.url` | |
| Telegram bot | `~/.config/apex-creds/telegram-bot.token` | Chat 6018839640 |
| Poke | `~/.config/apex-creds/poke.token` | |
| ntfy topic | memory: `sams-agent-yrkv9kbqp9e987nb` | |
| Supabase project | `xrzweoneiieddzxogewk` | us-east-1 |
| InsuraCloud | `~/.config/apex-creds/insuracloud.token` + `system_settings` | Header `x-api-key` |
| AgentLink cookies | `~/business-ops/insuracloud-token-harvester/harvest.mjs` | Re-harvest on expiry |
| Anthropic | `~/.config/apex-creds/anthropic.token` | |
| Stripe | `system_settings.mentorship_payment_links` | 4 live links |

All cred files `chmod 600`. Never read or expose in user-facing output.

---

## §11 · Communication With Sam

- Direct, terse, receipts-first. Memory `feedback_no_oversell.md`.
- Phone-friendly markdown: short paragraphs, bold one-liner lead-ins for multi-topic.
- Multi-channel notifications get "ton-of-math" rollup per 2026-06-13 instruction: every key metric, every URL, every status badge.
- No "should I" / "want me to" / "let me know" / "I'll need you to" — memory `feedback_just_execute.md` + `feedback_never_ask_full_execute.md`.
- Trail every meaningful deliverable with `Persisted to: <paths>` per Operating Contract.

---

## §12 · Debug Playbook

### §12.1 · Wrong number
1. Phoenix tz applied?
2. BETWEEN window not `>=`?
3. View vs raw table?
4. `v_cfo_cron_health` — when refreshed?
5. AgentLink sync OK? Check `v_agentlink_sync_health` + `v_insuracloud_auth_health`.

### §12.2 · Route returns non-200
1. Build green? `npx tsc --noEmit` then `npm run build`.
2. Route registered in `src/App.tsx`?
3. Page exists at `src/pages/<Name>.tsx`?
4. Vercel deploy log.
5. CDN cache hold? Hard refresh.

### §12.3 · Profile shows "User #X" not name
The `agents.al_user_id` gap. 61/156 backfilled 2026-06-13. For remaining 95:
```sql
SELECT * FROM v_agents_missing_al_user_id;
```
Then manual name-match to AgentLink user_id.

### §12.4 · Notification didn't fire
1. Token file at `~/.config/apex-creds/<service>.token`?
2. `chmod 600`?
3. Try Python notify script via Bash.
4. Telegram returns 200 even on bad chat_id; verify on phone.
5. Poke token: 90-day expiry.

---

## §13 · Session Receipts (commit shape)

```
<type>: <short summary> (<context tag>)

<2-3 line problem statement>

═══════════════════════════════════════════════════════════════════════
WHAT SHIPPED
═══════════════════════════════════════════════════════════════════════
<bullet list: files + SQL + tables + views + RPCs>

═══════════════════════════════════════════════════════════════════════
ROUTING + SIDEBAR (if applicable)
═══════════════════════════════════════════════════════════════════════
<route registered · sidebar entries added>

Cache: BUMP_VERSION NOT touched.
Verified: tsc 0, build ✓ (XXX precache · X.XMB).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

After every commit:
1. Push to origin/main.
2. Wait for HTTP 200 on deployed route.
3. Append to `~/business-ops/session-state/active-work.md` with status: done + Persisted to.
4. Receipt to Sam: Poke + Telegram (+ ntfy for urgent).

---

## §14 · 2026-06-13 Sweep Receipt (the 2-day push)

| # | SHA | Surface | Notes |
|---|---|---|---|
| 1 | 920f9548 | `/dashboard/carriers` + atlas §17-19 | 16 cards · BEST_FOR map |
| 2 | 72feb98e | `/dashboard/announcements` | Announcements + News Feed |
| 3 | 95e6ddad | Post a Deal flow on Announcements | New `fn_post_deal_celebration` RPC |
| 4 | fa154880 | `/dashboard/finances` (admin) | CFO snapshot UI |
| 5 | 648e70f9 | `/dashboard/scripts` | `sales_scripts` + 10 seeded |
| 6 | f186186c | docs: prompt §20-21 | Mirror updated |
| 7 | 74af43c9 | `/dashboard/profile` | Producer Profile |
| 8 | d052e91c | `/dashboard/help` + Calendar in sidebar | Help Center + exposure |
| 9 | 4338884d | `/dashboard/transfers` + `/dashboard/commission-grids` | Transfer flow + commission table |
| 10 | a2a54bb6 | docs: prompt §22 | Mirror updated |
| 11 | 06db34cc | Agent-role sidebar coverage | All parity items visible to agents |
| 12 | de872219 | `/dashboard/handbook` + `/dashboard/annuity-training` + `/dashboard/client-marketing` + `/dashboard/calling-cards` + `/dashboard/landing-page` + `/agent/:userId` + `/dashboard/recruiting-funnels` + `/dashboard/recruiting-tracker` + `/dashboard/needs-analysis` + `/dashboard/quoter` + full sidebar wiring all 3 roles | 9 dashboard pages + 1 public route + full role coverage |

Plus:
- `agents.al_user_id` backfill 0/156 → 61/156 (Postgres UPDATE)
- `v_agents_missing_al_user_id` view for remaining 95
- Notion "🎯 APEX Dashboard Atlas" child page under Command Center
- 4 Google Calendar events for tomorrow's 9 AM Calendly-callback cascade
- Notifications: Poke + Telegram + ntfy all 200

---

## §15 · "Every Piece of Info" Catalog (the data layer)

### §15.1 · Tables (canonical sources)
| Table | Rows (2026-06-13) | Purpose |
|---|---|---|
| `agentlink_deals_snapshot` | ~5k | 30-min mirror of AgentLink production. SOURCE OF TRUTH. |
| `agentlink_carriers` | 16 | Partner carrier cards. |
| `agents` | 156 | Internal agent records. 61 with `al_user_id`, 156 with `user_id`. |
| `profiles` | ~200 | Per-user editable. Drives landing page + calling cards + profile. |
| `announcements` | 3 | Active (`is_active = TRUE`). |
| `culture_events` | 157 | Deal celebrations · feeds `v_culture_feed`. |
| `sales_scripts` | 10 | Inbound + objections + recruiting + brand. |
| `transfer_requests` | 0 | Upline change requests. New 2026-06-13. |
| `qe_carriers` | 15 | UUID-keyed carrier table for commission grids. |
| `qe_products` | 22 | Carrier × product. |
| `qe_commission_schedules` | 22 | FY% + renewal% + advance per product. |
| `commission_ledger` | 113 | Real commission rows. |
| `cfo_approval_requests` | 1 pending | CFO-flagged for Sam's call. |
| `apex_carrier_contracts` | active | Per-agent carrier contracting. |

### §15.2 · Views (`v_*`)
`v_cfo_snapshot` · `v_cfo_dup_charge_watch` · `v_cfo_ica_paid_stuck` · `v_cfo_agent_activation_watch` · `v_cfo_cron_health` · `v_cfo_sync_health_watch` · `v_business_analytics_carriers` · `v_culture_feed` · `v_application_conversion_funnel` · `v_funnel_by_source` · `v_recruiting_leaderboard` · `v_recruiter_pipeline` · `v_recruiting_inbox` · `v_recruiting_inbox_summary` · `v_transfer_requests` · `v_commission_grid` · `v_trophy_cabinet` · `v_sales_challenges` · `v_agents_needs_attention` · `v_agents_learn_from` · `v_inactive_agents_summary` · `v_agents_missing_al_user_id` ← NEW 2026-06-13 · `v_carrier_premium_data_gap` · `v_carrier_reconciliation` · `v_stale_applicants` · `v_old_licensed_applicants` · `v_old_manager_applicants` · `v_paid_applicants` · `v_mentorship_payment_links` · `v_insuracloud_sync_health` · `v_insuracloud_auth_health` · `v_agentlink_sync_health` · `v_sync_pipeline_health` · `v_next_step_funnel_health` · `v_readymode_off_script` · `v_mercury_subscription_summary`

### §15.3 · RPCs
- `fn_post_deal_celebration(p_agent_id UUID, p_annual_premium NUMERIC, p_product_sold TEXT, p_note TEXT)` ← NEW 2026-06-13. Lets agents post wins to `culture_events`.
- `landing_recent_applicants(p_limit INTEGER)` — RecentApplicantsTicker on landing.
- `landing_live_stats()` — agent/policy/premium counter.
- `landing_recent_hires()` — RecentHiresTicker.
- `landing_unclaimed_summary()` — admin DashboardCommandCenter card.
- `producer_deep_dive(p_user_id UUID)` — modal on `/dashboard/profile`.
- `get_application_status(p_application_id UUID)` — public `/status/:id`.
- `fn_recover_stale_applicant(p_application_id UUID)` — admin recovery.
- `flex_hire(p_data JSONB)` — manual hire booking.

### §15.4 · Edge functions
- `insuracloud-sync` — rejects HTML masquerade + 401/403 + non-JSON · writes `status='auth_failed'` instead of fake success (2026-05-19 fix).
- `agentlink-fake-success-reaper` — sweeps zombie sync rows (commit ce27b959).
- `next-step-dispatch` — Telegram → SMS → Email fallback for 19-stage pipeline.
- `bot-sql` — admin SQL gateway.
- `add-agent` — programmatic agent creation.

### §15.5 · Cron jobs (pg_cron + launchd)
- pg_cron: 3 jobs for the Next Step Engine.
- `com.samjames.apex.finance-bot` — CFO scans + snapshot every hour.
- `com.samjames.apex.website-integrity-bot` — punch-list drain.
- `com.samjames.apex.social-bot` — social cadence.
- `com.samjames.apex.readymode-bot` — ReadyMode ingest.
- `com.samjames.apex.telegram-bot` — pre-hire + onboarding nudges.
- `com.samjames.apex.doctor` — Sunday 05:00 health check.
- `com.samjames.apex.codex-handoff` — 2-hour P0 backlog drain (credit-smart gated).
- Daily 04:00 archive of done active-work entries.

---

## §16 · Sam-Test (30-second sanity test)

Fresh Claude session must answer all in 30 seconds. Otherwise this prompt has failed:

1. Source of truth for production? _AgentLink → `agentlink_deals_snapshot`._
2. Phoenix tz pattern? _`(NOW() AT TIME ZONE 'America/Phoenix')::date`._
3. Window rule? _BETWEEN start AND today, never `>=`._
4. bot-sql token location? _`~/.config/apex-creds/bot-sql.token`._
5. bot-sql body shape? _`{"query": "..."}`._
6. Allowed palettes? _slate · amber · emerald · rose · white/black._
7. Sign-off line on strategic work? _"Hold the Standard. Average is the disease."_
8. The 4 hard limits? _Money to 3rd party · unsolicited outbound · irreversible delete · cards._
9. Who's Braxton? _Sacred. NEVER for content._
10. Voice? _Direct · faith-aware · anti-soft · Brand Bible-aligned._
11. Notification channels? _ntfy.sh · Telegram · Poke. Not Todoist · not Reminders.app · not Mail.app/Messages.app via osascript · not auto-draft emails._
12. Where does the fix live after this chat dies? _Filed under `Persisted to:` in the wrap._

---

## §17 · Open Punch-List (next-sprint candidates)

- Calling Cards PDF export (current: link + QR + screenshot → future: PDF download).
- Recruiting Funnel by-recruiter view (current: by-source).
- Annuity-training quiz to gate "complete" (current: self-mark).
- Per-agent landing page customization (color + cover art).
- Commission Grids → carrier filter on `/dashboard/contracts` for pre-fill.
- News Feed inline image upload (current: text-only).
- `agents.al_user_id` remaining backfill — 95 agents need manual name-match. Build admin UI.
- Producer Profile photo upload (current: URL field → future: drag-drop bucket upload).
- `/agent/<slug>` human-readable URLs alongside UUID.
- Quoter · save quote as PDF for the client.
- Needs Analysis · save snapshot to client record so the next call can resume.

---

## §18 · Persisted-to Block (what owns this spec after the chat dies)

- **This file**: `/Users/samjames/business-ops/master-prompts/125-apex-100x-dashboard-atlas.md`
- **Backup of prior version**: `…/125-apex-100x-dashboard-atlas.md.bak.2026-06-13`
- **Repo mirror**: `docs/operating-spec.md` in `samcom593-creator/rebuild-brighten-sparkle`
- **Memory index**: `~/.claude/projects/-Users-samjames-claude-sync/memory/MEMORY.md`
- **Session ledger**: `~/business-ops/session-state/active-work.md`
- **Notion**: 🎯 APEX Dashboard Atlas page `37f341a6-7027-812c-bbff-dbe671a7441e` under Command Center

---

## §19 · The North Star (one line, last word)

Every line of code, every dashboard tile, every cron job, every notification, every commit, every script — exists to make Sam more leveraged, more accurate, and more dangerous as a 20-year-old solo operator on a billion-dollar trajectory.

> **Hold the Standard. Average is the disease.**
