# 01 — Navigation, Routes and Shell (read-only map)

Program: APEX OS redesign, 2026-10-05. Repo HEAD `4ea291c8` (main). Domain: nav-routes-shell.
Method: grep/sed on source (file:line cited), guard scripts read in full, live DB measured via Supabase MCP `execute_sql` and bot-sql (read-only). Anything not measured is marked **unmeasured**.
Foreign uncommitted files (src/lib/recovery/, src/pages/RecoveryCommand.tsx, mp531-*.mjs, heartbeat.txt, 20260906234500_policy_recovery_command.sql) were not touched and are not part of the route map below (RecoveryCommand.tsx has no `<Route>` in App.tsx at HEAD).

---

## 1. What exists

### 1.1 Shell composition

| Layer | File | Notes |
|---|---|---|
| Router | `src/App.tsx` (836 lines) | 279 `<Route` tags; `QueryShell` layout wraps every non-landing path (App.tsx:344, 407); `AuthenticatedShell` is lazy (App.tsx:51-53) and wraps the authenticated tree (App.tsx:487); `*` → `NotFound` (App.tsx:825). |
| Legacy redirect helper | `src/App.tsx:74-77` | `LegacyWorkspaceRedirect({to})` = `<Navigate to={to + location.search} replace state={{ migratedFrom: pathname }} />`. Preserves the query string. The bare `<Navigate to=... replace />` form (e.g. App.tsx:557, 752) does **not** preserve the query string. |
| Route guard | `src/components/ProtectedRoute.tsx` (119 lines) | Props `requireAdmin`, `allowManagers`, `allowPresenters`, `allowRoles` (:8-26). Unauthenticated → `/login` with `state.from` (:108). Authenticated but not permitted → `/va-team` if `isVaManager` else `/dashboard` (:112-114). `allowRoles` resolves through `hasRole()` (:44-45), i.e. `user_roles`, **not** `agents.account_mode`. |
| Authenticated shell | `src/components/layout/AuthenticatedShell.tsx` (215) | `ProtectedRoute` (:187) → `ConfirmProvider` (:190) → `SidebarLayout` (:191) → `CommandPalette` (:195) + `CommandHintFab` (:196) → `<Outlet />` (:203). |
| Sidebar layout | `src/components/layout/SidebarLayout.tsx` (154) | Desktop rail `GlobalSidebar` (:88); mobile `Sheet` drawer rendering a second `GlobalSidebar mobile` (:98-113); `TopBar` (:144); `MobileBottomNav` (:151). Sidebar state in `localStorage["sidebar-open"]` / `["sidebar-fullscreen"]` (`src/hooks/useSidebarState.tsx:22,40,46`). |
| Sidebar | `src/components/layout/GlobalSidebar.tsx` (303) | Renders `APPLICANT_NAV` for applicant logins (:84-90), else `filterEntries(AGENT_CLOUD_PRIMARY_NAV)`; mode filter `modeAllows` (:76) with `seesAll = isAdmin && !isPreviewing` (:46); role preview follows `useRolePreview` (:44-45). Favorites block (:196-212). Mobile quick actions: Post a Deal, Add Agent (admin/manager), Search (:219-255). |
| Nav tree | `src/components/layout/agentCloudNavigation.ts` (264) | `AGENT_CLOUD_PRIMARY_NAV` (:121-207), `APPLICANT_NAV` (:216-221), `AGENT_CLOUD_ACCOUNT_NAV` (:223-238), `agentCloudPathIsActive` (:244-251), `agentCloudBreadcrumb` (:253-264). |
| Favorites | `src/components/layout/favoriteRoutes.ts` (76) | zustand store, `localStorage["apex:favorites:v1"]`, max 8 (:24-25); label derived from `agentCloudBreadcrumb` (:54-57). |
| Top bar | `src/components/layout/TopBar.tsx` (126) | Breadcrumb (:61, :76), star → `toggleFavorite(pathname, favoriteLabelFor(pathname))` (:95), search button → `setCommandPaletteOpen` (:34), `NotificationBell` (:101), support-desk link `/dashboard/help?tab=desk` (:103), `RolePreviewMenu` (:108). |
| Mobile bottom nav | `src/components/layout/MobileBottomNav.tsx` (107) | 5 slots per mode; ladder at :63-68 keyed on `effectiveMode` (preview-aware :57-60). |
| Command palette | `src/components/command/CommandPalette.tsx` (253) | cmdk `CommandDialog`; ⌘K / Ctrl+K listener (:108-117); 24 static `ROUTES` (:58-81) gated by `requires: "admin" \| "manager"` via `isAdmin/isManager` only (:97-106); debounced entity search on `agents` (display_name, agent_code) and `applications` (first/last/email) `.ilike` with `.limit(5)` (:146-158); opens `useAgentProfileDrawer` (:89). Also listens for `apex:voice-prompt` (:121-130). |
| ⌘K hint FAB | `src/components/layout/CommandHintFab.tsx` (57) | Opens the same `uiStore.commandPaletteOpen`. |
| Recruiting sub-nav | `src/components/recruiting/RecruitingWorkspaceNav.tsx` (65) | 6 views (:9-16): Pipeline `/dashboard/recruiting/pipeline`, Applicants `/dashboard/recruiting`, Interviews `/dashboard/recruiting/interviews`, Follow-ups `/dashboard/recruiting/follow-ups`, Hires `/dashboard/recruiting/interviews?tab=hired`, Training `/dashboard/recruiting/training`. Mounted by `DashboardApplicants.tsx`, `Interviews.tsx`, `InterviewRecovery.tsx`, `ApexCareerToolkit.tsx`. |
| Role homes | `src/pages/Dashboard.tsx` (1153) | Ladder (:1030-1110): va/va_manager → `VaOpsCommandCenter`; recruiter → `RecruiterHome`; real admin (no preview) → `AgentCloudHome`; agent → `AgentCommandDashboard`; agency_owner → `AgencyOwnerHome`; manager → manager branch. |
| Mode resolution | `src/hooks/useAuth.ts:405-414` | `effectiveMode`: admin wins → `agents.account_mode` (agency_owner/recruiter/manager/va/va_manager) → roles (va_manager, va, recruiter, manager) → `agent`. `account_mode` is read from `agents` (:153-162); null when no agents row. |
| Other keyboard shortcuts | `CallCenterActions.tsx`, `CallCenter.tsx`, `InterviewRecovery.tsx`, `admin/RecoveryQueue.tsx`, `ContractingCheckinPanel.tsx` | Page-local `metaKey/ctrlKey` handlers; none register a global route shortcut besides ⌘K. **No `useHotkeys`/keybinding registry exists.** |

### 1.2 The nav tree, per surface and role (as rendered today)

**Desktop sidebar** (`agentCloudNavigation.ts:121-207`; admin sees everything, `adminOnly` hidden for all others; `modes` allowlist otherwise):

| Group / item | href | Visible to |
|---|---|---|
| Home | `/dashboard` | everyone |
| **Sell** (modes PRODUCERS+va+va_manager) | | |
| · My Pipeline | `/dashboard/agent-pipeline` | agent, manager, agency_owner |
| · Call Center | `/dashboard/call-center` | PRODUCERS, va, va_manager |
| · **Quoter** | `/dashboard/quoter` (:134) | PRODUCERS |
| · Calendar | `/dashboard/calendar` | PRODUCERS |
| **Grow** (modes RECRUITING = all 6 non-admin modes) | | |
| · Recruit Stages | `/dashboard/recruits` | all |
| · Recruit Pipeline | `/dashboard/recruiting` | all |
| · **Interviews** | `/dashboard/recruiting/interviews` (:149) | all |
| · Invite an agent | `/admin/invite-links` | all (route itself is requireAdmin+allowManagers → agents/recruiters/VAs bounce to `/dashboard`, see D-07) |
| · **Follow-ups** | `/dashboard/recruiting/follow-ups` (:151) | recruiter, va, va_manager, manager, agency_owner |
| **My Business** (PRODUCERS) | Book of Business `/dashboard/production`, My Commissions `/dashboard/my-commissions`, Retention `/dashboard/retention` | |
| **Learn** (PRODUCERS) | Field Course `/dashboard/training/sales-course`, Training Home `/dashboard/training/library`, **Scripts** `/dashboard/scripts` (:173), Call Lab `/dashboard/call-lab` | |
| **Team** (PRODUCERS+recruiter) | Leaderboard `/dashboard/leaderboard` (PRODUCERS), My Team `/dashboard/team` | |
| **VA Team** (leaf) | `/va-team` (:188) | va_manager only |
| **Owner** (all adminOnly) | **Agencies** `/dashboard/agencies` (:197), Launch Board, Content, Reports `/dashboard/analytics`, Finances, Contracting Ops, Contract Requests, Import | admin |
| Account → Settings | Agency settings (admin), Notifications, Security, Billing (admin), Nova Pro, Support desk, Install app | |
| Account → Producer Profile | `/dashboard/profile` | PRODUCERS |

Applicant rail (`:216-221`, role agent + no agents row): Home, Get licensed `/get-licensed`, Training `/dashboard/training/library`, Support desk.

**Mobile bottom nav** (`MobileBottomNav.tsx:12-51`):

| Mode | Slots |
|---|---|
| admin | `/dashboard`, `/dashboard/recruiting`, `/dashboard/team`, `/dashboard/production`, `/dashboard/admin` |
| manager / agency_owner | `/dashboard`, `/dashboard/recruiting`, `/dashboard/team`, `/dashboard/production`, `/dashboard/resources` (redirect-only route, D-09) |
| recruiter | `/dashboard`, `/dashboard/recruiting`, **`/dashboard/recruiting/interviews`** (:40), **`/dashboard/recruiting/follow-ups`** (:41), `/dashboard/settings` |
| va / va_manager | `/dashboard`, `/dashboard/recruiting`, **`/dashboard/recruiting/interviews`** (:48), `/dashboard/team`, `/dashboard/resources` |
| agent (default) | `/agent-portal`, `/numbers`, `/dashboard/my-deals`, `/agent-pipeline`, `/dashboard/settings` |

**Command palette** (`CommandPalette.tsx:58-81`): none of the six retired destinations are listed. Entries that point at redirect-only routes: Command Center `/dashboard/command` (:59), Agent CRM `/dashboard/crm` (:62), Lead Center `/dashboard/leads` (:63). Entries whose gate is weaker than the route's: Hiring Pipeline `/dashboard/hiring-pipeline` (palette `manager`; route `requireAdmin allowManagers` — consistent), Award Graphics `/dashboard/awards` (palette admin; route plain `ProtectedRoute`), Content Library `/dashboard/content` (palette manager; the first-declared route is `ContentAccessGate`, see D-02).

**Favorites**: user-pinned, any pathname; labels from breadcrumb. A pinned retired route survives in `localStorage` after removal and will follow the redirect (fine) — but the label will be recomputed from the *new* path only on next pin.

**Shortcuts**: only ⌘K/Ctrl+K (palette). Nothing else to remove.

**In-page links to the six destinations** (every hit in `src`, tests and App.tsx excluded):

| Destination | File:line |
|---|---|
| Quoter `/dashboard/quoter` | `agentCloudNavigation.ts:134` only. `Quoter.tsx` has no DB access: `RATE_TABLE` (:25) and `PRODUCTS` (:64) are hardcoded; `RATE_TABLE` is referenced nowhere else. |
| Interviews `/dashboard/recruiting/interviews` | `agentCloudNavigation.ts:149`; `MobileBottomNav.tsx:40,48`; `RecruitingWorkspaceNav.tsx:12,14(?tab=hired),28,30`; `RecruiterHome.tsx:120,289`; `AgencyOwnerHome.tsx:297`; `VaOpsCommandCenter.tsx:117`; `DashboardApplicants.tsx:1223` (`navigate("/dashboard/recruiting/interviews?tab=hired")`). Legacy alias `/dashboard/interviews`: `OperationsCommandCenter.tsx:110` (MetricLink), App.tsx:698 redirect. Edge fn comment only: `supabase/functions/send-candidate-confirmation/index.ts:4`. |
| Follow-ups `/dashboard/recruiting/follow-ups` | `agentCloudNavigation.ts:151`; `MobileBottomNav.tsx:41`; `RecruitingWorkspaceNav.tsx:13`; `RecruiterHome.tsx:144,290`. Legacy alias `/dashboard/interview-recovery`: `VaOpsCommandCenter.tsx:125`, `SystemHealth.tsx:85,89`, App.tsx:699 redirect. **Outside src**: `supabase/functions/apex-outbox-dispatcher/slack-event-templates.ts:48` (`https://apex-financial.org/dashboard/recruiting/follow-ups`); DB functions `fn_queue_interview_noshow_slack` and `trigger_interview_noshow_recovery` embed the same URL (measured via `pg_get_functiondef`). |
| Scripts `/dashboard/scripts` | `agentCloudNavigation.ts:173`; `GettingStarted.tsx:59` (`ran_first_appointment` step href). **Outside src**: `supabase/functions/telegram-webhook/index.ts:660` ("Script library: https://apex-financial.org/dashboard/scripts"). |
| VA Team `/va-team` | `agentCloudNavigation.ts:188`; `ProtectedRoute.tsx:114` (denied-redirect target for va_manager); `Login.tsx:90`, `Signup.tsx:140`, `AgentNumbersLogin.tsx:81` (post-login routing); `VaOpsCommandCenter.tsx:168`. |
| Agencies `/dashboard/agencies` | `agentCloudNavigation.ts:197`; `components/dashboard/ImoByAgency.tsx:154` ("View agencies →"). |

### 1.3 What each retired page does (and the backend it owns)

| Page | Route (App.tsx) | Data | What it does |
|---|---|---|---|
| `Quoter.tsx` (276) | `/dashboard/quoter` :723, `ProtectedRoute` | none (hardcoded `RATE_TABLE`, `PRODUCTS`) | Client-side illustrative premium calculator ("confirm with carrier's actual rate", :146). No records written. |
| `Interviews.tsx` (855) | `/dashboard/recruiting/interviews` :496 (admin+managers+va_manager/va/recruiter) | `functions.invoke("interviews-pipeline")` (:176), `rpc("admin_enqueue_onboarding_call")` (:274) | "Interview Control Room" (:569) with tabs open/overdue/upcoming/hired/onboarding/all (:74-78); `?tab=hired` is the Hires board used by `RecruitingWorkspaceNav`, `DashboardApplicants:1223`. The edge fn `interviews-pipeline` reads `hh_*` tables (also used by `PromoteApplicantButton.tsx`, `HireLaunchBoard.tsx`, `DashboardApplicants.tsx`, `interviews-outcome` fn). |
| `InterviewRecovery.tsx` (1622) | `/dashboard/recruiting/follow-ups` :497 (same gate) | `v_interview_pipeline` (:258), `v_prospect_review_queue` (:273), `interview_events` (:416), `rpc("cc_dispose_interview")` (:403) | Follow-up / no-show recovery queue; disposition writes via `cc_dispose_interview(p_id, p_outcome, p_notes, p_followup_due_at)`. Keyboard shortcuts page-local. `v_prospect_review_queue` is also read by `VaOpsCommandCenter.tsx`. |
| `Scripts.tsx` (257) | `/dashboard/scripts` :711, `ProtectedRoute` | `sales_scripts` (is_active, ordered by sort_order) (:54-62) | Searchable copy-to-clipboard library, 4 categories (:39). `CallLabLive.tsx:133-135` reads the same table in its ScriptPanel — the capability already exists elsewhere. |
| `VaManagerPortal.tsx` (332) | `/va-team` :551 (`requireAdmin allowRoles=["va_manager"]`) | `rpc("list_my_vas")` (:58-66), `functions.invoke("create-va-account")` (:78), `functions.invoke("set-va-account")` (:114) | Create / enable / disable sub-VA accounts. Only consumer of those two edge fns and that RPC (grep). |
| `Agencies.tsx` (235) | `/dashboard/agencies` :554 (`requireAdmin`) | `rpc("agency_roster_production", p_start, p_end)` (:99) | "Agencies under you" (:120): per-agency roster + production. Only consumer of that RPC; `ImoByAgency.tsx` (the Home "TOTAL IMO BY AGENCY" widget) links to it but does not share the RPC. |

### 1.4 Redirect inventory (App.tsx) and chain depth

Single-hop `LegacyWorkspaceRedirect` (query preserved): `/dashboard/resources→/dashboard/training/library` (:545), `/dashboard/applicants→/dashboard/recruiting` (:565), `/dashboard/crm→/dashboard/team` (:602), `/dashboard/command→/dashboard/admin` (:604), `/admin/apex-toolkit→/dashboard/training` (:621), `/onboarding-course`,`/course-catalog→/dashboard/training/sales-course` (:654-655), `/dashboard/training-hub→…/library` (:659), `/course-progress(/content)` (:661-662), `/dashboard/contracts→/dashboard/contracting` (:679), `/dashboard/interviews→/dashboard/recruiting/interviews` (:698), `/dashboard/interview-recovery→/dashboard/recruiting/follow-ups` (:699), `/dashboard/business-analytics→/dashboard/analytics` (:707), `/dashboard/announcements→/dashboard/community` (:709), `/dashboard/recruit`,`/recruit→/dashboard/recruiting` (:736-737).

Bare `<Navigate replace>` (query dropped): `/dashboard/managers`,`/billers→/dashboard/crm` (:557-558), `/admin/recruiting-inbox→/dashboard/command` (:573), `/admin/agentlink-backfill→/dashboard/book-of-business` (:633), `/dashboard/leads`,`/inbound-leads`,`/inbound`,`/headhunters-calendar`,`/recruiting-funnels`,`/recruiting-tracker`,`/team-analytics`,`/today→/dashboard/command` (:671,690,691,695,720,721,724,735), `/dashboard/client-pipeline→/dashboard/clients` (:689), `/dashboard/hierarchy→/dashboard/crm` (:702), `/dashboard/team-hierarchy→/dashboard/agents` (:703), `/dashboard/carriers→/dashboard/book-of-business` (:708), `/dashboard/agent-link-sync→/dashboard/agentlink-sync` (:746), `/dashboard/agents→/dashboard/crm` (:752), `/dashboard/my-team→/dashboard/crm` (:777), `/dashboard/charges-audit→/dashboard` (:788), `/dashboard/admin/charges-audit→/dashboard/charges-audit` (:789), `/dashboard/conduct→/dashboard/strikes` (:795), `/dashboard/admin/book-quality→/dashboard/book-quality` (:800), `/log-numbers→/apex-daily-numbers` (:822).

**Multi-hop chains present today (no cycles found):**
- 3 hops: `/dashboard/team-hierarchy → /dashboard/agents → /dashboard/crm → /dashboard/team`.
- 2 hops: `/dashboard/agents`, `/dashboard/hierarchy`, `/dashboard/managers`, `/dashboard/billers`, `/dashboard/my-team` → `/dashboard/crm` → `/dashboard/team`; nine routes → `/dashboard/command` → `/dashboard/admin`; `/dashboard/admin/charges-audit → /dashboard/charges-audit → /dashboard`.
- The two interview aliases (:698-699) are 1 hop today and become 2 hops the moment `/dashboard/recruiting/interviews` or `/follow-ups` is itself turned into a redirect (see §4 D-01 and §7).

---

## 2. Authoritative records (for this domain)

| Record | Kind | Role |
|---|---|---|
| `src/App.tsx` `<Route path>` list | file | The only route truth; every guard (sidebar-routes, dead-internal-links, route-shape) parses it with a regex (`<Route\s+path="…"` / `path="…"`). Routes must stay on the `<Route path="..."` literal form. |
| `agentCloudNavigation.ts` | file | Desktop sidebar truth + breadcrumb + favorites label source. |
| `MobileBottomNav.tsx` | file | Mobile nav truth (separate, hand-maintained, `path:` keys). |
| `CommandPalette.tsx` `ROUTES` | file | Palette truth (separate, hand-maintained, `path:` keys). |
| `RecruitingWorkspaceNav.tsx` `WORKSPACE_VIEWS` | file | Recruiting sub-nav truth (object-literal `href:`). |
| `agents.account_mode` + `user_roles` | table | Mode/role truth. Measured: account_mode `agent` 214 rows / 201 people / 191 with login; `manager` 12/12/12; `admin` 1; `agency_owner` 1; **`recruiter` 0, `va` 0, `va_manager` 0**. `user_roles`: agent 563 users, manager 10, admin 2, va 2, va_manager 2, **recruiter 0**. |
| `interview_events` | table | Interview truth for Interviews/Follow-ups/Calendar (271 rows, 95 distinct applications, 0 upcoming at measurement, newest 2026-10-05 10:03Z). Columns include scheduled_at, canceled_at, outcome, outcome_at, followup_due_at, contacted_at, va_notes. |
| `v_interview_pipeline`, `v_prospect_review_queue` | view | Follow-ups page sources. **Both return 0 rows live** (view definition vs. data not distinguished — unmeasured). |
| `calendar_events` | table | Calendar page source: 320 rows, `source` = `schedule-auto-populate` 314, `siri` 6. **No interview-sourced rows**: Calendar does not carry interviews today. |
| `sales_scripts` | table | 11 rows, 11 active, 4 categories, last update 2026-08-31. |
| `list_my_vas()`, `agency_roster_production(p_start,p_end)`, `cc_dispose_interview(...)`, `admin_enqueue_onboarding_call(p_agent_id)` | rpc | All exist in `pg_proc` (measured). |
| `create-va-account`, `set-va-account`, `interviews-pipeline` | edge_fn | VA account lifecycle; interview pipeline (reads `hh_*`: hh_activity, hh_applicants, hh_import_log, hh_login_tokens, hh_rate_limits, hh_user_prefs, hh_users — there is **no** `hh_interviews` table). |
| `fn_queue_interview_noshow_slack`, `trigger_interview_noshow_recovery` | rpc/trigger fn | Embed `https://apex-financial.org/dashboard/recruiting/follow-ups` in outbound Slack text. |

---

## 3. Workflow traces

**T1 — Sidebar click → page.** User clicks a leaf (`GlobalSidebar.tsx:107` `<Link to={item.href}>`) → react-router → `<Route>` in App.tsx → `ProtectedRoute` (`ProtectedRoute.tsx:36-118`): loading → `SkeletonLoader`; no user → `/login`; gate fail → `/va-team` or `/dashboard`; pass → page. No record saved; no audit (a route visit writes nothing). Breadcrumb/favorite label derived from `agentCloudBreadcrumb` (TopBar.tsx:61). **Broken link**: sidebar visibility (`modes`) and route gate (`requireAdmin/allowRoles`) are two separate truths; e.g. "Invite an agent" is shown to every RECRUITING mode (nav :150) but the route (App.tsx:571) admits admin+managers only → agents/recruiters/VAs are bounced to `/dashboard` silently (D-07).

**T2 — Login → role home.** `Login.tsx:90` / `Signup.tsx:140` / `AgentNumbersLogin.tsx:81` send va_manager to `/va-team`, else `/dashboard` → `Dashboard.tsx:1030-1110` picks the home from `useRolePreview().effectiveRole` (derived from `useAuth.effectiveMode`, `useAuth.ts:405-414`) → `VaOpsCommandCenter` / `RecruiterHome` / `AgentCloudHome` / `AgentCommandDashboard` / `AgencyOwnerHome` / manager snapshot. Saved record: none. Audit: none. **Broken link**: `/va-team` as a login landing is the VA Team surface the brief retires; VA managers need a new landing (VaOpsCommandCenter at `/dashboard` already exists for va/va_manager).

**T3 — Legacy URL → current page.** Old URL hits a `LegacyWorkspaceRedirect` (App.tsx:74) → `Navigate` with search preserved + `state.migratedFrom` → target route. Nothing reads `migratedFrom` (grep: only the definition). Chains of 2-3 hops exist (§1.4). No loop today.

**T4 — ⌘K → entity → drawer.** `CommandPalette.tsx:108-117` keydown → `uiStore.commandPaletteOpen` → typed query ≥2 chars → `agents`/`applications` `.ilike` reads with `.limit(5)` (:146-158) → `openAgentProfile` drawer (:89) or `navigate(path)` (:164-167). Authorization: RLS only (anon key + session). No audit. **Broken link**: the `applications` search queries `email` with `ilike` on raw user input (MP-277 class: `%`/`_` are wildcards; not escaped here).

**T5 — Interview booked → Follow-ups.** Calendly webhook → `interview_events` row → no-show → `trigger_interview_noshow_recovery` / `fn_queue_interview_noshow_slack` → Slack text with the hard-coded URL `/dashboard/recruiting/follow-ups` (DB function bodies; also `slack-event-templates.ts:48`) → human clicks → `InterviewRecovery.tsx` → `cc_dispose_interview` → `interview_events.outcome/outcome_at/followup_due_at`. **If the route is removed without a redirect, every past and future Slack no-show alert 404s.**

**T6 — Scripts delivery.** Today: pull-only. Agent opens Learn → Scripts, or Call Lab live panel (`CallLabLive.tsx:133`), or follows `GettingStarted.tsx:59` / Telegram "Script library" link (`telegram-webhook/index.ts:660`). No push, no eligibility, no delivery record. The brief's "delivered after hiring and training completion" has **no existing table or job** (grep for a scripts delivery queue found none; sales_scripts has no audience/eligibility columns per the page's select list).

---

## 4. Defects (evidence → severity)

| ID | Sev | Where | What | Evidence |
|---|---|---|---|---|
| D-01 | P1 | App.tsx:698-699; `slack-event-templates.ts:48`; DB fns `fn_queue_interview_noshow_slack`, `trigger_interview_noshow_recovery`; `telegram-webhook/index.ts:660` | Retiring Interviews/Follow-ups/Scripts by deleting routes would 404 live outbound deep links (Slack no-show alerts, Telegram training hub) and turn the two legacy aliases into dead redirects. | `pg_get_functiondef` match on `/dashboard/recruiting/follow-ups` for both functions; grep hits quoted above; `check:dead-internal-links` scans `supabase/functions` for `https://apex-financial.org/...` literals and would fail on :48 and :660 if those paths leave App.tsx. |
| D-02 | P1 | App.tsx:525 vs :763 | `/dashboard/content` is declared twice with different elements and different gates (`ContentAccessGate`→`ContentQueue` vs `requireAdmin`→`ContentLibrary`). React Router v6 ranks identical paths by declaration order, so :763 is unreachable dead code and the palette label "Content Library" (CommandPalette.tsx:71) opens ContentQueue. | Two `<Route path="/dashboard/content"` lines; `check:route-shape` only NOTEs order divergence, never fails on duplicates. |
| D-03 | P1 | `scripts/check-sidebar-routes.mjs` (HREF_PATTERN `href\s*:` over GlobalSidebar+agentCloudNavigation only) and `scripts/check-dead-internal-links.mjs` LINK_PATTERNS (`to="`, `href="`, `navigate("`, `` to={`…`} ``, `|| "`) | Object-literal route tables are **unguarded**: `MobileBottomNav.tsx` (`path:`), `CommandPalette.tsx` (`path:`), `RecruitingWorkspaceNav.tsx` (`href:` in a file sidebar-routes never reads), `RecruiterHome.tsx:104-144` / `VaOpsCommandCenter.tsx:103-168` / `GettingStarted.tsx:55-60` / `SystemHealth.tsx:85-105` (`href:`). Deleting a route leaves these pointing at NotFound with every guard green. | Regexes quoted from the scripts; `path:` and `href: "` do not match `href="` or `to="`. Only `src/tests/components/RecruitingWorkspaceNav.test.tsx` and `GlobalSidebar.test.tsx` pin some of these by string. |
| D-04 | P1 | `agentCloudNavigation.ts:42,146-152`; `MobileBottomNav.tsx:36-43`; `Dashboard.tsx:1044`; `RecruiterHome.tsx` | The Pure Recruiter surface (sidebar Grow for `recruiter`, `recruiterNavItems`, `RecruiterHome`) serves **zero people**: `agents.account_mode='recruiter'` = 0 rows and `user_roles.role='recruiter'` = 0 users. Four nav variants are maintained for a mode nobody holds. | Live counts above. Not a reason to delete the mode, but the mobile/sidebar recruiter variants carry two of the six retired destinations and nothing else depends on them. |
| D-05 | P2 | App.tsx:703→752→602 | 3-hop redirect chain `/dashboard/team-hierarchy → /dashboard/agents → /dashboard/crm → /dashboard/team`; 15 other routes are 2-hop. Each bare `<Navigate>` hop drops the query string, so `LeaderboardTabs.tsx:710` and `AgentPipeline.tsx:501` (`/dashboard/crm?focusAgentId=`) survive only because `/dashboard/crm` is the `LegacyWorkspaceRedirect` form; a link into `/dashboard/agents?focusAgentId=` would lose it. | Route list §1.4; `LegacyWorkspaceRedirect` preserves `location.search`, `<Navigate to="/x" replace />` does not. |
| D-06 | P2 | `CommandPalette.tsx:59,62,63` | Palette entries "Command Center", "Agent CRM", "Lead Center" point at redirect-only routes (`/dashboard/command`, `/dashboard/crm`, `/dashboard/leads` → 2 hops to `/dashboard/admin`). | Route list; `/dashboard/leads` → `/dashboard/command` → `/dashboard/admin`. |
| D-07 | P2 | `agentCloudNavigation.ts:150` vs App.tsx:571 | "Invite an agent" is shown to all RECRUITING modes (agent, recruiter, va, va_manager, manager, agency_owner) but `/admin/invite-links` is `requireAdmin allowManagers`; plain agents, VAs and recruiters click and are bounced to `/dashboard` with no message (`ProtectedRoute.tsx:112-114`). Same class: Recruit Stages `/dashboard/recruits` (App.tsx:606 omits `recruiter` from `allowRoles`) is shown to recruiter mode. | Nav `modes` vs route props quoted. `GlobalSidebar.test.tsx:153` asserts a Pure Recruiter *sees* "Invite an agent" — the test pins the mismatch. |
| D-08 | P2 | `MobileBottomNav.tsx:33,50` | Manager and VA mobile slots point at `/dashboard/resources`, a redirect-only route (App.tsx:545). | Route list. |
| D-09 | P2 | `ProtectedRoute.tsx:112-114`, `Login.tsx:90`, `Signup.tsx:140`, `AgentNumbersLogin.tsx:81`, `VaOpsCommandCenter.tsx:168` | `/va-team` is both a nav destination and the *denied-route landing* for va_manager; retiring the destination without re-pointing these five sites either strands va_managers on a redirect or loops if `/va-team` redirects to a page that is itself `requireAdmin` without `allowRoles=["va_manager"]`. | File:line list; loop risk is structural (denied → `/va-team` → redirect → denied). |
| D-10 | P2 | `InterviewRecovery.tsx:258,273` | The Follow-ups page's two primary views return 0 rows live (`v_interview_pipeline`, `v_prospect_review_queue`) while `interview_events` has 271 rows; the page is therefore rendering its "Backlog clear" state (:537-538) regardless of real follow-up load. Whether the views are correctly empty or stale is **unmeasured** (definition not read). | Live counts. |
| D-11 | P2 | `calendar_events` | "Interviews → scheduling and history inside Pipeline and Calendar" (brief) has no data path today: `calendar_events.source` ∈ {schedule-auto-populate 314, siri 6}; `CalendarPage.tsx` reads `calendar_events` and `applications` only, never `interview_events`. | Live counts; grep of CalendarPage reads. |
| D-12 | P2 | `CommandPalette.tsx:97-106` | Palette gating uses `isAdmin/isManager` only; `account_mode` (recruiter/va/agency_owner) is ignored, so a VA sees "Course Catalog", "Purchase Leads", "My Referrals" etc. that the sidebar hides from them, and the palette ignores role preview entirely. | Code quoted. |
| D-13 | P2 | `OperationsCommandCenter.tsx:110`, `SystemHealth.tsx:85,89`, `VaOpsCommandCenter.tsx:125` | Four in-page links still use the *legacy* aliases `/dashboard/interviews` and `/dashboard/interview-recovery` rather than the current paths; after the retirement they would be 2-hop chains. | grep hits. |
| D-14 | P2 | `AdminProducerTrends.tsx:1694` | `<a href={`/dashboard/agents/${…}`}>` is a full-page reload inside the SPA; `check:internal-nav-hrefs` misses it because its regex requires `href=["']` and this is a template literal. Not a nav-shell file, noted for the owning domain. | Line + regex quoted. |
| D-15 | P2 | `CommandPalette.tsx:146-158` | Entity search passes raw input into `.ilike("%${query}%")` on `agents` and `applications.email` (MP-277 class: `%`,`_`,`*` unescaped). | Code quoted. |

---

## 5. Measurements

| Metric | Value | Method |
|---|---|---|
| `<Route` tags in App.tsx | 279 | `grep -c "<Route" src/App.tsx` (the task said 274; 279 is the count at HEAD 4ea291c8, incl. 2 layout routes without `path`) |
| Routes that are redirect-only | 44 (15 `LegacyWorkspaceRedirect`, 29 bare `Navigate`) | hand count from §1.4 |
| Redirect chains ≥2 hops | 16 routes (1 at 3 hops) | §1.4 |
| Sidebar hrefs | 38 primary+account hrefs (`check:sidebar-routes` reports its own count at run time) | `agentCloudNavigation.ts` |
| Palette static routes | 24 | `CommandPalette.tsx:58-81` |
| In-src refs to `/dashboard/applicants` (redirect-only) | 31 (AgentCommandDashboard 17, ManagerCommandView 2, ActivityFeedWidget 2, 7 singles) | grep, tests/App excluded |
| In-src refs to `/dashboard/team` | 23 | grep |
| In-src refs to `/dashboard/recruits` outside the sidebar | 0 (Recruit Stages reachable only via sidebar) | grep |
| `agents.account_mode` | agent 214 rows/201 people/191 logins; manager 12; admin 1; agency_owner 1; recruiter/va/va_manager 0 | bot-sql |
| `user_roles` | agent 563, manager 10, admin 2, va 2, va_manager 2, recruiter 0 | bot-sql |
| `sales_scripts` | 11 rows, 11 active, 4 categories, last update 2026-08-31 | bot-sql |
| `interview_events` | 271 rows, 95 distinct application_ids, 0 scheduled_at ≥ now, newest 2026-10-05 10:03Z | MCP execute_sql |
| `v_interview_pipeline` / `v_prospect_review_queue` | 0 / 0 rows | MCP execute_sql |
| `apex_scheduled_calls` | 2 rows | MCP execute_sql |
| `calendar_events` | 320 rows; sources schedule-auto-populate 314, siri 6; no interview source | MCP execute_sql |
| `hh_*` tables | 7 (no `hh_interviews`) | information_schema |
| DB functions embedding `/dashboard/recruiting/follow-ups` | 2 (`fn_queue_interview_noshow_slack`, `trigger_interview_noshow_recovery`) | `pg_get_functiondef` LIKE over 8 retired paths |
| Edge-fn literals to retired paths | 2 live (`slack-event-templates.ts:48`, `telegram-webhook/index.ts:660`) + 1 comment | grep supabase/functions |
| Nav/route tests that pin retired destinations | `GlobalSidebar.test.tsx:105,118,125,151-153,156,212-213`; `RecruitingWorkspaceNav.test.tsx:13-23`; `interviewPipelineContract.test.ts:11-14`; `slackMessagingFoundation.test.ts:149-164`; `mobileAppContract.test.ts:22-31`; `accountModeRouting.test.ts:11-62` | grep src/tests |

---

## 6. KEEP / REPAIR / MERGE / REMOVE checklist (every surface in this domain)

| Surface | File | Verdict | Reason / target |
|---|---|---|---|
| Router + `LegacyWorkspaceRedirect` | App.tsx | REPAIR | Collapse chains (D-05), remove duplicate `/dashboard/content` (D-02), add the six retirements as single-hop `LegacyWorkspaceRedirect`s, re-point legacy aliases directly at final targets. |
| `ProtectedRoute` | components/ProtectedRoute.tsx | REPAIR | Denied landing `/va-team` (:114) → `/dashboard` for everyone once VA Team is retired (VaOpsCommandCenter already owns `/dashboard` for va/va_manager). Consider a toast on bounce (currently silent). |
| `AuthenticatedShell`, `SidebarLayout`, `TopBar`, `CommandHintFab`, `favoriteRoutes` | layout/* | KEEP | No retired-destination coupling; favorites self-heal through redirects. |
| Desktop sidebar tree | agentCloudNavigation.ts | REPAIR | Delete :134 Quoter, :149 Interviews, :151 Follow-ups, :173 Scripts, :188 VA Team, :197 Agencies. Fix "Invite an agent" `modes` to leaders only (D-07) or widen the route. Preserve `label: "Sell"` and the `PRODUCERS` constant lines verbatim (`accountModeRouting.test.ts:55-57` pins them). |
| `GlobalSidebar` | layout/GlobalSidebar.tsx | KEEP | Rendering is data-driven; only the `Grow` special-case at :127 (`pathname.startsWith("/dashboard/recruiting/")`) stays valid. |
| Mobile bottom nav | layout/MobileBottomNav.tsx | REPAIR | recruiterNavItems :40-41 → Pipeline / Calendar / Team; staffNavItems :48 → `/dashboard/calendar` or `/admin/recovery-queue`; :33,:50 `/dashboard/resources` → `/dashboard/training/library`. Keep the ladder strings at :63-68 (pinned by `mobileAppContract.test.ts:29-30`). |
| Command palette | command/CommandPalette.tsx | REPAIR | Repoint :59→`/dashboard/admin`, :62→`/dashboard/team`, :63→`/dashboard/admin`; gate on `effectiveMode` (D-12); escape ilike input (D-15). No retired entries to remove. |
| Recruiting sub-nav | recruiting/RecruitingWorkspaceNav.tsx | MERGE | Collapse to Pipeline / Applicants / Hires / Training; Interviews and Follow-ups become tabs or filters of the Pipeline/Applicants view (target: `DashboardApplicants.tsx`, which already reads `interview_events` and `interviews-pipeline`). Update `RecruitingWorkspaceNav.test.tsx`. |
| Role homes' quick links | RecruiterHome.tsx:120,144,289,290; AgencyOwnerHome.tsx:297; VaOpsCommandCenter.tsx:117,125,168 | REPAIR | Repoint to Pipeline (`/dashboard/recruiting?view=interviews` / `?view=followups`) and Calendar; VaOps :168 → remove (VA Team) and surface staff management under Settings/Accounts. |
| `/dashboard/quoter` + Quoter.tsx | App.tsx:723 | REMOVE | Redirect → `/dashboard/agent-pipeline` (the Sell home). Delete `Quoter.tsx` (no other importer; `RATE_TABLE` unreferenced) or mark `// intentionally-orphan:` if the rate table is wanted for a future in-pipeline quote drawer. |
| `/dashboard/recruiting/interviews` + Interviews.tsx | App.tsx:496 | MERGE | Capability → Pipeline tab (`DashboardApplicants`) + Calendar (`interview_events` feed, D-11). Keep `admin_enqueue_onboarding_call` + `interviews-pipeline` consumers (`PromoteApplicantButton`, `HireLaunchBoard`). The `?tab=hired` Hires board must survive as `/dashboard/recruiting/hires` (route already exists at App.tsx:498 → DashboardApplicants). Redirect `/dashboard/recruiting/interviews` → `/dashboard/recruiting?view=interviews` (and `?tab=hired` → `/dashboard/recruiting/hires`); repoint App.tsx:698 directly. |
| `/dashboard/recruiting/follow-ups` + InterviewRecovery.tsx | App.tsx:497 | MERGE | Due actions → Pipeline (`?view=followups`), profile drawer, Calendar, Home. Keep `cc_dispose_interview`, `interview_events.followup_due_at`. **Route path must remain declared** (DB fns + Slack template + `slackMessagingFoundation.test.ts:164`), as a redirect that preserves the query. Repoint App.tsx:699, `VaOpsCommandCenter:125`, `SystemHealth:85,89` directly. |
| `/dashboard/scripts` + Scripts.tsx | App.tsx:711 | MERGE | Resource packet delivered post-hire/training (new eligibility+delivery record, see §7) and the existing `CallLabLive` ScriptPanel. Redirect → `/dashboard/training/library#scripts` (or a Training Home "Scripts" section). Update `GettingStarted.tsx:59` and `telegram-webhook/index.ts:660`. |
| `/va-team` + VaManagerPortal.tsx | App.tsx:551 | MERGE | Staff accounts/permissions → `/dashboard/accounts` (`DashboardAccounts`, admin) or a "Staff" tab under `/dashboard/settings/agency`, keeping `list_my_vas`, `create-va-account`, `set-va-account`. Redirect `/va-team` → `/dashboard`. Repoint `Login.tsx:90`, `Signup.tsx:140`, `AgentNumbersLogin.tsx:81`, `ProtectedRoute.tsx:114`. |
| `/dashboard/agencies` + Agencies.tsx | App.tsx:554 | MERGE | Agency hierarchy/reporting → Home "TOTAL IMO BY AGENCY" (`ImoByAgency.tsx`) drill-down and `/dashboard/analytics`; move `agency_roster_production` behind the drill-down. Redirect → `/dashboard#agency-breakdown` (Home) or `/dashboard/analytics?tab=agencies`. Repoint `ImoByAgency.tsx:154`. |
| Recruit Stages `/dashboard/recruits` (RecruitPipeline.tsx) | App.tsx:606 | KEEP | Brief: "Preserve useful views such as Recruit Stages." Add `recruiter` to `allowRoles` (D-07). |
| Recruit Pipeline `/dashboard/recruiting` (DashboardApplicants.tsx, 2585 lines) | App.tsx:494 | KEEP (becomes the merge target) | Already reads applications/agents/interview_events/interviews-pipeline; hosts `RecruitingCommandHero`. |
| `/dashboard/recruiting/pipeline` (RecruitingPipeline.tsx, `rp_pipeline_action`) | App.tsx:495 | MERGE → `/dashboard/recruiting` | Second "everyone one view" of the same applications; only reachable from the sub-nav. |
| `/dashboard/recruiting/hires` | App.tsx:498 | KEEP | Same element as :494; make it the Hires board target. |
| `/recruit-pipeline`, `/dashboard/recruit-pipeline` (AgentPipeline.tsx, 868) | App.tsx:684-685 | MERGE → `/dashboard/recruiting` | Third applications pipeline ("Schedule Interview"); 2 in-src refs; posts `discord-webhook-notify` (Discord step the brief removes). |
| `/dashboard/hiring-pipeline` (HiringPipeline.tsx, 985) | App.tsx:764 | MERGE → `/dashboard/recruiting` | Fourth applications pipeline; only reachable from the palette (:61). |
| `/dashboard/pipeline-simple` (AgentPipelineSimple.tsx) | App.tsx:761 | REMOVE | Unprotected route (`element={<AgentPipelineSimple />}` with no `ProtectedRoute`), 0 in-src refs, reads `agents`/`deals`. Redirect → `/dashboard/recruiting`. |
| `/dashboard/recruiter` (RecruiterDashboard.tsx, 1621) | App.tsx:682 | MERGE → RecruiterHome / `/dashboard/recruiting` | Unprotected route; linked only from `RecruiterHome.tsx:292`. |
| `/admin/my-applicants` (MyApplicants.tsx) | App.tsx:567 | MERGE → `/dashboard/recruiting?mine=1` | Per-recruiter filter of the same table. |
| `/dashboard/agent-pipeline`, `/agent-pipeline`, `/dashboard/clients` (ClientPipeline.tsx) | App.tsx:601,687-688 | KEEP | Insurance-consumer pipeline (brief: keep recruits and consumer leads distinct). Collapse the two aliases to one canonical + one redirect. |
| `/dashboard/team` (DashboardCRM.tsx) ← `/dashboard/crm`, `/agents`, `/my-team`, `/managers`, `/billers`, `/hierarchy`, `/team-hierarchy` | App.tsx:523,557-558,602,702-703,752,777 | REPAIR | Point every alias directly at `/dashboard/team` with `LegacyWorkspaceRedirect` (query preserved); drop the chain. |
| `/dashboard/agent-management` (AgentManagement.tsx) | App.tsx:767 | MERGE → `/dashboard/team` | Overlaps DashboardCRM (agents + deals + nudges); 2 in-src refs. |
| Training twins `/dashboard/recruiting/training/*` vs `/dashboard/training/*` | App.tsx:499-505 vs :513-519 | MERGE | Seven identical element pairs; keep `/dashboard/training/*` (9 refs) and redirect the `/recruiting/training/*` set (1 ref, `RecruitingWorkspaceNav:15`). `ApexTrainingEntry` (:13-15) already forwards agents to `TRAINING_ROUTES.home`. |
| `/dashboard/command` → `/dashboard/admin` cluster (10 aliases) | App.tsx:573,604,671,690-695,720-724,735 | REPAIR | Point all directly at `/dashboard/admin`. |
| `/dashboard/content` duplicate | App.tsx:525 vs :763 | REPAIR | Keep one; decide ContentQueue vs ContentLibrary with the Content domain owner. |
| `/dashboard/legacy` (DashboardCommandCenter) | App.tsx:560 | REMOVE | Same element as `/dashboard/admin`; redirect. |
| Owner group items (Launch Board, Content, Reports, Finances, Contracting Ops/Requests, Import) | agentCloudNavigation.ts:198-204 | KEEP | Outside the retirement list. |
| Account nav (Settings group, Producer Profile) | agentCloudNavigation.ts:223-238 | KEEP | — |
| Applicant rail | agentCloudNavigation.ts:216-221 | KEEP | — |

---

## 7. Recommended implementation plan (nav-routes-shell)

**Order of operations (so no commit leaves a guard red or a link dead):**

1. **Add the final destinations first** (other domains own the pages; this domain owns the URLs): `/dashboard/recruiting?view=interviews|followups` handled inside `DashboardApplicants` (read `interview_events` where `outcome is null and scheduled_at < now()` for follow-ups; `scheduled_at >= now()` for upcoming), a Calendar feed from `interview_events` (D-11), a Training Home "Scripts" section (reuse the `CallLabLive` ScriptPanel query), a Staff tab under `/dashboard/settings/agency` or `/dashboard/accounts` wrapping `list_my_vas` + the two edge fns, and an agency drill-down behind `ImoByAgency`.
2. **Repoint every in-src link** listed in §1.2 at the final destination (never at another redirect). Files: `agentCloudNavigation.ts`, `MobileBottomNav.tsx`, `RecruitingWorkspaceNav.tsx`, `RecruiterHome.tsx`, `AgencyOwnerHome.tsx`, `VaOpsCommandCenter.tsx`, `DashboardApplicants.tsx:1223`, `OperationsCommandCenter.tsx:110`, `SystemHealth.tsx:85,89`, `GettingStarted.tsx:59`, `ImoByAgency.tsx:154`, `Login.tsx:90`, `Signup.tsx:140`, `AgentNumbersLogin.tsx:81`, `ProtectedRoute.tsx:114`, `CommandPalette.tsx:59,62,63`.
3. **Convert the six routes to `LegacyWorkspaceRedirect`** in App.tsx (paths stay declared, query preserved): `/dashboard/quoter→/dashboard/agent-pipeline`; `/dashboard/recruiting/interviews→/dashboard/recruiting?view=interviews` (a tiny wrapper must map `?tab=hired`→`/dashboard/recruiting/hires` — extend `LegacyWorkspaceRedirect` with an optional `rewriteSearch` prop rather than a second helper); `/dashboard/recruiting/follow-ups→/dashboard/recruiting?view=followups`; `/dashboard/scripts→/dashboard/training/library#scripts`; `/va-team→/dashboard`; `/dashboard/agencies→/dashboard?section=agencies` (or `/dashboard/analytics?tab=agencies`). Re-point the legacy aliases at :698-699 directly at those same final targets. Loop rule: a redirect target must be a route whose element is a page component with a gate the *redirected* role can pass (VA manager → `/dashboard` passes; never route va_manager to a `requireAdmin` page without `allowRoles=["va_manager"]`).
4. **Collapse chains** (D-05, D-06): every bare `<Navigate>` whose target is itself a redirect → `LegacyWorkspaceRedirect` to the final page. Delete App.tsx:763 (D-02) or :525 per Content owner.
5. **Orphan handling**: once no `<Route>` renders them, `Quoter.tsx`, `Interviews.tsx`, `InterviewRecovery.tsx`, `Scripts.tsx`, `VaManagerPortal.tsx`, `Agencies.tsx` remain "wired" only while their `lazy(() => import(...))` lines stay in App.tsx. Either delete file + import (preferred for Quoter), or move the surviving logic into the merge target and delete, or add `// intentionally-orphan:<reason>` in the first 30 lines for anything parked. `check:orphan-pages` grades on the import graph, not on routes.
6. **Edge functions / DB text**: update `slack-event-templates.ts:48` and `telegram-webhook/index.ts:660` to the final URLs; ship a migration `create or replace function` for `fn_queue_interview_noshow_slack` and `trigger_interview_noshow_recovery` with the new URL (additive, same signature), mirrored under `supabase/migrations/`. Until then the redirect keeps old alerts working.
7. **Tests to change/add**: `GlobalSidebar.test.tsx` (:105,118,125,151-153,156,212-213 — drop Interviews/Follow-ups/Quoter expectations, add `expect(link("Quoter")).toBeNull()` for admin too); `RecruitingWorkspaceNav.test.tsx` (new view list); `interviewPipelineContract.test.ts:11-14` (new redirect strings); `slackMessagingFoundation.test.ts:164` (path still declared — passes if the redirect keeps `path="/dashboard/recruiting/follow-ups"`); keep `mobileAppContract.test.ts:29-30` and `accountModeRouting.test.ts:55-57` strings intact. **New** `src/tests/lib/routeRedirectContract.test.ts`: parse App.tsx, build the redirect graph, assert (a) no cycle, (b) max depth 1, (c) every `path:`/`href:` literal in `MobileBottomNav.tsx`, `CommandPalette.tsx`, `RecruitingWorkspaceNav.tsx`, `RecruiterHome.tsx`, `AgencyOwnerHome.tsx`, `VaOpsCommandCenter.tsx`, `GettingStarted.tsx`, `SystemHealth.tsx` matches a declared route **and** is not a redirect-only route (closes D-03 without editing a guard). Prove it red by pointing one entry at `/dashboard/nope` before committing.
8. **Guards affected** and what the change must satisfy:
   - `check:sidebar-routes`: every `href:` in `GlobalSidebar.tsx` + `agentCloudNavigation.ts` must match a `<Route path>` (params = one segment). Removing entries is always safe; adding a `?view=` href is safe (query stripped before matching).
   - `check:orphan-pages`: see step 5.
   - `check:dead-internal-links`: every literal `to="/…"`, `href="/…"`, `navigate("/…")`, `` to={`/…`} ``, `|| "/…"` in `src` + `supabase/functions`, and every `https://apex-financial.org/…` literal, must match a declared path by segment count. So: keep the six paths declared (as redirects) *or* update :48/:660 in the same commit. Hash fragments and queries are stripped, so `#scripts` / `?view=` targets are fine.
   - `check:internal-nav-hrefs`: do not introduce `<a href="/dashboard…">` or `window.location.href = "/dashboard…"` in pages/components/hooks/lib/layouts; use `Link`/`useNavigate`.
   - `check:route-shape`: keep `/apply`, `/`, `/status/:applicationId`, `/dashboard/agent/:id`, `/dashboard/agents/:id`, `/dashboard/training/library/course/:courseId`, `/join`, `/join/:token` declared (fixtures); it only NOTEs order divergence. Routes must remain on the `<Route path="…"` literal form (all three parsers are regexes over App.tsx).
   - `check:link-audit-coverage`: structural check on `scripts/link-audit.mjs`; unaffected. The post-deploy link audit will record 3xx chains and 404s in its artifact, so run it once after the redirect wave.
   - Also in `verify:core`: `check:stale-key-in-list`, `check:maybesingle-nonunique`, `check:empty-catch` baselines — the palette and nav files contain `// empty-catch-allow:` markers that must be preserved when editing (`favoriteRoutes.ts:39,48`, `CommandHintFab.tsx:19`).
9. **New tables/columns/RPCs truly needed**: none for the nav shell itself. For "Scripts delivered after hiring and training completion" the Training/Onboarding domain needs an eligibility + delivery record (e.g. `resource_deliveries(agent_id, resource_key, eligible_at, queued_at, delivered_at, channel, receipt)`), because `sales_scripts` has no audience columns and no job writes delivery receipts today; this domain only needs the destination URL to exist.

---

## 8. Risks and open questions

**Risks**
- Turning `/va-team` into a redirect while `ProtectedRoute.tsx:114` still bounces denied va_managers to `/va-team` creates the only plausible loop in this plan (denied → `/va-team` → `/dashboard`… is fine; denied → `/va-team` → a `requireAdmin` page → denied → `/va-team` is a loop). Repoint :114 in the same commit.
- Deleting routes instead of redirecting breaks live Slack no-show alerts (DB functions) and the Telegram training-hub message; `check:dead-internal-links` would fail on the two edge-fn literals, which is the right outcome but will block the commit until step 6 lands.
- Object-literal nav tables are invisible to every current guard (D-03); without the new contract test the next retirement wave repeats this audit.
- The Pure Recruiter mode is currently unpopulated (0 people); redesigning its nav cannot be verified against a real user. Keep it, but do not spend QA time on it beyond the contract test.
- `/dashboard/content` double declaration: whichever line is removed changes behaviour for whoever currently reaches ContentQueue via the sidebar "Content" item (:199).

**Open questions**
1. Interviews/Follow-ups inside Pipeline: tabs on `DashboardApplicants` (2585 lines already) or a drawer? The brief says Pipeline + Calendar; the page owner decides the shape, this domain only fixes the URL (`?view=`).
2. Agencies redirect target: Home section vs `/dashboard/analytics` tab — depends on where the Home domain puts the "TOTAL IMO BY AGENCY" drill-down.
3. Are `v_interview_pipeline` / `v_prospect_review_queue` legitimately empty (backlog clear) or stale? Unmeasured; the Follow-ups merge should rebuild the due-action query directly on `interview_events` rather than inherit two views that return nothing.
4. Should `/dashboard/pipeline-simple` and `/dashboard/recruiter` (both unprotected routes) be redirected in this wave or handed to the recruiting domain? Recommend redirect now — they are 0- and 1-ref routes with no `ProtectedRoute`.
5. Keep `recruiter` as an `AccountMode` at all, given 0 holders? Removing it touches `useAuth.ts:405-414`, `Dashboard.tsx:1044`, `RolePreview`, three tests — out of scope for the retirement wave; flag for the roles domain.
