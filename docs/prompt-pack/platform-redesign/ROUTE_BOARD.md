# Route board: every screen, who sees it, and how far it is from the contract

Measured 2026-10-28 on `claude/grow-redesign-prompt` (PR #46 merged with `main` ba730a7) by reading
`src/App.tsx` in full and every page file's header. This is the inventory the area prompts read from.
Update the **Pattern** column as areas ship; a route is finished when it reads `NEW`.

## Totals

| What | Count |
|---|---|
| `<Route path>` entries in `src/App.tsx` | 285 |
| Screens (groups 1–11 below) | 198 |
| Aliases (a second mount of a page already listed) | 36 |
| Redirects (`LegacyWorkspaceRedirect` ×50, plus `/r/:code`) | 51 |
| Page files rendered by non-redirect routes | 186 (+ `RecruitingShortLink`) |
| Pattern today | NEW 1 · NEW\* 3 · PH 119 · LEGACY 75 (41 of the LEGACY are public, marketing or sign-in pages) |

## How to read the columns

- **Page file** is relative to `src/`.
- **Who can see it** is exactly what wraps the route in `App.tsx`. *Public* = outside the signed-in shell.
  *Public·token* = the page checks a token or id itself. *Shell* = inside `AuthenticatedShell` with no
  guard of its own (any signed-in user). *PR* = `<ProtectedRoute>` (any signed-in user). *Admin* =
  `requireAdmin`; *+Mgr* = `allowManagers`; *+Presenter* = `allowPresenters`; *+VAM / +VA / +Rec* =
  `allowRoles` with va_manager / va / recruiter. A refused user sees `AccessDeniedPanel`.
- **Sidebar** is `Group › Label [modes]` from `agentCloudNavigation.ts`; *P* = agent, manager,
  agency_owner; *grant* = the per-person `sold_calls` permission; *Mobile:* = a `MobileBottomNav` tab.
  An admin outside role preview sees every desktop item.
- **Pattern**: `NEW` = `PageHeader` + a scoreboard (`GrowScoreboard` or `ScopedProductionScoreboard`) + a
  declared `primaryAction` (the screen contract's skeleton). `NEW*` = the same without a declared primary
  action. `PH` = `PageHeader` only; `PH+1` = `PageHeader` with a declared primary action. `LEGACY` =
  neither. Meeting the full contract in `00-MASTER.md` §3 is what the council checks; this column is the
  skeleton.
- **Controls**: whole component tags in the page file (`<Button`, `<Select`, `<Input`, `<Tabs`,
  `<Switch`, `<DropdownMenu`), then in brackets the prefix count (also `SelectItem`, `TabsTrigger`,
  `DropdownMenuItem`…). *+N in X* = controls in a component the page hands off to. A clutter signal, not
  a verdict.
- Routes not in the nav are grouped by what they do, or by their breadcrumb in `ROUTE_CRUMBS`. Routes gated
  to `requireAdmin` alone with no nav home sit in group 11.

## 1 · Home (area 04)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard` | pages/Dashboard.tsx | Home [all]; applicant rail Home; Mobile: Home on every ladder | Shell | Home by role: admin → AgentCloudHome; agent → scoreboard + AgentCommandDashboard; manager → scoreboard + ManagerCommandView; owner → scoreboard + AgencyOwnerHome; recruiter → RecruiterHome; VA → VaOpsCommandCenter; admin preview → ExecutiveDashboard | NEW\* (agent/manager/owner); admin view has a scoreboard, no PageHeader; recruiter and VA = PH | 7 (7); +22 AgentCommandDashboard, +8 AgencyOwnerHome, +5 ManagerCommandView, +5 RecruiterHome, +1 AgentCloudHome |
| `/agent-portal` | pages/AgentCommandDashboard.tsx | not in nav | PR | "Welcome back": the agent command dashboard (same component agents get inside /dashboard) | PH | 22 (31) |
| `/agent-portal/legacy` | pages/AgentPortal.tsx | not in nav | Shell | "Agent Portal": the old heavy card stack plus logging numbers | LEGACY | 5 (5) |
| `/dashboard/my-day` | pages/MyDay.tsx | My Day [adminOnly] | Admin | Sam's own day schedule | LEGACY | 5 (5) |
| `/dashboard/today` | pages/DashboardToday.tsx | not in nav | PR | "Galaxy Today": income tasks, appointments, hot prospects | PH | 1 (1) |
| `/numbers` | pages/Numbers.tsx | Mobile only: agent "Numbers" | Shell | "Galaxy Daily Numbers": agent logs presentations, calls, referrals; small leaderboard | LEGACY | 0 (0) +4 CompactProductionEntry |

## 2 · Sell (area 05)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/agent-pipeline` | pages/ClientPipeline.tsx | Sell › My Pipeline [P]; Mobile: agent and agency_owner "Pipeline" | PR | "Client sales cockpit": clients and policies | PH | 32 (57) |
| `/dashboard/call-center` | pages/CallCenter.tsx | Sell › Call Center [P, va, va_manager] | PR | "Call Center" (eyebrow "Recruiting · Dial session"): the **recruit** dialer, filed under Sell | PH | 10 (10) |
| `/dashboard/calendar` | pages/CalendarPage.tsx | Sell › Calendar [P]; Grow › Calendar [recruiter, va, va_manager]; Mobile: recruiter and VA; recruiting sub-nav | Shell | "Calendar": appointments, interviews, follow-ups | PH+1 ("Appointment") | 30 (34) |
| `/dashboard/clients/:clientId` | pages/ClientDetail.tsx | not in nav (detail) | PR | One client: timeline, policies, beneficiaries, next-best action | LEGACY | 7 (7) |
| `/dashboard/calls-today` | pages/CallsTodayCockpit.tsx | not in nav | PR | "Calls today": Google Calendar events; Start call opens the inbound form | PH | 1 (1) |
| `/dashboard/pipeline-simple` | pages/AgentPipelineSimple.tsx | not in nav | Shell | "Agent Pipeline (Simple)": a lighter client pipeline | PH | 8 (13) |
| `/dashboard/quoter` | pages/Quoter.tsx | not in nav | PR | "Quoter": rough premium estimates | PH | 4 (4) |
| `/dashboard/needs-analysis` | pages/NeedsAnalysis.tsx | not in nav (cut 2026-08-31) | PR | DIME coverage calculator | PH | 3 (4) |
| `/dashboard/client-marketing` | pages/ClientMarketing.tsx | not in nav | PR | After-sale message templates; a second tab "Recruiting Funnels" | PH | 6 (6) |
| `/purchase-leads` | pages/PurchaseLeads.tsx | not in nav | Shell | "Fuel Your Pipeline": weekly lead packs | LEGACY | 6 (6) |

## 3 · Grow (PR #46 done; area 03 for the rest)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/recruiting` | pages/DashboardApplicants.tsx → RecruitingWorklist | Grow › Call list [manager, recruiter, va, va_manager]; Mobile: admin, manager, recruiter, VA "Recruiting"; sub-nav | Admin+Mgr+VAM+VA+Rec | Call list: call people, record what happened, set the next step. `?view=classic` is the old table | **NEW** (classic view LEGACY) | 42 (80) mostly classic; 12 in RecruitingWorklist |
| `/dashboard/recruiting/pipeline` | pages/RecruitingPipeline.tsx | sub-nav "Pipeline"; breadcrumb Grow › Pipeline | Admin+Mgr+VAM+VA+Rec | Pipeline: first call to active agent | NEW\* | 14 (25) |
| `/dashboard/recruits` | pages/RecruitPipeline.tsx | Grow › New hires [manager, va, va_manager]; Mobile VA; sub-nav | Admin+Mgr+VAM+VA | New hires: from hire to first deal | NEW\* (secondary CSV only) | 18 (26) |
| `/admin/invite-links` | pages/admin/InviteLinks.tsx | Grow › Invite an agent [manager] | Admin+Mgr | Invite an agent: create and send a hire link, contracting copy card | PH | 0 (0) +13 InviteAgentForm, +8 InvitationsTable |
| `/dashboard/referrals/new` | pages/ReferralSubmit.tsx | Grow › Refer a recruit [agent, agency_owner] | PR | Submit a referral | LEGACY | 9 (13) |
| `/va-team` | pages/VaManagerPortal.tsx | Grow › Staff accounts [va_manager] | Admin+VAM | Staff accounts | PH+1 | 9 (9) |
| `/dashboard/social-command` | pages/SocialCommandCenter.tsx | Grow › Social Command [grant] | Admin+Mgr | Social Command Center (MP-308, in flight) | PH | 8 (8) |
| `/dashboard/inbox/instagram` | pages/InstagramInbox.tsx | Grow › Instagram [manager] | Admin+Mgr | Instagram command center (MP-305, in flight) | PH | 8 (8) |
| `/dashboard/recruiting/interviews` | pages/Interviews.tsx | not in nav | Admin+Mgr+VAM+VA+Rec | "Interview Control Room" | LEGACY | 30 (36) |
| `/dashboard/recruiting/follow-ups` | pages/InterviewRecovery.tsx | not in nav | Admin+Mgr+VAM+VA+Rec | "Interview Recovery" backlog (MP-264) | PH | 29 (29) |
| `/dashboard/onboarding-ladder` | pages/OnboardingLadder.tsx | not in nav (NHLB "Open queue") | Admin+Mgr+VAM+VA | Onboarding queue: every live hire with an open requirement | PH | 1 (1) |
| `/dashboard/stale-recovery` | pages/StaleRecovery.tsx | not in nav | Admin+Mgr | Applied over 24h ago, nobody has called | PH | 5 (12) |
| `/dashboard/aged-leads` | pages/DashboardAgedLeads.tsx | not in nav | Shell (page admits admin/manager only) | Aged leads: past applicants and first-contact leads; call mode | PH | 29 (63) |
| `/dashboard/hiring-pipeline` | pages/HiringPipeline.tsx | not in nav | Admin+Mgr | Drag-and-drop applicant board | PH | 11 (32) |
| `/dashboard/referrals` | pages/ReferralPipeline.tsx | not in nav | Admin+Mgr | The team's referral pipeline | PH | 3 (6) |
| `/dashboard/referrals/mine` | pages/MyReferrals.tsx | not in nav | PR | My referrals | PH | 2 (2) |
| `/admin/my-applicants` | pages/admin/MyApplicants.tsx | not in nav | Admin+Mgr | A manager's own credited recruits | LEGACY | 3 (3) |
| `/admin/add-referral` | pages/admin/AddReferral.tsx | not in nav | Admin+Mgr | Referral form managers fill in themselves | LEGACY | 8 (17) |
| `/admin/licensed-inbox` | pages/LicensedInbox.tsx | not in nav | Admin+VAM+VA (managers not admitted) | Licensed applicants, call now | PH | 7 (7) |
| `/admin/recovery-queue` | pages/admin/RecoveryQueue.tsx | not in nav | Admin+Mgr+VAM+VA | "License Push": closest to getting licensed | PH | 18 (18) |
| `/admin/unlicensed-all` | pages/admin/UnlicensedAll.tsx | not in nav | Admin+Mgr+VAM+VA | Unlicensed queue: assign to a VA, the 30-day ghosted pile | PH | 18 (41) |
| `/dashboard/getting-started` | pages/GettingStarted.tsx | not in nav | PR | Getting-started tracker after signup | PH | 6 (16) |
| `/dashboard/prelicensing` | pages/PrelicensingManager.tsx | not in nav | PR (page admits admin/manager only) | Pre-licensing: track, nudge, move forward | PH | 14 (25) |
| `/dashboard/pre-licensing` | pages/PreLicensing.tsx | not in nav | Admin+Mgr | Pre-licensing course progress (XCEL daily report) | PH | 11 (21) |
| `/dashboard/admin/licensing` | pages/admin/LicensingTracker.tsx | not in nav | Admin+Mgr | Licensing tracker: 8-stage board plus stalled list | PH | 2 (11) |
| `/dashboard/recruit-pipeline` | pages/AgentPipeline.tsx | not in nav | PR | Titled "My Pipeline": recruits through licensing (second page with that title) | LEGACY | 14 (28) |
| `/dashboard/recruiter` | pages/RecruiterDashboard.tsx | not in nav | Shell (page bounces non-admin/manager/recruiter/owner) | "Recruiter HQ" | LEGACY | 22 (22) |
| `/dashboard/seminar` | pages/SeminarControl.tsx | not in nav | Admin+Mgr+Presenter | Group interview pipeline (seminar retired 2026-10-15) | PH | 3 (3) |
| `/dashboard/old-applicants/managers` | pages/OldApplicants.tsx | not in nav | Admin+Mgr | Old manager applicants | PH | 6 (6) |
| `/dashboard/old-applicants/licensed-recruiters` | pages/OldApplicants.tsx | not in nav | Admin+Mgr | Old licensed applicants | PH | same file |

## 4 · My Business (area 06)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/production` | pages/MyDeals.tsx | My Business › Book of Business [P]; Mobile: agent "Book", admin/manager/owner "Production" | PR | Titled "Agency Production" / "Team Production" / "My Deals" by role: posted deals | PH+1 | 10 (10) |
| `/dashboard/retention` | pages/BookOfBusiness.tsx | My Business › Retention [P] | PR | Titled "Book of Business": every policy record; no retention-specific view | PH | 27 (62) |
| `/dashboard/easy-resells` | pages/EasyResells.tsx | My Business › Easy Resells [grant] | Admin+Mgr | Easiest resells first | PH | 9 (9) |
| `/dashboard/books` | pages/BookFlips.tsx | My Business › Book Flips [manager] | Admin+Mgr | Work the books: call, rewrite, mark resold | PH | 4 (4) |
| `/dashboard/ayro-book` | pages/AyroBook.tsx | My Business › Ayro Book [grant] | Admin+Mgr | Ayro Financial book by carrier | PH | 15 (19) |
| `/dashboard/sold-calls` | pages/SoldCalls.tsx | My Business › Sold Calls [grant] | Admin+Mgr | ReadyMode sales and callers who balked | PH | 9 (9) |
| `/dashboard/my-commissions` | pages/MyCommissions.tsx | My Business › My Commissions [P] | PR | Paid amounts vs estimates | PH | 0 (0) |
| `/dashboard/book-quality` | pages/BookReconciliation.tsx | not in nav | Admin+Mgr | Carrier records vs internal deal log | PH | 3 (16) |
| `/dashboard/bulk-deals` | pages/BulkDeals.tsx | not in nav | Admin+Mgr | Bulk deal import from raw text | PH | 2 (2) |

## 5 · Learn (area 07)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/training/sales-course` | pages/CourseCatalog.tsx | Learn › Field Course [P] | PR | Field-release training course | LEGACY | 8 (15) |
| `/dashboard/training/library` | pages/TrainingHub.tsx | Learn › Training Home [P]; applicant rail; Mobile: manager, owner, applicant | PR | Training center: required course first, then the library | PH | 6 (17) |
| `/dashboard/call-lab` | pages/CallLab.tsx | Learn › Call Lab [P] | PR | Practise a sales conversation | PH | 6 (6) |
| `/dashboard/call-lab/live/:id` | pages/CallLabLive.tsx | not in nav | PR | Live practice call | LEGACY | 9 (9) |
| `/dashboard/call-lab/report/:id` | pages/CallLabReport.tsx | not in nav | PR | Call report scorecard | LEGACY | 5 (5) |
| `/dashboard/training/library/course/:courseId` | pages/TrainingHubCourse.tsx | not in nav | PR | Course player: lessons, quizzes, progress | LEGACY | 5 (5) |
| `/dashboard/training` | pages/ApexTrainingEntry.tsx → ApexCareerToolkit.tsx | not in nav | PR (admin/manager/VA get the toolkit; others → library) | Galaxy Training: licensing → certification → launch → first sale | PH | 0 (0) +5 ApexCareerToolkit |
| `/dashboard/training/progress` | pages/CourseProgress.tsx | not in nav | Admin+Mgr+VAM+VA+Rec | Course progress monitor | LEGACY | 7 (12) |
| `/dashboard/training/content` | pages/CourseContent.tsx | not in nav | Admin+Mgr+VAM+VA+Rec | Course content modules | LEGACY | 4 (4) |
| `/dashboard/training/annuities` | pages/AnnuityTraining.tsx | not in nav (cut) | PR | Annuity training, 6 modules | PH | 3 (3) |
| `/dashboard/scripts` | pages/Scripts.tsx | not in nav | PR | Every sales script, click to copy | PH | 4 (4) |
| `/dashboard/handbook` | pages/AgentHandbook.tsx | not in nav (cut) | PR | Agent handbook | PH | 1 (1) |

## 6 · Team (area 07)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/leaderboard` | pages/Leaderboard.tsx | Team › Leaderboard [P] | PR | Production, recruiting, referral and activity rankings | PH | 8 (23) |
| `/dashboard/team` | pages/DashboardCRM.tsx | Team › My Team [P, recruiter]; Mobile admin/manager/owner/recruiter "Team"; `?view=contracting` = Grow › Contracting review [va, va_manager], Mobile VA | PR | My Team: Overview, Attendance, Contracting and Link views | PH | 4 (10) +4 ContractingReviewWorkspace |
| `/dashboard/team/next-step` | pages/ManagerNextStepBoard.tsx | not in nav | Admin+Mgr | Next-step board: stalled and idle people | LEGACY | 2 (2) |
| `/dashboard/agents/:id` | pages/AgentDetail.tsx | not in nav (detail) | PR | One agent: MTD and active ALP, pending commissions, churn, deals | LEGACY | 2 (2) |
| `/dashboard/admin/manager` | pages/admin/ManagerDashboard.tsx | not in nav | Admin+Mgr | Manager Command: recruiting, licensing, production tabs | PH | 1 (8) |
| `/dashboard/reactivation` | pages/ProducerReactivation.tsx | not in nav | Admin+Mgr | Proven sellers who went quiet | PH | 3 (3) |
| `/dashboard/inactive-agents` | pages/InactiveAgents.tsx | not in nav | PR (page admits admin/manager only) | Inactive agent recovery | PH | 13 (29) |
| `/dashboard/transfers` | pages/TransferRequests.tsx | not in nav | PR | Transfer requests: move under a new upline | PH | 6 (6) |
| `/dashboard/community` | pages/Announcements.tsx | not in nav (cut) | PR | Announcements and news feed | PH+1 | 6 (6) |
| `/dashboard/challenges` | pages/Challenges.tsx | not in nav (cut) | PR | Challenges | PH | 0 (0) |
| `/dashboard/awards` | pages/AwardsGallery.tsx | not in nav (cut) | PR | Awards gallery | PH | 9 (14) |
| `/dashboard/hall-of-fame` | pages/HallOfFame.tsx | not in nav (cut) | PR | Hall of fame | PH | 7 (19) |
| `/dashboard/rewards` | pages/Rewards.tsx | not in nav | PR | Awards and rewards, issued nightly | PH | 0 (0) |
| `/dashboard/my-plaques` | pages/MyPlaques.tsx | not in nav | PR | My plaques | PH | 3 (3) |
| `/board` | pages/BoardLive.tsx | not in nav | PR | Live production board for screenshots | LEGACY | 0 (0) |
| `/dashboard/my-strikes` | pages/MyStrikes.tsx | not in nav | PR | Your conduct record | PH | 2 (2) |
| `/dashboard/team-chat` | pages/TeamChat.tsx | not in nav (deprecated) | PR | Live team chat | LEGACY | 2 (2) |

## 7 · Owner (area 08)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/launch-board` | pages/LaunchBoard.tsx | Owner › Launch Board [adminOnly] | PR + ContentAccessGate (admin, or an email on the invite list) | Content workflow from idea to published | LEGACY | 42 (57) |
| `/dashboard/analytics` | pages/BusinessAnalytics.tsx | Owner › Reports [adminOnly] | Admin+Mgr | Business analytics | PH | 3 (3) |
| `/dashboard/finances` | pages/Finances.tsx | Owner › Finances [adminOnly] | Admin | Commissions, forecasts, payouts | PH | 9 (29) |
| `/dashboard/contracting` | pages/CarrierContracts.tsx (review) | Owner › Contracting [adminOnly] | Admin | Contracting review: one front door | PH | 5 (5) +4 ContractingReviewWorkspace |
| `/dashboard/contracting/carriers` | pages/CarrierContracts.tsx | page tabs; breadcrumb | Admin | Carriers | PH | same file |
| `/dashboard/contracting/documents` | pages/CarrierContracts.tsx | breadcrumb | Admin | Writing numbers | PH | same file |
| `/dashboard/contracting/requests` | pages/CarrierContracts.tsx | breadcrumb | Admin | Contracting requests (retired intake, history) | PH | same file |
| `/dashboard/contracting/history` | pages/CarrierContracts.tsx | "Earlier records" | Admin | Intake history | PH | same file |
| `/dashboard/import` | pages/admin/XcelImport.tsx | Owner › Import [adminOnly] | Admin+Mgr+VAM | Import XCEL CSV | PH | 3 (3) |
| `/dashboard/admin` | pages/DashboardCommandCenter.tsx | Mobile only: admin "Admin" | Admin | The old admin hub; nine old URLs redirect here | PH | 8 (41) |

## 8 · Settings and account (area 09)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/dashboard/settings` | pages/Settings.tsx | Settings tab bar "Account"; Mobile recruiter "Settings" | Shell | Account settings; also `?tab=integrations`, `?tab=automation` | PH | 15 (15) |
| `/dashboard/settings/agency` | pages/Settings.tsx | Settings › Agency settings [adminOnly] | Admin | Agency settings | PH | same file |
| `/dashboard/settings/notifications` | pages/Settings.tsx | Settings › Notifications | Shell | Notification settings | PH | same file |
| `/dashboard/settings/security` | pages/Settings.tsx | Settings › Security | Shell | Security settings | PH | same file |
| `/dashboard/settings/billing` | pages/Settings.tsx | Settings › Billing [adminOnly] | Admin | Billing | PH | same file |
| `/dashboard/settings/nova-pro` | pages/Settings.tsx | Settings › Nova Pro | Shell | "AI assistant" (tab labelled "Assistant") | PH | same file |
| `/dashboard/help` | pages/HelpCenter.tsx | Settings › Support desk (`?tab=desk`); applicant rail; top bar | PR | Help center: FAQ plus a tracked support desk | PH | 1 (1) |
| `/dashboard/profile` | pages/ProducerProfile.tsx | Producer Profile [P]; Mobile agent "Profile" | PR | Producer profile: contact info, bio, licence stats | PH | 21 (21) |
| `/dashboard/notifications/mine` | pages/MyNotifications.tsx | not in nav | PR | My notifications | PH | 1 (1) |
| `/dashboard/calling-cards` | pages/CallingCards.tsx | not in nav | PR | Digital business card | PH | 4 (4) |
| `/dashboard/landing-page` | pages/MyLandingPage.tsx | not in nav | PR | Personal public page | PH | 4 (4) |
| `/dashboard/contracting-profile` | pages/ContractingProfile.tsx | not in nav (from the contracting email) | PR | Complete your contracting profile: 5 fields | LEGACY | 12 (12) |

## 9 · Public and applicant-facing (area 02)

| Route | Page file | Sidebar | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|---|
| `/` | pages/Index.tsx | logo link | Public (outside QueryShell) | Recruiting landing: hero, earnings, career path, benefits, call to action | LEGACY | 0 (0) |
| `/careers/:state` | pages/StateCareerLanding.tsx | — | Public | Careers page per state (Google for Jobs) | LEGACY | 3 (3) |
| `/apply` | pages/Apply.tsx | — | Public | Agent application form | LEGACY | 11 (11) |
| `/apply/success` | pages/ApplySuccess.tsx | — | Public | Generic confirmation | LEGACY | 0 (0) |
| `/apply/success/licensed` | pages/ApplySuccessLicensed.tsx | — | Public | Confirmation plus "Schedule your call" | LEGACY | 0 (0) |
| `/apply/success/unlicensed` | pages/ApplySuccessUnlicensed.tsx | — | Public | Confirmation plus how to get licensed | LEGACY | 0 (0) |
| `/unlicensed-overview` | pages/UnlicensedOverview.tsx | — | Public | Licensing video first | LEGACY | 0 (0) |
| `/status/:applicationId` | pages/ApplicationStatus.tsx | — | Public·token | Applicant status: next step, report progress | LEGACY | 0 (0) |
| `/vsl` | pages/Vsl.tsx | — | Public | Recruiting video page | LEGACY | 0 (0) |
| `/get-licensed` | pages/GetLicensed.tsx | applicant rail; Mobile applicant | Public | How to get your life insurance licence | LEGACY | 0 (0) |
| `/resources/licensing` | pages/ResourcesLicensing.tsx | — | Public | Copy of the resources library | LEGACY | 0 (0) |
| `/training` | pages/TrainingIndex.tsx | — | Public | Training landing for licensed agents | LEGACY | 0 (0) |
| `/login` | pages/Login.tsx | — | Public | Sign in | LEGACY | 8 (8) |
| `/reset-password` | pages/ResetPassword.tsx | — | Public | Password-reset landing | LEGACY | 2 (2) |
| `/signup` | pages/Signup.tsx | — | Public·token | Manager signup | LEGACY | 4 (4) |
| `/join` | pages/Join.tsx | — | Public | One link that signs in or creates the account | LEGACY | 2 (2) |
| `/hire/:token` | pages/HireLink.tsx | — | Public·token | Magic hire link (MP-233) | LEGACY | 4 (4) |
| `/join/:token` | pages/JoinLink.tsx | — | Public·token | Prospect join link (MP-234) | LEGACY | 5 (5) |
| `/agent-signup` | pages/AgentSignup.tsx | — | Public (needs `?ref=`) | Join the team: creates a new agent row | LEGACY | 4 (4) |
| `/claim` | pages/ClaimAccount.tsx | — | Public | Match your existing record and attach a login | LEGACY | 6 (6) |
| `/agent-login` | pages/AgentNumbersLogin.tsx | — | Public | Agent login for Daily Numbers | LEGACY | 7 (7) |
| `/agent/:userId` | pages/PublicAgentLanding.tsx | — | Public | An agent's public landing page | LEGACY | 0 (0) |
| `/magic-login` | pages/MagicLogin.tsx | — | Public·token | Secure login link | LEGACY | 6 (6) |
| `/schedule-call` | pages/ScheduleCall.tsx | — | Public | Calendly booking; unlicensed visitors blocked | LEGACY | 9 (9) |
| `/assistant/interviews` | pages/AssistantInterviewForm.tsx | — | Public·token | Interview intake for Sam's assistant | PH | 10 (14) |
| `/pending-approval` | pages/PendingApproval.tsx | — | Public | Account pending approval | LEGACY | 1 (1) |
| `/privacy` | pages/Privacy.tsx | — | Public | Privacy policy | LEGACY | 0 (0) |
| `/terms` | pages/Terms.tsx | — | Public | Terms of service | LEGACY | 0 (0) |
| `/disclosures` | pages/Disclosures.tsx | — | Public | Disclosures | LEGACY | 0 (0) |
| `/install` | pages/Install.tsx | Settings › Install app | Public | Install the OS as an app | LEGACY | 4 (4) |
| `/links` | pages/LinksPage.tsx | — | Public | Sam's link-in-bio page | LEGACY | 4 (4) |
| `/leads` | pages/LeadsLanding.tsx | — | Public | Sales page for leads and the dialer | LEGACY | 4 (4) |
| `/contact` | pages/Contact.tsx | — | Public | Contact page | LEGACY | 1 (1) |
| `/storefront` | pages/Storefront.tsx | — | Public | Return page after a Stripe Payment Link purchase | LEGACY | 5 (5) |
| `/data-deletion` | pages/DataDeletion.tsx | — | Public | Data-deletion request (required by Meta) | LEGACY | 2 (2) |
| `/checkin` | pages/ApplicantCheckin.tsx | — | Public·token (`?id=`) | Daily licensing check-in | LEGACY | 2 (2) |
| `/agent-flow` | pages/AgentFlow.tsx | — | Public | Agent onboarding flow | LEGACY | 0 (0) |
| `/plaque/:slug` | pages/PlaqueShare.tsx | — | Public | Public plaque page | LEGACY | 6 (6) |
| `/share/:token` | pages/SharePage.tsx | — | Public·token | Shared clips for an editor | LEGACY | 2 (2) |
| `/privacy-policy` | pages/PrivacyPolicy.tsx | — | **Shell (sign-in required)** | Second privacy policy; `/privacy` is the public one | LEGACY | 0 (0) |
| `/terms-of-service` | pages/TermsOfService.tsx | — | **Shell (sign-in required)** | Second terms page; `/terms` is the public one | LEGACY | 0 (0) |
| `*` | pages/NotFound.tsx | — | Public (outside QueryShell) | 404 | LEGACY | 0 (0) |

## 10 · Admin-only tools with no nav home (area 08 triage; all `requireAdmin`)

| Route | Page file | Who can see it | Purpose | Pattern | Controls |
|---|---|---|---|---|---|
| `/apex-daily-numbers` | pages/LogNumbers.tsx | Admin, outside the shell | Enter production for any agent | LEGACY | 5 (5) |
| `/awards` | pages/AwardGraphics.tsx | Admin, outside the shell | Award graphics for Instagram | PH | 16 (24) |
| `/dashboard/recruiting-links` | pages/RecruitingLinks.tsx | Admin | Application link under any manager | PH | 5 (5) |
| `/dashboard/apex-control` | pages/ApexControl.tsx | Admin | Galaxy Control | PH | 1 (1) |
| `/dashboard/agencies` | pages/Agencies.tsx | Admin | Agencies under you | PH | 1 (1) |
| `/dashboard/builders`, `/dashboard/builders/:builderId`, `/dashboard/agency-owners` | pages/BuildersDashboard.tsx | Admin | Builder ranking, licensing pressure, downline (three modes) | PH | 9 (13) |
| `/admin/agent-duplicates` | pages/admin/AgentDuplicates.tsx | Admin | Merge duplicate agent rows | PH | 1 (1) |
| `/dashboard/accounts` | pages/DashboardAccounts.tsx | Admin | Accounts | PH | 12 (28) |
| `/dashboard/offers` | pages/OffersPage.tsx | Admin | The live Stripe products | PH | 0 (0) |
| `/dashboard/xcel-pipeline` | pages/XcelPipeline.tsx | Admin | Paid pre-licensing students | PH | 4 (4) |
| `/dashboard/settings/deleted-leads` | pages/DeletedLeadsVault.tsx | Admin | Deleted leads vault | LEGACY | 6 (12) |
| `/admin/next-step/stuck` | pages/AdminStuckPool.tsx | Admin | Everyone past their stage deadline | LEGACY | 2 (2) |
| `/admin/next-step/funnel-health` | pages/AdminFunnelHealth.tsx | Admin | Next-step funnel health | LEGACY | 0 (0) |
| `/admin/email-gaps` | pages/AdminEmailGaps.tsx | Admin | Licensed agents who never got the course email | PH | 2 (2) |
| `/admin/policy-leads` | pages/AdminPolicyLeads.tsx | Admin | Policy Help Center consumer leads | LEGACY | 1 (1) |
| `/admin/missing-al-link` | pages/AdminMissingAlLink.tsx | Admin | Missing AgentLink links | PH | 1 (1) |
| `/admin/producer-trends` | pages/AdminProducerTrends.tsx | Admin | Producer trends | PH | 10 (24) |
| `/dashboard/my-inbox` | pages/SamInbox.tsx | Admin | Sam's applicant inbox | PH | 3 (3) |
| `/dashboard/social` | pages/SocialDashboard.tsx | Admin | Social analytics | PH | 3 (6) |
| `/dashboard/whales` | pages/WhaleRecruiting.tsx | Admin | Whale recruiting | PH | 2 (2) |
| `/dashboard/notifications` | pages/NotificationHub.tsx | Admin | Every push, SMS and email sent | LEGACY | 20 (59) |
| `/dashboard/planner` | pages/AdminCalendar.tsx | Admin | Day planner | PH | 25 (44) |
| `/dashboard/inbox` | pages/InboxPage.tsx | Admin | Every reply in one stream | PH | 17 (36) |
| `/dashboard/automation` | pages/AutomationHub.tsx | Admin | Automation hub | PH | 2 (2) |
| `/bot-token` | pages/BotToken.tsx | Admin | Bot SQL token: copy or rotate | LEGACY | 3 (3) |
| `/dashboard/agentlink-sync` | pages/AgentLinkSync.tsx | Admin | AgentLink history sync | PH | 3 (3) |
| `/dashboard/agentlink-vault` | pages/AgentLinkVault.tsx | Admin | AgentLink vault | PH | 6 (19) |
| `/dashboard/setup` | pages/admin/Setup.tsx | Admin | System setup health checks | PH | 1 (1) |
| `/dashboard/automation-health` | pages/AutomationHealth.tsx | Admin | Scheduled jobs health | PH | 4 (9) |
| `/dashboard/instagram-automation` | pages/InstagramAutomation.tsx | Admin | Agent content subscriptions | LEGACY | 2 (2) |
| `/dashboard/admin/board-access` | pages/AdminBoardAccess.tsx | Admin | Manager board access | LEGACY | 1 (1) |
| `/dashboard/agent-management` | pages/AgentManagement.tsx | Admin | Agent management | PH | 23 (40) |
| `/dashboard/system-health` | pages/SystemHealth.tsx | Admin | System health | PH | 1 (1) |
| `/dashboard/hiring-routing` | pages/HiringManagerAssignments.tsx | Admin | Hiring manager routing | PH | 11 (19) |
| `/dashboard/email-log` | pages/EmailDeliveryLog.tsx | Admin | Email delivery log | PH | 4 (9) |
| `/dashboard/comp-tiers` | pages/admin/CompTiersSettings.tsx | Admin | Contract and override % per agent | LEGACY | 4 (4) |
| `/dashboard/integrations` | pages/admin/IntegrationsSettings.tsx | Admin | Discord, Realtime integrations | LEGACY | 11 (11) |
| `/admin/contentwheel` | pages/ContentWheel.tsx | Admin | ContentWheel content system | PH | 0 (0) |
| `/dashboard/admin/content-command` | pages/admin/ContentCommand.tsx | Admin | Content command | PH | 20 (36) |
| `/dashboard/strikes` | pages/AdminStrikes.tsx | Admin | Agent strikes | PH | 19 (51) |
| `/dashboard/lead-payments` | pages/LeadPayments.tsx | Admin | Venmo lead payments log | PH | 13 (39) |
| `/dashboard/readymode` | pages/ReadyModeIntegration.tsx | Admin | ReadyMode sync | PH | 10 (21) |
| `/dashboard/admin/social-media-bot` | pages/admin/SocialMediaBot.tsx | Admin | Social media bot | PH | 20 (37) |
| `/dashboard/admin/telegram-bot` | pages/admin/TelegramBot.tsx | Admin | Telegram bot | PH | 9 (34) |
| `/dashboard/admin/sam` | pages/admin/SamHQ.tsx | Admin | Sam HQ | PH | 7 (7) |
| `/dashboard/sam-todo` | pages/SamTodo.tsx | Admin | Sam todo | PH | 1 (1) |
| `/dashboard/admin/unclaimed` | pages/admin/UnclaimedLeads.tsx | Admin | Unclaimed leads | PH | 5 (12) |
| `/dashboard/admin/commission-recovery` | pages/admin/CommissionRecovery.tsx | Admin | Commission recovery | PH | 2 (2) |

## 11 · Redirects and aliases (not screens; a redesign of the canonical route covers them)

**Redirects (51).** `/r/:code` → `/apply?ref=:code` (`components/RecruitingShortLink.tsx`). Fifty
`LegacyWorkspaceRedirect`s, none chaining to another redirect; three land on aliases
(`/dashboard/book-of-business` twice, `/dashboard/clients` once). Most-used targets: `/dashboard/admin`
(9: `/admin/recruiting-inbox`, `/dashboard/command`, `/dashboard/leads`, `/dashboard/inbound-leads`,
`/dashboard/inbound`, `/dashboard/headhunters-calendar`, `/dashboard/recruiting-funnels`,
`/dashboard/recruiting-tracker`, `/dashboard/team-analytics`), `/dashboard/team` (7), `/dashboard/contracting`
(4), `/dashboard/recruiting` (4: `/dashboard/applicants`, `/dashboard/interview-recovery`, `/dashboard/recruit`,
`/recruit`), then `/dashboard/training/library` (2), `/dashboard/training/sales-course` (2), and one each:
`/start-contracting` → `/dashboard/contracting-profile`, `/seminar` → `/apply`, `/log-numbers` →
`/apex-daily-numbers`, `/dashboard/content` → `/dashboard/launch-board?tab=queue`, `/dashboard/contracting/contracts`
→ `…/documents`, `/dashboard/contracting/ethos` and `/cases` → `/dashboard/team?view=contracting`,
`/course-progress` → `/dashboard/training/progress`, `/course-progress/content` → `…/content`,
`/admin/apex-toolkit` → `/dashboard/training`, `/dashboard/interviews` → `/dashboard/calendar`,
`/dashboard/business-analytics` → `/dashboard/analytics`, `/dashboard/announcements` → `/dashboard/community`,
`/today` → `/dashboard/today`, `/dashboard/agent-link-sync` → `/dashboard/agentlink-sync`, `/dashboard/conduct`
→ `/dashboard/strikes`, `/dashboard/admin/book-quality` → `/dashboard/book-quality`, `/dashboard/charges-audit`
and `/dashboard/admin/charges-audit` → `/dashboard`.

**Aliases (36).** None of the 32 page files involved reads the URL path, so each alias renders exactly
what its canonical route renders: `/activate` (= `/claim`), `/get-leads` and `/dialer` (= `/leads`),
`/delete-my-data`, `/daily-checkin`, `/dashboard/recruiting/hires` (= Call list), the eight
`/dashboard/recruiting/training/*` mounts (= `/dashboard/training/*`), `/dashboard/training-hub/course/:courseId`,
`/dashboard/annuity-training`, `/dashboard/book-of-business` (= Retention), `/dashboard/my-deals`,
`/admin/xcel-import`, `/dashboard/nova` (= Help), `/dashboard/legacy` (= `/dashboard/admin`),
`/dashboard/producer-trends`, `/dashboard/seminar-control`, `/agent-dashboard`, `/recruit-pipeline`,
`/agent-pipeline` and `/dashboard/clients` (= My Pipeline), `/hall-of-fame`, `/dashboard/bot-token`,
`/dashboard/instagram-inbox`, `/team-chat`, `/bulk-deals`, `/agentlink-sync`, `/setup`, `/dashboard/agent/:id`,
`/leaderboard`, `/rewards`. **One alias has a looser guard than its canonical route:**
`/dashboard/instagram-inbox` is `PR` while `/dashboard/inbox/instagram` is Admin+Mgr.

**Page files used by more than one route** that are distinct screens: `Settings` (6 tabs),
`CarrierContracts` (5 views), `BuildersDashboard` (3 modes), `OldApplicants` (2 kinds).
**Shared components:** `AgentCommandDashboard` also renders inside `/dashboard` for agents;
`ContractingReviewWorkspace` serves both `/dashboard/contracting` and `/dashboard/team?view=contracting`.

## The 15 most control-heavy page files

DashboardApplicants 42 (80, mostly the classic view) · LaunchBoard 42 (57) · ClientPipeline 32 (57) ·
CalendarPage 30 (34) · Interviews 30 (36) · DashboardAgedLeads 29 (63) · InterviewRecovery 29 (29) ·
BookOfBusiness 27 (62) · AdminCalendar 25 (44) · AgentManagement 23 (40) · AgentCommandDashboard 22 (31) ·
RecruiterDashboard 22 (22) · ProducerProfile 21 (21) · NotificationHub 20 (59) · ContentCommand 20 (36) ·
SocialMediaBot 20 (37). Next: AdminStrikes 19 (51), DashboardCommandCenter 8 (41), UnlicensedAll 18 (41),
LeadPayments 13 (39).

## Findings the area prompts carry

1. **Only one screen meets the contract skeleton** (the Call list). Three more have a scoreboard and a
   header but no declared primary action (Pipeline, New hires, the role homes). Headers that declare
   `primaryAction` at all: RecruitingWorklist, CalendarPage, MyDeals, Announcements, VaManagerPortal.
2. **Recruiting is spread over about thirty screens.** Beside the Call list, Pipeline and New hires there
   are twenty-two recruiting pages with no nav home (group 3), plus the recruit dialer filed under Sell as
   Call Center. Each is a place a recruit can sit unseen. Area 03 consolidates them into Call list queues
   with parity proofs and redirects.
3. **Fifty admin-only tools have no nav home** (group 10). Area 08 triages every one: keep (meets the
   contract), fold (becomes a view or a fold of a kept page), or redirect.
4. **Sidebar and route guards disagree.** Reports and Import are admin-only in the sidebar but their
   routes admit managers (Import also VA managers). Launch Board is admin-only in the sidebar but anyone on
   its invite list can open it. The four `sold_calls` grant items are routed Admin+Mgr (the data is checked
   server-side). `/dashboard/instagram-inbox` (alias) is open to any signed-in user while the canonical
   route is Admin+Mgr. Four pages have no route guard and restrict themselves in code: `/dashboard/aged-leads`,
   `/dashboard/recruiter`, `/dashboard/prelicensing`, `/dashboard/inactive-agents`. Analysis H4 decides;
   area 01 applies.
5. **Names that do not match what they open.** Sidebar "Retention" opens a page titled "Book of Business"
   (and has no retention view); sidebar "Book of Business" opens MyDeals ("My Deals" / "Team Production");
   "Nova Pro" opens a tab labelled "AI assistant"; Call Center sits under Sell but is the recruiting dialer;
   two pages are titled "My Pipeline" (ClientPipeline for clients, AgentPipeline for recruits).
6. **Legal pages behind sign-in.** `/privacy-policy` and `/terms-of-service` sit inside the signed-in
   shell; `/privacy` and `/terms` are the public ones. Area 02 redirects the shell pair to the public pair.
7. **Six ways to sign in or join**: `/login`, `/join`, `/join/:token`, `/claim` (`/activate`),
   `/magic-login`, `/agent-login`, plus `/signup` and `/agent-signup`. Area 02 maps which are live paths and
   folds the rest, with analysis H9's measurements.
8. **Orphans.** `pages/ContentLibrary.tsx` and `pages/OnboardingCourse.tsx` are imported by nothing. Three
   lazy imports with no file (`LeadCenter`, `ChargesAudit`, `ConductCommandCenter`) are commented out and
   their routes redirect.
9. **Training is mounted twice** (`/dashboard/training/*` and `/dashboard/recruiting/training/*`); area 07
   picks the canonical path.
