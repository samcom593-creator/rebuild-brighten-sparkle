# Galaxy page redesign implementation guide

**Source basis:** original local baseline `4e52c06771d3edfcfcb4271c30953f91524f2599`; current checkout `1ce4886a21dcab00ac72f2d2f55772fdd4f1dab7` plus the current local private-recording playback changes. Source hashes in `coverage.json` pin the inspected files. This is a source-backed implementation guide, not a claim that every live page was visited or that the local changes are deployed.

## Start here

1. Read [Shared design, data and validation contract](00-shared-contract.md).
2. Find a route in the exhaustive table below. Open its domain prompt or exact alias prompt.
3. Execute one page or one proven consolidation at a time. Keep current queries, role scope, actions and evidence semantics.
4. Report actual edits and focused validation. Do not mark proposed work complete or publish this technical guide without the required expanded publication approval.

## Coverage

- **304 registered routes**, with **82 aliases** and **222 implementation route variants**.
- **198 real implementation prompts**, each with a source-specific React/TypeScript sample; shared route variants are explicitly listed in the page section.
- Every alias has its own destination-specific prompt and preserving redirect sample.
- All routed source files were parsed/scanned for imports, views/functions, actions, route modes and render structure. High-risk auth, finance, task, award, recruiting, recording and consolidation seams were inspected directly. Static source review does not prove every backing RLS policy or provider interaction.

## Domain guides

- [Public recruiting, account entry and applicant journeys](01-public-and-applicant.md)
- [Production, finance and daily work](02-production-finance-and-daily-work.md)
- [Recognition and community](03-recognition-and-community.md)
- [Recruiting and licensing operations](04-recruiting-and-licensing.md)
- [Training and enablement](05-training-and-enablement.md)
- [Team and contracting](06-team-and-contracting.md)
- [Owner systems, content and integrations](07-owner-content-and-integrations.md)
- [Clients, leads and calling](08-clients-leads-and-calling.md)
- [Settings, support and messages](09-settings-support-and-messages.md)
- [Compatibility and internal redirect prompts](10-aliases-and-redirects.md)

## Completed locally versus proposed

The committed baseline already contains canonical Finances, Training and Settings discovery; private owner gates and personal tasks; account cache isolation; typed award facts; secure copy fallbacks; and the licensed/unlicensed media correction. The current local release additionally contains the authenticated workspace style pass, finance and contracting content changes, 15 direct aliases, the old Rewards page folded into source-filtered MyPlaques, and private recording playback recovery with three caller-authorized exact-ID signers. Confirm current diffs and the coordinator’s release receipt before describing any of those as live.

The recording changes do not certify live media availability. MyLeads still has a provider URL without a stable internal call ID, and two field-course source clips are explicitly silent. The shared contract and affected page prompts retain those limitations.

Conditional future work remains labeled in each prompt: recruiting boards with distinct actions/roles, licensing-student versus provider-progress models, legacy agent dashboards, content operations, message-sender consolidation, and profile/share tools. Similar names or a missing sidebar shortcut are not proof of safe deletion.

## Every registered route

| Exact route | Access in source | Decision / destination | Prompt and code |
|---|---|---|---|
| `/` | public | Keep | [Index](01-public-and-applicant.md#page-index) |
| `/careers` | public | Keep | [CareersIndex](01-public-and-applicant.md#page-careers-index) |
| `/careers/:state` | public | Keep | [StateCareerLanding](01-public-and-applicant.md#page-state-career-landing) |
| `/apply` | public | Keep | [Apply](01-public-and-applicant.md#page-apply) |
| `/share/:token` | intended token/link recipient | Internal | [SharePage](01-public-and-applicant.md#page-share-page) |
| `/start-contracting` | public | Alias → /dashboard/contracting-profile | [Redirect prompt](10-aliases-and-redirects.md#alias-2e9aa8cd06f3) |
| `/apply/success` | public | Internal | [ApplySuccess](01-public-and-applicant.md#page-apply-success) |
| `/apply/success/licensed` | public | Internal | [ApplySuccessLicensed](01-public-and-applicant.md#page-apply-success-licensed) |
| `/apply/success/unlicensed` | public | Internal | [ApplySuccessUnlicensed](01-public-and-applicant.md#page-apply-success-unlicensed) |
| `/unlicensed-overview` | public | Keep | [UnlicensedOverview](01-public-and-applicant.md#page-unlicensed-overview) |
| `/status/:applicationId` | public | Keep | [ApplicationStatus](01-public-and-applicant.md#page-application-status) |
| `/vsl` | public | Keep | [Vsl](01-public-and-applicant.md#page-vsl) |
| `/get-licensed` | public | Keep | [GetLicensed](01-public-and-applicant.md#page-get-licensed) |
| `/resources/licensing` | public | Keep | [ResourcesLicensing](01-public-and-applicant.md#page-resources-licensing) |
| `/training` | public | Consolidate conditionally: public orientation remains until guest-resource parity is proven | [TrainingIndex](01-public-and-applicant.md#page-training-index) |
| `/login` | public | Keep | [Login](01-public-and-applicant.md#page-login) |
| `/reset-password` | public | Keep | [ResetPassword](01-public-and-applicant.md#page-reset-password) |
| `/signup` | public | Keep | [Signup](01-public-and-applicant.md#page-signup) |
| `/join` | public | Keep | [Join](01-public-and-applicant.md#page-join) |
| `/hire/:token` | intended token/link recipient | Internal | [HireLink](01-public-and-applicant.md#page-hire-link) |
| `/join/:token` | intended token/link recipient | Internal | [JoinLink](01-public-and-applicant.md#page-join-link) |
| `/contract/:slug` | intended token/link recipient | Internal | [ContractJoin](01-public-and-applicant.md#page-contract-join) |
| `/agent-signup` | public | Internal | [AgentSignup](01-public-and-applicant.md#page-agent-signup) |
| `/unsubscribe` | public | Internal | [Unsubscribe](01-public-and-applicant.md#page-unsubscribe) |
| `/claim` | public | Internal | [ClaimAccount](01-public-and-applicant.md#page-claim-account) |
| `/activate` | public | Consolidate | [ClaimAccount](01-public-and-applicant.md#page-claim-account) |
| `/agent-login` | public | Keep | [AgentNumbersLogin](01-public-and-applicant.md#page-agent-numbers-login) |
| `/agent/:userId` | public | Keep | [PublicAgentLanding](01-public-and-applicant.md#page-public-agent-landing) |
| `/magic-login` | public | Internal | [MagicLogin](01-public-and-applicant.md#page-magic-login) |
| `/schedule-call` | public | Keep | [ScheduleCall](01-public-and-applicant.md#page-schedule-call) |
| `/assistant/interviews` | intended token/link recipient | Internal | [AssistantInterviewForm](01-public-and-applicant.md#page-assistant-interview-form) |
| `/pending-approval` | public | Internal | [PendingApproval](01-public-and-applicant.md#page-pending-approval) |
| `/privacy` | public | Keep | [Privacy](01-public-and-applicant.md#page-privacy) |
| `/privacy-policy` | public | Alias → /privacy | [Redirect prompt](10-aliases-and-redirects.md#alias-39ce28de9b50) |
| `/terms` | public | Keep | [Terms](01-public-and-applicant.md#page-terms) |
| `/terms-of-service` | public | Alias → /terms | [Redirect prompt](10-aliases-and-redirects.md#alias-ad5beb9b14d3) |
| `/disclosures` | public | Keep | [Disclosures](01-public-and-applicant.md#page-disclosures) |
| `/install` | public | Keep | [Install](01-public-and-applicant.md#page-install) |
| `/apex-daily-numbers` | admin | Internal | [LogNumbers](02-production-finance-and-daily-work.md#page-log-numbers) |
| `/links` | public | Keep | [LinksPage](01-public-and-applicant.md#page-links-page) |
| `/seminar` | public | Alias → /apply | [Redirect prompt](10-aliases-and-redirects.md#alias-bbdb425633f5) |
| `/leads` | public | Keep | [LeadsLanding](01-public-and-applicant.md#page-leads-landing) |
| `/contact` | public | Keep | [Contact](01-public-and-applicant.md#page-contact) |
| `/storefront` | public | Keep | [Storefront](01-public-and-applicant.md#page-storefront) |
| `/get-leads` | public | Consolidate | [LeadsLanding](01-public-and-applicant.md#page-leads-landing) |
| `/dialer` | public | Consolidate | [LeadsLanding](01-public-and-applicant.md#page-leads-landing) |
| `/data-deletion` | public | Keep | [DataDeletion](01-public-and-applicant.md#page-data-deletion) |
| `/delete-my-data` | public | Consolidate | [DataDeletion](01-public-and-applicant.md#page-data-deletion) |
| `/checkin` | public | Keep | [ApplicantCheckin](01-public-and-applicant.md#page-applicant-checkin) |
| `/daily-checkin` | public | Consolidate | [ApplicantCheckin](01-public-and-applicant.md#page-applicant-checkin) |
| `/agent-flow` | public | Consolidate conditionally into orientation; do not replace live status | [AgentFlow](01-public-and-applicant.md#page-agent-flow) |
| `/awards` | admin | Keep | [WinPostStudio](03-recognition-and-community.md#page-win-post-studio) |
| `/awards/legacy` | admin | Legacy | [AwardGraphics](03-recognition-and-community.md#page-award-graphics) |
| `/plaque/:slug` | public | Keep | [PlaqueShare](03-recognition-and-community.md#page-plaque-share) |
| `/r/:code` | public | Internal | [RecruitingShortLink](01-public-and-applicant.md#page-recruiting-short-link) |
| `/dashboard` | authenticated | Keep | [Dashboard](02-production-finance-and-daily-work.md#page-dashboard) |
| `/dashboard/recruiting` | admin / manager / va_manager / va / recruiter | Keep | [DashboardApplicants](04-recruiting-and-licensing.md#page-dashboard-applicants) |
| `/dashboard/recruiting/pipeline` | admin / manager / va_manager / va / recruiter | Keep | [RecruitingPipeline](04-recruiting-and-licensing.md#page-recruiting-pipeline) |
| `/dashboard/recruiting/licensed` | admin / va_manager / va | Keep | [LicensedInbox](04-recruiting-and-licensing.md#page-licensed-inbox) |
| `/dashboard/recruiting/interviews` | admin / manager / va_manager / va / recruiter | Keep | [Interviews](04-recruiting-and-licensing.md#page-interviews) |
| `/dashboard/recruiting/follow-ups` | admin / manager / va_manager / va / recruiter | Consolidate conditionally under Interviews; preserve recovery actions | [InterviewRecovery](04-recruiting-and-licensing.md#page-interview-recovery) |
| `/dashboard/recruiting/hires` | admin / manager / va_manager / va / recruiter | Improve | [DashboardApplicants](04-recruiting-and-licensing.md#page-dashboard-applicants) |
| `/dashboard/recruiting/training` | authenticated | Alias → /dashboard/training | [Redirect prompt](10-aliases-and-redirects.md#alias-92352778cfb3) |
| `/dashboard/recruiting/training/library` | authenticated | Alias → /dashboard/training/library | [Redirect prompt](10-aliases-and-redirects.md#alias-590ed03b8928) |
| `/dashboard/recruiting/training/library/course/:courseId` | authenticated | Alias → /dashboard/training/library/course/:courseId | [Redirect prompt](10-aliases-and-redirects.md#alias-b2f5a3efc57f) |
| `/dashboard/recruiting/training/sales-course` | authenticated | Alias → /dashboard/training/sales-course | [Redirect prompt](10-aliases-and-redirects.md#alias-7fa04b64acb6) |
| `/dashboard/recruiting/training/progress` | authenticated | Alias → /dashboard/training/progress | [Redirect prompt](10-aliases-and-redirects.md#alias-d6676c6342e6) |
| `/dashboard/recruiting/training/content` | authenticated | Alias → /dashboard/training/content | [Redirect prompt](10-aliases-and-redirects.md#alias-65bf947ffe2c) |
| `/dashboard/recruiting/training/annuities` | authenticated | Alias → /dashboard/training/annuities | [Redirect prompt](10-aliases-and-redirects.md#alias-5d440452a2f5) |
| `/dashboard/training` | authenticated | Keep | [ApexTrainingEntry](05-training-and-enablement.md#page-apex-training-entry) |
| `/dashboard/training/library` | authenticated | Keep | [TrainingHub](05-training-and-enablement.md#page-training-hub) |
| `/dashboard/training/library/course/:courseId` | authenticated | Keep | [TrainingHubCourse](05-training-and-enablement.md#page-training-hub-course) |
| `/dashboard/training/sales-course` | authenticated | Keep | [CourseCatalog](05-training-and-enablement.md#page-course-catalog) |
| `/dashboard/training/progress` | admin / manager / va_manager / va / recruiter | Keep | [CourseProgress](05-training-and-enablement.md#page-course-progress) |
| `/dashboard/training/content` | admin / manager / va_manager / va / recruiter | Internal | [CourseContent](05-training-and-enablement.md#page-course-content) |
| `/dashboard/training/annuities` | authenticated | Keep | [AnnuityTraining](05-training-and-enablement.md#page-annuity-training) |
| `/dashboard/team` | authenticated | Keep | [DashboardCRM](06-team-and-contracting.md#page-dashboard-c-r-m) |
| `/dashboard/ethos-call-sheet` | authenticated | Keep | [EthosCallSheet](06-team-and-contracting.md#page-ethos-call-sheet) |
| `/dashboard/carrier-command` | owner verified by server | Keep | [CarrierCommand](07-owner-content-and-integrations.md#page-carrier-command) |
| `/dashboard/recruiting-links` | admin | Keep | [RecruitingLinks](04-recruiting-and-licensing.md#page-recruiting-links) |
| `/dashboard/content` | authenticated | Alias → /dashboard/launch-board?tab=queue | [Redirect prompt](10-aliases-and-redirects.md#alias-e8fa49830a11) |
| `/dashboard/call-lab` | authenticated | Keep | [CallLab](05-training-and-enablement.md#page-call-lab) |
| `/dashboard/call-lab/live/:id` | authenticated | Keep | [CallLabLive](05-training-and-enablement.md#page-call-lab-live) |
| `/dashboard/call-lab/report/:id` | authenticated | Keep | [CallLabReport](05-training-and-enablement.md#page-call-lab-report) |
| `/dashboard/contracting` | admin | Keep | [CarrierContracts](06-team-and-contracting.md#page-carrier-contracts) |
| `/dashboard/contracting-profile` | authenticated | Keep | [ContractingProfile](06-team-and-contracting.md#page-contracting-profile) |
| `/dashboard/grow` | authenticated | Keep | [ContractingDownlines](06-team-and-contracting.md#page-contracting-downlines) |
| `/dashboard/contracting/downlines` | authenticated | Alias → /dashboard/grow | [Redirect prompt](10-aliases-and-redirects.md#alias-6ebb9a91a3c5) |
| `/dashboard/contracting/contracts` | authenticated | Alias → /dashboard/contracting/documents | [Redirect prompt](10-aliases-and-redirects.md#alias-306d2295851e) |
| `/dashboard/contracting/carriers` | admin | Keep | [CarrierContracts](06-team-and-contracting.md#page-carrier-contracts) |
| `/dashboard/contracting/ops` | authenticated | Alias → /dashboard/contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-8f3690dd7ad6) |
| `/dashboard/contracting/requests` | admin | Alias → /dashboard/contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-d69c24ab02ea) |
| `/dashboard/contracting/history` | admin | Keep | [CarrierContracts](06-team-and-contracting.md#page-carrier-contracts) |
| `/dashboard/contracting/documents` | admin | Keep | [CarrierContracts](06-team-and-contracting.md#page-carrier-contracts) |
| `/dashboard/contracting/audit` | authenticated | Alias → /dashboard/contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-bb26817bf57f) |
| `/dashboard/contracting/ethos` | authenticated | Alias → /dashboard/team?view=contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-9490a41c2d94) |
| `/dashboard/contracting/aflac` | authenticated | Alias → /dashboard/contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-19247cc81660) |
| `/dashboard/contracting/cases` | authenticated | Alias → /dashboard/team?view=contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-4893ddec07c4) |
| `/dashboard/retention` | admin / manager | Keep distinct retention workflow; consolidate discovery only after exact parity | [BookOfBusiness](08-clients-leads-and-calling.md#page-book-of-business) |
| `/dashboard/production` | authenticated | Keep | [MyDeals](02-production-finance-and-daily-work.md#page-my-deals) |
| `/dashboard/analytics` | real authenticated admin outside role preview; agency aggregates | Keep | [BusinessAnalytics](02-production-finance-and-daily-work.md#page-business-analytics) |
| `/dashboard/community` | authenticated | Keep | [Announcements](03-recognition-and-community.md#page-announcements) |
| `/dashboard/resources` | authenticated | Alias → /dashboard/training/library | [Redirect prompt](10-aliases-and-redirects.md#alias-eff3a4698bd4) |
| `/dashboard/import` | admin / manager / va_manager | Keep | [XcelImport](04-recruiting-and-licensing.md#page-xcel-import) |
| `/dashboard/nova` | authenticated | Consolidate duplicate discovery into Help while retaining support and query tabs | [HelpCenter](09-settings-support-and-messages.md#page-help-center) |
| `/dashboard/admin` | admin | Internal | [DashboardCommandCenter](07-owner-content-and-integrations.md#page-dashboard-command-center) |
| `/va-team` | admin / va_manager | Keep | [VaManagerPortal](06-team-and-contracting.md#page-va-manager-portal) |
| `/dashboard/apex-control` | admin | Internal | [ApexControl](07-owner-content-and-integrations.md#page-apex-control) |
| `/dashboard/launch-board` | owner verified by server | Keep | [LaunchBoard](07-owner-content-and-integrations.md#page-launch-board) |
| `/dashboard/money-inbox` | owner verified by server | Keep | [MoneyInbox](07-owner-content-and-integrations.md#page-money-inbox) |
| `/dashboard/agencies` | admin | Keep | [Agencies](02-production-finance-and-daily-work.md#page-agencies) |
| `/dashboard/builders` | admin | Keep | [BuildersDashboard](02-production-finance-and-daily-work.md#page-builders-dashboard) |
| `/dashboard/builders/:builderId` | admin | Keep | [BuildersDashboard](02-production-finance-and-daily-work.md#page-builders-dashboard) |
| `/dashboard/managers` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-f0d5dec164d9) |
| `/dashboard/billers` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-161a1a95a1b7) |
| `/dashboard/agency-owners` | admin | Keep | [BuildersDashboard](02-production-finance-and-daily-work.md#page-builders-dashboard) |
| `/dashboard/legacy` | admin | Consolidate | [DashboardCommandCenter](07-owner-content-and-integrations.md#page-dashboard-command-center) |
| `/dashboard/today` | authenticated | Improve | [DashboardToday](02-production-finance-and-daily-work.md#page-dashboard-today) |
| `/dashboard/applicants` | authenticated | Alias → /dashboard/recruiting | [Redirect prompt](10-aliases-and-redirects.md#alias-f7818e7fe79e) |
| `/admin/my-applicants` | admin / manager | Keep | [MyApplicants](04-recruiting-and-licensing.md#page-my-applicants) |
| `/admin/add-referral` | admin / manager | Keep | [AddReferral](04-recruiting-and-licensing.md#page-add-referral) |
| `/admin/invite-links` | admin / manager | Keep | [InviteLinksAdmin](04-recruiting-and-licensing.md#page-invite-links-admin) |
| `/admin/recruiting-inbox` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-582e6d52b9ae) |
| `/admin/agent-duplicates` | admin | Keep | [AgentDuplicates](06-team-and-contracting.md#page-agent-duplicates) |
| `/dashboard/stale-recovery` | admin / manager | Keep | [StaleRecovery](04-recruiting-and-licensing.md#page-stale-recovery) |
| `/dashboard/accounts` | admin | Keep | [DashboardAccounts](06-team-and-contracting.md#page-dashboard-accounts) |
| `/dashboard/offers` | admin | Internal | [OffersPage](07-owner-content-and-integrations.md#page-offers-page) |
| `/dashboard/xcel-pipeline` | admin | Consolidate conditionally into licensing workspace after provider-state parity | [XcelPipeline](04-recruiting-and-licensing.md#page-xcel-pipeline) |
| `/dashboard/settings` | authenticated | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/agency` | admin | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/notifications` | authenticated | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/security` | authenticated | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/billing` | admin | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/nova-pro` | authenticated | Keep | [Settings](09-settings-support-and-messages.md#page-settings) |
| `/dashboard/settings/deleted-leads` | admin | Keep | [DeletedLeadsVault](09-settings-support-and-messages.md#page-deleted-leads-vault) |
| `/dashboard/clients` | authenticated | Alias → /dashboard/agent-pipeline | [Redirect prompt](10-aliases-and-redirects.md#alias-16f85a28274b) |
| `/dashboard/crm` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-031482bf9375) |
| `/dashboard/aged-leads` | authenticated | Keep | [DashboardAgedLeads](08-clients-leads-and-calling.md#page-dashboard-aged-leads) |
| `/dashboard/command` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-659bcc282658) |
| `/dashboard/team/next-step` | admin / manager | Keep | [ManagerNextStepBoard](04-recruiting-and-licensing.md#page-manager-next-step-board) |
| `/dashboard/recruits` | admin / manager / va_manager / va | Keep | [RecruitPipeline](04-recruiting-and-licensing.md#page-recruit-pipeline) |
| `/admin/next-step/stuck` | admin | Internal | [AdminStuckPool](04-recruiting-and-licensing.md#page-admin-stuck-pool) |
| `/admin/next-step/funnel-health` | admin | Internal | [AdminFunnelHealth](04-recruiting-and-licensing.md#page-admin-funnel-health) |
| `/admin/recruit-funnel` | admin | Keep | [RecruitFunnel](04-recruiting-and-licensing.md#page-recruit-funnel) |
| `/admin/email-gaps` | admin | Internal | [AdminEmailGaps](04-recruiting-and-licensing.md#page-admin-email-gaps) |
| `/admin/policy-leads` | admin | Internal | [AdminPolicyLeads](04-recruiting-and-licensing.md#page-admin-policy-leads) |
| `/admin/missing-al-link` | admin | Internal | [AdminMissingAlLink](04-recruiting-and-licensing.md#page-admin-missing-al-link) |
| `/dashboard/onboarding-ladder` | admin / manager / va_manager / va | Keep | [OnboardingLadder](04-recruiting-and-licensing.md#page-onboarding-ladder) |
| `/admin/licensed-inbox` | authenticated | Alias → /dashboard/recruiting/licensed | [Redirect prompt](10-aliases-and-redirects.md#alias-a2d8164d8d71) |
| `/admin/apex-toolkit` | authenticated | Alias → /dashboard/training | [Redirect prompt](10-aliases-and-redirects.md#alias-edf14efbd269) |
| `/admin/recovery-queue` | admin / manager / va_manager / va | Keep | [RecoveryQueue](04-recruiting-and-licensing.md#page-recovery-queue) |
| `/admin/unlicensed-all` | admin / manager / va_manager / va | Keep | [UnlicensedAll](04-recruiting-and-licensing.md#page-unlicensed-all) |
| `/admin/xcel-import` | admin / manager / va_manager | Keep | [XcelImport](04-recruiting-and-licensing.md#page-xcel-import) |
| `/admin/producer-trends` | admin | Alias → /dashboard/producer-trends | [Redirect prompt](10-aliases-and-redirects.md#alias-194538945d3b) |
| `/dashboard/producer-trends` | admin | Keep | [AdminProducerTrends](02-production-finance-and-daily-work.md#page-admin-producer-trends) |
| `/admin/agentlink-backfill` | authenticated | Alias → /dashboard/book-of-business | [Redirect prompt](10-aliases-and-redirects.md#alias-c0e46c7278c0) |
| `/dashboard/clients/:clientId` | authenticated | Keep | [ClientDetail](08-clients-leads-and-calling.md#page-client-detail) |
| `/dashboard/seminar` | admin / manager / active_presenter | Consolidate | [SeminarControl](04-recruiting-and-licensing.md#page-seminar-control) |
| `/dashboard/seminar-control` | admin / manager / active_presenter | Alias → /dashboard/seminar | [Redirect prompt](10-aliases-and-redirects.md#alias-198414a73098) |
| `/dashboard/my-inbox` | real authenticated admin outside role preview; applicant triage | Consolidate conditionally under Recruiting after triage-action parity | [SamInbox](09-settings-support-and-messages.md#page-sam-inbox) |
| `/dashboard/referrals` | admin / manager | Keep | [ReferralPipeline](04-recruiting-and-licensing.md#page-referral-pipeline) |
| `/dashboard/referrals/mine` | authenticated | Keep | [MyReferrals](04-recruiting-and-licensing.md#page-my-referrals) |
| `/dashboard/referrals/new` | authenticated | Keep | [ReferralSubmit](04-recruiting-and-licensing.md#page-referral-submit) |
| `/dashboard/notifications/mine` | authenticated | Keep | [MyNotifications](09-settings-support-and-messages.md#page-my-notifications) |
| `/agent-portal` | authenticated | Improve; conditional consolidation only after role-branch parity | [AgentCommandDashboard](02-production-finance-and-daily-work.md#page-agent-command-dashboard) |
| `/agent-dashboard` | authenticated | Improve; conditional consolidation only after role-branch parity | [AgentCommandDashboard](02-production-finance-and-daily-work.md#page-agent-command-dashboard) |
| `/agent-portal/legacy` | authenticated | Legacy | [AgentPortal](02-production-finance-and-daily-work.md#page-agent-portal) |
| `/onboarding-course` | authenticated | Alias → /dashboard/training/sales-course | [Redirect prompt](10-aliases-and-redirects.md#alias-7198ca996f2a) |
| `/course-catalog` | authenticated | Alias → /dashboard/training/sales-course | [Redirect prompt](10-aliases-and-redirects.md#alias-253dc96b25d3) |
| `/dashboard/training-hub` | authenticated | Alias → /dashboard/training/library | [Redirect prompt](10-aliases-and-redirects.md#alias-ef0e66f91332) |
| `/dashboard/training-hub/course/:courseId` | authenticated | Alias → /dashboard/training/library/course/:courseId | [Redirect prompt](10-aliases-and-redirects.md#alias-74ced05e6203) |
| `/course-progress` | authenticated | Alias → /dashboard/training/progress | [Redirect prompt](10-aliases-and-redirects.md#alias-1eed0298a19d) |
| `/course-progress/content` | authenticated | Alias → /dashboard/training/content | [Redirect prompt](10-aliases-and-redirects.md#alias-6f2d4695bc25) |
| `/numbers` | authenticated | Keep | [Numbers](02-production-finance-and-daily-work.md#page-numbers) |
| `/purchase-leads` | authenticated | Keep | [PurchaseLeads](08-clients-leads-and-calling.md#page-purchase-leads) |
| `/dashboard/call-center` | authenticated | Keep | [CallCenter](08-clients-leads-and-calling.md#page-call-center) |
| `/dashboard/leads` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-84722035131a) |
| `/dashboard/social` | admin | Keep | [SocialDashboard](07-owner-content-and-integrations.md#page-social-dashboard) |
| `/dashboard/calls-today` | authenticated | Keep | [CallsTodayCockpit](08-clients-leads-and-calling.md#page-calls-today-cockpit) |
| `/dashboard/whales` | admin | Keep | [WhaleRecruiting](04-recruiting-and-licensing.md#page-whale-recruiting) |
| `/dashboard/contracts` | authenticated | Alias → /dashboard/contracting | [Redirect prompt](10-aliases-and-redirects.md#alias-eeeb77d999ec) |
| `/dashboard/challenges` | authenticated | Improve | [Challenges](03-recognition-and-community.md#page-challenges) |
| `/dashboard/recruiter` | authenticated | Consolidate conditionally after recruiter-role and action parity | [RecruiterDashboard](04-recruiting-and-licensing.md#page-recruiter-dashboard) |
| `/recruit-pipeline` | authenticated | Alias → /dashboard/recruit-pipeline | [Redirect prompt](10-aliases-and-redirects.md#alias-cdd4d6e810f7) |
| `/dashboard/recruit-pipeline` | authenticated | Consolidate conditionally; retain distinct actions until mapped | [AgentPipeline](04-recruiting-and-licensing.md#page-agent-pipeline) |
| `/agent-pipeline` | authenticated | Alias → /dashboard/agent-pipeline | [Redirect prompt](10-aliases-and-redirects.md#alias-bc4e8306bef4) |
| `/dashboard/agent-pipeline` | authenticated | Keep | [ClientPipeline](08-clients-leads-and-calling.md#page-client-pipeline) |
| `/dashboard/client-pipeline` | authenticated | Alias → /dashboard/agent-pipeline | [Redirect prompt](10-aliases-and-redirects.md#alias-6517cb7c93ea) |
| `/dashboard/inbound-leads` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-b0113aaa8263) |
| `/dashboard/inbound` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-c950d2d3037e) |
| `/dashboard/calendar` | authenticated | Keep | [CalendarPage](08-clients-leads-and-calling.md#page-calendar-page) |
| `/dashboard/my-day` | owner verified by server | Improve | [MyDay](02-production-finance-and-daily-work.md#page-my-day) |
| `/dashboard/notifications` | admin | Consolidate conditionally with Inbox operations after channel/action parity | [NotificationHub](09-settings-support-and-messages.md#page-notification-hub) |
| `/dashboard/planner` | admin | Internal | [AdminCalendar](08-clients-leads-and-calling.md#page-admin-calendar) |
| `/dashboard/headhunters-calendar` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-8589cc47da7c) |
| `/dashboard/interviews` | authenticated | Alias → /dashboard/calendar | [Redirect prompt](10-aliases-and-redirects.md#alias-401dfd491f40) |
| `/dashboard/interview-recovery` | authenticated | Alias → /dashboard/recruiting | [Redirect prompt](10-aliases-and-redirects.md#alias-8e3cc6d2abc0) |
| `/dashboard/reactivation` | admin / manager | Keep | [ProducerReactivation](06-team-and-contracting.md#page-producer-reactivation) |
| `/dashboard/hierarchy` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-0343ee660224) |
| `/dashboard/team-hierarchy` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-ada20028beca) |
| `/dashboard/inbox` | admin | Keep | [InboxPage](09-settings-support-and-messages.md#page-inbox-page) |
| `/dashboard/automation` | admin | Internal | [AutomationHub](07-owner-content-and-integrations.md#page-automation-hub) |
| `/dashboard/book-of-business` | admin / manager | Keep distinct retention workflow; consolidate discovery only after exact parity | [BookOfBusiness](08-clients-leads-and-calling.md#page-book-of-business) |
| `/dashboard/business-analytics` | authenticated | Alias → /dashboard/analytics | [Redirect prompt](10-aliases-and-redirects.md#alias-5e7bfebddeaf) |
| `/dashboard/carriers` | authenticated | Alias → /dashboard/book-of-business | [Redirect prompt](10-aliases-and-redirects.md#alias-1674623841cb) |
| `/dashboard/announcements` | authenticated | Alias → /dashboard/community | [Redirect prompt](10-aliases-and-redirects.md#alias-1897cca9b6f9) |
| `/dashboard/finances` | authenticated | Keep | [Finances](02-production-finance-and-daily-work.md#page-finances) |
| `/dashboard/scripts` | authenticated | Consolidate entry point into Training; keep the script reader and unlock rules | [Scripts](05-training-and-enablement.md#page-scripts) |
| `/dashboard/profile` | authenticated | Keep | [ProducerProfile](06-team-and-contracting.md#page-producer-profile) |
| `/dashboard/help` | authenticated | Consolidate duplicate discovery into Help while retaining support and query tabs | [HelpCenter](09-settings-support-and-messages.md#page-help-center) |
| `/dashboard/transfers` | authenticated | Keep | [TransferRequests](06-team-and-contracting.md#page-transfer-requests) |
| `/dashboard/handbook` | authenticated | Consolidate discovery into Training; preserve full handbook content | [AgentHandbook](05-training-and-enablement.md#page-agent-handbook) |
| `/dashboard/annuity-training` | authenticated | Alias → /dashboard/training/annuities | [Redirect prompt](10-aliases-and-redirects.md#alias-e73bae54f167) |
| `/dashboard/client-marketing` | authenticated | Keep | [ClientMarketing](08-clients-leads-and-calling.md#page-client-marketing) |
| `/dashboard/calling-cards` | authenticated | Consolidate discovery into Producer Profile; keep card/share tool | [CallingCards](08-clients-leads-and-calling.md#page-calling-cards) |
| `/dashboard/landing-page` | authenticated | Consolidate discovery into Producer Profile; retain preview/share workflow | [MyLandingPage](08-clients-leads-and-calling.md#page-my-landing-page) |
| `/dashboard/recruiting-funnels` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-68284a1a527e) |
| `/dashboard/recruiting-tracker` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-7134e8c0836b) |
| `/dashboard/needs-analysis` | authenticated | Keep | [NeedsAnalysis](08-clients-leads-and-calling.md#page-needs-analysis) |
| `/dashboard/quoter` | authenticated | Legacy illustration; do not promote as an authoritative quote engine | [Quoter](08-clients-leads-and-calling.md#page-quoter) |
| `/dashboard/team-analytics` | authenticated | Alias → /dashboard/admin | [Redirect prompt](10-aliases-and-redirects.md#alias-7c8ad5abfe3b) |
| `/dashboard/awards` | authenticated | Keep | [AwardsGallery](03-recognition-and-community.md#page-awards-gallery) |
| `/dashboard/hall-of-fame` | authenticated | Keep | [HallOfFame](03-recognition-and-community.md#page-hall-of-fame) |
| `/hall-of-fame` | authenticated | Alias → /dashboard/hall-of-fame | [Redirect prompt](10-aliases-and-redirects.md#alias-17f86b765690) |
| `/bot-token` | admin | Consolidate discovery under Integrations only after rotation/copy parity | [BotToken](07-owner-content-and-integrations.md#page-bot-token) |
| `/dashboard/bot-token` | admin | Consolidate discovery under Integrations only after rotation/copy parity | [BotToken](07-owner-content-and-integrations.md#page-bot-token) |
| `/dashboard/inbox/instagram` | owner verified by server | Keep | [InstagramInbox](07-owner-content-and-integrations.md#page-instagram-inbox) |
| `/dashboard/instagram-inbox` | authenticated | Alias → /dashboard/inbox/instagram | [Redirect prompt](10-aliases-and-redirects.md#alias-11bd82d58555) |
| `/today` | authenticated | Alias → /dashboard/today | [Redirect prompt](10-aliases-and-redirects.md#alias-19f66d97436b) |
| `/dashboard/recruit` | authenticated | Alias → /dashboard/recruiting | [Redirect prompt](10-aliases-and-redirects.md#alias-2b720e147c00) |
| `/recruit` | authenticated | Alias → /dashboard/recruiting | [Redirect prompt](10-aliases-and-redirects.md#alias-070a30dd49b3) |
| `/dashboard/team-chat` | authenticated | Legacy | [TeamChat](03-recognition-and-community.md#page-team-chat) |
| `/team-chat` | authenticated | Alias → /dashboard/team-chat | [Redirect prompt](10-aliases-and-redirects.md#alias-ee53cde7253e) |
| `/dashboard/bulk-deals` | admin / manager | Keep | [BulkDeals](08-clients-leads-and-calling.md#page-bulk-deals) |
| `/bulk-deals` | admin / manager | Alias → /dashboard/bulk-deals | [Redirect prompt](10-aliases-and-redirects.md#alias-9526c919f31f) |
| `/dashboard/agentlink-sync` | admin | Internal | [AgentLinkSync](07-owner-content-and-integrations.md#page-agent-link-sync) |
| `/dashboard/agent-link-sync` | authenticated | Alias → /dashboard/agentlink-sync | [Redirect prompt](10-aliases-and-redirects.md#alias-dbe06703d75f) |
| `/agentlink-sync` | admin | Alias → /dashboard/agentlink-sync | [Redirect prompt](10-aliases-and-redirects.md#alias-c9a12a830762) |
| `/dashboard/agentlink-vault` | admin | Internal | [AgentLinkVault](07-owner-content-and-integrations.md#page-agent-link-vault) |
| `/setup` | admin | Consolidate conditionally under Integrations/System after control parity | [Setup](07-owner-content-and-integrations.md#page-setup) |
| `/dashboard/setup` | admin | Consolidate conditionally under Integrations/System after control parity | [Setup](07-owner-content-and-integrations.md#page-setup) |
| `/dashboard/agent/:id` | authenticated | Consolidate duplicate URL now; page merge only after Producer Profile parity | [AgentDetail](06-team-and-contracting.md#page-agent-detail) |
| `/dashboard/agents` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-d0b1f5a9bd5e) |
| `/dashboard/agents/:id` | authenticated | Alias → /dashboard/agent/:id | [Redirect prompt](10-aliases-and-redirects.md#alias-b5e5665b0377) |
| `/dashboard/leaderboard` | authenticated | Keep | [Leaderboard](03-recognition-and-community.md#page-leaderboard) |
| `/leaderboard` | authenticated | Alias → /dashboard/leaderboard | [Redirect prompt](10-aliases-and-redirects.md#alias-898668814cfb) |
| `/board` | authenticated | Keep | [BoardLive](02-production-finance-and-daily-work.md#page-board-live) |
| `/dashboard/rewards` | authenticated | Alias → /dashboard/my-plaques?source=reward | [Redirect prompt](10-aliases-and-redirects.md#alias-628a298e44f6) |
| `/rewards` | authenticated | Alias → /dashboard/my-plaques?source=reward | [Redirect prompt](10-aliases-and-redirects.md#alias-25fa56c26632) |
| `/dashboard/automation-health` | admin | Internal | [AutomationHealth](07-owner-content-and-integrations.md#page-automation-health) |
| `/dashboard/pipeline-simple` | authenticated | Consolidate conditionally into Team/Transfers after action parity | [AgentPipelineSimple](06-team-and-contracting.md#page-agent-pipeline-simple) |
| `/dashboard/instagram-automation` | admin | Keep | [InstagramAutomation](07-owner-content-and-integrations.md#page-instagram-automation) |
| `/dashboard/hiring-pipeline` | admin / manager | Consolidate conditionally into Recruiting after stage/scope parity | [HiringPipeline](04-recruiting-and-licensing.md#page-hiring-pipeline) |
| `/dashboard/admin/board-access` | admin | Internal | [AdminBoardAccess](06-team-and-contracting.md#page-admin-board-access) |
| `/dashboard/prelicensing` | admin and managers (page gates internally) | Improve | [PrelicensingManager](04-recruiting-and-licensing.md#page-prelicensing-manager) |
| `/dashboard/agent-management` | admin | Consolidate conditionally into My Team after administrative action parity | [AgentManagement](06-team-and-contracting.md#page-agent-management) |
| `/dashboard/system-health` | owner verified by server | Keep | [SystemHealth](07-owner-content-and-integrations.md#page-system-health) |
| `/dashboard/my-commissions` | authenticated | Alias → /dashboard/finances | [Redirect prompt](10-aliases-and-redirects.md#alias-6c9613e55f05) |
| `/dashboard/my-tasks` | authenticated real account outside preview; owned usable agent identity required | Keep | [MyTasks](02-production-finance-and-daily-work.md#page-my-tasks) |
| `/dashboard/hiring-routing` | admin | Keep | [HiringManagerAssignments](04-recruiting-and-licensing.md#page-hiring-manager-assignments) |
| `/dashboard/getting-started` | authenticated | Keep | [GettingStarted](05-training-and-enablement.md#page-getting-started) |
| `/dashboard/inactive-agents` | admin and managers (page gates internally) | Improve | [InactiveAgents](06-team-and-contracting.md#page-inactive-agents) |
| `/dashboard/my-plaques` | authenticated | Keep | [MyPlaques](03-recognition-and-community.md#page-my-plaques) |
| `/dashboard/email-log` | admin | Internal | [EmailDeliveryLog](07-owner-content-and-integrations.md#page-email-delivery-log) |
| `/dashboard/comp-tiers` | admin | Internal | [CompTiersSettings](07-owner-content-and-integrations.md#page-comp-tiers-settings) |
| `/dashboard/integrations` | admin | Internal | [IntegrationsSettings](07-owner-content-and-integrations.md#page-integrations-settings) |
| `/dashboard/my-team` | authenticated | Alias → /dashboard/team | [Redirect prompt](10-aliases-and-redirects.md#alias-b56f69cdf329) |
| `/dashboard/my-deals` | authenticated | Alias → /dashboard/production | [Redirect prompt](10-aliases-and-redirects.md#alias-517e90f1e5ac) |
| `/admin/contentwheel` | admin | Keep | [ContentWheel](07-owner-content-and-integrations.md#page-content-wheel) |
| `/dashboard/admin/content-command` | admin | Consolidate conditionally under Launch Board after draft/source-health parity | [ContentCommand](07-owner-content-and-integrations.md#page-content-command) |
| `/dashboard/strikes` | admin | Keep | [AdminStrikes](03-recognition-and-community.md#page-admin-strikes) |
| `/dashboard/my-strikes` | authenticated | Keep | [MyStrikes](03-recognition-and-community.md#page-my-strikes) |
| `/dashboard/charges-audit` | authenticated | Alias → /dashboard | [Redirect prompt](10-aliases-and-redirects.md#alias-81415d225a42) |
| `/dashboard/admin/charges-audit` | authenticated | Alias → /dashboard | [Redirect prompt](10-aliases-and-redirects.md#alias-cd8014229719) |
| `/dashboard/lead-payments` | admin | Keep | [LeadPayments](02-production-finance-and-daily-work.md#page-lead-payments) |
| `/dashboard/old-applicants/managers` | admin / manager | Keep | [OldApplicants](04-recruiting-and-licensing.md#page-old-applicants) |
| `/dashboard/old-applicants/licensed-recruiters` | admin / manager | Keep | [OldApplicants](04-recruiting-and-licensing.md#page-old-applicants) |
| `/dashboard/conduct` | authenticated | Alias → /dashboard/strikes | [Redirect prompt](10-aliases-and-redirects.md#alias-0b9ad4e70ce1) |
| `/dashboard/pre-licensing` | admin / manager | Keep | [PreLicensing](04-recruiting-and-licensing.md#page-pre-licensing) |
| `/dashboard/book-quality` | admin / manager | Keep | [BookReconciliation](08-clients-leads-and-calling.md#page-book-reconciliation) |
| `/dashboard/books` | admin / manager | Keep | [BookFlips](08-clients-leads-and-calling.md#page-book-flips) |
| `/dashboard/sold-calls` | admin / manager | Keep | [SoldCalls](08-clients-leads-and-calling.md#page-sold-calls) |
| `/dashboard/easy-resells` | admin / manager | Keep | [EasyResells](08-clients-leads-and-calling.md#page-easy-resells) |
| `/dashboard/call-training` | admin / manager | Keep | [CallTraining](08-clients-leads-and-calling.md#page-call-training) |
| `/dashboard/lead-bundles` | admin / manager | Alias → /dashboard/lead-manager | [Redirect prompt](10-aliases-and-redirects.md#alias-ed7d38eb51c9) |
| `/dashboard/my-leads` | authenticated | Keep | [MyLeads](08-clients-leads-and-calling.md#page-my-leads) |
| `/dashboard/lead-manager` | admin / manager | Consolidate duplicate URL; retain the lead operations workflow | [LeadManager](08-clients-leads-and-calling.md#page-lead-manager) |
| `/dashboard/consumer-import` | admin / manager | Keep | [ConsumerLeadImport](08-clients-leads-and-calling.md#page-consumer-lead-import) |
| `/dashboard/ayro-book` | authenticated | Alias → /dashboard/book-of-business | [Redirect prompt](10-aliases-and-redirects.md#alias-5866f67f58e5) |
| `/dashboard/social-command` | admin / manager | Keep | [SocialCommandCenter](07-owner-content-and-integrations.md#page-social-command-center) |
| `/dashboard/admin/book-quality` | authenticated | Alias → /dashboard/book-quality | [Redirect prompt](10-aliases-and-redirects.md#alias-dbc954ea496a) |
| `/dashboard/readymode` | admin | Internal | [ReadyModeIntegration](07-owner-content-and-integrations.md#page-ready-mode-integration) |
| `/dashboard/admin/performance-bot` | admin | Keep | [PerformanceBot](07-owner-content-and-integrations.md#page-performance-bot) |
| `/dashboard/admin/brand-command` | admin | Keep | [BrandCommand](07-owner-content-and-integrations.md#page-brand-command) |
| `/dashboard/admin/social-media-bot` | owner verified by server | Keep | [SocialMediaCenter](07-owner-content-and-integrations.md#page-social-media-center) |
| `/dashboard/admin/telegram-bot` | admin | Internal | [TelegramBot](07-owner-content-and-integrations.md#page-telegram-bot) |
| `/dashboard/admin/sam` | owner verified by server | Internal | [SamHQ](02-production-finance-and-daily-work.md#page-sam-h-q) |
| `/dashboard/sam-todo` | owner verified by server | Improve | [SamTodo](02-production-finance-and-daily-work.md#page-sam-todo) |
| `/dashboard/admin/unclaimed` | admin | Keep | [UnclaimedLeads](04-recruiting-and-licensing.md#page-unclaimed-leads) |
| `/dashboard/admin/manager` | admin / manager | Keep | [ManagerDashboard](04-recruiting-and-licensing.md#page-manager-dashboard) |
| `/dashboard/admin/licensing` | admin / manager | Consolidate conditionally after licensing-student data/action parity | [LicensingTracker](04-recruiting-and-licensing.md#page-licensing-tracker) |
| `/dashboard/admin/commission-recovery` | admin | Keep | [CommissionRecovery](02-production-finance-and-daily-work.md#page-commission-recovery) |
| `/log-numbers` | public | Alias → /apex-daily-numbers | [Redirect prompt](10-aliases-and-redirects.md#alias-948648f5a3b4) |
| `*` | public | Keep | [NotFound](01-public-and-applicant.md#page-not-found) |
