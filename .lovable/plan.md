

# Full Site Breakdown -- APEX Financial Platform

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────┐
│                      BrowserRouter                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │  AuthProvider → SidebarProvider → TooltipProvider  │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │         Routes                              │  │  │
│  │  │  ├─ Public (12 routes)                      │  │  │
│  │  │  ├─ AuthenticatedShell (25 routes)           │  │  │
│  │  │  │   └─ SidebarLayout + Outlet              │  │  │
│  │  │  └─ Catch-all → NotFound                    │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 1. PAGES (47 total)

### Public Pages (no auth required)
| Page | Route | Purpose |
|------|-------|---------|
| Index | `/` | Landing page (Hero, Benefits, Earnings, Testimonials, Systems, Career Pathway, CTA, Footer + DealsTicker) |
| Apply | `/apply` | Multi-step application form |
| ApplySuccess | `/apply/success` | Generic success page |
| ApplySuccessLicensed | `/apply/success/licensed` | Licensed applicant confirmation |
| ApplySuccessUnlicensed | `/apply/success/unlicensed` | Unlicensed applicant confirmation |
| GetLicensed | `/get-licensed` | Licensing instructions |
| Login | `/login` | Email/password login |
| Signup | `/signup` | Manager signup with token |
| AgentSignup | `/join` | Agent signup via invite link |
| AgentNumbersLogin | `/agent-login` | Quick login for daily numbers |
| MagicLogin | `/magic-login` | Token-based passwordless login |
| ScheduleCall | `/schedule-call` | Calendly embed |
| PendingApproval | `/pending-approval` | Post-signup waiting screen |
| Privacy / Terms / Disclosures | `/privacy`, `/terms`, `/disclosures` | Legal pages |
| Install | `/install` | PWA install instructions |
| LogNumbers | `/apex-daily-numbers` | Public daily production entry |
| LinksPage | `/links` | Resource links |
| SeminarPage | `/seminar` | Public seminar registration |
| ApplicantCheckin | `/checkin` | Applicant daily check-in form |

### Authenticated Pages (inside AuthenticatedShell)
| Page | Route | Role Access | Purpose |
|------|-------|-------------|---------|
| Dashboard | `/dashboard` | All | Main dashboard with stat cards, leaderboards, charts, team overview |
| DashboardApplicants | `/dashboard/applicants` | Admin/Manager | Applicant pipeline management |
| DashboardAdmin | `/dashboard/admin` | Admin/Manager | Admin tools panel |
| DashboardAccounts | `/dashboard/accounts` | Admin only | Account management |
| Settings | `/dashboard/settings` | All | Profile settings, password reset |
| DeletedLeadsVault | `/dashboard/settings/deleted-leads` | Admin only | Recover deleted leads |
| TeamDirectory | `/dashboard/team` | All | Team member directory |
| DashboardCRM | `/dashboard/crm` | Admin/Manager | Full CRM with stage management |
| DashboardAgedLeads | `/dashboard/aged-leads` | Admin only | Aged lead management |
| DashboardCommandCenter | `/dashboard/command` | Admin only | Full admin command center |
| AgentPortal | `/agent-portal` | All | Individual agent performance view |
| OnboardingCourse | `/onboarding-course` | All | Training course modules |
| CourseProgress | `/course-progress` | Admin/Manager | Course progress tracking |
| CourseContent | `/course-progress/content` | All | Course video/quiz content |
| Numbers | `/numbers` | All | Daily production number entry |
| PurchaseLeads | `/purchase-leads` | All | Lead purchase interface |
| CallCenter | `/dashboard/call-center` | Admin/Manager | Call center with lead cards, voice recorder, stage selector |
| LeadCenter | `/dashboard/leads` | Admin only | Centralized lead management |
| RecruiterDashboard | `/dashboard/recruiter` | Admin + Aisha | Recruiter HQ with AI panel |
| AgentPipeline | `/agent-pipeline` | Agent | Personal pipeline Kanban board |
| CalendarPage | `/dashboard/calendar` | All | Calendar view |
| NotificationHub | `/dashboard/notifications` | Admin only | Notification management |
| GrowthDashboard | `/dashboard/growth` | Admin/Manager | Growth metrics & Instagram directory |
| AdminCalendar (Day Planner) | `/dashboard/planner` | Admin only | Hour-by-hour scheduler with DnD, AI scan, recurring blocks, ICS export |
| SeminarAdmin | `/dashboard/seminar` | Admin/Manager | Seminar registration management |

---

## 2. COMPONENTS (165+)

### Layout (5)
- **AuthenticatedShell** -- wraps all protected routes with sidebar, schedule bar, push notification prompt
- **SidebarLayout** -- responsive sidebar + main content with mobile drawer
- **GlobalSidebar** -- role-based navigation with collapse/expand, fullscreen mode, tooltips
- **ScheduleBar** -- upcoming schedule items at top
- **PushNotificationPrompt** -- browser push notification opt-in

### Landing (15)
- Navbar, HeroSection, BenefitsSection, EarningsSection, TestimonialsSection, SystemsSection, CareerPathwaySection, CTASection, Footer, DealsTicker, ApplicationToast, CalendlyEmbed, VideoModal, VideoTestimonialCard, FAQSection

### Dashboard (98)
- **Stats & Cards**: StatCard, MetricsCard, PersonalStatsCard, DownlineStatsCard, AgencyGrowthCard, EstimatedEarningsCard, EarningsPotentialCard, IncomeGoalTracker, YearPerformanceCard, TeamSnapshotCard
- **Leaderboards**: LeaderboardTabs, LeaderboardCard, LiveLeaderboard, CompactLeaderboard, MiniLeaderboard, MobileLeaderboardCard, BuildingLeaderboard, ClosingRateLeaderboard, ReferralLeaderboard, ManagerLeaderboard, MyRankingChart
- **Production**: ProductionEntry, CompactProductionEntry, BubbleDealEntry, BubbleStatInput, ProductionForecast, ProductionHistoryChart, ALPCalculator
- **Team Management**: ManagerTeamView, TeamHierarchyManager, TeamOverviewDashboard, TeamPerformanceBreakdown, TeamGoalsTracker, DraggableAgentCard, ManagersPanel, ManagerProductionStats
- **Agent Management**: AddAgentModal, AgentChecklist, AgentNotes, AgentQuickEditDialog, AgentRankBadge, DeactivateAgentDialog, AvatarUpload, ProfileSettings, StarRating, EvaluationButtons
- **Lead Management**: AllLeadsPanel, LeadImporter, LeadExporter, LeadReassignment, BulkLeadAssignment, QuickAssignMenu, TerminatedAgentLeadsPanel, AbandonedLeadsPanel, LeadPaymentTracker, LeadQualificationChat, LastContactedBadge
- **Onboarding**: OnboardingTracker, OnboardingPipelineCard, LicenseProgressSelector, LicenseConfirmModal, ContractedModal
- **Comms**: QuickEmailMenu, EmailPreviewModal, InviteTeamModal, InviteManagerCard, ManagerInviteLinks, QuickInviteLink, AdminManagerInvites, InstagramPromptDialog, PhonePromptBanner, InterviewScheduler, InterviewRecorder
- **Charts**: GrowthChart, AnalyticsPieChart, AnimatedNumber, PerformanceDashboardSection
- **Gamification**: ConfettiCelebration, PerformanceBadges, WeeklyBadges, RankChangeIndicator
- **Misc**: TotalApplicationsBanner, ActivationRiskBanner, CheckinActivityPanel, AccountLinkForm, QuizQuestionsAdmin, CallModeInterface, AttendanceGrid, AgedLeadImporter, AgedLeadEmailPreview, ApplicationDetailSheet, ApplicantNotes, ApplicantSummary, DashboardLayout, RecruitingQuickView, StatCardPopup, PerformanceBreakdownModal, AddToCourseButton, AddAgentToCourseDialog

### Admin (8)
- AISummaryReport, AgentProfileEditor, CourseContentViewer, CourseProgressPanel, DuplicateMergeTool, QuickFilters, RecognitionQueue, SystemIntegrityCard

### Call Center (10)
- CallCenterActions, CallCenterFilters, CallCenterLeadCard, CallCenterProgressRing, CallCenterStageSelector, CallCenterVoiceRecorder, LeadExpiryCountdown, LeadReassignButton, ResendLicensingButton

### Course (3)
- CourseModuleSidebar, CourseQuiz, CourseVideoPlayer

### CRM (1)
- BulkStageActions

### Growth (4)
- GrowthDeltaCards, GrowthInputForm, GrowthLeaderboard, InstagramDirectory

### Pipeline (2)
- KanbanBoard, PipelineCard

### Recruiter (5)
- ActivityTimeline, DailyChallenge, DormantBadge, LeadDetailSheet, RecruiterAIPanel

### UI Library (50+)
- Full shadcn/ui component library + custom: GlassCard, BackgroundGlow, GradientButton, SectionHeading, SkeletonLoader, AnimatedCounter, DateRangePicker, ScrollToTop

---

## 3. HOOKS (20)

| Hook | Purpose |
|------|---------|
| useAuth | Auth context: user, session, profile, roles (admin/manager/agent) |
| useSidebarState | Sidebar open/collapsed/fullscreen state with localStorage persistence |
| useIsDesktop | Media query for lg breakpoint |
| useIsMobile | Media query for mobile breakpoint |
| useIsTouchDevice | Touch vs pointer detection |
| useNavigationGuard | Cleans up stuck overlays on route change |
| useInFlightGuard | Prevents duplicate mutations |
| useDebouncedRefetch | Debounced query refetch |
| useProductionRealtime | Realtime production data subscription |
| usePushNotifications | Web Push API integration |
| useSoundEffects | UI sound effects |
| useTheme | Dark/light theme |
| useAnimatedCounter | Number animation |
| useLeadCounter | Live lead count |
| useRankChange | Agent rank change detection |
| useManagerRankChange | Manager rank tracking |
| useTop3Celebration | Confetti for top 3 finish |
| useWeeklyBadges | Weekly achievement badges |
| useOnboardingCourse | Course progress tracking |
| use-toast | Toast notifications |

---

## 4. BACKEND: Edge Functions (90+)

### Auth & Account
- simple-login, agent-signup, manager-signup, setup-agent-password, reset-agent-password, generate-magic-link, verify-magic-link, validate-signup-token, link-account, create-new-agent-account

### Production & Data
- log-production, import-production-data, increment-lead-counter, submit-application, update-application-referral

### AI
- ai-assistant, analyze-call-transcript, parse-schedule-image, generate-quiz-questions

### Notifications (40+)
- Email, SMS, push notifications for: deals, milestones, streaks, rankings, evaluations, training reminders, attendance, daily summaries, weekly champions, leaderboards, course progress, agent contracted/live, hire announcements, and more

### Automated Checks (8)
- check-abandoned-applications, check-comeback-milestones, check-daily-plaques, check-low-aop-friday, check-monthly/weekly/streak/team-milestones, check-stale-onboarding

### Admin
- add-agent, confirm-agent-removal, merge-agent-records, dedupe-aged-leads, system-health-check, get-active-managers, reset-monthly-goals

---

## 5. DATABASE (25+ tables)

Key tables: `agents`, `profiles`, `user_roles`, `applications`, `daily_production`, `agent_metrics`, `agent_onboarding`, `agent_achievements`, `achievements`, `aged_leads`, `lead_activity`, `lead_counter`, `lead_payment_tracking`, `agent_lead_stats`, `agent_ratings`, `plaque_awards`, `email_tracking`, `notification_log`, `error_logs`, `health_check_log`, `partial_applications`, `resources`, `onboarding_questions`, `interview_recordings`, `manager_invite_links`, `manager_signup_tokens`, `magic_login_tokens`, `contracting_links`, `manager_growth_stats`, `elite_circle_waitlist`, `recurring_calendar_blocks`, `seminar_registrations`, `applicant_checkins`, `invitation_seen`

Role-based RLS across all tables using `has_role()` and `current_agent_id()` helper functions.

---

## 6. KEY PATTERNS

- **Auth**: 3-tier RBAC (admin > manager > agent) via `user_roles` table
- **Routing**: `AuthenticatedShell` wraps all protected routes with single sidebar mount
- **Data**: React Query with 2min stale time, lazy-loaded pages
- **UI**: Glass morphism design system, dark/light themes, framer-motion animations
- **PWA**: Service worker, push notifications, install prompt
- **Realtime**: Supabase realtime subscriptions for production data

---

## 7. IDENTIFIED ISSUES (from previous analysis)

1. Duplicate "11 PM" option in Day Planner end-hour select
2. Recurring block applied-dates tracked in-memory (resets on refresh)
3. Paused recurring blocks hidden from management dialog
4. No "Today" button on date navigator
5. No recurrence editing on existing blocks

---

## Recommendation

Your codebase is current and complete. **Yes, do the Git commit now** -- this captures all Phase 4 Day Planner work plus the full platform state. After committing, you can have the analyzer review the repo and identify what to add next (weekly view, block templates, the 5 fixes above, etc.).

