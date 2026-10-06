# 03 — Headcount & Production Data (APEX OS redesign, domain map)

Mapper: read-only subagent, 2026-10-05/06 (Phoenix "today" at measurement = 2026-10-05; the DB clock had crossed into 2026-10-06 UTC).
Repo: `/Users/samjames/projects/rebuild-brighten-sparkle` @ `4ea291c8` (main). DB: Supabase `xrzweoneiieddzxogewk`, measured live via MCP `execute_sql` (read-only).
Every number below is measured unless marked **unmeasured**. "rows" means database rows; "people" means distinct eligible identities after canonical dedupe.

---

## 0. Executive summary

1. **"125 Direct Reports" and "208 Roster Agents" are hierarchy-graph sizes, not headcount.** Both come from `scoped_production_scoreboard_uncached()`: `direct_team.agents = cardinality(v_direct_ids)` and `imo.agents = cardinality(v_scope_ids)`. Reproduced live: 126 depth-1 edges under Sam's canonical root in `mv_hierarchy_hops`, minus 1 `roster_exclusions` row = **125**; 208 distinct `canonical_id` in `mv_agent_truth` not excluded = **208** (228 rows − 19 merged duplicates − 1 excluded). The 125 "direct reports" contain 35 terminated, 23 inactive, 16 GHOST placeholders and 12 deactivated rows; only **40** are active, non-deactivated, non-ghost. The 208 includes Sam himself, 64 terminated rows, 16 ghosts and 87 deactivated.
2. **Eligible unique people today: 118** (`canonical_agent_id is null AND agent_code not GHOST% AND not is_deactivated AND status <> 'terminated'`; 118 rows = 118 distinct names). Under the recommended rule "direct = canonical `manager_id`", they reconcile exactly: **63 direct to Sam + 54 indirect (under 8 sub-managers) + 1 owner (Sam) = 118.** Strict "active" subset (also `status='active' AND not is_inactive`) = 57.
3. **Snowflake / Nails / Travis / Dom are Ayro Financial producers, not Apex agents.** `ingest_ayro_sales_deal()` mints a `GHOST_AYRO_*` row in `public.agents` whenever a Discord-posted Ayro sale names a producer it cannot match; the BEFORE trigger `z_default_agent_manager_to_sam` then sets `manager_id = Sam`, so they become Sam's "direct reports", and `mv_production_comp_truth` labels every non-Vantage row `'APEX Financial'`, so their $66,670 (36 deals) lands in Sam's IMO. "Nails" is the placeholder **`GHOST_AYRO_NELSR_62b7` ("Nels r")**, 6 deals / $8,506. Six placeholders exist: Dom Yous 13/$21,409, Tyler K. 4/$14,354, Travis N 7/$13,320, Nels r 6/$8,506, snow flake 5/$8,318, David A. 1/$763. Tyler K. also has a **real** `agents` row (created 2026-09-28, has login, 0 deals) — an identity split, not a stranger.
4. **A $1,821,600 phantom sits in this month's IMO.** `agentlink_book` carries 2 rows posted 2026-10-02 for AgentLink user 1069 with no `agents` row: annual premium $1,800,000 / monthly $150,000 / face $500,000,000 / effective 2055-04-02 (plus a $21,600 sibling). `v_imo_by_agency` and `imo_by_agency_period()` have **no agent/roster filter**, so Home's "Total IMO by agency" shows APEX **alp_mtd = $1,879,609** while the scoreboard tile two inches above it shows **$58,009** (it filters `agent_id = any(v_scope_ids)`). Same page, two numbers, 31× apart.
5. **AgentLink stopped feeding the book in September.** `agentlink_book` posted rows by month: Jun 213, Jul 132, Aug 65, **Sep 0**, Oct 2 (the phantom pair). September production (191 rows / $321,926) came entirely from `apex_native` deals, Ayro Discord ingest and the Vantage AgentCloud API. Any surface still reading only `agentlink_book` (`v_manager_hierarchy_mtd`, `v_apex_roster`, `v_top_producers_mtd`, Book of Business tiles) reports a dead month.
6. **Ayro production is counted twice on the same Home page**: `ayro_book` (20 all-time rows, rendered by `AyroProductionPanel`) overlaps `production_external_deals` (source `ayro_sales`, rendered via the scoreboard/IMO) on 8 policy numbers / $21,705. `ayro_book.is_excluded` is literally a display-name blacklist (`excluded_agents = "Dom Yous, snow flake, Travis N"`).
7. **Projected starts do not exist as data.** `applications.start_date` is populated on 0 rows; `agents.start_date` is in the future on 1 row; no table models Confirmed / Likely / Awaiting Response / Not Attending. `agents.attendance_status` is an enum `good,warning,critical` (a health flag), not attendance.

---

## 1. What exists

### 1.1 Headcount sources

| Object | Kind | Defined / read at | What it is |
|---|---|---|---|
| `public.agents` | table | 228 rows | Identity + lifecycle. Relevant columns: `status` enum `active,inactive,pending,terminated`; `is_deactivated`, `is_inactive`, `canonical_agent_id`, `agent_code` (NULL on 78 rows; `GHOST%` on 16), `manager_id`, `switched_to_manager_id`, `invited_by_manager_id`, `al_user_id`, `start_date`, `license_status` enum `licensed,unlicensed,pending`, `is_manager`, `account_mode`, `attendance_status`. **No `terminated_at` column** (that lives on `applications`). |
| `v_agent_canonical_map` | view | `SELECT id AS agent_id, COALESCE(canonical_agent_id, id)` | The dedupe map. 19 rows point at another row. |
| `roster_exclusions` | table | 1 row (`agent_id, reason, excluded_at, excluded_by`) | Manual roster kill-switch (migration `20260822220000_apex_canonical_roster.sql:29`). |
| `mv_agent_truth` | matview | migration `20260904210000_production_truth_materialized.sql` (MP-430) | Per-agent facts: `canonical_id`, `roster_excluded`, `subagency` (`'vantage'` or NULL), `contract_pct`, `contract_provenance`. 228 rows. |
| `mv_hierarchy_hops` | matview | same migration | Recursive closure over edge `parent = COALESCE(manager_id, switched_to_manager_id, invited_by_manager_id)` collapsed to canonical ids, **no lifecycle filter**. Under Sam: 208 members, 126 depth-1, 82 depth-2, max depth 2, 2 members with >1 parent candidate. |
| `fn_hierarchy_first_hops(p_roots)` | RPC | wraps `mv_hierarchy_hops` | Member → first hop under the roots. |
| `fn_agent_is_roster_excluded(_live)` | RPC | `mv_agent_truth.roster_excluded` fallback to `roster_exclusions` lookup | The single "off the roster" lever (10+ views). Only 1 agent is excluded. |
| `fn_agent_subagency(_live)` | RPC | `'vantage'` iff canonical id = KJ's id, or `agents.manager_id` (canonical) = KJ, or the Vantage pseudo-id `…a008`; else NULL | The entire agency model. Binary. |
| `get_downline_agent_ids(root)` / `my_downline_agent_ids()` | RPC | recursive on `invited_by_manager_id` where `is_deactivated = false` | A *second* hierarchy definition (invited-by edge), used by `AgencyOwnerHome.tsx:106` via `useMyDownline` and `BookOfBusiness.tsx:450`. |
| `v_apex_roster` | view | 61 rows | "active OR produced in 120d via `v_agentlink_book_scoped`", excludes GHOST/XAGENT/MP_HIRED, inactive, deactivated, exclusions. Feeds Home "Roster / Producing / In onboarding" tiles (`apex_home_dashboard` → `roster` block) and `v_manager_hierarchy_mtd`. |
| `crm_agent_roster()` / `crm_roster_segments()` | RPC | `DashboardCRM.tsx:383-393`, `ProductionMetricsCard.tsx:48` ("Team size … on the canonical roster") | Per-agent roster with MTD/L30/lifetime from `mat_production_unified`; segments = counts over it. `is_sync_only = agent_code like 'GHOST\_%' and user_id is null`. |
| `scoped_production_scoreboard(_uncached)(p_start,p_end)` | RPC | `ScopedProductionScoreboard.tsx:342`; rendered on `/dashboard` for agent, agency_owner, manager, admin (`Dashboard.tsx:1086,1107,1125`) and inside `AgentCloudHome.tsx:256` | Source of **"direct report"** (`direct_team.agents`, tsx:565) and **"roster agent"** (`imo.agents`, tsx:579) counts. |
| `z_default_agent_manager_to_sam` | trigger (BEFORE INSERT on agents) | `fn_default_agent_manager_to_sam` | If `manager_id` is NULL → canonical `invited_by_manager_id`, else **Sam**. This is how every minted placeholder becomes Sam's direct report. |
| `v_recruiting_pipeline` | view | migration `20260927020000_recruiting_pipeline_unified.sql:18,36` | `expected_start = applications.start_date` / `agents.start_date` (both ~empty). |

### 1.2 Production sources

| Object | Kind | Grain / measure | Eligible statuses | Date | Attribution |
|---|---|---|---|---|---|
| `agentlink_book` | table, 1384 rows, 41 producer names = 41 AL `user_id`s, source `agentlink_deals_live` | deal; `annual_premium` (ALP) | `is_dead` flag: dead = Lapse Pending 57, Declined 53, Lapsed 42, Withdrawn 31, Not Taken 24, Cancelled 2 (209). Alive = **Unknown 1048**, Active 98, In Review 19, Pending 5, Approved 4, Issued 1 | `posted_date` (0 nulls), `effective_date` (0 nulls). Posted range 2025-11-28 → 2026-10-02 | `agent_id` via `al_user_id`; 8 rows (2 AL users) unattributed |
| `v_agentlink_book_scoped` | view, 1300 rows (1095 alive) | DISTINCT ON (agent_name, client, premium, effective_date, carrier) + not roster-excluded | | | |
| `deals` | table, 1921 rows: `source` agent_link 1784 (legacy mirror, max 2026-08-31), apex 10, apex_native 127 | deal; `annual_premium` | apex_native all `submitted` | `posted_at::date` else `created_at` | `agent_id` |
| `production_external_deals` | table | deal; `annual_premium` | excludes duplicate/lapsed/cancelled/charged_back/withdrawn/not_taken/declined | `posted_date` | `agent_id` (ghost-minted when unresolved) + **`agency_name`** (`'Ayro Financial'` 52 rows/$97,677; `'Vantage Financial'` 24 rows) |
| `production_external_daily_snapshots` | table | agency-day aggregate (`reported_policies`, `reported_alp`, producers JSON) | | `business_date` | Vantage API; `vantage_producer_map` (6 mapped) |
| `v_production_canonical` | view | union agentlink ∪ apex_native (deduped against the book by policy no. / client+premium+effective) ∪ discord_external (ranked dedupe) | | `posted_date` | |
| `v_production_unified` → `mat_production_unified` (matview, 5-min cron `apex-mat-production-refresh`) | canonical ∪ Vantage API producers ∪ `external_daily_gap` filler rows (one synthetic row per unattributed Vantage policy, agent_id `…a008`) | | | |
| `v_production_comp_truth` → `mv_production_comp_truth` (matview; `refresh_production_truth` cron `*/5` + dirty-flag debounce) | adds `seller_comp_pct`, `direct_estimate`, **`agency`** = `'Vantage Financial'` if gap or `subagency='vantage'` else `'APEX Financial'` | | | |
| `ayro_book` | table, 20 rows / 7 names / $40,014, `is_excluded` on 11 rows | all-time, no dates | | none | name-matched `agent_id`; blacklist by name |
| `ethos_book_policies` | table, 1468 rows, $2,134,720, 1 distinct `owner_agent_id` | stale 2019-2023 CSV (memory 2026-08-20) | | | Not in any production view. Contains unrelated "TRAVIS ABBOTT"/"TRAVIS STUCKI" — a reason a first-name blacklist is wrong. |
| `daily_production` | table, 1467 rows, has `aop` | guarded against by `check-metric-truth.mjs:53-54,398` | | | legacy |
| RPCs | `crm_today_production()` (Phoenix `current_date`, `mat_production_unified`, admin sees gap rows); `production_period_totals()` (`v_production_unified`, `agent_id is not null`, week = **Sunday** start); `imo_by_agency_period(_uncached)` (`v_production_unified`, no agent filter); `agency_roster_production()` (`mv_production_comp_truth`); `leaderboard_book*`, `scoped_production_projection`, `production_book_freshness` | | | | |

Live origin mix in `mat_production_unified`: agentlink 1095 rows / 38 agents / $3,281,227 (8 null-agent rows); apex_native 127 / 12 / $205,546 (2026-08-24 → 10-05); agentcloud_producer 67 / 5 / $110,243 (Sep); discord_external 64 / 13 / $123,105 (= 52 Ayro + 12 Vantage-Discord); external_daily_gap 16 / $23,557.

### 1.3 Frontend surfaces in this domain (file → data)

- `src/components/dashboard/ScopedProductionScoreboard.tsx` — `scoped_production_scoreboard`, `scoped_production_projection`, `production_book_freshness`, `discord_deal_feed_health`. Period windows from `src/lib/scoreboardPeriod.ts` (week starts **Monday**, computed in UTC from a Phoenix through-date).
- `src/components/dashboard/AgentCloudHome.tsx:256-299` — scoreboard + `AyroProductionPanel` + Roster/Producing/In-onboarding tiles (`apex_admin_home_dashboard` → `v_apex_roster`) + `ImoByAgency`.
- `src/components/dashboard/ImoByAgency.tsx` — `imo_by_agency_period` (windowed) or `v_imo_by_agency` (summary) + `production_external_daily_snapshots`; admin-gated. Mounted by AgentCloudHome, AgentCommandDashboard, Finances.
- `src/components/dashboard/AyroProductionPanel.tsx` — `v_ayro_totals`, `v_ayro_production`, `v_ayro_book`; mounted on Home and `BookOfBusiness.tsx:68`.
- `src/pages/Agencies.tsx:89,99` (`/dashboard/agencies`, slated for nav removal) — `v_imo_by_agency` + `agency_roster_production`.
- `src/pages/MyDeals.tsx:112,130,190,212,226` (`/dashboard/production`) — reads `v_production_unified` directly (no agent filter), `v_agentlink_book_truth`, `v_book_status_tiles`, `v_imo_by_agency`.
- `src/pages/DashboardCRM.tsx:383-393, 2207` + `ProductionMetricsCard.tsx:48` — `crm_roster_segments` ("Team size"), `crm_agent_roster`.
- `src/components/dashboard/ManagerHierarchyMtdPanel.tsx:45,55` — `v_manager_hierarchy_mtd` (agentlink_book only), `v_top_producers_mtd`.
- `src/components/dashboard/ProductionAnalyticsCard.tsx:51` (DashboardCommandCenter) — `production_period_totals`.
- `src/components/dashboard/TeamHierarchyManager.tsx:160,480` and `src/pages/AgentManagement.tsx:159-165` — read legacy `deals` directly (`posted_at`, `DEAL_TRUTH_STATUS_FILTER`); `indirectReports` computed client-side.
- `src/components/dashboard/LeaderboardTabs.tsx:108,113` — `deals` + `daily_production`.
- `src/pages/AgencyOwnerHome.tsx:106-145` — `useMyDownline` (invited-by edge) then `agents` by id chunks.
- `src/pages/BookOfBusiness.tsx:436-549` — `v_agentlink_book_truth`, `v_book_status_segments`, persistency/concentration views.

### 1.4 Jobs
`cron.job`: `apex-mat-production-refresh` (`*/5`, `refresh_mat_production_unified_if_needed`), `refresh-production-truth` (`*/5`, `refresh_production_truth(false)`, MP-431 debounce 15s/120s ceiling, advisory lock), `apex-agentlink-watchdog-1m`, `agentlink_reap_stuck_5min`, `apex-agentlink-clients-sync-30m`. `v_agentlink_book_freshness`: latest_posted 2026-10-02, last_import 2026-10-02T14:58Z, last_successful_refresh 2026-10-06T05:21Z (sync runs; the upstream has nothing new).

---

## 2. Authoritative records

| Question | Authoritative record | Not authoritative (derived / legacy) |
|---|---|---|
| Who is a person | `agents` collapsed by `v_agent_canonical_map` (`canonical_agent_id`) | `profiles`, `applications` rows, `agentlink_book.agent_name` |
| Lifecycle | `agents.status` + `is_deactivated` (+ `is_inactive`) — three flags that disagree (see §4) | `onboarding_stage`, `v_apex_roster.roster_state` |
| Reporting line | `agents.manager_id` (canonical) — guarded by `trg_agents_manager_no_cycle` | `invited_by_manager_id` (recruiting attribution), `switched_to_manager_id` (history) |
| Agency membership | today: `fn_agent_subagency` (binary Vantage) — **no agency table exists** (`agency_branding` is branding only) | `production_external_deals.agency_name` is the only place "Ayro Financial" is recorded |
| Deal truth | `mv_production_comp_truth` (MP-430) at deal grain, `posted_date`, `annual_premium` | `deals` (source `agent_link` mirror frozen 2026-08-31), `daily_production.aop`, `ayro_book`, `ethos_book_policies` |
| Book freshness | `v_agentlink_book_freshness`, `production_book_freshness()` | |
| Comp | `fn_agent_contract_pct` → `mv_agent_truth.contract_pct` | |

---

## 3. Workflow traces

**T1 — Owner opens Home, reads "IMO total · 208 roster agents" and "My direct team · 125 direct reports".**
`Dashboard.tsx` → role admin → `AgentCloudHome` → `ScopedProductionScoreboard` → `supabase.rpc("scoped_production_scoreboard", {p_start,p_end})` → `fn_rpc_single_flight` → `scoped_production_scoreboard_uncached`: `auth.uid()` required; `apex_is_admin()`; `v_personal_ids` = canonical ids of `agents.user_id = auth.uid()` (Sam: SJAMES01; SJAMES02 collapses to it); `fn_hierarchy_first_hops(v_personal_ids)` → `v_hier_ids` (207), `v_direct_ids` (125); admin `v_scope_ids` = all non-excluded canonical ids (208). Production = `mv_production_comp_truth` rows in window with `agent_id = any(v_scope_ids)` **or** `origin='external_daily_gap'`. Renders tsx:565/579. No audit history (read path). Broken links: counts are graph cardinalities with no lifecycle filter; the labels "direct report"/"roster agent" assert headcount.

**T2 — Owner reads "Total IMO by agency" (same page, below).**
`ImoByAgency.tsx` → `imo_by_agency_period(p_start,p_end)` → `v_production_unified` (not the matview) grouped by `fn_agent_subagency(agent_id)='vantage'` → APEX/Vantage. No `agent_id is not null`, no roster-excluded filter, no placeholder filter. Result today: APEX alp_mtd **$1,879,609** (contains $1,821,600 from AL user 1069 with no agent row and $16,600 from Ayro ghosts) vs scoreboard IMO MTD **$58,009**. Broken link: two "IMO" numbers on one page from two predicates.

**T3 — An Ayro sale is posted in Discord.**
Discord reader → `ingest_ayro_sales_deal(policy, name, carrier, ap, …)` (SECURITY DEFINER): resolve `lower(display_name)` to a non-ghost active agent → else existing `GHOST_AYRO_%` → else `INSERT INTO agents (display_name, agent_code 'GHOST_AYRO_…', status 'active', has_production_access true, metadata.external_source='ayro_sales')` → BEFORE trigger `z_default_agent_manager_to_sam` sets `manager_id = Sam` → insert `production_external_deals (source 'ayro_sales', agency_name 'Ayro Financial', agent_id = ghost)` → `trg_truth_dirty` → `refresh_production_truth` → `mv_production_comp_truth.agency = 'APEX Financial'` (because `subagency` is NULL) → scoreboard "IMO total", `agency_roster_production`, `v_free_leads_qualification`, `v_recruiting_pipeline` ("Active Agent"), `v_hire_activity` all show the placeholder as an Apex person. Audit: `production_external_deals.external_ref` is the only receipt. Broken links: `agency_name` is written and then ignored by every reader; the trigger parents an external producer to the owner; the name match (`lower(btrim(display_name))`) can bind a stranger to a real agent sharing a name.

**T4 — Owner reads Ayro on Home / Book of Business.**
`AyroProductionPanel` → `v_ayro_totals` (`ayro_book where not is_excluded`) → "$22,468 · 9 deals · 4 agents · excluded: Dom Yous, snow flake, Travis N". The same policies (8 of 20) also exist in `production_external_deals.ayro_sales` and are already inside the scoreboard/IMO. Double count by construction; exclusion is a name blacklist.

**T5 — Manager/agent opens Home.** Same RPC, non-admin branch: `v_scope_ids = personal ∪ hierarchy members`; `downline_agents = |scope| − |personal|`; label "You + N downline" — N again includes terminated/ghost/deactivated descendants.

**T6 — CRM "Team size".** `DashboardCRM` → `crm_roster_segments()` → `count(*)` over `crm_agent_roster()` (admin/manager scoped; filters on `is_inact…` — tail of predicate **unmeasured**, truncated in catalog read) → `ProductionMetricsCard` "Team size … on the canonical roster". Includes `is_sync_only` ghosts (the brief's guard `check-roster-segment-placeholders.mjs` exists because 6 placeholders sat in "New hires 6 of 27").

**T7 — Headcount edit.** `TeamHierarchyManager.tsx:254-421` writes `agents.manager_id` / deletes agents directly from the client (hard delete cascade at :411-421: `onboarding_progress`, `daily_production`, `agent_notes`, … then `agents.delete`). No RPC, no audit row. Out of scope to fix here but it is a write path into headcount truth with no history.

---

## 4. Defects (evidence → severity)

| ID | Sev | Where | What | Evidence |
|---|---|---|---|---|
| HP-01 | **P0** | `v_imo_by_agency`, `imo_by_agency_period_uncached()`; `ImoByAgency.tsx`, `Agencies.tsx:89`, `MyDeals.tsx:226` | IMO-by-agency has no producer/roster predicate, so unattributed and placeholder rows are summed as APEX Financial | Live: APEX `alp_mtd = 1879609`, `policies_mtd = 34`; same window in `mv_production_comp_truth` with `agent_id in scope` = 32 rows / **$58,009**; `null_agent_ap = 1821600`; `ghost_ayro_ap = 16600`. |
| HP-02 | **P0** | `agentlink_book` rows for AL `user_id = 1069` (no `agents.al_user_id` match) | Two rows posted 2026-10-02 with implausible values pollute MTD, 30d and lifetime | `annual_premium 1800000.00, monthly 150000.00, face 500000000.00, effective_date 2055-04-02, status Unknown, is_dead false` and a $21,600 sibling, same effective date. `unattributed_ap` in scoped book = $1,829,334 (8 rows). |
| HP-03 | **P0** | `ingest_ayro_sales_deal()` + trigger `z_default_agent_manager_to_sam` + `mv_production_comp_truth.agency` CASE | External (Ayro) producers are minted as Apex agents, parented to Sam, and their production labelled APEX Financial | 6 `GHOST_AYRO_*` rows, all `status='active'`, `manager_id = 7c3c5581…` (Sam); 36 deals / $66,670 in `v_production_canonical`; all 52 `ayro_sales` rows carry `agency_name='Ayro Financial'` yet `mv_production_comp_truth.agency='APEX Financial'` for every one. |
| HP-04 | **P1** | `ScopedProductionScoreboard.tsx:565,579`; `scoped_production_scoreboard_uncached` `direct_team.agents`, `imo.agents`, `downline_agents` | Labels assert headcount; values are hierarchy cardinalities with no lifecycle filter | depth-1 under Sam = 126 → 125 after exclusion: 40 active/clean, 35 terminated, 23 inactive, 16 ghost, 8 active-but-deactivated, 4 inactive-deactivated. 208 = 228 − 19 merged − 1 excluded, includes Sam and 64 terminated. |
| HP-05 | **P1** | `ayro_book` + `AyroProductionPanel.tsx`; `v_ayro_totals.excluded_agents` | Same Ayro deals counted twice on Home; exclusion is a display-name blacklist (the exact anti-pattern Sam rejected) | 8 of 20 `ayro_book` policy numbers also in `production_external_deals.ayro_sales` ($21,705); `is_excluded` true on 11 rows; `excluded_agents = 'Dom Yous, snow flake, Travis N'`. |
| HP-06 | **P1** | `agents` identity | Tyler K. exists as `GHOST_AYRO_TKREJCHA` (4 deals / $14,354) **and** as a real row created 2026-09-28 with a login and 0 deals | `real_rows_same_name = 1, real_has_login = true, real_under_sam = true` for that ghost; 0 for the other five. |
| HP-07 | **P1** | `agentlink_book` / AgentLink pipeline | The book has had no September postings; most "stale-month" views read only it | rows by posted month: 2026-06 213, 07 132, 08 65, **09 0**, 10 2. Sync itself is alive (`last_successful_refresh` 2026-10-06). `v_manager_hierarchy_mtd`, `v_apex_roster` (producing = 120d agentlink), `v_top_producers_mtd`, `ManagerHierarchyMtdPanel.tsx` read `agentlink_book`/scoped only. |
| HP-08 | **P1** | three lifecycle flags | `status`, `is_deactivated`, `is_inactive` contradict on 44 rows (e.g. `status='active' AND is_deactivated` 12 rows; `status='inactive' AND NOT is_inactive` 26 rows); `v_agents_status_deac_mismatch` exists but nothing resolves it | group-by measured: `active/deactivated` 9+3, `inactive/not inactive` 19+7, `active/inactive-flag` 15+1+1, etc. |
| HP-09 | **P1** | hierarchy edge definitions | Three different "who is under whom": `mv_hierarchy_hops` (manager ∪ switched_to ∪ invited_by), `get_downline_agent_ids` (invited_by only, `is_deactivated=false`), `crm_agent_roster.downline_count` (manager ∪ invited_by) | Under Sam, manager_id edge gives 137 rows (SJAMES01 129 + SJAMES02 8), invited_by edge gives 88 rows; `AgencyOwnerHome` and `BookOfBusiness` use the invited_by walk while Home uses the merged walk. |
| HP-10 | **P1** | `fn_agent_subagency_live` vs `mv_hierarchy_hops` | Agency is decided on `agents.manager_id = KJ` only, hierarchy on the coalesced edge | 1 depth-1 member under KJ has `subagency = NULL` (33 members: 32 vantage + 1 null) → its production is APEX while its team is Vantage. A depth-2 Vantage agent would also be mis-bucketed (structural; 0 such today). |
| HP-11 | **P2** | period definitions | "Week" starts Monday in `scoreboardPeriod.ts:16-17` and Sunday in `production_period_totals()` (`d - extract(dow …)`); "30d" is `today-30` inclusive in `v_imo_by_agency` (31 days) and `today-29` in `crm_agent_roster` (30 days); `last_month` only exists client-side | code quoted. |
| HP-12 | **P2** | `AgentManagement.tsx:159-165`, `TeamHierarchyManager.tsx:160`, `LeaderboardTabs.tsx:108,113` | Read legacy `deals` (1784 `agent_link` mirror rows frozen at 2026-08-31 + native) / `daily_production` instead of the truth matview | `legacy_mirror_max = 2026-08-31`, `legacy_mirror_since_sept = 0`. |
| HP-13 | **P2** | `agentlink_book.status` | 1048 of 1384 rows are `Unknown` and counted as alive; the measure is therefore "submitted ALP net of known-dead", never issued/paid | status histogram above. Not a bug per se; must be stated on every surface. |
| HP-14 | **P2** | projected starts | No record: `applications.start_date` populated on 0 rows; `agents.start_date` future on 1; `apex_scheduled_calls.start_at >= now()` 0; `attendance_status` enum is `good,warning,critical` | measured. |
| HP-15 | **P2** | `agentlink_book` AL user 918 | 6 alive rows / $7,734 (last 2026-07-14) with no `agents.al_user_id` — silent attribution gap, excluded from every agent-scoped total, included in `v_imo_by_agency` | measured. |
| HP-16 | **P2** | `TeamHierarchyManager.tsx:400-421` | Client-side hard delete of an agent and 8 child tables; no audit row; headcount history destroyed | code quoted. |

---

## 5. Measurements (all live, 2026-10-05 Phoenix)

| Metric | Value | Method |
|---|---|---|
| `agents` rows | 228 | `count(*)` |
| merged duplicates (`canonical_agent_id not null`) | 19 | |
| `agent_code like 'GHOST%'` | 16 (10 `GHOST_###` May-2026 + 6 `GHOST_AYRO_*`) | |
| `agent_code is null` | 78 (60 of them eligible) | |
| status active / inactive / terminated | 97 / 67 / 64 | group by |
| `is_deactivated` / `is_inactive` | 87 / 118 | |
| `al_user_id` set / distinct | 81 / 73 | |
| `is_manager` | 14 (10 distinct managers actually referenced by `manager_id`) | |
| **Eligible people** (not merged, not ghost, not deactivated, not terminated) | **118** rows = 118 distinct `lower(display_name)` | |
| Strict active (eligible ∧ `status='active'` ∧ `not is_inactive`) | 57 | |
| Sam rows | SJAMES01 (canonical, admin) + SJAMES02 (→ SJAMES01), both `al_user_id 211`, `manager_id null` | |
| `manager_id` = Sam (either row): rows / eligible / strict | 137 / 63 / 31 | |
| `invited_by_manager_id` = Sam: rows / eligible / strict | 88 / 42 / 22 | |
| `manager_id` = a sub-manager: rows / eligible / strict | 87 / 54 / 25 | |
| sub-managers (rows → eligible reports) | KJ 36→19, Damenion (inactive) 14→12, Chudi 10→6, Aisha 9→4, Obiajulu 8→5, John R. (no code) 7→7, Moody (terminated) 2→0, Dudley (terminated) 1→1 | |
| **Reconciliation** | 63 direct + 54 indirect + 1 owner = **118** = eligible total | |
| `mv_hierarchy_hops` under Sam: members / depth-1 / depth-2 / multi-parent | 208 / 126 / 82 / 2 | |
| "125 Direct Reports" reproduced | 126 depth-1 first hops − 1 excluded = 125 | |
| "208 Roster Agents" reproduced | 208 distinct non-excluded `canonical_id` (= 207 descendants + Sam) | |
| `v_apex_roster` (Home "Roster" tile) | 61 | |
| `roster_exclusions` | 1 | |
| Vantage: `subagency='vantage'` rows / eligible / under KJ depth-1 | 39 / 20 / 33 (32 vantage + 1 null) | |
| `vantage_producer_map` | 6 rows, 6 mapped | |
| Active producers (distinct `agent_id`, non-gap): MTD Oct / Sep / L30 | 10 (6 real + 4 ghost) / 22 (16 real + 6 ghost) / 22 (16 + 6) | `mat_production_unified` |
| MTD Oct production rows / AP | 34 / $1,879,609 (of which $1,821,600 null-agent, $16,600 ghost; in-scope = 32 / $58,009) | `mv_production_comp_truth` |
| Sep production rows / AP | 191 / $321,926 | |
| `agentlink_book` rows / alive / dead / alive AP | 1384 / 1175 / 209 / $3,492,488 | |
| `agentlink_book` posted by month Jun/Jul/Aug/Sep/Oct | 213 / 132 / 65 / 0 / 2 | |
| `v_agentlink_book_scoped` rows / alive / alive unattributed / unattributed AP | 1300 / 1095 / 8 / $1,829,334 | |
| `deals` rows: agent_link / apex / apex_native | 1784 (max 2026-08-31) / 10 / 127 (all `submitted`, 2026-08-24→10-05, $205,546) | |
| `production_external_deals` | ayro_sales 52 / 9 agents / $97,677 (9/24→10/02); discord_vantage_agentcloud 24 | |
| Ayro producers | 6 ghosts ($66,670) + 2 real agents: one no-code agent created 2026-08-23 (9 Ayro deals / $19,384, 10 native), one `AGT4B4B` (7 Ayro / $11,623, 76 AL deals) | |
| `ayro_book` | 20 rows / 7 names / $40,014 / 11 excluded; 8 policies ($21,705) overlap `production_external_deals` | |
| `v_imo_by_agency` live | APEX 1274 / $3,584,451 all-time, MTD $1,879,609, 30d $2,079,738; Vantage 95 / $159,228, 30d $96,282; owner 125%, head 105% | |
| Sam personal lifetime in comp truth | 57 rows / $82,732 | |
| `ethos_book_policies` | 1468 rows / $2,134,720 / 1 owner id; not in any production view | |
| `daily_production` | 1467 rows (`aop` column) | |
| Projected starts | `applications.start_date` 0 populated; `agents.start_date` future 1; future scheduled calls 0 | |
| `crm_roster_segments()` live values | **unmeasured** (SECURITY DEFINER needs `auth.uid()`; cannot run read-only as the MCP role) | |
| `apex_admin_home_dashboard` live JSON | **unmeasured** (admin-gated RPC) | |

---

## 6. Definitions table (proposed, with measured value)

| Metric | Definition | Owner (Sam) included? | Source | Measured now |
|---|---|---|---|---|
| Total IMO agents (headcount) | eligible people: canonical row, `agent_code` not `GHOST%`, not `is_deactivated`, `status <> 'terminated'`, not `roster_excluded`, agency ∈ Sam's IMO | **Yes (stated)** | `agents` ⋈ `v_agent_canonical_map` | 118 (117 excluding Sam) |
| Current direct agents | eligible ∧ canonical `manager_id` = Sam's canonical id | No | same | 63 |
| Current indirect agents | eligible ∧ canonical `manager_id` ≠ Sam ∧ reachable from Sam in `mv_hierarchy_hops` by the `manager_id` edge | No | same + hops | 54 (reconciles: 63+54+1 = 118) |
| Unassigned (data-quality) | eligible ∧ `manager_id is null` ∧ not owner | n/a | | 0 today (2 non-eligible rows) |
| Orphaned branch (data-quality) | indirect whose first hop is inactive/terminated | n/a | | 13 (Damenion 12 + Dudley 1) |
| Active producers (period) | distinct eligible canonical `agent_id` with ≥1 row in `mv_production_comp_truth` in window, origin ≠ gap/placeholder | Yes if Sam produced | matview | MTD Oct 6; Sep 16 |
| Historical membership | every canonical row ever, with `start_date` / terminated marker | Yes | `agents` | 209 canonical rows |
| Recruiting stage | `applications` not yet converted (`agents.source_application_id`) | No | `applications` | out of this domain |
| Projected starts | `applications.expected_start_on` + `expected_start_status ∈ {confirmed, likely, awaiting_response, not_attending}` (new) | No | new columns | 0 (no data exists) |
| Production (period) | Σ `annual_premium` of rows in `mv_production_comp_truth` where `posted_date ∈ [start, end)` (Phoenix dates), `agent_id` is an eligible/attributed producer or a labelled exception; measure = **submitted annualised premium net of known-dead statuses** (never issued/paid/commission) | Yes | matview | MTD $58,009 attributed + $1,821,600 unattributed exception |
| Agency attribution | row-level `agency` = external `agency_name` if the deal came from an external source whose producer is not an Apex agent; else the agency of the producer's first hop under Sam (Vantage = KJ's branch); else APEX direct | | new `fn_production_agency` | today only APEX/Vantage |
| Unresolved attribution | rows whose `agent_id` is NULL, a `GHOST%` placeholder, or an unmapped AL user; shown as its own line, never zeroed, never folded into a producer | | | 8 AL rows ($1.83M) + 36 Ayro ghost rows ($66,670) + 16 gap rows ($23,557) |

---

## 7. KEEP / REPAIR / MERGE / REMOVE checklist

| Surface | File | Class | Reason / target |
|---|---|---|---|
| Scoped production scoreboard (Home, all roles) | `src/components/dashboard/ScopedProductionScoreboard.tsx` | **REPAIR** | Keep tiles; replace `direct_team.agents` / `imo.agents` / `downline_agents` with eligible-headcount counts from the new headcount RPC and label "N direct agents (eligible)"; add the unresolved-attribution line. |
| Total IMO by agency block | `src/components/dashboard/ImoByAgency.tsx` | **REPAIR** | Point at the single production RPC (same predicate as the scoreboard); add Ayro Financial row and an "Unattributed" row; drop the 31× divergence. |
| Home roster tiles (Roster/Producing/In onboarding) | `AgentCloudHome.tsx:276-296` via `apex_home_dashboard` → `v_apex_roster` | **REPAIR** | 61 ≠ 118 ≠ 208; redefine on the headcount view; "Producing" must read the matview not 120d agentlink. |
| Ayro production panel | `src/components/dashboard/AyroProductionPanel.tsx`, `v_ayro_*`, `ayro_book` | **MERGE → REMOVE** | Fold into the agency breakdown as "Ayro Financial"; retire `ayro_book` (keep table, stop reading) and its name blacklist. |
| Agencies page | `src/pages/Agencies.tsx` (`/dashboard/agencies`) | **MERGE** | Nav removal per brief; its `agency_roster_production` table becomes the Home agency drill-down. |
| Production page | `src/pages/MyDeals.tsx` | **REPAIR** | Stop reading `v_production_unified` raw; read the shared RPC with the same scope; unresolved rows as exception rows. |
| CRM "Team size" + segments | `src/pages/DashboardCRM.tsx`, `ProductionMetricsCard.tsx`, `crm_roster_segments()` | **REPAIR** | Define `total` on eligibility; keep `is_sync_only` ratchet (`check-roster-segment-placeholders.mjs`). |
| Manager hierarchy MTD panel | `ManagerHierarchyMtdPanel.tsx`, `v_manager_hierarchy_mtd`, `v_top_producers_mtd` | **REPAIR** | Read `mv_production_comp_truth`, not `agentlink_book` (0 Sep rows). |
| Production analytics card | `ProductionAnalyticsCard.tsx`, `production_period_totals()` | **REPAIR** | Align week start with `scoreboardPeriod.ts` (pick one, Monday) and share the window helper. |
| Team hierarchy manager / Agent management | `TeamHierarchyManager.tsx:160,400-421`, `AgentManagement.tsx:159-165` | **REPAIR** | Replace legacy `deals` reads with `crm_agent_roster`/matview; route manager changes and deletes through an audited RPC (no client cascade delete). |
| Leaderboard tabs | `LeaderboardTabs.tsx:108,113` | **REPAIR** | Drop `deals`/`daily_production` reads; use `leaderboard_board`/matview. |
| Agency owner home roster | `AgencyOwnerHome.tsx:106-145` | **REPAIR** | Use the same hierarchy edge (manager_id) and eligibility as Home; today it walks `invited_by` with no lifecycle filter beyond `is_deactivated`. |
| Book of Business | `BookOfBusiness.tsx` | **KEEP** (note) | Book views are AgentLink-only by design; label as "AgentLink book" not "production". |
| `v_imo_by_agency`, `imo_by_agency_period(_uncached)` | SQL | **REPAIR** | Add producer/roster/placeholder predicate + Ayro + unattributed line; or replace with the shared RPC. |
| `scoped_production_scoreboard_uncached` | SQL | **REPAIR** | Emit headcount from the eligibility view; keep production math (already correct scope). |
| `ingest_ayro_sales_deal` | SQL | **REPAIR** | Stop minting `agents` rows; write `agent_id = NULL` + `agency_name='Ayro Financial'` + `producer_label`; resolve to a real agent only by stable identity (NPN / `al_user_id` / explicit map table), never by display name. |
| `z_default_agent_manager_to_sam` | trigger | **REPAIR** | Skip rows with `agent_code like 'GHOST%'` or `metadata->>'external_source'`. |
| `mv_production_comp_truth.agency` | SQL | **REPAIR** | Replace binary CASE with `fn_production_agency(origin, raw_agent_id, agency_name)`. |
| `mv_agent_truth` / `mv_hierarchy_hops` / `refresh_production_truth` | SQL + cron | **KEEP** | Add `is_eligible`, `is_owner`, `first_hop_under_owner`, `agency` columns to `mv_agent_truth`. |
| `get_downline_agent_ids` / `my_downline_agent_ids` | SQL | **MERGE** | Re-implement on `mv_hierarchy_hops` (manager edge) so there is one hierarchy. |
| `crm_today_production`, `production_book_freshness`, `agentlink_book` sync | SQL/cron | **KEEP** | |
| `ethos_book_policies`, `daily_production`, `deals.source='agent_link'` mirror | tables | **KEEP (frozen, unread)** | Historical; no reader should sum them. |
| `v_recruiting_pipeline.expected_start` | SQL | **REPAIR** | Bind to the new expected-start columns. |

---

## 8. Recommended implementation plan (this domain)

**A. One headcount truth (additive migration).**
1. Extend `mv_agent_truth` with: `is_eligible boolean` (predicate from §6), `is_owner boolean` (`canonical_id = '7c3c5581-…'`), `owner_first_hop uuid` (first hop under the owner via the **manager_id-only** edge), `is_direct_to_owner`, `agency text` (owner branch → 'APEX Financial'; KJ branch → 'Vantage Financial'; later heads from a small `agency_heads(agent_id, agency_name)` table instead of the hard-coded uuid), `lifecycle text` (one derived value from `status`/`is_deactivated`/`is_inactive` with the contradictions resolved by a documented precedence: terminated > deactivated > inactive > active).
2. New RPC `headcount_summary()` → `{imo_total, owner_included: true, direct, indirect, unassigned, orphaned_branch, active_producers_period, projected_starts, as_of}` and `headcount_members(p_bucket)` returning the exact rows (drill-down = same predicate). Assert in SQL: `direct + indirect + 1 = imo_total`.
3. Make `scoped_production_scoreboard_uncached` read `direct_team.agents`/`imo.agents` from those columns; keep `all_members_count` as `hierarchy_size` for diagnostics only.
4. Rewrite `get_downline_agent_ids`/`my_downline_agent_ids` on `mv_hierarchy_hops` with `is_eligible`.
5. Projected starts: add `applications.expected_start_on date`, `expected_start_status text CHECK (in ('confirmed','likely','awaiting_response','not_attending'))`, `expected_start_set_at/by`; outcome stays in `interview_events`/booking tables. Headcount RPC reports `projected_starts` from it and never adds it to current headcount.

**B. One production truth.**
6. `fn_production_agency(origin, raw_agent_id, source_agency_name)` → agency label; `mv_production_comp_truth` gains `agency` from it plus `attribution_state text` ∈ `attributed | placeholder_producer | unmapped_al_user | agency_aggregate`.
7. New RPC `production_truth(p_start, p_end, p_scope)` returning deal-grain rows (`row_key, origin, agent_id, canonical_id, agency, attribution_state, annual_premium, posted_date, …`) under the **same** scope predicate the scoreboard uses, and `production_summary(p_start,p_end,p_scope)` aggregating it (by agency, by producer, totals, unresolved). Cards, charts, tables, exports and drill-downs call these two; `v_imo_by_agency` and `imo_by_agency_period` become thin wrappers or are left unread.
8. Period helper single-sourced: a SQL `fn_period_window(p_period, p_through)` mirroring `scoreboardPeriod.ts` (Monday week, Phoenix date); `production_period_totals` and `crm_agent_roster` call it.
9. Unresolved attribution is a first-class row on every surface ("Unattributed — AgentLink user 1069, 2 policies, $1,821,600, posted 2026-10-02 — needs identity"), never zeroed and never summed into APEX.

**C. Identity-level fixes for the named records (no blacklist).**
10. Dom Yous, snow flake, Travis N, Nels r ("Nails"), David A.: keep their deals in `production_external_deals` with `agency_name='Ayro Financial'`, set `agent_id = NULL` + `producer_label`, and set the six `GHOST_AYRO_*` agents to `status='inactive', is_deactivated=true, manager_id=NULL` (historical rows retained). They drop out of headcount and out of "APEX Financial"; they appear under "Ayro Financial (external producers, unattributed)".
11. Tyler K.: merge the ghost into the real 2026-09-28 row via `canonical_agent_id` (existing merge RPC path from `/admin/agent-duplicates`), so his 4 deals ride the real identity; his agency label then follows his first hop.
12. The two real agents with Ayro deals (no-code agent and `AGT4B4B`) stay attributed to themselves; their Ayro rows carry `agency = 'Ayro Financial'` as the **writing agency** while hierarchy keeps them in Sam's IMO — show both (agency-of-record vs. hierarchy) rather than choosing.
13. AL users 1069 and 918: surface in a `v_agentlink_unmapped_users` exception view with a one-click "link to agent" (sets `agents.al_user_id`) or "mark as upstream test data" (new `agentlink_book_overrides(deal_key, verdict, by, at)` table — never edit `agentlink_book`).
14. `ingest_ayro_sales_deal`: remove the `INSERT INTO agents` branch; `z_default_agent_manager_to_sam`: early-return on GHOST/external.

**D. Tests and guards.**
- vitest: `src/tests/lib/headcountReconciliation.test.ts` (static: migration text contains the `direct + indirect + owner = imo` assertion; SQL fixture via `npx vitest run`), extend `ScopedProductionScoreboard.test.tsx` to assert the tile detail strings read `*_eligible` fields, `financeTruth.test.ts` unchanged scopes.
- new `scripts/check-production-single-source.mjs` wired into `verify:core`: forbid `.from("v_imo_by_agency")`, `.from("v_production_unified")`, `.rpc("imo_by_agency_period")` outside `src/lib/productionTruth.ts`; forbid `.from("deals")`/`.from("daily_production")` in `TeamHierarchyManager`, `AgentManagement`, `LeaderboardTabs`. Prove red on a fixture before merging.
- `scripts/check-metric-truth.mjs`: add the Home parity ratchet (scoreboard IMO total vs IMO-by-agency total must share a source).
- `scripts/check-roster-segment-placeholders.mjs`: keep; it already models `is_sync_only`.
- Refresh `scripts/data/rpc-catalog.json`, `relation-catalog.json`, `column-catalog.json`, `unique-index-catalog.json` (new columns/RPCs) or `check:function-contracts` / `check:maybesingle-nonunique` go red.
- apex-doctor: a weekly check that `headcount_summary().direct + indirect + 1 = imo_total` and that `production_summary` unresolved AP is reported (movement-graded).

---

## 9. Risks and open questions

**Risks**
- Flipping `fn_agent_is_roster_excluded` or `is_deactivated` on the ghosts changes `v_production_canonical` row counts (migration `20261005213000` explicitly refused this) — the plan keeps the deals and relabels agency instead; verify `v_production_canonical` count before/after.
- `mv_production_comp_truth` refresh is `CONCURRENTLY`; adding columns requires a non-concurrent rebuild once (brief: additive only — do `create materialized view … _v2` then swap readers, or accept one blocking refresh off-hours).
- MP-430's lesson: any new per-row function in a view must be materialized or the 8s statement timeout returns.
- Hard-coded uuids for Sam and KJ in 6+ functions; moving to an `agency_heads` table must keep those two rows seeded or every agency label flips to APEX.
- `check-metric-truth.mjs` and the native-deals guard read file paths by name; renaming components breaks the guards before the code.

**Open questions**
1. Is AL user 1069's $1.8M pair upstream test data or a real Newbridge policy? (effective 2055, $500M face says test; only AgentLink can confirm). Until answered it stays an exception line.
2. Did Apex stop writing through AgentLink in September (0 book rows), or is the AgentLink account filtered? `agentlink_sync_log` columns differ from what I queried (`created_at` absent) — **unmeasured** which.
3. Should Ayro Financial be a sub-agency inside Sam's IMO (like Vantage, with an override) or an unrelated organization? Two real Apex agents write through it; the five strangers do not. The plan shows it as an external agency-of-record and leaves the IMO-inclusion decision to Sam.
4. Which lifecycle precedence resolves the 44 contradicting rows (`status` vs `is_deactivated` vs `is_inactive`)?
5. Is "direct" `manager_id` (reporting) or `invited_by_manager_id` (recruiting)? The plan picks `manager_id` because it is the edge `trg_agents_manager_no_cycle` guards and the one that reconciles (63+54+1=118); confirm with Sam.
6. `crm_roster_segments()` and `apex_admin_home_dashboard()` live values could not be executed read-only (auth-gated); re-measure with `apex-sql-as.sh` before claiming parity.
