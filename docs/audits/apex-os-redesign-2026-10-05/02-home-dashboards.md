# 02 — Home / Dashboards (domain map, read-only)

Program: APEX OS redesign 2026-10-05. Repo `rebuild-brighten-sparkle` @ `4ea291c8` (main). DB: Supabase `xrzweoneiieddzxogewk`, measured live 2026-10-05 (Phoenix date `2026-10-05`).
Method: grep/sed on code, SQL `pg_get_functiondef`/`pg_get_viewdef` on the LIVE catalog (several Home RPCs are hand-applied and absent from `supabase/migrations/`), read-only `select` measurements. Every number below is measured unless marked **unmeasured**.

---

## 1. What exists

### 1.1 Route → component → role dispatch

| Route | File | Who lands here |
|---|---|---|
| `/dashboard` | `src/App.tsx:491` → `src/pages/Dashboard.tsx` (default export, `:975-1153`) | everyone authenticated; sidebar "Home" = `src/components/layout/agentCloudNavigation.ts:122,217`; mobile `MobileBottomNav.tsx:21,29,38,46` |
| `/dashboard/admin`, `/dashboard/legacy` | `src/App.tsx:548,560` → `src/pages/DashboardCommandCenter.tsx` (1,281 lines) | admin only (`requireAdmin`) — legacy command center |
| `/dashboard/command` | `src/App.tsx:604` | redirect → `/dashboard/admin` |
| `/agent-portal`, `/agent-dashboard` | `src/App.tsx:651-652` → `src/pages/AgentCommandDashboard.tsx` (5,039 lines) | any authenticated; mobile nav "Home" for agents points at `/agent-portal` (`MobileBottomNav.tsx:13`) |

`Dashboard.tsx` dispatch (`:1030-1152`), in order:

| Condition | Renders |
|---|---|
| `isVaOps` or `effectiveRole in (va, va_manager)` | `VaOpsCommandCenter` (`:1030-1042`) |
| `effectiveRole === "recruiter"` | `RecruiterHome` (`:1045-1058`) |
| **real admin, no preview** (`shouldRenderDefaultAdminCommand`, `:978`) | **`<AgentCloudHome />` + `<ReferralLinkCard />`** (`:1066-1071`) ← Sam's Home |
| `effectiveRole === "agent"` | `ScopedProductionScoreboard` + `AgentCommandDashboard` (`:1078-1093`) |
| `effectiveRole === "agency_owner"` | `ScopedProductionScoreboard` + `AgencyOwnerHome` (`:1098-1114`) |
| `effectiveRole === "manager"` | `ScopedProductionScoreboard` + `ManagerCommandView` (`:1116-1130`) |
| admin previewing admin | `ExecutiveDashboard` (in-file, `:261-`), fed by `loadDashboardSnapshot` (14 client-side table reads: `deals`×2, `applications`×2, `agents`×2, `v_agentlink_book_truth`, `interview_events`, `lead_purchases`, `lead_purchase_requests`, `lead_counter`, `seminar_registrations`, `system_health_logs`, `daily_production`, `v_my_applications`, rpc `sync_health_summary`) |

Comment at `Dashboard.tsx:1061-1065` ("no preview + real admin: AgentCommandDashboard") is stale; the code renders `AgentCloudHome`.

### 1.2 Sam's Home (`src/components/dashboard/AgentCloudHome.tsx`, 375 lines) — render order (`:245-371`)

| # | Section | Component | Data source | Drill-down | Loading | Full-dataset? |
|---|---|---|---|---|---|---|
| 1 | Join your team (Slack + Discord invites) | `JoinYourTeam` (`:253`) | `system_settings` keys `discord_invite_url`, `slack_community_invite_url`; `agents.onboarding_stage` (`JoinYourTeam.tsx:36-37`) | external links | none (returns null until data) | n/a — hides for admin only when `isAgent` false or stage joined (`:50-52`) |
| 2 | Training next step | `TrainingNextStep` | — | — | — | admin-gated off (`:259` `{!isAdmin && ...}`) |
| 3 | **Production scoreboard** (4 tiles for admin: My personal / My direct team / My team / IMO total; projection; earnings; production by hierarchy; per-agent table) | `ScopedProductionScoreboard` (`:260`) | rpc `scoped_production_scoreboard(p_start,p_end)` → single-flight wrapper → `scoped_production_scoreboard_uncached` (16,355 chars, live); rpc `scoped_production_projection`; rpc `discord_deal_feed_health`; rpc `production_book_freshness` (`ScopedProductionScoreboard.tsx:342,358,378,396`) | none on tiles (table rows link to agent) | 3 Skeletons (`:544-546`) + error text, no guessed totals (`:548-551`) | yes — server aggregate |
| 4 | Ayro Financial production | `AyroProductionPanel` (`:267`) | `v_ayro_totals`, `v_ayro_production`, `v_ayro_book` (separate book, no per-deal dates) | — | Skeleton×2 | all-time, not windowed (by design, comment `:262-266`) |
| 5 | **Total IMO by agency** header + period picker + 3 cards (Roster / Producing / In onboarding) | inline in `AgentCloudHome` (`:275-297`) | rpc `apex_admin_home_dashboard(p_start,p_end)` → single-flight → `apex_admin_home_dashboard_uncached` → `apex_home_dashboard('agency',…)` → CTE `roster` over `v_apex_roster` | none | 2+1 Skeletons (`:233-238`) | yes |
| 6 | IMO by agency bars | `ImoByAgency` (`:298`) | rpc `imo_by_agency_period(p_start,p_end)` (windowed) or view `v_imo_by_agency` (summary); `production_external_daily_snapshots` where `source='agentcloud_production_api'`, `agency_name='Vantage Financial'` (`ImoByAgency.tsx:63-66,80-88`) | `/dashboard/agencies` link (`:154`) — a route slated for removal | **none** — `isLoading` never destructured; `if (imo.length===0) return null` (`:135`) so the section is blank while loading and blank on error | yes (server aggregate) |
| 7 | **Run the business** (8 metric links) + **Who is not selling** list | `OperationsCommandCenter` (`:303`) | rpc `apex_admin_operations_snapshot` → `_uncached` (4,252 chars): `v_onboarding_sequence`, `apex_carrier_contracts`, `v_producer_pulse`, system_settings (`readymode_sync_enabled`) | `/dashboard/recruiting`, `/dashboard/interviews` (slated for removal), `/dashboard/team`, training progress, `/dashboard/contracting`, `/dashboard/production`, `/dashboard/help?tab=desk` (`OperationsCommandCenter.tsx:110-119`) | 1 Skeleton; returns null on empty | people list capped `limit 12` server-side, `.slice(0,8)` client (`:139`) — counts are full |
| 8 | **Producer pulse by leg** | `ProducerPulse` (`:306`) | view `v_leg_production` (grouped `v_producer_pulse` by `leg`), drill `v_producer_pulse where leg=…` (`ProducerPulse.tsx:37,49-51`) | `/dashboard/team?agent=…` | Skeleton; "Loading producers…" text inside expanded leg | yes |
| 9 | **Personal records** + **$500 recruiter bounties** | `RecordsAndBounties` (`:307`) | rpc `apex_records_and_bounties(p_limit:=12)` (reads `personal_records`, `recruiter_bounties`, `v_recruiter_bounty_candidates`, `agents`); write rpc `set_recruiter_bounty_status` (`RecordsAndBounties.tsx:71,87`) | none | text "Loading records… / Loading bounties…" (no skeleton) | capped at 12 records |
| 10 | Trend and policy status (collapsed `<details>`) | inline (`:318-370`) | same `apex_admin_home_dashboard` payload (`trend`, `policy_status`, `lifetime`) | none | shares #5 | yes |
| 11 | **Your link in bio** (referral link) | `ReferralLinkCard` → `MyReferralLinkCard` (`Dashboard.tsx:1069`; `components/dashboard/ReferralLinkCard.tsx:3-4`) | rpc `my_recruiting_link` (`MyReferralLinkCard.tsx:37`) | copy/share | text | n/a |

Two realtime hooks drive refetch: `useProductionRealtime` (`AgentCloudHome.tsx:168,174`) + `invalidateOperationalTruth` — noted MP-431/MP-436 feedback-loop guards in comments; `src/tests/hooks/productionRealtimeFeedbackLoop.test.ts` pins them.

### 1.3 The four widgets Sam wants removed — resolved component names

| Sam's words | Actual component | File | Heading string (exact) | Data source | Other dependents |
|---|---|---|---|---|---|
| "Who's Not Selling" | `OperationsCommandCenter` (the `<Card>` block + the "Not selling" `MetricLink`) | `src/components/dashboard/OperationsCommandCenter.tsx:124-170`, tile `:118` | `"Who is not selling"` (`:130`); tile label `"Not selling"` (`:118`) | `apex_admin_operations_snapshot` → `sales.{expected_to_sell, sold_today, not_selling, people}` over `v_producer_pulse` | **Only** `AgentCloudHome`. The RPC is also referenced by `src/lib/demoMode.ts` (masking). The rest of the component (Run-the-business tiles) is NOT what Sam asked to remove — see §6. |
| "Producer Post-Leg widget (broken)" | `ProducerPulse` | `src/components/dashboard/ProducerPulse.tsx:30-` | `"Producer pulse by leg"` (`:65`) | `v_leg_production`, `v_producer_pulse` | **Only** `AgentCloudHome`; `v_leg_production` also in `src/lib/demoMode.ts`. `v_producer_pulse` is ALSO the input of the operations snapshot's `sales` block, so the VIEW must stay even if the widget goes. "Broken": live `v_leg_production` returns 4 legs — `Samuel James ap=3179 | Chudi Ifediora ap=1546 | Direct to Sam ap=0 | Obiajulu Ifediora ap=0` — i.e. a leg literally labelled by the owner's own name beside a leg called "Direct to Sam", two legs with $0, and a widget whose expansion prints "Loading producers…" indefinitely when the leg has zero people (`ProducerPulse.tsx:97`: `people.length === 0 ? "Loading producers…"` — an empty leg is indistinguishable from loading). |
| "Personal Referrals" | `ReferralLinkCard` (wrapper of `MyReferralLinkCard`) — on the admin Home ONLY via `Dashboard.tsx:1069` | `src/components/dashboard/ReferralLinkCard.tsx`, `src/components/agent/MyReferralLinkCard.tsx` | `"Your link in bio"` (`MyReferralLinkCard.tsx:73`) | rpc `my_recruiting_link` | `MyReferralLinkCard` is ALSO mounted in `ManagerCommandView.tsx:162` and `AgentCommandDashboard.tsx` (kept for agents/managers); `RecruiterBountyCard` and `RecruitingLinks.tsx` also call `my_recruiting_link`. Guard: `src/tests/lib/linkInBioDashboardContract.test.ts:28-30` asserts the admin branch of `Dashboard.tsx` contains `<ReferralLinkCard />` — must be updated with the removal. Also referenced by `src/pages/DashboardApplicants.tsx`. |
| "Financial Referral Bounties" | `RecordsAndBounties` (second card) | `src/components/dashboard/RecordsAndBounties.tsx:128-136` | `"$500 recruiter bounties"` (`:132`); first card `"Personal records"` (`:103`) | rpc `apex_records_and_bounties`, write rpc `set_recruiter_bounty_status` | **Only** `AgentCloudHome`. Live data: `recruiter_bounties` has **1 row, status `reversed`**; `personal_records` has 66 rows. The bounty programme UI for recruiters is a DIFFERENT component (`RecruiterBountyCard`, "Build Your Agency · $500 Producer Bounty") mounted on `RecruiterHome`, `AgencyOwnerHome`, `AgentCommandDashboard`, `DashboardApplicants` — not on Sam's Home, and not in scope to remove. |

### 1.4 Other Home-adjacent surfaces

- `HideableCard` / `HiddenCardsManager` (`src/components/dashboard/HideableCard.tsx` 58 lines, `HiddenCardsManager.tsx` 47 lines): used ONLY by `DashboardCommandCenter.tsx` and `AgentPortal.tsx` — not on Sam's Home. Per-viewer hide state; not a data surface.
- `DashboardCommandCenter.tsx` (`/dashboard/admin`, `/dashboard/legacy`): reads `user_roles`×3, `agents`×3, `profiles`, `lead_payment_tracking`, legacy `deals`, rpc `get_agent_production_stats`. Legacy. Header comment at `AgentCloudHome.tsx:35-41` documents the page it replaced fired 33 API calls incl. 1000-row-capped arrays.
- `AgentCommandDashboard.tsx` (5,039 lines; agent Home + `/agent-portal`): 60+ client reads — `applications`×19, `agents`×16, `agentlink_deals_snapshot`×14, `aged_leads`×8, `v_production_unified`×2, legacy `deals`×2, `daily_production`×2, `commission_ledger`×2, rpc `apex_dashboard_summary`, and 17 single-use views. Mounts `MyReferralLinkCard`, `ImoByAgency` (admin-gated inside), `RecruiterBountyCard`.
- `RecruiterHome.tsx` (296): `applications`×2, `agents`. `AgencyOwnerHome.tsx` (304): `agents`×2, `applications`. `ManagerCommandView.tsx` (306): `v_upcoming_calls`, `applications`, `agents`, `agentlink_deals_snapshot`. `VaOpsCommandCenter.tsx` (197): `applications`×2, `profiles`. All are direct PostgREST reads (1000-row cap applies to any count derived from an array).
- `ImoByAgency` is mounted at 3 sites: `AgentCloudHome.tsx:298`, `AgentCommandDashboard.tsx`, `Finances.tsx` (admin-gated inside the component, `ImoByAgency.tsx:40-50`).

### 1.5 Jobs / automation touching Home numbers
- `mv_agent_truth`, `mv_hierarchy_hops` materialized views refreshed by pg_cron every 30s when dirty (migration `20260904210000_production_truth_materialized.sql`; doctor Check #60 per memory). The scoreboard's headcounts come from these.
- No Home-specific cron. All Home RPCs are `SECURITY DEFINER` with `fn_rpc_single_flight` 15s dedupe wrappers (live defs).

---

## 2. Authoritative records (as the code uses them today)

| Record | Kind | Role on Home | Notes |
|---|---|---|---|
| `agents` | table | headcount base, hierarchy edges (`manager_id`, `switched_to_manager_id`, `invited_by_manager_id`), status (`agent_status` enum: active/inactive/terminated) | 228 rows → 209 distinct canonical ids (via `v_agent_canonical_map`); 97 active / 67 inactive / 64 terminated rows; Sam has 2 rows (`cde14d07…` canonicalised to `7c3c5581…`) |
| `v_agent_canonical_map` / `mv_agent_truth` | view / matview | duplicate-row collapse | 19 rows collapse into other ids |
| `roster_exclusions` | table | hard exclusion from every roster/production figure | 1 row |
| `mv_hierarchy_hops` + `fn_hierarchy_first_hops` | matview + fn | "direct"/"team" membership | edges = `COALESCE(manager_id, switched_to_manager_id, invited_by_manager_id)`; **no status filter** |
| `v_apex_roster` | view | the Home "Roster / Producing / In onboarding" cards | `agents` rows (not canonical) with status `active` OR a deal in 120d; excludes GHOST/XAGENT/MP%_HIRED placeholders, `is_inactive`, `is_deactivated`, exclusions |
| `agentlink_book` | table | AgentLink mirror; the production truth for the scoreboard, pulse, IMO | per memory: never hand-upsert |
| `v_production_unified` | view | production across origins `agentlink` / `apex_native` / `discord_external` with `annual_premium`, `posted_date`, `agent_id` (nullable) | feeds `imo_by_agency_period_uncached`, `v_imo_by_agency` |
| `v_production_canonical` → `v_producer_pulse` → `v_leg_production` | views | "expected producers", pulse states, legs | 9 expected producers live (cold=4, quiet=3, slipping=2) |
| `fn_agent_subagency(uuid)` | fn | the ONLY agency classifier: returns `'vantage'` for 39 agents (hardcoded head `431dff0d…` + placeholder `…a008`), NULL (= APEX) for 189 | there is **no agency table**: `information_schema` has no `agencies`; `agents` has no `agency_id` (only `agency_owner_qualified_at`) |
| `apex_carrier_contracts`, `v_onboarding_sequence` | table / view | "Run the business" contracting + onboarding counts | contracting domain owns these |
| `personal_records`, `recruiter_bounties`, `v_recruiter_bounty_candidates` | tables / view | Records & bounties widget | 66 / 1 (reversed) / unmeasured |
| `system_settings` | table | Discord/Slack invite URLs, `readymode_sync_enabled` | Discord-facing UI source |

---

## 3. Workflow traces

### 3.1 Admin opens Home → headcount tiles
User opens `/dashboard` → `useAuth().isAdmin` true, no preview (`Dashboard.tsx:978`) → `AgentCloudHome` mounts → `ScopedProductionScoreboard` calls `scoped_production_scoreboard(p_start,p_end)` (RLS bypassed: SECURITY DEFINER; auth via `auth.uid()` → `agents.user_id`; `v_is_admin` from `apex_is_admin()`) → `_uncached` builds `v_personal_ids` (Sam's canonical ids), `v_direct_ids` = distinct `first_hop` from `fn_hierarchy_first_hops` not excluded, `v_scope_ids` (admin) = ALL non-excluded canonical agents → returns `direct_team.agents = cardinality(v_direct_ids)`, `imo.agents = cardinality(v_scope_ids)` → UI prints `plural(data.direct_team.agents,"direct report")` and `plural(data.imo.agents,"roster agent")` (`ScopedProductionScoreboard.tsx:565,579`). No saved record, no audit; refetch on realtime. **Measured live: 125 and 208 — reproduced exactly.**

Simultaneously `apex_admin_home_dashboard` → `apex_home_dashboard` → `roster` CTE over `v_apex_roster` → the "Roster" card prints `roster.total` (`AgentCloudHome.tsx:282`). **Measured live: 61** ("agents on the team"), producing 9, in onboarding 52. So the same page shows **208, 125 and 61** as three different "how many agents" answers with no reconciliation statement.

### 3.2 Admin changes period → IMO by agency
Period picker (`AgentCloudHome.tsx:184-212`) → `windowFor()` Phoenix-local → `ImoByAgency start end` → rpc `imo_by_agency_period` → `_uncached` groups `v_production_unified` rows in window by `fn_agent_subagency(agent_id)='vantage'` into exactly two labels `'Vantage Financial'` / `'APEX Financial'`, with owner-override % from `fn_agent_contract_pct` on two hardcoded uuids → bars. No agent count per agency (the brief asks for agency, agent count, production, share; share is computed client-side from `alp/max`, agent count is absent). Drill-down: link to `/dashboard/agencies` (route slated for removal, `App.tsx` has `path="/dashboard/agencies"`).

### 3.3 "Who is not selling" → Call
`apex_admin_operations_snapshot_uncached` selects from `v_producer_pulse` where `pulse <> 'sold_today'` plus `profiles.phone/email` (live def) → `people[]` (limit 12) → UI shows name, leg, **phone number in clear text** (`OperationsCommandCenter.tsx:143`) and a `tel:` link → clicking opens the dialer. **No outcome is recorded anywhere** (brief: "a dial-link click is not a completed call"). No saved record, no automation, no audit.

### 3.4 Records & bounties → mark bounty paid/reversed
`apex_records_and_bounties(12)` → two cards → admin clicks status → `set_recruiter_bounty_status(p_id,p_status,p_note)` (SECURITY DEFINER, 1,385 chars, live) → `recruiter_bounties.status` → toast. Audit: **unmeasured** whether the RPC writes a history row. Live table has 1 row (`reversed`), so the widget renders its empty-state copy to Sam today.

### 3.5 Personal referral link
`my_recruiting_link()` → `agents.ref_slug` → `/r/<slug>` URL → copy. Recruiting domain owns `/r/<slug>` → attribution (memory MP-342). Home only displays it.

---

## 4. Defects (evidence-backed)

**D1 — P0 — A single unattributed $1,800,000 "annual premium" row is 96% of this month's Home production.**
Where: `agentlink_book` row posted `2026-10-02`, surfaced through `v_production_unified` (origin `agentlink`, `agent_id = NULL`, agent_name "Willard Herald", carrier Newbridge, status `Unknown`, `annual_premium = 1800000.00`), plus a sibling row $21,600 same name/date.
Evidence: `v_production_unified` this month = 34 rows, sum **$1,879,609**, max $1,800,000, **median $1,590**; only 1 row > $50,000 in the whole month; only 1 row > $100,000 in the lifetime of `agentlink_book`. Rows with `agent_id IS NULL` this month = 2, summing **$1,821,600**. `imo_by_agency_period_uncached(2026-10-01, 2026-11-01)` returns `APEX Financial policies=34 alp=1879609`. The scoreboard's IMO tile, the IMO-by-agency bar, the trend chart and "Total IMO" all include it. A $1.8M AP on a "Level Death Benefit" product is almost certainly a face amount captured in the premium column.
Fix direction: do not blacklist by name. (a) Surface `agent_id IS NULL` production as a visible "Unattributed" data-quality bucket on the IMO breakdown (brief §4 RECONCILIATION), excluded from agency shares but shown. (b) Add an outlier flag (e.g. `annual_premium > 50000` on a non-annuity product) that renders as an exception row, not a total. (c) The AgentLink row itself belongs to the production domain to resolve (status `Unknown`, unresolved agent).

**D2 — P0 — Three contradictory headcounts on one screen, two of them counting departed people.**
Where: `ScopedProductionScoreboard.tsx:565,579` vs `AgentCloudHome.tsx:282`.
Evidence (live): "208 roster agents" = every non-excluded distinct canonical agent regardless of status (`scoped_production_scoreboard_uncached`: `from public.agents a … where not fn_agent_is_roster_excluded(a.id)` — no status predicate); only **92** of those are active. "125 direct reports" = distinct `first_hop` under Sam, any status: by canonical membership **56 active**, the rest inactive/terminated (first_hop raw-row status split: 54 active / 37 inactive / 35 terminated). "61 Roster" = `v_apex_roster` rows (active OR produced in 120d; row-level, 57 distinct canonical). The owner is included in 208 and 61 but excluded from 125; none of the three says so.
Fix direction: one headcount definition set, declared on-screen: Owner (1) · Direct active (56) · Indirect active (35) · = Total IMO active (92), measured live to reconcile exactly with 0 active agents unreachable from the owner. Historical membership (208) and "producing in period" (9 now) become separate, labelled figures.

**D3 — P1 — "TOTAL IMO BY AGENCY" has no agency model.**
Where: `imo_by_agency_period_uncached` (live def), `v_imo_by_agency`, `fn_agent_subagency`.
Evidence: classifier is a hardcoded `case` on two uuids → labels `'Vantage Financial'` else `'APEX Financial'`; this month only one bucket (`APEX Financial`) exists because 0 Vantage producers posted; `agents` has no agency column and there is no `agencies` table. The brief requires "legitimate agencies beneath my IMO" with agent count and share, and no double counting — none of that is representable today. The component also shows no agent count.
Fix direction: derive agencies from the hierarchy (`mv_hierarchy_hops` depth-1 members of the owner who are `agency_owner`/have downline) rather than inventing a parallel table; return `agent_count`, `production`, `share`, plus `Personal (owner)` and `Unattributed` buckets; prevent double counting by attributing each canonical producer to exactly one first-hop leg.

**D4 — P1 — Removal targets are entangled with kept logic.**
Evidence: `v_producer_pulse` feeds BOTH the removable "Who is not selling" list AND the operations snapshot's `sales.*` counts (`apex_admin_operations_snapshot_uncached` live def: `… into v_sales from public.v_producer_pulse`). Removing `ProducerPulse` + the card is safe at the UI level, but dropping the view would break the snapshot. `linkInBioDashboardContract.test.ts:28-30` asserts `<ReferralLinkCard />` in the admin branch of `Dashboard.tsx`. `src/lib/demoMode.ts` references `v_leg_production` and `apex_admin_operations_snapshot`.

**D5 — P1 — Home links to two routes the brief retires.**
Evidence: `OperationsCommandCenter.tsx:111` → `/dashboard/interviews`; `ImoByAgency.tsx:154` → `/dashboard/agencies`. `check:dead-internal-links` will go red once those routes are removed unless Home is updated in the same change.

**D6 — P1 — Dial link with no outcome record; phone in clear on the owner Home.**
Evidence: `OperationsCommandCenter.tsx:143,147` renders `person.phone` and a `tel:` href; nothing writes an activity. Brief §5: "A dial-link click is not a completed call."

**D7 — P2 — Loading/empty states are inconsistent ("tacky load screens").**
Evidence: `ImoByAgency` has zero loading state (`isLoading` unused; `imo.length === 0 → return null`, `:135`) so the section pops in late and silently vanishes on error; `RecordsAndBounties` and `MyReferralLinkCard` use text "Loading…" with no skeleton; `ProducerPulse.tsx:97` shows "Loading producers…" for an EMPTY leg forever; `AgentCloudHome` skeleton shape (`:233-238`, two 48px + one 64px blocks) does not match the rendered layout (scoreboard → Ayro → 2-col grid); `JoinYourTeam` renders nothing then appears.

**D8 — P2 — Discord-facing UI on Home.**
Evidence: `JoinYourTeam.tsx:60` "Discord is where deals and wins get posted. Join both."; `apex_admin_operations_snapshot_uncached` has a `discord_missing` onboarding bucket (step `5.%`). Brief: remove Discord steps from the agent journey.

**D9 — P2 — Stale routing comment.** `Dashboard.tsx:1061-1065` says admin → `AgentCommandDashboard`; code renders `AgentCloudHome`.

**D10 — P2 — Records/bounties widget is empty for the owner.** `recruiter_bounties` = 1 row (`reversed`); the card renders its empty-state sentence on every load.

---

## 5. Measurements (live, 2026-10-05)

| Metric | Value | Method |
|---|---|---|
| `agents` rows / distinct canonical | 228 / 209 | `count(*)`, `count(distinct coalesce(canonical_agent_id,id))` via `v_agent_canonical_map` |
| status mix (rows) | active 97 · inactive 67 · terminated 64 | `group by status` |
| `roster_exclusions` | 1 | `count(*)` |
| "208 Roster Agents" reproduced | 208 | non-excluded distinct canonical, any status (scoreboard admin `v_scope_ids` logic) |
| same, active only | 92 | add `status='active'` |
| "125 Direct Reports" reproduced | 125 | `fn_hierarchy_first_hops(Sam's 2 ids)` distinct non-excluded `first_hop` |
| direct active / indirect active / owner | 56 / 35 / 1 = 92 | depth=1 vs depth>1 members ∩ active canonical set |
| active canonical unreachable from owner | 0 | set difference |
| `agents.manager_id = Sam` rows | 137 | any status |
| `v_apex_roster` total / producing / in_onboarding / distinct canonical | 61 / 9 / 52 / 57 | the Home "Roster" cards |
| `v_producer_pulse` rows | 9 (cold 4, quiet 3, slipping 2, sold_today 0) | "expected producers" |
| `v_leg_production` | 4 legs: Samuel James 3,179 · Chudi Ifediora 1,546 · Direct to Sam 0 · Obiajulu Ifediora 0 (ap_mtd) | the "Post-Leg" widget's rows |
| `v_production_unified` this month | 34 rows · $1,879,609 · max $1,800,000 · median $1,590 | Phoenix month window |
| by origin this month | discord_external 19 ($31,926) · apex_native 13 · agentlink 2 (both unattributed, $1,821,600) | `group by origin` |
| unattributed (`agent_id IS NULL`) lifetime / this month | 8 / 2 | |
| `imo_by_agency_period_uncached(month)` | 1 row: APEX Financial, 34 policies, $1,879,609, override 0% | direct call |
| `fn_agent_subagency` over agents | NULL (APEX) 189 · vantage 39 | |
| `recruiter_bounties` | 1 (reversed) | |
| `personal_records` | 66 | |
| "Dom"/"Travis" rows in unified (lifetime) | Dom Yous 13 rows $21,409; Travis N 7 rows $13,320 — both `discord_external`, both attributed (`agent_id` not null) | name grep; "Snowflake"/"Nails" not present as `agent_name` in `v_production_unified` |
| RPC wrappers | all four Home RPCs are `fn_rpc_single_flight` 15s wrappers over `_uncached` bodies; `scoped_production_scoreboard_uncached` 16,355 chars; migrations folder lacks `apex_admin_operations_snapshot*`, `apex_records_and_bounties`, `imo_by_agency_period*`, `v_leg_production`, `my_recruiting_link`, `set_recruiter_bounty_status` | `pg_proc` vs `grep supabase/migrations` |
| `production_book_freshness()` from SQL console | `(,0,0,2026-10-06 05:41:49Z,0)` — auth-less call; **unmeasured** as the UI sees it | |

Unmeasured: `set_recruiter_bounty_status` audit trail; render timings; `v_recruiter_bounty_candidates` size; whether `check:metric-truth` (`scripts/check-metric-truth.mjs:11,105` pins `src/pages/Dashboard.tsx`) asserts anything about the admin branch (not read in full).

---

## 6. KEEP / REPAIR / MERGE / REMOVE — every surface in the domain

| Surface | File | Verdict | Reason / target |
|---|---|---|---|
| `/dashboard` dispatcher | `src/pages/Dashboard.tsx` | REPAIR | fix stale comment `:1061-1065`; drop `<ReferralLinkCard />` from admin branch (`:1069`); update `linkInBioDashboardContract.test.ts:28-30` |
| Admin Home shell | `AgentCloudHome.tsx` | REPAIR | reorder to Overview → Production & Agency → Contracting → Recruiting & Expected Starts → Immediate Actions; one skeleton matching layout |
| Production scoreboard | `ScopedProductionScoreboard.tsx` | REPAIR | KEEP as the single production authority; relabel headcount sub-captions (`:565,579`) to declared definitions; add unattributed/outlier exception line |
| Roster / Producing / In-onboarding cards | `AgentCloudHome.tsx:275-297` | MERGE → headcount block in Overview | replace `v_apex_roster.total` with the declared Owner/Direct/Indirect/Total-active set from the scoreboard RPC; "Producing (period)" stays |
| Total IMO by agency | `ImoByAgency.tsx` | REPAIR | add loading state, agent count, share, Personal/Unassigned/Unattributed buckets; retarget `/dashboard/agencies` link to the hierarchy drill-down that replaces it |
| Ayro production panel | `AyroProductionPanel.tsx` | KEEP (collapse into Production drill-down) | separate book, correct not to fold in |
| Run the business tiles | `OperationsCommandCenter.tsx:109-120` | REPAIR → "Immediate Actions" | keep Contracting/Onboarding/Recruits/Support tiles; drop "Not selling" tile and `/dashboard/interviews` link; counts stay server-side |
| **Who is not selling** card | `OperationsCommandCenter.tsx:124-170` | **REMOVE** | Sam's request; keep `v_producer_pulse` (snapshot dependency) |
| **Producer pulse by leg** | `ProducerPulse.tsx` | **REMOVE** | Sam's request; broken (empty leg = "Loading…", owner-named leg); view `v_leg_production` can go only if `src/lib/demoMode.ts` reference is removed too |
| **Personal records + $500 recruiter bounties** | `RecordsAndBounties.tsx` | **REMOVE** from Home | Sam's request ("Financial Referral Bounties"); 1 live bounty row; `set_recruiter_bounty_status` capability stays reachable from recruiting (bounties already have `RecruiterBountyCard` elsewhere) |
| **Your link in bio** on admin Home | `ReferralLinkCard.tsx` via `Dashboard.tsx:1069` | **REMOVE** from admin Home ("Personal Referrals") | keep `MyReferralLinkCard` on agent/manager homes and `/dashboard/recruiting-links` |
| Join your team (Slack+Discord) | `JoinYourTeam.tsx` | REPAIR | Discord copy out of the agent journey; already hidden for admin in practice (returns null when not an agent) — verify Sam's agent row does not make it render |
| Training next step | `TrainingNextStep.tsx` | KEEP | agents/managers only |
| Trend + policy status disclosure | `AgentCloudHome.tsx:318-370` | MERGE → Production drill-down | not top-level |
| Legacy admin command center | `DashboardCommandCenter.tsx` (`/dashboard/admin`, `/dashboard/legacy`) | REMOVE (redirect → `/dashboard`) | superseded; 33-call page; `HideableCard`/`HiddenCardsManager` go with it unless `AgentPortal` still needs them |
| `AgentCommandDashboard.tsx` | 5,039 lines | REPAIR (out of this domain's scope to rewrite) | agent Home; 60+ client reads, legacy `deals`; keep, but Home redesign must not add to it |
| Recruiter / Agency Owner / Manager / VA homes | `RecruiterHome.tsx`, `AgencyOwnerHome.tsx`, `ManagerCommandView.tsx`, `VaOpsCommandCenter.tsx` | KEEP | role homes; all direct PostgREST reads — any count from an array is 1000-capped (audit per role is a follow-up) |
| ExecutiveDashboard (admin previewing admin) | `Dashboard.tsx:261-` + `loadDashboardSnapshot` | REMOVE | preview-only legacy fed by 14 client reads incl. legacy `deals`; preview should show the real admin Home |

---

## 7. Recommended implementation plan (Home domain)

**New Home hierarchy (short top level, drill-downs for detail):**

1. **Overview** — one row: Headcount (Owner 1 · Direct 56 · Indirect 35 · **Total IMO active 92**; "Producing this period 9"; "Historical members 208" as a muted footnote) + Production headline (period picker already exists) + data-quality chip ("2 unattributed deals · $1,821,600 — review"). Source: extend `scoped_production_scoreboard_uncached` to return a `headcount` object with `owner_included` flags and the active-only sets (same hierarchy walk, add `status='active'` on members). Drill → `/dashboard/team`.
2. **Production and Agency Breakdown** — `ScopedProductionScoreboard` tiles + `ImoByAgency` (repaired) + collapsed Ayro + trend/policy status. One calculation: `v_production_unified` windowed by `posted_date`, Phoenix. Drill → `/dashboard/production`.
3. **Contracting** — compact summary tiles from the contracting domain's queues (people vs carrier-case counts labelled). Drill → `/dashboard/contracting`. (Owned by domain 10; Home only mounts its summary component.)
4. **Recruiting and Expected Starts** — recruits/uncontacted/hired counts (already in `apex_admin_operations_snapshot`) + expected-start buckets from domain 6. Drill → `/dashboard/recruiting`.
5. **Immediate Actions** — due follow-ups, stalled onboarding, support urgent, contracting issues (existing `MetricLink`s minus "Not selling"/"Interviews").

**Files to change**
- `src/pages/Dashboard.tsx`: remove `<ReferralLinkCard />` (`:1069`), fix comment, make admin-preview render `AgentCloudHome` instead of `ExecutiveDashboard`; delete `loadDashboardSnapshot`/`ExecutiveDashboard` once nothing imports them.
- `src/components/dashboard/AgentCloudHome.tsx`: drop imports/mounts of `ProducerPulse`, `RecordsAndBounties`; replace the three cards with `HeadcountStrip` reading the scoreboard payload; move trend/status + Ayro into a "Production detail" disclosure; single layout-matched skeleton.
- `src/components/dashboard/OperationsCommandCenter.tsx`: delete `:124-170` card and the `Not selling` tile; change `/dashboard/interviews` → `/dashboard/recruiting?tab=interviews` (or whatever the pipeline domain lands on).
- `src/components/dashboard/ImoByAgency.tsx`: add `isLoading` skeleton + error row; render `agent_count` and `share`; link to the hierarchy drill-down replacing `/dashboard/agencies`.
- Delete `ProducerPulse.tsx`, `RecordsAndBounties.tsx`, `components/dashboard/ReferralLinkCard.tsx` (keep `MyReferralLinkCard`); update `src/lib/demoMode.ts` references to `v_leg_production`; update `linkInBioDashboardContract.test.ts`.
- `check:orphan-pages` / `check:sidebar-routes`: `DashboardCommandCenter` removal needs its two routes redirected in `App.tsx:548,560`.

**Backend (additive only, migration file mirrored)**
- `scoped_production_scoreboard_uncached`: add `headcount` jsonb {owner, direct_active, indirect_active, total_active, historical_members, owner_included:true} computed from the same `fn_hierarchy_first_hops` walk with an active filter; add `reconciliation.unattributed_rows / unattributed_ap / outlier_rows` from `v_production_unified where agent_id is null` and a premium-outlier predicate.
- `imo_by_agency_period_uncached` / `v_imo_by_agency`: replace the two-label `case` with first-hop-leg attribution (one canonical producer → one leg), add `agent_count`, `share`, `'Personal'`/`'Unattributed'` buckets. No new table.
- Do NOT drop `v_producer_pulse` (operations snapshot depends on it). `v_leg_production` may be dropped only after `demoMode.ts` is cleaned; prefer leaving it (additive rule).

**Tests to write**
- `src/tests/lib/homeHierarchyContract.test.ts`: admin branch mounts `AgentCloudHome` only; no `ProducerPulse`, `RecordsAndBounties`, `ReferralLinkCard`, `"Who is not selling"` strings in Home files.
- Vitest on the headcount strip: `owner + direct + indirect === total_active` from a fixture payload; renders "unmeasured"/exception when `headcount` missing (never 0).
- SQL proof (bot-sql, read-only): `select` the new `headcount` for Sam's uid and assert 1+56+35=92 and `historical_members=208` at ship time.
- ImoByAgency: loading skeleton renders when `isLoading`; error row renders on `isError`; shares sum to 100% ± rounding; unattributed bucket excluded from share.

**Guards affected**: `check:dead-internal-links` (retired `/dashboard/interviews`, `/dashboard/agencies` links on Home), `check:sidebar-routes` + `check:orphan-pages` (removing `DashboardCommandCenter` routes), `check:metric-truth` (pins `src/pages/Dashboard.tsx`), `check:native-deals` (reads `AgentCloudHome.tsx`, `ScopedProductionScoreboard.tsx`, `ImoByAgency.tsx`), `check:realtime-invalidate-coalesce` + `realtime-coalesce-baseline.json`, `check:rpc-status-literals`, `check:stale-key-in-list`, `check:maybesingle-nonunique`, `check:tsc-error-count` baseline, tests `linkInBioDashboardContract`, `freeLeadsDashboardContract`, `vantageProductionGap`, `accountModeRouting`, `productionRealtimeFeedbackLoop`, `ScopedProductionScoreboard.test.tsx`.

---

## 8. Risks and open questions

Risks
- Removing `v_leg_production`/`ProducerPulse` without touching `src/lib/demoMode.ts` leaves a dead masking rule (harmless) — but dropping `v_producer_pulse` would break `apex_admin_operations_snapshot`.
- The headcount redefinition changes the number Sam has been reading (208 → 92). Ship with the footnote "208 historical members" so the drop is explained on-screen, not discovered.
- `scoped_production_scoreboard_uncached` is 16k chars, hand-applied, and wrapped in single-flight; edits must be CREATE OR REPLACE with the full body and mirrored into `supabase/migrations/`.
- D1's $1.8M row: Home must show it as an exception, not silently exclude it (brief: "never convert unknown data into zero"). Correcting the row itself is the production domain's job.
- Realtime feedback loops (MP-431/436) are pinned by tests; reordering components must keep the two `useProductionRealtime` hooks as-is.

Open questions
- Is "Willard Herald" an Apex producer under another spelling, or external? (`agent_id` NULL on both rows.) Owner decision on whether unattributed AgentLink rows ever count toward IMO.
- Which legs are "legitimate agencies beneath the IMO" — every depth-1 member with a downline, or only `account_mode = agency_owner`? (`agents.agency_owner_qualified_at` exists; 0 rows checked — unmeasured.)
- Should the owner's own production appear as a "Personal" agency bucket or stay outside the agency breakdown?
- Does `set_recruiter_bounty_status` write an audit row? (unmeasured) — determines whether bounty capability can simply relocate.
- `production_book_freshness()` returned an empty-ish tuple from the SQL console (no auth) — the UI-visible freshness is unmeasured here.
- Role homes (`RecruiterHome`, `AgencyOwnerHome`, `ManagerCommandView`, `VaOpsCommandCenter`) derive counts from direct PostgREST arrays; whether any exceeds 1,000 rows is unmeasured and belongs to a per-role pass.
