# Galaxy page consolidation and value audit

**Release/work-session date: November 24, 2026 (Phoenix).** Source snapshot: local base `86d2772bf9578e28a5c80cd34c711c0ccee733fb` plus the reviewed integration changes. The coordinator verified that deployed main `f0f9d34d1fcd7eaf6eb9da339134a4f223649187` has the same baseline tree, `2e0aaab3ee9d847114a91a5e08b68a65787505cc`.

## Release addendum: subsequent local implementation

The original audit below is retained as a historical snapshot. Its counts, proposed consolidations and route matrix predate the subsequent redesign. The [current page-by-page implementation guide](../prompt-pack/galaxy-page-redesign/README.md) supersedes those details with 304 routes, 82 compatibility aliases and source-specific prompts/code. Neither document establishes a live deployment.

The subsequent local implementation includes:

- A shared authenticated workspace style with large italic financial figures, responsive chart/table layouts, consistent cards and keyboard focus states.
- Finances tabs for **Issue & pay** and **Policy book**, with **Management** mounted only for authorized real admins. Recorded commission payments, policy status and estimated payouts retain distinct meanings. Issued-and-paid annual premium remains explicitly unavailable without a verified premium-payment receipt contract.
- Fifteen additional preserving redirects. Rewards is now folded into **Award history**, combining reward and milestone sources with applied scope/source filters, recorded units, dates and copy actions. The old Rewards implementation is removed; original artwork and public share records remain.
- Current contracting submissions and MGN discovery by default, with current receipt review and explicitly labeled historical carrier records available in their own views.
- A shared recorded-call player across call reviews, training and lead-recording review. Play requests start the native player; timestamp seeks, pause/restart, bounded error recovery and account changes preserve coherent state. Focus/reconnect does not replace a playing URL, and starting another recording pauses the previous one.
- Three ID-only recording URL functions. Training, ReadyMode and lead review each recheck the caller's existing authorized catalog/RPC before signing its exact object in a fixed private bucket for 900 seconds. No table grants or role scope are broadened. The lead review lookup is deliberately limited to the newest 200 authorized rows and supports the current newest-40 review card.

Release and evidence limits remain explicit. The new recording functions must be deployed before the dependent frontend. Browser verification uses synthetic media and does not certify authenticated production recordings or physical speaker output. My Leads' legacy provider-link field has no verified internal call ID in its current response, so it is not guessed into the new playback path. Two tutorial source clips are marked as having no audio. Live calling and the older private-task database policies still require their own production evidence. The local Deno gates could not complete; required CI remains a release condition.

The expanded source, comments, tests, scripts and technical documentation are prepared locally. Public publication is pending expanded owner approval after automatic approval review rejected the earlier public write because the existing authorization covered only the 18-file recruiting update.

## Decision and scope

Keep the operating workflows, real production and recruiting graphs, payout/contract percentages, financial source distinctions, policy history and current aggressive visual system. Reduce competing entry points and repeated navigation. Consolidate a route only where its canonical destination retains the same data, actions and role access; preserve compatibility URLs and their context.

This is an exhaustive **source route/navigation audit**, with focused implementation and test receipts identified below. Every declared route is in the matrix and machine-readable inventory. Every routed page source was scanned for data-source and local-link footprints; high-impact candidates were inspected directly. This is not a claim that every signed-in page or action was visited in a browser, that every live RLS policy was tested, or that hidden routes have no users. No production data, applications, calls, imports, campaign messages, task writes or publishing actions were triggered by this audit.

## Implemented in the local source

| Area | Concrete change | Behavior retained / verification limit |
|---|---|---|
| Finances | `/dashboard/finances` is the single authenticated entry. `/dashboard/my-commissions` redirects to it. Personal commissions and Policies remain separate source views; only real admins outside preview mount Management. Dashboard quick actions, Help Center and Agent Handbook now use the canonical name/link; the ledger points admins to Management. | Personal ledger, actual payout/contract percentages, estimated components, owner reconciliation, policy rows, policy status and written-premium graphs remain. Help copy distinguishes recorded payments from issued policies. This audit does not certify live commission balances. |
| Learn | One Training sidebar entry points to `/dashboard/training/library`. Seven old recruiting/training paths and the old training-hub course path redirect to canonical training routes. | Start here retains Field Course and Practice a call; content/progress permissions and dynamic course IDs are preserved. |
| Settings | One Account settings entry opens `/dashboard/settings`; Support desk, Install and Producer Profile remain. | Local role-filtered tabs and existing agency/notifications/security/billing/assistant URLs remain. Those tab URLs are not duplicate features to delete. |
| Client pipeline | `/dashboard/clients` and `/agent-pipeline` redirect to `/dashboard/agent-pipeline`. The existing admin Import action is labeled Import consumers and opens `/dashboard/consumer-import`. | Client next-action work, call sheets, search/filters, saved call outcomes and manager ownership context remain. Licensing/XCEL import stays at `/dashboard/import`. |
| Legal aliases | `/privacy-policy` and `/terms-of-service` now redirect outside `AuthenticatedShell`. | Old public links retain query/hash context and do not require login to reach Privacy or Terms. |
| Sidebar density | Groups default closed except the group for the current route; explicit toggles remain. | All authorized destinations remain available. The change reduces initial visual clutter, not features or permissions. |
| Reports | `/dashboard/analytics` and the page itself require a real admin outside role preview. Content and child panels use viewer-keyed queries. | Existing agency graphs and coaching signals remain. Manager reporting was not opened: the latest source SQL contains owner/admin aggregate gates, not a verified manager-scoped report. Final integrated check receipts are separate. |
| Contextual owner links | Reports now links Performance goals; Launch Board now links Social media approvals. Their duplicate primary shortcuts are removed. | Specialist graph, approval, export and manual-publish workflows remain at their original URLs. No send/post automation changed. |
| Legacy recognition | Hall of Fame no longer sums mixed-unit award amounts. Plaque-count standings and milestone-type counts remain. Hall, My Plaques and public PlaqueShare reuse the recorded-unit/date presenter. | Hires and streak days stay counts; known ALP, legacy premium and premium increases remain distinct; unknown units and absent premium stay explicit. Monthly hire dates are month buckets. Stored art is labeled original artwork. |
| My Plaques safety | Mine must resolve the current agent before any award query. Queries are keyed by real user and effective scope; role downgrades force Mine. Errors, null roots and malformed rows are unavailable, not empty. | Existing shared/public award visibility remains on shared pages. Both reward and plaque histories remain; the historical plaque window stays capped at 100 and is labeled. |
| Client Marketing | Client copy templates stay available; Recruiting Funnels mounts and fetches only for an authorized recruiting role outside preview, with viewer/access-key scoping. | Template content, copy controls and the actual recruiting pipeline destination remain. No outbound message was sent. |
| Recruiting triage | `/dashboard/my-inbox` keeps its admin-only applicant worklist, now labeled Recruiting triage with validated viewer-keyed reads, explicit errors/retry and an honest 120-row caption. | The source is applicant paid/contact/staleness data from `v_sam_inbox`, not Sam's personal conversations. It is not included in the private-DM route set. |

Legacy award/import verification: **68 focused tests passed** (21 page/render/share/scope, 19 Pipeline, 6 full-history/count helpers, 22 typed presenter). The render-health guard passed and `git diff --check` passed. These are local tests with synthetic data, not live award or consumer-import actions. Other implementation owners supply their own finance, role, task and integration receipts.

## Personal tasks and private owner access

`/dashboard/my-tasks` is a new own-account entry, separate from Sam's private routine. The source uses `current_agent_id()` in caller context, verifies ownership and active/pending unmerged agent state, binds client requests to a checked account token, and scopes the list by user and agent. `personal-task-create` rejects caller-supplied owner/assignee/status fields; authenticated ownership is resolved before a service-role insert stamps the owner. Its config has `verify_jwt = true`.

Nine routes now include the `SamOnlyRoute` wrapper, whose server `is_sam()` check supplements their route/page gates. A wrapper is not proof that every backing table/RPC is Sam-only. Source history still shows broad `sam_daily_tasks` access and admin-only `sam_todo_*` routines. Those require separate live metadata and database correction proof before claiming complete server privacy. Counters and pre-licensing confirmations also have their own source authorization contracts.

The task source review found concrete reliability/isolation gaps in task read validation, persistent checklist queue failures, embedded widget account scope, and unchecked-scorecard behavior after a failed checks read. Their corrections and independent reread are tracked in the task receipt below. Existing global unowned My Day storage keys are not adopted into the new user namespace; the source audit does not claim historical browser data was purged.

The authenticated session now clears the shared query cache before resolving a different account, and on sign-out or failed token refresh. Request-generation checks reject late role/profile/mode responses and obsolete cache resets. The route gate waits for each new account's access and resets private component state. Same-account token refresh preserves the current page and cache. These behaviors passed 46 auth/route regressions, including a real global-key query, prefilled Calendar/Today caches, late canceled fetches, delayed startup snapshots, and A-to-B-to-A transitions. The lazy cache import passed both cold-landing dependency guards.

Deploying this source is a separate step: shared Edge dependencies/config changes cause the deployment workflow to select all functions on an authorized main deployment. A green pull-request Supabase check does not mean functions were deployed; production writes are gated off for pull-request events.

## Actual navigation retained

| Section | Current destinations and reason |
|---|---|
| Daily entry | Home `/dashboard`, My Tasks `/dashboard/my-tasks`, and owner-only My Day `/dashboard/my-day`. |
| Sell / Grow | Existing producer client pipeline, Call Center and Calendar; recruiting call list, New hires, invitations/referrals and role-specific staff entry points remain. |
| My Business | Book `/dashboard/production`, Finances `/dashboard/finances`, My Leads, and every granted Sold Calls / Easy Resells / Call Training / Leads / Retention operation remain. |
| Learn | One Training entry `/dashboard/training/library`; actual courses, Call Lab, recordings, scripts and progress remain in their context. |
| Team | Leaderboard, Wins & Awards, My Team, Call sheet and Grow my team retain their current role boundaries. |
| Owner | Money Inbox, Launch Board, **Brand Command, Carrier Command, Import**, Reports, Contracting, Agent Duplicates, Strikes and System remain. The three bold entries were deliberately retained because replacement discovery/role parity is not proven. |
| Account | `/dashboard/settings`, `/dashboard/help?tab=desk`, `/install`, and producer `/dashboard/profile`. Applicant navigation remains its distinct four-link flow. |

The Owner section has ten destinations, not the earlier seven-destination proposal. Agent Duplicates and Strikes stay pinned. Removing Brand Command solely because My Day has a link would alter non-owner admin discoverability; Carrier Command and the licensing importer also lack proven replacement parent flows. They are retained rather than made URL-only.

| Removed primary shortcut | Where the real feature remains discoverable | State |
|---|---|---|
| Field Course | Training Start here → `/dashboard/training/sales-course` | Existing local link retained |
| Call Lab | Training Start here → Practice a call → `/dashboard/call-lab` | Existing local link retained |
| Separate settings tab links | Account settings → local Settings navigation | Existing tab URLs retained |
| Performance Bot | Reports → Performance goals → `/dashboard/admin/performance-bot` | Local parent action added |
| Social Media Center | Launch Board → Social media approvals → `/dashboard/admin/social-media-bot` | Local parent action added |
| Duplicate Finances/commission entry | My Business → `/dashboard/finances`; old commission URL redirects | Canonical entry in place |

## Retained or pending decisions

1. **Recruiting boards need action and role parity before retirement.** RecruitingPipeline, AgentPipeline, HiringPipeline, RecruiterDashboard and newer recruiting views are not interchangeable simply because their names overlap. `/dashboard/recruiting/hires` still mounts the general worklist without a hires-specific filter, and its recruiter audience cannot automatically enter every New hires page.
2. **Three book views have different jobs.** MyDeals is the current joined policy book, ClientPipeline is next-action/calling work, and BookOfBusiness carries policy health, chargeback, persistency/concentration and historical source evidence. A Finances policy table does not replace contact workflows or retention graphs.
3. **Carrier contracting route variants are meaningful.** Review, Requests, Carriers, Writing numbers and Intake history are selected by pathname. Settings tabs and builder/detail modes also have distinct behavior. Preserve those route families.
4. **Recognition histories are not all in one table.** `agentlink_rewards` and `plaque_awards` are different records. Keep Rewards/My Plaques and legacy artwork until complete data/share parity is verified. Rewards' existing Mine/All control is not applied to its query; that remaining issue should be fixed before promoting it. Challenges' wallet-credit claims need live evaluator/ledger evidence before being described as earned benefits.
5. **Reports remain agency/admin analytics.** A manager-safe report needs a separate scoped data contract. Do not solve that gap by merely displaying the admin link to managers.
6. **Keep useful hidden tools contextual.** Needs Analysis belongs near calls; scripts, handbook and annuities belong in Training; calling cards/landing preview belong with Profile; coaching/trend detail belongs under Team/Reports; diagnostics/imports belong with the workflow they serve. No generic Tools page is required.
7. **The Quoter is illustrative.** Its source has hard-coded rate tables, not a verified live carrier quoting integration. Do not promote it as an authoritative quote engine.
8. **Legacy/internal is a navigation classification, not deletion approval.** Preserve transaction/token links, applicant status, public plaque slugs, historical content, and existing bookmarked aliases. Hidden routes have no usage telemetry in this audit.

## Preservation criteria

- Preserve actual production, commission, ALP/premium and payout-percent definitions; missing or unauthorized values must not become zero.
- Keep real graph axes, periods, hierarchy scopes, policy state and trend evidence. Do not add decorative activity, fabricated gains or aggregate mixed units.
- Preserve the red/charcoal/emerald/cyan/amber visual system, large production figures, readable financial values, responsive layouts and accessible controls.
- Retain role/individual grants and server checks. Demo values remain render-only and never enter production records, exported evidence or public claims as facts.
- Compatibility redirects preserve query/hash, campaign/referral context, record/course IDs and return paths. A canonical destination's fixed query keys remain authoritative.
- Error, loading, unavailable, true-empty and stale states remain distinguishable. A source scan or a green skipped workflow is not end-to-end verification.

## Inventory reading rules

Keep preserves a distinct workflow, not necessarily a sidebar shortcut. Improve identifies a concrete remaining clarity/accuracy/access task. Consolidate is conditional on action, data and role parity. Legacy keeps compatibility or explicit history. Internal describes administrative, diagnostic, token or transaction/detail routes. The observed route wrappers and intended audience are recorded separately: a broad authenticated wrapper may still have narrower page/RPC/RLS rules.

The JSON contains route wrappers, guard props, intended roles, navigation visibility, query/table footprints, literal inbound links and source hashes. It distinguishes static inventory from tests and deployment proof.


## Snapshot counts

Extracted **2026-11-25T02:35:51.163Z**. **304 unique route declarations**, **67 redirects**, **198 existing routed page source files**, **39 primary navigation entries** across all role menus. The matcher inspected **589 literal internal-link occurrences** and found **0 unmatched paths**. Categories: Consolidate: 43, Improve: 9, Internal: 38, Keep: 143, Legacy: 71.

Visible unique links include account navigation; they are not all expanded at once. Applicant navigation is separate. The initial pre-integration snapshot was 303 routes / 55 redirects / 198 source pages / 44 primary entries, with 49 owner, 24 manager and 20 agent links.

| Audience | Current unique visible links |
|---|---|
| agent | 17 |
| manager | 21 |
| agency_owner | 19 |
| recruiter | 9 |
| va | 10 |
| va_manager | 11 |
| manager_with_sold_calls | 27 |
| admin_not_owner | 35 |
| owner | 41 |
| applicant | 4 |

## Private-route wrapper inventory

`/dashboard/carrier-command`, `/dashboard/launch-board`, `/dashboard/money-inbox`, `/dashboard/my-day`, `/dashboard/inbox/instagram`, `/dashboard/system-health`, `/dashboard/admin/social-media-bot`, `/dashboard/admin/sam`, `/dashboard/sam-todo`.

## Task/privacy final review receipt

Status: **Local focused tests and independent source review passed; integrated gates and live server-policy proof remain separate**.

Resolved items:

- My Tasks rejects null/nonarray roots, malformed rows, foreign-agent rows and duplicate IDs; verified [] alone is empty.
- Personal-task creation derives the authenticated owner before any service-role insert, rejects caller ownership/status fields and refuses inactive or merged agent identities.
- Client requests use checked account tokens; user/agent query keys and view leases prevent old-account results or pending gated actions from entering a new view.
- My Day validates namespaced schedule/check caches and pending queues; a checkmark changes only after durable queue write/readback succeeds. Unreadable queues are preserved and failed writes/clear operations are visibly paused.
- My Day distinguishes verified, cached, stale and unavailable checks; failed/null reads cannot appear as an unchecked zero scorecard. Valid cached checks remain explicitly stale and retry can recover.
- MyDayWins and PrelicensingCheck enforce the owner gate directly, scope cache keys to the account, pin reads/mutations to checked tokens, and cancel pending gated mutations after view closure/access change.

Validation:

- 129/129 focused tests passed across 5 files: myDayStorage 11, personalTaskCreate 44, myTasks 39, MyTasks 10, privateTaskPages 25.
- Independent source reread checked corrected cache/queue/error branches, actual embedded widget auth/key/mutation paths, request ownership derivation and deployment config.
- Scoped lint reported 0 errors and 2 react-refresh warnings for MyDayTodoist/MyDayWins exports.
- Author's remaining scoped guards exited 0: detached Supabase 0 aliases; RPC arguments 364 resolved with 18 pre-existing unprovable calls; private surfaces 9 gated pages; diff check clean. The auth cancellation test now explicitly asserts the expected cancellation rejection; the empty-catch guard passed across all roots after that correction.
- Full type/build/required CI and production deployment are separate release gates owned by the coordinator; focused tests alone do not certify the final deployment.

Limitations:

- No live task write, Todoist action, production data read, account impersonation or browser operation was performed by this review.
- Older sam_daily_tasks policies and sam_todo RPC source gates need separate live metadata/migration proof; frontend Sam gating is not a claim of full database authorization.
- Local Deno was unavailable to the author; authoritative Edge checking requires CI.
- This source/test review does not verify deployment or production RLS behavior.

## Exhaustive route matrix


### Public recruiting, applicant and legal

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/` | Keep | public | `/` | `src/pages/Index.tsx` — Keep exact two recruiting choices plus Agent Login, aggressive coherent style and accessible flow. |
| `/careers` | Keep | public | `/careers` | `src/pages/CareersIndex.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/careers/:state` | Keep | public | `/careers/:state` | `src/pages/StateCareerLanding.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/apply` | Keep | public | `/apply` | `src/pages/Apply.tsx` — Preserve licensed/unlicensed defaults, resumed answers, attribution, validation and actual submissions. |
| `/share/:token` | Internal | intended token/link recipient | `/share/:token` | `src/pages/SharePage.tsx` — Token-scoped editor clip sharing must remain public to the intended recipient and outside primary navigation. |
| `/apply/success` | Internal | public | `/apply/success` | `src/pages/ApplySuccess.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/apply/success/licensed` | Internal | public | `/apply/success/licensed` | `src/pages/ApplySuccessLicensed.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/apply/success/unlicensed` | Internal | public | `/apply/success/unlicensed` | `src/pages/ApplySuccessUnlicensed.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/unlicensed-overview` | Keep | public | `/unlicensed-overview` | `src/pages/UnlicensedOverview.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/status/:applicationId` | Keep | public | `/status/:applicationId` | `src/pages/ApplicationStatus.tsx` — Applicant status/next-step deep link must remain; do not redirect to a generic dashboard. |
| `/vsl` | Keep | public | `/vsl` | `src/pages/Vsl.tsx` — Frozen audience-specific video correction; do not modify in this audit. |
| `/get-licensed` | Keep | public | `/get-licensed` | `src/pages/GetLicensed.tsx` — Unlicensed roadmap and canonical licensing video. Preserve public licensing links, state context and application attribution. |
| `/resources/licensing` | Keep | public | `/get-licensed` | `src/pages/ResourcesLicensing.tsx` — Licensing reference material has value apart from application. Preserve current content links and state-specific facts. |
| `/training` | Consolidate | public | `/dashboard/training/library` | `src/pages/TrainingIndex.tsx` — Public training directory points at several compatibility URLs. Preserve public resources and align signed-in destinations with canonical Training. |
| `/login` | Keep | public | `/login` | `src/pages/Login.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/reset-password` | Keep | public | `/reset-password` | `src/pages/ResetPassword.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/signup` | Keep | public | `/signup` | `src/pages/Signup.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/join` | Keep | public | `/join` | `src/pages/Join.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/hire/:token` | Internal | intended token/link recipient | `/hire/:token` | `src/pages/HireLink.tsx` — Issued invite-token workflow. Keep token, prefill and hire behavior. |
| `/join/:token` | Internal | intended token/link recipient | `/join/:token` | `src/pages/JoinLink.tsx` — Issued hire/join-token workflow; distinct from marketing Apply. |
| `/contract/:slug` | Internal | intended token/link recipient | `/contract/:slug` | `src/pages/ContractJoin.tsx` — Scoped contracting invitation; preserve slug attribution and existing contracting flow. |
| `/agent-signup` | Internal | public | `/agent-signup` | `src/pages/AgentSignup.tsx` — Invited producer signup differs from public recruiting application; keep authorization and invite context. |
| `/unsubscribe` | Internal | public | `/unsubscribe` | `src/pages/Unsubscribe.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/claim` | Internal | public | `/claim` | `src/pages/ClaimAccount.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/activate` | Consolidate | public | `/claim` | `src/pages/ClaimAccount.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/agent-login` | Keep | public | `/agent-login` | `src/pages/AgentNumbersLogin.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/agent/:userId` | Keep | public | `/agent/:userId` | `src/pages/PublicAgentLanding.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/magic-login` | Internal | public | `/magic-login` | `src/pages/MagicLogin.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/schedule-call` | Keep | public | `/schedule-call` | `src/pages/ScheduleCall.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/assistant/interviews` | Internal | intended token/link recipient | `/assistant/interviews` | `src/pages/AssistantInterviewForm.tsx` — Token-checked assistant intake is intentionally outside login. Preserve token flow; do not promote in public nav. |
| `/pending-approval` | Internal | public | `/pending-approval` | `src/pages/PendingApproval.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/privacy` | Keep | public | `/privacy` | `src/pages/Privacy.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/terms` | Keep | public | `/terms` | `src/pages/Terms.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/disclosures` | Keep | public | `/disclosures` | `src/pages/Disclosures.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/install` | Keep | public | `/install` | `src/pages/Install.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/links` | Keep | public | `/links` | `src/pages/LinksPage.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/leads` | Keep | public | `/leads` | `src/pages/LeadsLanding.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/contact` | Keep | public | `/contact` | `src/pages/Contact.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/storefront` | Keep | public | `/storefront` | `src/pages/Storefront.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/get-leads` | Consolidate | public | `/leads` | `src/pages/LeadsLanding.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dialer` | Consolidate | public | `/leads` | `src/pages/LeadsLanding.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/data-deletion` | Keep | public | `/data-deletion` | `src/pages/DataDeletion.tsx` — Required user data request workflow; preserve public reachability. |
| `/delete-my-data` | Consolidate | public | `/data-deletion` | `src/pages/DataDeletion.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/checkin` | Keep | public | `/checkin` | `src/pages/ApplicantCheckin.tsx` — Candidate progress self-report; preserve issued links and licensing state. |
| `/daily-checkin` | Consolidate | public | `/checkin` | `src/pages/ApplicantCheckin.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/agent-flow` | Consolidate | public | `/get-licensed` | `src/pages/AgentFlow.tsx` — Static duplicate onboarding diagram has no next-step links and generic timeline/paperwork claims. Reuse verified roadmap and audience-specific CTA. |
| `/r/:code` | Internal | public | `/r/:code` | `src/App.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `*` | Keep | public | `/` | `src/pages/NotFound.tsx` — Keep meaningful recovery destinations; source literal scan found no unmatched route targets. |

### Compatibility redirects

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/start-contracting` | Legacy | public | `/dashboard/contracting-profile` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/privacy-policy` | Legacy | public | `/privacy` | `src/App.tsx` — Public compatibility redirect now sits outside AuthenticatedShell. Query/hash context is preserved and the target remains public. |
| `/terms-of-service` | Legacy | public | `/terms` | `src/App.tsx` — Public compatibility redirect now sits outside AuthenticatedShell. Query/hash context is preserved and the target remains public. |
| `/seminar` | Legacy | public | `/apply` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training` | Legacy | authenticated | `/dashboard/training` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/library` | Legacy | authenticated | `/dashboard/training/library` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/library/course/:courseId` | Legacy | authenticated | `/dashboard/training/library/course/:courseId` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/sales-course` | Legacy | authenticated | `/dashboard/training/sales-course` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/progress` | Legacy | authenticated | `/dashboard/training/progress` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/content` | Legacy | authenticated | `/dashboard/training/content` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting/training/annuities` | Legacy | authenticated | `/dashboard/training/annuities` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/content` | Legacy | authenticated | `/dashboard/launch-board?tab=queue` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/contracts` | Legacy | authenticated | `/dashboard/contracting/documents` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/ops` | Legacy | authenticated | `/dashboard/contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/audit` | Legacy | authenticated | `/dashboard/contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/ethos` | Legacy | authenticated | `/dashboard/team?view=contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/aflac` | Legacy | authenticated | `/dashboard/contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracting/cases` | Legacy | authenticated | `/dashboard/team?view=contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/resources` | Legacy | authenticated | `/dashboard/training/library` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/managers` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/billers` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/applicants` | Legacy | authenticated | `/dashboard/recruiting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/admin/recruiting-inbox` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/clients` | Legacy | authenticated | `/dashboard/agent-pipeline` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/crm` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/command` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/admin/licensed-inbox` | Legacy | authenticated | `/dashboard/recruiting/licensed` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/admin/apex-toolkit` | Legacy | authenticated | `/dashboard/training` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/admin/agentlink-backfill` | Legacy | authenticated | `/dashboard/book-of-business` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/onboarding-course` | Legacy | authenticated | `/dashboard/training/sales-course` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/course-catalog` | Legacy | authenticated | `/dashboard/training/sales-course` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/training-hub` | Legacy | authenticated | `/dashboard/training/library` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/training-hub/course/:courseId` | Legacy | authenticated | `/dashboard/training/library/course/:courseId` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/course-progress` | Legacy | authenticated | `/dashboard/training/progress` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/course-progress/content` | Legacy | authenticated | `/dashboard/training/content` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/leads` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/contracts` | Legacy | authenticated | `/dashboard/contracting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/agent-pipeline` | Legacy | authenticated | `/dashboard/agent-pipeline` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/client-pipeline` | Legacy | authenticated | `/dashboard/agent-pipeline` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/inbound-leads` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/inbound` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/headhunters-calendar` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/interviews` | Legacy | authenticated | `/dashboard/calendar` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/interview-recovery` | Legacy | authenticated | `/dashboard/recruiting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/hierarchy` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/team-hierarchy` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/business-analytics` | Legacy | authenticated | `/dashboard/analytics` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/carriers` | Legacy | authenticated | `/dashboard/book-of-business` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/announcements` | Legacy | authenticated | `/dashboard/community` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting-funnels` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruiting-tracker` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/team-analytics` | Legacy | authenticated | `/dashboard/admin` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/instagram-inbox` | Legacy | authenticated | `/dashboard/inbox/instagram` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/today` | Legacy | authenticated | `/dashboard/today` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/recruit` | Legacy | authenticated | `/dashboard/recruiting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/recruit` | Legacy | authenticated | `/dashboard/recruiting` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/agent-link-sync` | Legacy | authenticated | `/dashboard/agentlink-sync` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/agents` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/my-commissions` | Legacy | authenticated | `/dashboard/finances` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/my-team` | Legacy | authenticated | `/dashboard/team` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/my-deals` | Legacy | authenticated | `/dashboard/production` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/charges-audit` | Legacy | authenticated | `/dashboard` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/admin/charges-audit` | Legacy | authenticated | `/dashboard` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/conduct` | Legacy | authenticated | `/dashboard/strikes` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/ayro-book` | Legacy | authenticated | `/dashboard/book-of-business` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/dashboard/admin/book-quality` | Legacy | authenticated | `/dashboard/book-quality` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |
| `/log-numbers` | Legacy | public | `/apex-daily-numbers` | `src/App.tsx` — Existing compatibility redirect. Preserve query/hash/referral and authorization behavior; do not delete shared/bookmarked URLs. |

### Production, finance and daily work

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/apex-daily-numbers` | Internal | admin | `/apex-daily-numbers` | `src/pages/LogNumbers.tsx` — Admin daily-number entry. Keep protected and compatible with existing login routing. |
| `/dashboard` | Keep | authenticated | `/dashboard` | `src/pages/Dashboard.tsx` — Canonical role-aware home. Preserve production, goals, conversion charts, hierarchy and honest error/empty states. |
| `/dashboard/production` | Keep | authenticated | `/dashboard/production` | `src/pages/MyDeals.tsx` — Current joined policy book. Retain table, policy state, client details, lead yield and production graphs. |
| `/dashboard/analytics` | Keep | real authenticated admin outside role preview; agency aggregates | `/dashboard/analytics` | `src/pages/BusinessAnalytics.tsx` — Admin-only route and page gate now match the agency aggregate SQL. Viewer-keyed content/query caches and contextual Performance goals link are present. Keep all graphs; manager reporting requires a separately verified scoped contract. |
| `/dashboard/agencies` | Keep | admin | `/dashboard/agencies` | `src/pages/Agencies.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/builders` | Keep | admin | `/dashboard/builders` | `src/pages/BuildersDashboard.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/builders/:builderId` | Keep | admin | `/dashboard/builders/:builderId` | `src/pages/BuildersDashboard.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/agency-owners` | Keep | admin | `/dashboard/agency-owners` | `src/pages/BuildersDashboard.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/today` | Improve | authenticated | `/dashboard/today` | `src/pages/DashboardToday.tsx` — Useful personal priorities and meetings. Keep separate from owner-private routine; consolidate its navigation into the authorized My Tasks flow. |
| `/admin/producer-trends` | Consolidate | admin | `/dashboard/producer-trends` | `src/pages/AdminProducerTrends.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/producer-trends` | Keep | admin | `/dashboard/analytics` | `src/pages/AdminProducerTrends.tsx` — Distinct coaching trends, activation and weekly history. Keep as a drilldown; do not replace graphs with a general dashboard link. |
| `/agent-portal` | Improve | authenticated | `/dashboard` | `src/pages/AgentCommandDashboard.tsx` — Still renders the producer home as well as old portal URLs; do not delete this implementation. Reduce alternate entry URLs only after role parity. |
| `/agent-dashboard` | Consolidate | authenticated | `/agent-portal` | `src/pages/AgentCommandDashboard.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/agent-portal/legacy` | Legacy | authenticated | `/dashboard` | `src/pages/AgentPortal.tsx` — Explicit legacy portal. Preserve existing bookmarks while steering to the canonical role-aware home. |
| `/numbers` | Keep | authenticated | `/numbers` | `src/pages/Numbers.tsx` — Producer daily entry is in the mobile bar. Preserve submission behavior and distinguish it from reporting-only production charts. |
| `/dashboard/my-day` | Improve | owner verified by server | `/dashboard/my-day` | `src/pages/MyDay.tsx` — Owner-gated private routine with per-user storage keys and pinned task requests. Queue persistence, read validation, stale/unavailable checks and embedded widget isolation passed focused tests and source review. Backing private-task server policy proof remains separate. |
| `/dashboard/finances` | Keep | authenticated | `/dashboard/finances` | `src/pages/Finances.tsx` — Canonical finance workspace now contains personal commission ledger and policy book; only real admins outside role preview mount Management. Preserve estimates versus paid receipts, payout/contract percentages, policy trends and source-specific errors. |
| `/board` | Keep | authenticated | `/dashboard/leaderboard` | `src/pages/BoardLive.tsx` — Dedicated board/presentation surface. Retain truthful live data and privacy/present-mode behavior. |
| `/dashboard/my-tasks` | Keep | authenticated real account outside preview; owned usable agent identity required | `/dashboard/my-tasks` | `src/pages/MyTasks.tsx` — New personal task page derives owned active/unmerged agent identity through current_agent_id, scopes reads and completion, and creates through an authenticated ownership-stamping Edge endpoint. Final task/privacy correction receipts are tracked separately below. |
| `/dashboard/lead-payments` | Keep | admin | `/dashboard/lead-payments` | `src/pages/LeadPayments.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/admin/sam` | Internal | owner verified by server | `/dashboard/admin/sam` | `src/pages/admin/SamHQ.tsx` — Owner-gated task/content/operations aggregate with viewer-keyed requests. Preserve specialist actions and private records; backing sam_daily_tasks server-policy verification remains separate. |
| `/dashboard/sam-todo` | Improve | owner verified by server | `/dashboard/sam-todo` | `src/pages/SamTodo.tsx` — Owner-gated keyed task list with pinned mutation tokens. Source SQL for the older RPCs is admin-only rather than Sam-only; live metadata and any database correction require separate proof. |
| `/dashboard/admin/commission-recovery` | Keep | admin | `/dashboard/admin/commission-recovery` | `src/pages/admin/CommissionRecovery.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |

### Recognition and community

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/awards` | Keep | admin | `/awards` | `src/pages/WinPostStudio.tsx` — Admin content creation/queue uses current wins. Keep manual export/share and actual renderer. |
| `/awards/legacy` | Legacy | admin | `/awards` | `src/pages/AwardGraphics.tsx` — Historical graphics generator explicitly linked as legacy. Preserve old art/batches; do not label it the new renderer. |
| `/plaque/:slug` | Keep | public | `/plaque/:slug` | `src/pages/PlaqueShare.tsx` — Public share_slug endpoint retained. Visible facts and manual-share captions now use recorded metric/date units; stored images are labeled original artwork. No automatic publishing. |
| `/dashboard/community` | Keep | authenticated | `/dashboard/team` | `src/pages/Announcements.tsx` — Community announcements remain distinct from work queues; keep contextual discovery. |
| `/dashboard/challenges` | Improve | authenticated | `/dashboard/awards` | `src/pages/Challenges.tsx` — Catalog claims wallet credits while its own admin copy says unlock engine is next phase. Verify live evaluator/ledger before presenting earned benefits. |
| `/dashboard/awards` | Keep | authenticated | `/dashboard/awards` | `src/pages/AwardsGallery.tsx` — New recorded-award wall/copy controls with typed metrics. Preserve primary Wins & Awards link. |
| `/dashboard/hall-of-fame` | Keep | authenticated | `/dashboard/hall-of-fame` | `src/pages/HallOfFame.tsx` — Mixed-amount dollar totals removed. Full-history plaque-count standings and distinct milestone-type counts remain; cards/details use recorded hires, days, ALP, premium/increase or unknown-unit labels. |
| `/hall-of-fame` | Keep | authenticated | `/dashboard/hall-of-fame` | `src/pages/HallOfFame.tsx` — Mixed-amount dollar totals removed. Full-history plaque-count standings and distinct milestone-type counts remain; cards/details use recorded hires, days, ALP, premium/increase or unknown-unit labels. |
| `/dashboard/team-chat` | Legacy | authenticated | `/dashboard/community` | `src/pages/TeamChat.tsx` — Mobile nav source marks this deprecated. Do not delete history; confirm active usage before redirecting or retiring writes. |
| `/team-chat` | Consolidate | authenticated | `/dashboard/team-chat` | `src/pages/TeamChat.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/leaderboard` | Keep | authenticated | `/dashboard/leaderboard` | `src/pages/Leaderboard.tsx` — Keep production/recruiting/referral rankings and date filters. Existing links already connect Awards and Hall of Fame. |
| `/leaderboard` | Consolidate | authenticated | `/dashboard/leaderboard` | `src/pages/Leaderboard.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/rewards` | Consolidate | authenticated | `/dashboard/awards` | `src/pages/Rewards.tsx` — Distinct agentlink_rewards history belongs in Recognition after data parity. Existing mine/all state is not applied to its query; fix scope before promotion. |
| `/rewards` | Consolidate | authenticated | `/dashboard/rewards` | `src/pages/Rewards.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/my-plaques` | Consolidate | authenticated | `/dashboard/awards` | `src/pages/MyPlaques.tsx` — Preserve combined agentlink_rewards/plaque history until Recognition has full parity. Typed facts and month buckets are fixed; Mine stops at missing identity, account/scoped keys isolate viewers, and failed/malformed reads are unavailable rather than empty. |
| `/dashboard/strikes` | Keep | admin | `/dashboard/strikes` | `src/pages/AdminStrikes.tsx` — Required primary admin conduct workflow and trend evidence. Keep issue/resolve/void and agent visibility. |
| `/dashboard/my-strikes` | Keep | authenticated | `/dashboard/profile` | `src/pages/MyStrikes.tsx` — Own conduct records and acknowledgement; do not expose admin management controls. |

### Recruiting and licensing operations

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/recruiting` | Keep | admin / manager / va_manager / va / recruiter | `/dashboard/recruiting` | `src/pages/DashboardApplicants.tsx` — Canonical recruiting worklist. Classic view still contains exceptional operations; retain until those actions have parity. |
| `/dashboard/recruiting/pipeline` | Keep | admin / manager / va_manager / va / recruiter | `/dashboard/recruiting` | `src/pages/RecruitingPipeline.tsx` — Existing Recruiting workspace tab over its pipeline view/RPC; keep local tab, avoid another primary label. |
| `/dashboard/recruiting/licensed` | Keep | admin / va_manager / va | `/dashboard/recruiting/licensed` | `src/pages/LicensedInbox.tsx` — Immediate licensed-prospect queue; local workspace nav deliberately limits to admin/VA staff. |
| `/dashboard/recruiting/interviews` | Keep | admin / manager / va_manager / va / recruiter | `/dashboard/recruiting` | `src/pages/Interviews.tsx` — Recruiter-accessible interview/hired views remain a permission-safe destination; do not redirect every recruiter to restricted New hires. |
| `/dashboard/recruiting/follow-ups` | Consolidate | admin / manager / va_manager / va / recruiter | `/dashboard/recruiting` | `src/pages/InterviewRecovery.tsx` — Overlap with due/overdue worklist. Retain queue actions and specialist review until an action-by-action parity check supports a redirect. |
| `/dashboard/recruiting/hires` | Improve | admin / manager / va_manager / va / recruiter | `/dashboard/recruiting` | `src/pages/DashboardApplicants.tsx` — Mounts the general worklist with no hires-path filter. Do not blindly redirect to New hires: that destination excludes recruiters, who currently may enter this route. |
| `/dashboard/recruiting-links` | Keep | admin | `/dashboard/grow` | `src/pages/RecruitingLinks.tsx` — Shareable recruiting attribution links. Local links already reach Grow, worklist and Invite links; retain tokens/referrals. |
| `/dashboard/import` | Keep | admin / manager / va_manager | `/dashboard/import` | `src/pages/admin/XcelImport.tsx` — Retained licensing/XCEL importer and Owner shortcut. A role-safe replacement entry in the unlicensed roster is not proven. Consumer import is separate. |
| `/admin/my-applicants` | Keep | admin / manager | `/admin/my-applicants` | `src/pages/admin/MyApplicants.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/add-referral` | Keep | admin / manager | `/admin/add-referral` | `src/pages/admin/AddReferral.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/invite-links` | Keep | admin / manager | `/dashboard/team` | `src/pages/admin/InviteLinks.tsx` — Unique scoped hire/join link tool. Already linked by My Team/Grow; eligible for contextual placement with manager access intact. |
| `/dashboard/stale-recovery` | Keep | admin / manager | `/dashboard/recruiting` | `src/pages/StaleRecovery.tsx` — Specific recovery queue and conversion evidence; retain as staff drilldown. |
| `/dashboard/xcel-pipeline` | Consolidate | admin | `/admin/unlicensed-all` | `src/pages/XcelPipeline.tsx` — Another licensing-progress presentation. Keep source-specific fields until unified roster has proven parity. |
| `/dashboard/team/next-step` | Keep | admin / manager | `/dashboard/team/next-step` | `src/pages/ManagerNextStepBoard.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/recruits` | Keep | admin / manager / va_manager / va | `/dashboard/recruits` | `src/pages/RecruitPipeline.tsx` — Hire-to-first-deal board with onboarding exceptions. Distinct from pre-hire call list. |
| `/admin/next-step/stuck` | Internal | admin | `/admin/next-step/stuck` | `src/pages/AdminStuckPool.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/next-step/funnel-health` | Internal | admin | `/admin/next-step/funnel-health` | `src/pages/AdminFunnelHealth.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/recruit-funnel` | Keep | admin | `/admin/recruit-funnel` | `src/pages/admin/RecruitFunnel.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/email-gaps` | Internal | admin | `/admin/email-gaps` | `src/pages/AdminEmailGaps.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/policy-leads` | Internal | admin | `/admin/policy-leads` | `src/pages/AdminPolicyLeads.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/missing-al-link` | Internal | admin | `/admin/missing-al-link` | `src/pages/AdminMissingAlLink.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/onboarding-ladder` | Keep | admin / manager / va_manager / va | `/dashboard/onboarding-ladder` | `src/pages/OnboardingLadder.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/recovery-queue` | Keep | admin / manager / va_manager / va | `/admin/unlicensed-all` | `src/pages/admin/RecoveryQueue.tsx` — Prioritized hot licensing work queue. Keep contextual view and explicit staff roles. |
| `/admin/unlicensed-all` | Keep | admin / manager / va_manager / va | `/admin/unlicensed-all` | `src/pages/admin/UnlicensedAll.tsx` — Full scoped unlicensed roster and VA assignment. Real parent for licensing history/recovery/import, not a new generic hub. |
| `/admin/xcel-import` | Keep | admin / manager / va_manager | `/dashboard/import` | `src/pages/admin/XcelImport.tsx` — Retained licensing/XCEL importer and Owner shortcut. A role-safe replacement entry in the unlicensed roster is not proven. Consumer import is separate. |
| `/dashboard/seminar` | Consolidate | admin / manager / active_presenter | `/dashboard/seminar-control` | `src/pages/SeminarControl.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/seminar-control` | Keep | admin / manager / active_presenter | `/dashboard/calendar` | `src/pages/SeminarControl.tsx` — Presenter/manager seminar attendance and candidate workflow; preserve explicit active-presenter admission and exact scheduled records. |
| `/dashboard/referrals` | Keep | admin / manager | `/dashboard/recruiting` | `src/pages/ReferralPipeline.tsx` — Manager referral operations. Keep staff access distinct from personal referral status. |
| `/dashboard/referrals/mine` | Keep | authenticated | `/dashboard/referrals/new` | `src/pages/MyReferrals.tsx` — Agent-owned referral status and pending earnings; linked back from submission and command palette. |
| `/dashboard/referrals/new` | Keep | authenticated | `/dashboard/referrals/new` | `src/pages/ReferralSubmit.tsx` — Safe recruiting action for agents and agency owners without staff role. Do not replace with a denied staff worklist. |
| `/dashboard/whales` | Keep | admin | `/dashboard/whales` | `src/pages/WhaleRecruiting.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/recruiter` | Consolidate | authenticated | `/dashboard/recruiting` | `src/pages/RecruiterDashboard.tsx` — Older recruiter-specific workstation; source has its own role gate. Preserve unique assignment/actions until migrated. |
| `/recruit-pipeline` | Consolidate | authenticated | `/dashboard/recruit-pipeline` | `src/pages/AgentPipeline.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/recruit-pipeline` | Consolidate | authenticated | `/dashboard/recruiting` | `src/pages/AgentPipeline.tsx` — Older recruit board still linked from producer home and admits broader roles. Map agent referrals separately before consolidating with staff recruiting. |
| `/dashboard/hiring-pipeline` | Consolidate | admin / manager | `/dashboard/recruiting` | `src/pages/HiringPipeline.tsx` — Additional applications kanban with its own mutations. Consolidate entry point only after stage/mutation parity, not a blind redirect. |
| `/dashboard/prelicensing` | Improve | admin and managers (page gates internally) | `/admin/unlicensed-all` | `src/pages/PrelicensingManager.tsx` — Admin/manager query is disabled for other authenticated roles despite broad route. Align route/message; avoid a false-empty producer experience. |
| `/dashboard/hiring-routing` | Keep | admin | `/dashboard/hiring-routing` | `src/pages/HiringManagerAssignments.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/old-applicants/managers` | Keep | admin / manager | `/dashboard/old-applicants/managers` | `src/pages/OldApplicants.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/old-applicants/licensed-recruiters` | Keep | admin / manager | `/dashboard/old-applicants/licensed-recruiters` | `src/pages/OldApplicants.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/pre-licensing` | Keep | admin / manager | `/admin/unlicensed-all` | `src/pages/PreLicensing.tsx` — XCEL report history differs from manual stage tracking; keep as licensing evidence drilldown. |
| `/dashboard/admin/unclaimed` | Keep | admin | `/dashboard/admin/unclaimed` | `src/pages/admin/UnclaimedLeads.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/admin/manager` | Keep | admin / manager | `/dashboard/admin/manager` | `src/pages/admin/ManagerDashboard.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/admin/licensing` | Consolidate | admin / manager | `/admin/unlicensed-all` | `src/pages/admin/LicensingTracker.tsx` — Another licensing kanban and stalled queue. Fold navigation into the existing roster with source/stage parity first. |

### Learning and enablement

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/training` | Keep | authenticated | `/dashboard/training/library` | `src/pages/ApexTrainingEntry.tsx` — Staff training entry intentionally shows lifecycle toolkit; ordinary agents are redirected to learning home. Preserve that split. |
| `/dashboard/training/library` | Keep | authenticated | `/dashboard/training/library` | `src/pages/TrainingHub.tsx` — Single Learn entry. Start here retains Field Course and Practice a call; legacy recruiting/training paths redirect to the canonical training route while preserving course IDs and query/hash context. |
| `/dashboard/training/library/course/:courseId` | Keep | authenticated | `/dashboard/training/library` | `src/pages/TrainingHubCourse.tsx` — Course detail and progress are not duplicate overview content. Preserve course IDs and shareable deep links. |
| `/dashboard/training/sales-course` | Keep | authenticated | `/dashboard/training/library` | `src/pages/CourseCatalog.tsx` — Field Course remains available from TrainingJourney and staff workspace navigation. Remove only duplicate primary entry. |
| `/dashboard/training/progress` | Keep | admin / manager / va_manager / va / recruiter | `/dashboard/training/library?tab=team` | `src/pages/CourseProgress.tsx` — Staff training progress remains under Training workspace navigation; preserve role gates. |
| `/dashboard/training/content` | Internal | admin / manager / va_manager / va / recruiter | `/dashboard/training/library` | `src/pages/CourseContent.tsx` — Content administration; keep staff navigation and mutations, never expose it as an ordinary learner task. |
| `/dashboard/training/annuities` | Keep | authenticated | `/dashboard/training/library` | `src/pages/AnnuityTraining.tsx` — Specialist training already linked from Start here; retain content without a separate primary entry. |
| `/dashboard/call-lab` | Keep | authenticated | `/dashboard/training/library` | `src/pages/CallLab.tsx` — Practice a call already links here from TrainingJourney; retain live session/report subroutes. |
| `/dashboard/call-lab/live/:id` | Keep | authenticated | `/dashboard/call-lab` | `src/pages/CallLabLive.tsx` — Session detail; keep session ID and recording/runtime state. |
| `/dashboard/call-lab/report/:id` | Keep | authenticated | `/dashboard/call-lab` | `src/pages/CallLabReport.tsx` — Practice report and feedback; keep history and source-specific score semantics. |
| `/dashboard/scripts` | Consolidate | authenticated | `/dashboard/training/library?tab=library` | `src/pages/Scripts.tsx` — Keep unique sales_scripts content and course integration; consolidate after library includes the same scripts. |
| `/dashboard/handbook` | Consolidate | authenticated | `/dashboard/training/library?tab=library` | `src/pages/AgentHandbook.tsx` — Reference material belongs in existing Scripts & guides. Preserve content and useful script links. |
| `/dashboard/annuity-training` | Consolidate | authenticated | `/dashboard/training/annuities` | `src/pages/AnnuityTraining.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/getting-started` | Keep | authenticated | `/dashboard/training/library` | `src/pages/GettingStarted.tsx` — Activation checklist has live activation state and exemptions. It is not equivalent to training completion. |

### Team, contracting and people

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/team` | Keep | authenticated | `/dashboard/team` | `src/pages/DashboardCRM.tsx` — Canonical team roster with contracting view, roster health and scoped profile actions. |
| `/dashboard/ethos-call-sheet` | Keep | authenticated | `/dashboard/ethos-call-sheet` | `src/pages/EthosCallSheet.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/contracting` | Keep | admin | `/dashboard/contracting` | `src/pages/CarrierContracts.tsx` — Path chooses Review, Requests, Carriers, Writing numbers or Intake history. These are real linked views, not duplicate pages. |
| `/dashboard/contracting-profile` | Keep | authenticated | `/dashboard/profile` | `src/pages/ContractingProfile.tsx` — Caller-owned contracting form is a real email/deep-link endpoint. Preserve exact route and receipt semantics. |
| `/dashboard/grow` | Keep | authenticated | `/dashboard/grow` | `src/pages/ContractingDownlines.tsx` — Scoped hire/contracting submissions and team board. Distinct from owner carrier administration. |
| `/dashboard/contracting/downlines` | Consolidate | authenticated | `/dashboard/grow` | `src/pages/ContractingDownlines.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/contracting/carriers` | Keep | admin | `/dashboard/contracting` | `src/pages/CarrierContracts.tsx` — Path chooses Review, Requests, Carriers, Writing numbers or Intake history. These are real linked views, not duplicate pages. |
| `/dashboard/contracting/requests` | Keep | admin | `/dashboard/contracting` | `src/pages/CarrierContracts.tsx` — Path chooses Review, Requests, Carriers, Writing numbers or Intake history. These are real linked views, not duplicate pages. |
| `/dashboard/contracting/history` | Keep | admin | `/dashboard/contracting` | `src/pages/CarrierContracts.tsx` — Path chooses Review, Requests, Carriers, Writing numbers or Intake history. These are real linked views, not duplicate pages. |
| `/dashboard/contracting/documents` | Keep | admin | `/dashboard/contracting` | `src/pages/CarrierContracts.tsx` — Path chooses Review, Requests, Carriers, Writing numbers or Intake history. These are real linked views, not duplicate pages. |
| `/va-team` | Keep | admin / va_manager | `/va-team` | `src/pages/VaManagerPortal.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/agent-duplicates` | Keep | admin | `/admin/agent-duplicates` | `src/pages/admin/AgentDuplicates.tsx` — Required primary admin identity-merge destination. CRM does not replace its adjudication action. |
| `/dashboard/accounts` | Keep | admin | `/dashboard/team` | `src/pages/DashboardAccounts.tsx` — Auth/account administration has capabilities beyond roster display. Keep protected drilldown. |
| `/dashboard/reactivation` | Keep | admin / manager | `/dashboard/team` | `src/pages/ProducerReactivation.tsx` — Distinct producer recovery queue; keep as a team drilldown with manager scope. |
| `/dashboard/profile` | Keep | authenticated | `/dashboard/profile` | `src/pages/ProducerProfile.tsx` — Preserve own/authorized producer details, comp percentage, contracts, documents and training progress. |
| `/dashboard/transfers` | Keep | authenticated | `/dashboard/transfers` | `src/pages/TransferRequests.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/agent/:id` | Consolidate | authenticated | `/dashboard/agents/:id` | `src/pages/AgentDetail.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/agents/:id` | Consolidate | authenticated | `/dashboard/profile` | `src/pages/AgentDetail.tsx` — Older full page overlaps the shared profile/drawer. Keep ID-based URLs until fields/history/actions match. |
| `/dashboard/pipeline-simple` | Consolidate | authenticated | `/dashboard/team` | `src/pages/AgentPipelineSimple.tsx` — Legacy agent roster/manager-switch board despite client-pipeline subtitle. Retain manager reassignment/request actions until CRM has parity; not a client pipeline replacement. |
| `/dashboard/admin/board-access` | Internal | admin | `/dashboard/admin/board-access` | `src/pages/AdminBoardAccess.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/agent-management` | Consolidate | admin | `/dashboard/team` | `src/pages/AgentManagement.tsx` — Older management surface overlaps CRM; retain role changes and destructive actions until explicitly migrated. |
| `/dashboard/inactive-agents` | Improve | admin and managers (page gates internally) | `/dashboard/team` | `src/pages/InactiveAgents.tsx` — Source is admin/manager gated internally; align the broad route with its intended audience and retain recovery data. |

### Owner systems, content and integrations

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/carrier-command` | Keep | owner verified by server | `/dashboard/carrier-command` | `src/pages/CarrierCommand.tsx` — Retained owner-only carrier reconciliation shortcut. No verified equivalent parent route/role flow replaces it; preserve carrier portal truth and reconciliation records. |
| `/dashboard/admin` | Internal | admin | `/dashboard/admin` | `src/pages/DashboardCommandCenter.tsx` — Older admin operations surface remains the mobile Admin destination and Cmd+K entry. Inventory unique actions before retiring it. |
| `/dashboard/apex-control` | Internal | admin | `/dashboard/apex-control` | `src/pages/ApexControl.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/launch-board` | Keep | owner verified by server | `/dashboard/launch-board` | `src/pages/LaunchBoard.tsx` — Owner-gated content workflow now includes Social media approvals -> /dashboard/admin/social-media-bot, allowing that duplicate primary shortcut to be removed without removing approvals/manual publishing. |
| `/dashboard/money-inbox` | Keep | owner verified by server | `/dashboard/money-inbox` | `src/pages/MoneyInbox.tsx` — Private money/opportunity inbox; preserve owner-only server access and direct daily discovery. |
| `/dashboard/legacy` | Consolidate | admin | `/dashboard/admin` | `src/pages/DashboardCommandCenter.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/offers` | Internal | admin | `/storefront` | `src/pages/OffersPage.tsx` — Admin catalog over OffersTiles; preserve real checkout behavior and do not promote stale literal SKU counts. |
| `/dashboard/social` | Keep | admin | `/dashboard/admin/brand-command` | `src/pages/SocialDashboard.tsx` — Historical platform growth graphs are distinct analytical evidence. Keep as brand report drilldown. |
| `/dashboard/automation` | Internal | admin | `/dashboard/system-health` | `src/pages/AutomationHub.tsx` — Operational automation controls and schedules; retain inside System, not a second daily hub. |
| `/bot-token` | Consolidate | admin | `/dashboard/bot-token` | `src/pages/BotToken.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/bot-token` | Internal | admin | `/dashboard/bot-token` | `src/pages/BotToken.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/inbox/instagram` | Keep | owner verified by server | `/dashboard/inbox/instagram` | `src/pages/InstagramInbox.tsx` — Owner-private DM queue. Do not expose it through a generic team social hub. |
| `/dashboard/agentlink-sync` | Internal | admin | `/dashboard/agentlink-sync` | `src/pages/AgentLinkSync.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/agentlink-sync` | Consolidate | admin | `/dashboard/agentlink-sync` | `src/pages/AgentLinkSync.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/agentlink-vault` | Internal | admin | `/dashboard/agentlink-vault` | `src/pages/AgentLinkVault.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/setup` | Consolidate | admin | `/dashboard/setup` | `src/pages/admin/Setup.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/setup` | Internal | admin | `/dashboard/setup` | `src/pages/admin/Setup.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/automation-health` | Internal | admin | `/dashboard/system-health` | `src/pages/AutomationHealth.tsx` — Cron/job diagnostics; preserve actual run/error history and owner access. |
| `/dashboard/instagram-automation` | Keep | admin | `/dashboard/instagram-automation` | `src/pages/InstagramAutomation.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/system-health` | Keep | owner verified by server | `/dashboard/system-health` | `src/pages/SystemHealth.tsx` — Monitoring and owner integrations/subscriptions are useful. Keep a single System primary entry; specialist tools remain contextual. |
| `/dashboard/email-log` | Internal | admin | `/dashboard/email-log` | `src/pages/EmailDeliveryLog.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/comp-tiers` | Internal | admin | `/dashboard/comp-tiers` | `src/pages/admin/CompTiersSettings.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/integrations` | Internal | admin | `/dashboard/integrations` | `src/pages/admin/IntegrationsSettings.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/admin/contentwheel` | Keep | admin | `/dashboard/admin/content-command` | `src/pages/ContentWheel.tsx` — Existing ideation/hook modules use live schema; already reached from Content Command. Keep working modules only. |
| `/dashboard/admin/content-command` | Consolidate | admin | `/dashboard/launch-board` | `src/pages/admin/ContentCommand.tsx` — Overlapping legacy content queue/ideation; map approval states and unique research before retirement. |
| `/dashboard/social-command` | Keep | admin / manager | `/dashboard/social-command` | `src/pages/SocialCommandCenter.tsx` — Granted team social inbox/lane monitoring differs from owner content. Preserve its direct grant-gated access. |
| `/dashboard/readymode` | Internal | admin | `/dashboard/readymode` | `src/pages/ReadyModeIntegration.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/admin/performance-bot` | Keep | admin | `/dashboard/analytics` | `src/pages/admin/PerformanceBot.tsx` — Goal/pace/lead-yield page retained; Reports now provides a Performance goals action. Primary shortcut removed after that parent link was added. |
| `/dashboard/admin/brand-command` | Keep | admin | `/dashboard/admin/brand-command` | `src/pages/admin/BrandCommand.tsx` — Retained Owner shortcut. My Day has a contextual link, but removing the shared admin entry could change role discoverability; parity has not been proven. |
| `/dashboard/admin/social-media-bot` | Keep | owner verified by server | `/dashboard/launch-board` | `src/pages/admin/SocialMediaCenter.tsx` — Specialist approvals/publish-receipt page retained and reached by the Launch Board local action. Existing review/publish semantics remain; cleanup invokes no sends/posts. |
| `/dashboard/admin/telegram-bot` | Internal | admin | `/dashboard/admin/telegram-bot` | `src/pages/admin/TelegramBot.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |

### Client book, leads and calling

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/retention` | Consolidate | admin / manager | `/dashboard/book-of-business` | `src/pages/BookOfBusiness.tsx` — Same BookOfBusiness implementation without a pathname-selected retention view. Keep policy-health graphs/workflow and improve naming; not equivalent to MyDeals. |
| `/dashboard/aged-leads` | Keep | authenticated | `/dashboard/aged-leads` | `src/pages/DashboardAgedLeads.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/clients/:clientId` | Keep | authenticated | `/dashboard/agent-pipeline` | `src/pages/ClientDetail.tsx` — Client record and next-step activity. Preserve route IDs, back state and authorized contact data. |
| `/purchase-leads` | Keep | authenticated | `/purchase-leads` | `src/pages/PurchaseLeads.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/call-center` | Keep | authenticated | `/dashboard/call-center` | `src/pages/CallCenter.tsx` — Daily calling workflow used by producers and VAs. Preserve recording and queue operations. |
| `/dashboard/calls-today` | Keep | authenticated | `/dashboard/calendar` | `src/pages/CallsTodayCockpit.tsx` — Focused scheduled-call cockpit; keep contextual access from Calendar and preserve provider/event metadata. |
| `/dashboard/agent-pipeline` | Keep | authenticated | `/dashboard/agent-pipeline` | `src/pages/ClientPipeline.tsx` — Canonical consumer next-action/call workflow retained. Duplicate URLs redirect here. Existing admin Import now opens /dashboard/consumer-import, not the licensing/XCEL importer. |
| `/dashboard/calendar` | Keep | authenticated | `/dashboard/calendar` | `src/pages/CalendarPage.tsx` — Canonical scheduling surface. Sidebar duplicates are intentional role fallbacks, already de-duplicated for owner. |
| `/dashboard/planner` | Internal | admin | `/dashboard/calendar` | `src/pages/AdminCalendar.tsx` — Admin recurring schedule blocks differ from agent calendar. Keep contextual admin access; do not combine data scopes. |
| `/dashboard/book-of-business` | Improve | admin / manager | `/dashboard/production` | `src/pages/BookOfBusiness.tsx` — Retain policy health, chargebacks, persistency, concentration and historic source drilldown. Different source/operations from MyDeals; name it clearly instead of deleting it. |
| `/dashboard/client-marketing` | Keep | authenticated | `/dashboard/marketing` | `src/pages/ClientMarketing.tsx` — Client copy templates remain available. Recruiting Funnels mounts and queries only for an authorized recruiting role outside preview; viewer/access-key scoping prevents cross-role cached funnel content. |
| `/dashboard/calling-cards` | Consolidate | authenticated | `/dashboard/profile` | `src/pages/CallingCards.tsx` — Profile-derived share tools can be contextual profile actions. Preserve public link/QR/share behavior. |
| `/dashboard/landing-page` | Consolidate | authenticated | `/dashboard/profile` | `src/pages/MyLandingPage.tsx` — Profile-derived landing preview belongs beside calling card/share links, not another primary page. |
| `/dashboard/needs-analysis` | Keep | authenticated | `/dashboard/agent-pipeline` | `src/pages/NeedsAnalysis.tsx` — Real DIME calculator has distinct client-call value. Keep contextual access; no need for primary sidebar. |
| `/dashboard/quoter` | Legacy | authenticated | `/dashboard/training/library?tab=library` | `src/pages/Quoter.tsx` — Illustrative hard-coded rate table, not a carrier rate engine. Keep out of daily selling nav; retain only clearly labeled training reference until verified rates exist. |
| `/dashboard/bulk-deals` | Keep | admin / manager | `/dashboard/bulk-deals` | `src/pages/BulkDeals.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/bulk-deals` | Consolidate | admin / manager | `/dashboard/bulk-deals` | `src/pages/BulkDeals.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/book-quality` | Keep | admin / manager | `/dashboard/production` | `src/pages/BookReconciliation.tsx` — Distinct reconciliation and recovery work. Preserve carrier comparisons, discrepancy graphs and embedded Book Flips. |
| `/dashboard/books` | Keep | admin / manager | `/dashboard/book-quality` | `src/pages/BookFlips.tsx` — Real recoverable-policy worklist already embedded in reconciliation; standalone URL supports Easy Resells deep links. |
| `/dashboard/sold-calls` | Keep | admin / manager | `/dashboard/sold-calls` | `src/pages/SoldCalls.tsx` — Granted call operations and review. Keep directly discoverable; preserve separate private/raw-media permissions. |
| `/dashboard/easy-resells` | Keep | admin / manager | `/dashboard/easy-resells` | `src/pages/EasyResells.tsx` — Granted ranked recovery workflow; retain direct access and the source records behind rankings. |
| `/dashboard/call-training` | Keep | admin / manager | `/dashboard/call-training` | `src/pages/CallTraining.tsx` — Granted coaching operations are distinct from the general Training library. Keep direct access and matching grants. |
| `/dashboard/lead-bundles` | Consolidate | admin / manager | `/dashboard/lead-manager` | `src/pages/LeadManager.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/my-leads` | Keep | authenticated | `/dashboard/my-leads` | `src/pages/MyLeads.tsx` — Assigned agent work queue and recording/follow-up actions. Keep in primary navigation and mobile access. |
| `/dashboard/lead-manager` | Keep | admin / manager | `/dashboard/lead-manager` | `src/pages/LeadManager.tsx` — Canonical granted lead allocation console. Preserve pool filters, receipts, resale ledger and per-person grants. |
| `/dashboard/consumer-import` | Keep | admin / manager | `/dashboard/lead-manager` | `src/pages/ConsumerLeadImport.tsx` — Real consumer CSV review/import path. Keep reachable from the lead workflow; no imports executed by this audit. |

### Account, support and notifications

| Exact route | Decision | Intended audience | Canonical parent / destination | Evidence and value |
|---|---|---|---|---|
| `/dashboard/nova` | Consolidate | authenticated | `/dashboard/help` | `src/pages/HelpCenter.tsx` — Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion. |
| `/dashboard/settings` | Keep | authenticated | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/agency` | Keep | admin | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/notifications` | Keep | authenticated | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/security` | Keep | authenticated | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/billing` | Keep | admin | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/nova-pro` | Keep | authenticated | `/dashboard/settings` | `src/pages/Settings.tsx` — One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features. |
| `/dashboard/settings/deleted-leads` | Keep | admin | `/dashboard/settings/deleted-leads` | `src/pages/DeletedLeadsVault.tsx` — Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review. |
| `/dashboard/my-inbox` | Consolidate | real authenticated admin outside role preview; applicant triage | `/dashboard/recruiting` | `src/pages/SamInbox.tsx` — Renamed Recruiting triage, with authenticated-admin/outside-preview admission, viewer-keyed validated reads, explicit error/retry state and honest 120-row labels. This is applicant triage, not private conversations; retain until recruiting parent has action parity. |
| `/dashboard/notifications/mine` | Keep | authenticated | `/dashboard/notifications/mine` | `src/pages/MyNotifications.tsx` — Personal notifications already reached by bell and Cmd+K. Keep outside primary sidebar. |
| `/dashboard/notifications` | Consolidate | admin | `/dashboard/inbox` | `src/pages/NotificationHub.tsx` — Admin notification history/actions overlap Inbox, but preserve delivery/filter/export parity before merging. |
| `/dashboard/inbox` | Keep | admin | `/dashboard/inbox` | `src/pages/InboxPage.tsx` — Admin operational inbox/delivery evidence. Keep separate from private owner Money Inbox and Instagram. |
| `/dashboard/help` | Keep | authenticated | `/dashboard/help?tab=desk` | `src/pages/HelpCenter.tsx` — Searchable FAQ and support desk. /dashboard/nova is the same component, not a separate AI product. |

## Complete navigation manifest

Every primary, account and applicant entry is listed below. Calendar/support duplicates across mutually exclusive role/menu contexts are not automatically clutter for one user.

| Menu / section | Label | Exact href | Static visible audiences |
|---|---|---|---|
| PRIMARY / top level | Home | `/dashboard` | agent, manager, agency_owner, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / top level | My Tasks | `/dashboard/my-tasks` | agent, manager, agency_owner, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / top level | My Day | `/dashboard/my-day` | owner |
| PRIMARY / Sell | My Pipeline | `/dashboard/agent-pipeline` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Sell | Call Center | `/dashboard/call-center` | agent, manager, agency_owner, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Sell | Calendar | `/dashboard/calendar` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Grow | Social Command | `/dashboard/social-command` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Grow | Call list | `/dashboard/recruiting` | manager, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Grow | New hires | `/dashboard/recruits` | manager, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Grow | Invite an agent | `/admin/invite-links` | manager, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Grow | Instagram | `/dashboard/inbox/instagram` | owner |
| PRIMARY / Grow | Refer a recruit | `/dashboard/referrals/new` | agent, agency_owner, admin_not_owner, owner |
| PRIMARY / Grow | Calendar | `/dashboard/calendar` | recruiter, va, va_manager |
| PRIMARY / Grow | Staff accounts | `/va-team` | va_manager, admin_not_owner, owner |
| PRIMARY / Grow | Contracting review | `/dashboard/team?view=contracting` | va, va_manager |
| PRIMARY / My Business | Book of Business | `/dashboard/production` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Easy Resells | `/dashboard/easy-resells` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Sold Calls | `/dashboard/sold-calls` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Call Training | `/dashboard/call-training` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Leads | `/dashboard/lead-manager` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | My Leads | `/dashboard/my-leads` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Finances | `/dashboard/finances` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / My Business | Retention | `/dashboard/retention` | manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Learn | Training | `/dashboard/training/library` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Team | Leaderboard | `/dashboard/leaderboard` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Team | Wins & Awards | `/dashboard/awards` | agent, manager, agency_owner, recruiter, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Team | My Team | `/dashboard/team` | agent, manager, agency_owner, recruiter, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Team | Call sheet | `/dashboard/ethos-call-sheet` | manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Team | Grow my team | `/dashboard/grow` | manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |
| PRIMARY / Owner | Money Inbox | `/dashboard/money-inbox` | owner |
| PRIMARY / Owner | Launch Board | `/dashboard/launch-board` | owner |
| PRIMARY / Owner | Brand Command | `/dashboard/admin/brand-command` | admin_not_owner, owner |
| PRIMARY / Owner | Carrier Command | `/dashboard/carrier-command` | owner |
| PRIMARY / Owner | Reports | `/dashboard/analytics` | admin_not_owner, owner |
| PRIMARY / Owner | Contracting | `/dashboard/contracting` | admin_not_owner, owner |
| PRIMARY / Owner | Import | `/dashboard/import` | admin_not_owner, owner |
| PRIMARY / Owner | Agent Duplicates | `/admin/agent-duplicates` | admin_not_owner, owner |
| PRIMARY / Owner | Strikes | `/dashboard/strikes` | admin_not_owner, owner |
| PRIMARY / Owner | System | `/dashboard/system-health` | owner |
| APPLICANT / top level | Home | `/dashboard` | applicant |
| APPLICANT / top level | Get licensed | `/get-licensed` | applicant |
| APPLICANT / top level | Training | `/dashboard/training/library` | applicant |
| APPLICANT / top level | Support desk | `/dashboard/help?tab=desk` | applicant |
| ACCOUNT / Settings | Account settings | `/dashboard/settings` | agent, manager, agency_owner, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| ACCOUNT / Settings | Support desk | `/dashboard/help?tab=desk` | agent, manager, agency_owner, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| ACCOUNT / Settings | `Install ${BRAND.shortName} app` | `/install` | agent, manager, agency_owner, recruiter, va, va_manager, manager_with_sold_calls, admin_not_owner, owner |
| ACCOUNT / top level | Producer Profile | `/dashboard/profile` | agent, manager, agency_owner, manager_with_sold_calls, admin_not_owner, owner |

## Release verification still required

The source and focused receipts above do not replace the integrated forced type check, production build, required PR verification, database/Edge deployment, and actual production-version match. Coordinator-owned browser checks cover selected flows, not every row in this matrix. Verify private server boundaries with current metadata and tests before claiming their database protections complete. No irreversible workflow action is needed merely to prove route discovery.

Companion artifacts: `verification/page-consolidation-inventory.json`, `verification/page-consolidation-inventory.raw.json`, `verification/page-inventory-extraction.log`; focused legacy award/import receipts are `verification/legacy-awards-focused-tests.log`, `verification/legacy-awards-final-tests.log`, and `verification/legacy-awards-render-health.log`. These are source/test evidence, not live business records.
