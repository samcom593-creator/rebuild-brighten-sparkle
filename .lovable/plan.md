

# Apex Financial — Complete Platform Architecture & Functions

## Overview
Apex Financial is a full-stack Agency Operating System for insurance recruiting, licensing, production tracking, and team management. Built with React + Vite + Tailwind + Supabase (Lovable Cloud).

---

## PAGES & THEIR FUNCTIONS

### Public Pages
| Page | Route | Purpose |
|------|-------|---------|
| **Index** | `/` | Landing page with hero, benefits, testimonials, FAQ, CTA |
| **Apply** | `/apply` | Multi-step application form for prospective agents |
| **ApplySuccess** / Licensed / Unlicensed | `/apply/success/*` | Post-application confirmation with next steps |
| **GetLicensed** | `/get-licensed` | Licensing instructions page |
| **Login** | `/login` | Email/password login |
| **Signup** | `/signup` | Manager signup with token |
| **AgentSignup** | `/join` | Agent signup via invite link |
| **AgentNumbersLogin** | `/agent-login` | Quick login for agents to log daily numbers |
| **MagicLogin** | `/magic-login` | Token-based passwordless login |
| **ScheduleCall** | `/schedule-call` | Calendly embed for scheduling |
| **PendingApproval** | `/pending-approval` | Holding page for unapproved agents |
| **LogNumbers** | `/apex-daily-numbers` | Public daily production entry (standalone) |
| **LinksPage** | `/links` | Linktree-style resource page |
| **Privacy / Terms / Disclosures** | `/privacy`, `/terms`, `/disclosures` | Legal pages |
| **Install** | `/install` | PWA installation instructions |

### Authenticated Pages (Inside Sidebar Shell)
| Page | Route | Access | Purpose |
|------|-------|--------|---------|
| **Dashboard** | `/dashboard` | All | Main hub: leaderboards, stats, team view, quick actions |
| **Numbers** | `/numbers` | All | Log daily production numbers |
| **Agent Portal** | `/agent-portal` | All | Personal stats, production history, goals, badges, leaderboards |
| **Agent Pipeline** | `/agent-pipeline` | Agents | Personal lead pipeline |
| **Onboarding Course** | `/onboarding-course` | All | Training course with modules and quizzes |
| **Course Progress** | `/course-progress` | Admin/Manager | View all agents' course completion |
| **Course Content** | `/course-progress/content` | Admin/Manager | Course content viewer |
| **CRM** | `/dashboard/crm` | Admin/Manager | Full agent management: onboarding tracker, attendance, ratings, notes, license progress, evaluations, checklist, performance badges |
| **Pipeline (Applicants)** | `/dashboard/applicants` | Admin/Manager | Application pipeline management |
| **Call Center** | `/dashboard/call-center` | Admin/Manager | Lead calling interface with voice recording, stage selector, filters |
| **Calendar** | `/dashboard/calendar` | All | Scheduling view |
| **Purchase Leads** | `/purchase-leads` | All | Lead purchase interface |
| **Growth Dashboard** | `/dashboard/growth` | Admin/Manager | Instagram/social growth tracking |
| **Recruiter HQ** | `/dashboard/recruiter` | Admin + Aisha | Full recruiter dashboard with AI panel, lead scoring, call outcomes, activity timeline, daily challenges, Kanban-style pipeline |
| **Settings** | `/dashboard/settings` | All | Profile, password, theme settings |
| **Team Directory** | `/dashboard/team` | All | Team member directory |
| **Command Center** | `/dashboard/command` | Admin only | Full agency control: all agents, production leaderboard, time-period filters, promote/demote managers, send login links, reassign teams, deactivate agents, duplicate merge, lead import/export, abandoned leads, bulk operations |
| **Lead Center** | `/dashboard/leads` | Admin only | Centralized lead management |
| **Notification Hub** | `/dashboard/notifications` | Admin only | Push notification management |
| **Accounts** | `/dashboard/accounts` | Admin only | Account management |
| **Aged Leads** | `/dashboard/aged-leads` | Admin only | Old lead management and re-engagement |
| **Deleted Leads Vault** | `/dashboard/settings/deleted-leads` | Admin only | Recover deleted leads |

---

## KEY COMPONENTS

### Dashboard Components
- **ManagerTeamView** — Team roster with expandable rows: stats, admin actions (send login, promote, deactivate, reassign, change stage, license toggle), bulk select
- **LeaderboardTabs** — ALP leaderboard by day/week/month
- **ClosingRateLeaderboard / ReferralLeaderboard** — Secondary leaderboards
- **TeamSnapshotCard** — Production snapshot
- **TeamPerformanceBreakdown** — Weekly breakdown table
- **OnboardingPipelineCard** — Onboarding funnel visualization
- **RecruitingQuickView** — Quick recruiting stats
- **AgencyGrowthCard** — Growth metrics
- **TotalApplicationsBanner** — Live application counter (FOMO)
- **EstimatedEarningsCard** — Earnings calculator
- **ActivationRiskBanner** — Agents at risk of going inactive
- **StatCard / StatCardPopup** — Clickable stat cards with drill-down
- **ProductionEntry / CompactProductionEntry** — Daily number logging forms
- **PersonalStatsCard** — Individual agent performance
- **ProductionHistoryChart** — Historical production chart
- **GrowthChart** — Growth trend chart
- **AnalyticsPieChart** — Lead source / license distribution charts
- **ConfettiCelebration** — Animated confetti on achievements
- **InviteTeamModal** — Invite new team members
- **AddAgentModal** — Create agent records (admin)
- **DeactivateAgentDialog** — Soft-delete agent
- **AgentQuickEditDialog** — Quick agent profile editing
- **BulkLeadAssignment** — Assign leads in bulk
- **LeadReassignment** — Reassign leads between agents
- **LeadImporter / LeadExporter** — CSV import/export
- **AbandonedLeadsPanel** — Partial applications that weren't completed
- **AllLeadsPanel** — All leads view
- **TerminatedAgentLeadsPanel** — Leads from deactivated agents
- **WeeklyBadges** — Achievement badges
- **PerformanceBadges** — Performance tier badges
- **AgentRankBadge** — XP-based rank display
- **AgentChecklist** — Onboarding checklist (course, dialer, Discord)
- **AgentNotes / ApplicantNotes** — Note-taking system
- **AttendanceGrid** — Training/meeting attendance tracker
- **StarRating** — Agent potential rating
- **EvaluationButtons** — Evaluation pass/fail
- **OnboardingTracker** — Stage progression UI
- **LicenseProgressSelector** — License status dropdown
- **InterviewRecorder** — Record interview audio
- **InterviewScheduler** — Schedule interviews
- **CallModeInterface** — Click-to-call interface
- **ManagerLeaderboard / BuildingLeaderboard** — Manager-level leaderboards
- **TeamHierarchyManager** — Drag-and-drop team hierarchy
- **TeamGoalsTracker / IncomeGoalTracker** — Goal setting and tracking
- **ProductionForecast** — AI-powered production forecasting
- **YearPerformanceCard** — Annual performance summary
- **AccountLinkForm** — Link agent accounts
- **QuickEmailMenu** — Quick email templates
- **AgedLeadImporter / AgedLeadEmailPreview** — Aged lead tools
- **LeadPaymentTracker** — Track lead payment status
- **LeadQualificationChat** — AI-powered lead qualification
- **ProfileSettings** — Profile management with avatar upload
- **PhonePromptBanner** — Prompt to add phone number

### Admin Components
- **AISummaryReport** — AI-generated agency report
- **AgentProfileEditor** — Edit agent profiles
- **CourseContentViewer** — View/manage course content
- **CourseProgressPanel** — Course completion tracking
- **DuplicateMergeTool** — Find and merge duplicate records
- **QuickFilters** — Production filter buttons
- **RecognitionQueue** — Recognition/plaque queue
- **SystemIntegrityCard** — System health overview

### Call Center Components
- **CallCenterActions / Filters / LeadCard / ProgressRing / StageSelector / VoiceRecorder** — Full calling interface
- **LeadExpiryCountdown** — Lead expiry timer
- **LeadReassignButton** — Reassign leads
- **ResendLicensingButton** — Resend licensing instructions

### Recruiter Components
- **ActivityTimeline** — Lead activity history
- **DailyChallenge** — Gamified daily recruiting challenges
- **DormantBadge** — Dormant lead indicator
- **LeadDetailSheet** — Full lead detail panel
- **RecruiterAIPanel** — AI-powered lead insights and suggestions

### Pipeline Components
- **KanbanBoard** — Drag-and-drop pipeline board

### Landing Components
- **HeroSection / BenefitsSection / EarningsSection / CareerPathwaySection / SystemsSection / TestimonialsSection / FAQSection / CTASection / Footer / Navbar** — Marketing pages
- **CalendlyEmbed** — Scheduling integration
- **DealsTicker** — Scrolling deals ticker
- **ApplicationToast** — Live application notifications
- **VideoModal / VideoTestimonialCard** — Video content

### Layout Components
- **AuthenticatedShell** — Wrapper with sidebar for authenticated routes
- **GlobalSidebar** — Main navigation sidebar (role-based)
- **SidebarLayout** — Sidebar + content layout
- **ScheduleBar** — Schedule indicator bar
- **PushNotificationPrompt** — Push notification opt-in

---

## EDGE FUNCTIONS (Backend)

### Agent/Account Management
- `add-agent` — Create agent with Auth + Profile + Agent records
- `agent-signup` — Agent self-registration
- `manager-signup` — Manager registration with token
- `create-agent-from-leaderboard` — Create agent from leaderboard entry
- `create-new-agent-account` — Create new account
- `confirm-agent-removal` — Confirm agent deletion
- `merge-agent-records` — Merge duplicate agents
- `link-account` — Link agent to auth account
- `reset-agent-password` — Reset password
- `setup-agent-password` — Initial password setup
- `update-user-email` — Update email
- `simple-login` — Simplified login flow

### Auth & Tokens
- `generate-magic-link` — Create magic login links
- `verify-magic-link` — Validate magic tokens
- `validate-signup-token` — Validate manager signup tokens
- `send-password-reset` — Send password reset email

### Production & Data
- `log-production` — Log daily production numbers
- `import-production-data` — Bulk import production
- `increment-lead-counter` — Update lead counter
- `get-active-managers` — List active managers
- `get-vapid-public-key` — Get push notification key
- `dedupe-aged-leads` — Deduplicate aged leads
- `reset-monthly-goals` — Reset monthly goals

### Applications
- `submit-application` — Process new applications
- `update-application-referral` — Update referral source
- `schedule-interview` — Schedule interviews
- `check-abandoned-applications` — Find incomplete applications

### Email/SMS Communications
- `send-agent-portal-login` — Send portal login email
- `send-bulk-portal-logins` — Bulk send login emails
- `send-licensing-instructions` — Send licensing info
- `bulk-send-licensing` — Bulk licensing emails
- `send-application-notification` — New application alerts
- `send-followup-emails` — Automated follow-ups
- `send-manual-followup` — Manual follow-up
- `send-outreach-email` — Outreach campaigns
- `send-aged-lead-email` — Aged lead re-engagement
- `send-course-enrollment-email` — Course enrollment
- `send-course-reminder` — Course reminders
- `send-course-hurry-emails` — Course urgency
- `send-abandoned-followup` — Abandoned application follow-up
- `send-bulk-unlicensed-outreach` — Bulk unlicensed outreach
- `send-post-call-followup` — Post-call follow-up
- `send-batch-blast` — Mass email blasts
- `send-bulk-notification-blast` — Bulk notifications
- `send-weekly-analytics` — Weekly analytics report
- `send-weekly-team-summary` — Weekly team summary
- `send-daily-leaderboard-summary` — Daily leaderboard email
- `send-daily-sales-leaderboard` — Sales leaderboard email
- `send-monthly-motivation` — Monthly motivation email
- `send-outstanding-performance` — Outstanding performance recognition
- `send-plaque-recognition` — Plaque recognition
- `send-sms-auto-detect` — Smart SMS routing
- `send-sms-via-email` — SMS via email gateway
- `send-push-notification` — Push notifications
- `send-push-optin-email` — Push opt-in email
- `welcome-new-agent` — Welcome email

### Email Tracking
- `track-email-open` — Track email opens
- `track-email-click` — Track email clicks
- `check-email-status` — Check email delivery

### AI
- `ai-assistant` — AI-powered assistant
- `analyze-call-transcript` — Analyze call recordings
- `generate-quiz-questions` — Generate quiz questions

### Automated Checks (Cron-style)
- `check-daily-plaques` — Check plaque milestones
- `check-monthly-milestones` / `check-weekly-milestones` — Milestone checks
- `check-comeback-milestones` — Comeback tracking
- `check-recruiting-milestones` — Recruiting milestones
- `check-streak-milestones` — Streak tracking
- `check-team-milestones` — Team milestones
- `check-stale-onboarding` — Stale onboarding detection
- `check-low-aop-friday` — Low AOP Friday alert
- `system-health-check` — System health monitoring
- `test-email-flows` — Test email infrastructure

### Notifications (40+ types)
- Deal alerts, milestone congrats, rank changes, streak alerts, production submitted, stage changes, hire announcements, fill numbers reminders, attendance missing, evaluation due/result, training reminders, test reminders/scheduled, lead assigned/closed/purchased, top performers, weekly champions, monthly leaderboard, manager referrals, comeback alerts, no-deal-today, missed dialer, module progress, course complete/started, set goals, low close rate, admin daily summary, admin earnings, agent contracted/live-field/login, manager daily digest, all-managers leaderboard, manager downline production, top performers morning, notes added

---

## DATABASE TABLES

### Core
- `agents` — Agent records (status, onboarding stage, manager, checklist flags, performance tier, attendance)
- `profiles` — User profiles (name, email, phone, avatar, bio, city, state, Instagram)
- `user_roles` — Role assignments (admin, manager, agent)
- `applications` — Lead/application records with full lifecycle tracking
- `daily_production` — Daily production numbers (presentations, deals, ALP, referrals, hours)

### Management
- `agent_onboarding` — Onboarding stage history
- `agent_metrics` — Period-based performance metrics
- `agent_ratings` — Star ratings
- `agent_achievements` — Earned achievements
- `agent_lead_stats` — Lead statistics by period
- `agent_removal_requests` — Deactivation requests
- `lead_payment_tracking` — Lead payment status
- `lead_activity` — Lead activity timeline
- `lead_counter` — Global lead counter

### Communication
- `contact_history` — Contact log (calls, emails)
- `email_tracking` — Email open/click tracking
- `notification_log` — All notifications sent
- `magic_login_tokens` — Magic link tokens

### Recruiting
- `aged_leads` — Old leads for re-engagement
- `partial_applications` — Abandoned applications
- `scheduled_interviews` — Interview scheduling
- `interview_recordings` — Interview audio recordings
- `elite_circle_waitlist` — Waitlist entries

### Admin
- `manager_invite_links` — Manager invite codes
- `manager_signup_tokens` — Manager registration tokens
- `manager_growth_stats` — Growth tracking (Instagram, followers)
- `contracting_links` — Contracting URLs
- `plaque_awards` — Plaque milestones
- `achievements` — Achievement definitions
- `resources` — Training resources
- `onboarding_questions` — Course quiz questions
- `error_logs` — Error tracking
- `health_check_log` — System health
- `banned_prospects` — Blocked applicants

---

## HOOKS

| Hook | Purpose |
|------|---------|
| `useAuth` | Authentication context with roles, profile, sign in/out |
| `useProductionRealtime` | Singleton realtime subscription for production updates |
| `useDebouncedRefetch` | Debounced query refetching |
| `useInFlightGuard` | Prevent duplicate concurrent requests |
| `useNavigationGuard` | Unsaved changes warning |
| `usePushNotifications` | Push notification management |
| `useSoundEffects` | UI sound effects (click, success, error, celebrate) |
| `useRankChange` / `useManagerRankChange` | Rank change detection |
| `useTop3Celebration` | Top 3 leaderboard celebration |
| `useWeeklyBadges` | Weekly achievement badges |
| `useLeadCounter` | Live lead counter |
| `useOnboardingCourse` | Course progress tracking |
| `useAnimatedCounter` | Animated number transitions |
| `useSidebarState` | Sidebar open/collapsed state |
| `useTheme` | Dark/light theme |
| `useIsMobile` / `useIsDesktop` / `useIsTouchDevice` | Device detection |

---

## ROLE-BASED ACCESS

| Feature | Agent | Manager | Admin |
|---------|-------|---------|-------|
| Dashboard + Leaderboards | Yes | Yes | Yes |
| Log Numbers | Yes | Yes | Yes |
| Agent Portal (personal) | Yes | Yes | Yes |
| Pipeline (personal) | Yes | — | — |
| Onboarding Course | Yes | — | — |
| CRM | — | Team only | All |
| Pipeline (applicants) | — | Team only | All |
| Call Center | — | Yes | Yes |
| Course Progress | — | Yes | Yes |
| Aged Leads | — | — | Yes |
| Command Center | — | — | Yes |
| Lead Center | — | — | Yes |
| Accounts | — | — | Yes |
| Notification Hub | — | — | Yes |
| Deleted Leads Vault | — | — | Yes |
| Promote/Demote Managers | — | — | Yes |
| Deactivate Agents | — | — | Yes |
| Send Portal Logins | — | — | Yes |
| Bulk Operations | — | — | Yes |
| Growth Dashboard | — | Yes | Yes |
| Recruiter HQ | — | Aisha only | Yes |

---

## CONFIGURATION (`apexConfig.ts`)

- **Follow-up timing**: 10min initial outreach, 24h retry, 3d course check-in, 48h needs-contact, 14d dormant
- **Lead scoring weights**: Base 30, Licensed +25, Test scheduled +20, Recent contact +15, Stale -20
- **Score thresholds**: Low <40, Medium <70
- **XP rewards**: Contact 10, Stage update 15, Test scheduled 25, Licensed 100, Note added 5
- **Rank levels**: Rookie (0), Rising Star (100), Power Recruiter (300), Elite (600), Legend (1000)
- **Scheduling links**: Calendly for licensed/unlicensed
- **Call outcomes**: No Answer, Voicemail, Interested, Not Interested, Wrong Number

