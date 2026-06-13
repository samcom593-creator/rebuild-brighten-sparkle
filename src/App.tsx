import { Suspense, lazy, useEffect, useState } from "react";
// wave-17 (2026-06-04): Toaster + Sonner moved off the eager entry static
// graph. Together they pulled @radix-ui/react-toast (vendor-radix slice)
// + sonner + next-themes (vendor-ui slice) into landing's critical path
// even though `/` never fires a toast — only post-navigation routes do.
// Lazy-loading + idle-prefetch keeps user-fired toasts working without
// the cold-landing CSS/JS cost.
const ToasterShadcn = lazy(() =>
  import("@/components/ui/toaster").then((m) => ({ default: m.Toaster })),
);
const SonnerToaster = lazy(() =>
  import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })),
);
// wave-18 (2026-06-04): TooltipProvider moved into AuthenticatedShell. Zero
// landing-eager components mount a <Tooltip>. All Tooltip consumers live under
// dashboard routes (already wrapped in AuthenticatedShell) — App-level provider
// was the sole static-import edge dragging vendor-radix's tooltip slice + popper
// transitive graph onto every cold landing visit.
// wave-23 (2026-06-06): QueryClientProvider + queryClient eager imports retired.
// They were the sole module-graph edges anchoring vendor-query (28 KB raw / 7.95 KB gz)
// to the cold-landing modulepreload chain — zero eager-landing components reference
// react-query directly. The shared lazy wrapper `LazyQueryRoot` mounts QCP via a
// React.lazy chunk, used by (1) HeroSection's LiveStats+RecentHires Suspense block,
// (2) Index's lower lazy Suspense block, and (3) the App-level `QueryShell` layout
// route that wraps every non-landing path. The shared singleton queryClient still
// lives in `@/shared/api/queryClient` so every QCP mount points at the same cache.
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { LazyQueryRoot } from "@/shared/api/LazyQueryRoot";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuroraBackground } from "@/components/layout/AuroraBackground";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { SidebarProvider } from "@/hooks/useSidebarState";
import { AuthProvider } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
// AuthenticatedShell is lazy: it pulls in SidebarLayout + CommandPalette +
// CelebrationProvider + RequireProfilePicture which the literal landing route
// (`/`) does NOT need. Eager-importing it shipped ~40-60kB of sidebar/command
// UI on every cold visitor. Lazy means landing only loads the shell once a
// dashboard route is navigated to.
const AuthenticatedShell = lazy(() =>
  import("@/components/layout/AuthenticatedShell").then((m) => ({
    default: m.AuthenticatedShell,
  })),
);
import { RouteTelemetry } from "@/shared/telemetry/useRouteTelemetry";
// SupabaseHealthBanner is lazy: it renders null 99% of the time (only shows when
// Postgres data plane is slow/down). Eager-loading it pulled @/integrations/supabase/client
// + its 60s probe into the entry chunk. Deferring until 1s after LCP is invisible to
// users — outages are not first-paint events.
const SupabaseHealthBanner = lazy(() =>
  import("@/components/SupabaseHealthBanner").then((m) => ({
    default: m.SupabaseHealthBanner,
  })),
);
import { initTelemetry } from "@/shared/telemetry/track";

import { ProtectedRoute } from "@/components/ProtectedRoute";

initTelemetry();

// Eagerly loaded pages (critical path) — only the literal landing.
// Login + Apply moved to lazy so a visitor who only sees the home page
// doesn't pay for their (~50-100 kB each) bundles up front.
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
const Login = lazy(() => import("./pages/Login"));
const Apply = lazy(() => import("./pages/Apply"));
const StateCareerLanding = lazy(() => import("./pages/StateCareerLanding"));

// Lazy loaded pages (heavy or less critical)
const LogNumbers = lazy(() => import("./pages/LogNumbers"));
const ApplySuccess = lazy(() => import("./pages/ApplySuccess"));
const ApplySuccessLicensed = lazy(() => import("./pages/ApplySuccessLicensed"));
const ApplySuccessUnlicensed = lazy(() => import("./pages/ApplySuccessUnlicensed"));
const ApplicationStatus = lazy(() => import("./pages/ApplicationStatus"));
const StaleRecovery = lazy(() => import("./pages/StaleRecovery"));
const GetLicensed = lazy(() => import("./pages/GetLicensed"));
const Signup = lazy(() => import("./pages/Signup"));
const AgentSignup = lazy(() => import("./pages/AgentSignup"));
const AgentNumbersLogin = lazy(() => import("./pages/AgentNumbersLogin"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ApexControl = lazy(() => import("./pages/ApexControl"));
const BuildersDashboard = lazy(() => import("./pages/BuildersDashboard"));
const DashboardApplicants = lazy(() => import("./pages/DashboardApplicants"));
const DashboardAccounts = lazy(() => import("./pages/DashboardAccounts"));
const OffersPage = lazy(() => import("./pages/OffersPage"));
const Storefront = lazy(() => import("./pages/Storefront"));
const XcelPipeline = lazy(() => import("./pages/XcelPipeline"));
const DashboardCRM = lazy(() => import("./pages/DashboardCRM"));
const DashboardAgedLeads = lazy(() => import("./pages/DashboardAgedLeads"));
const DashboardCommandCenter = lazy(() => import("./pages/DashboardCommandCenter"));
const ManagerNextStepBoard = lazy(() => import("./pages/ManagerNextStepBoard"));
const AdminStuckPool = lazy(() => import("./pages/AdminStuckPool"));
const AdminFunnelHealth = lazy(() => import("./pages/AdminFunnelHealth"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const ScheduleCall = lazy(() => import("./pages/ScheduleCall"));
const Settings = lazy(() => import("./pages/Settings"));
const DeletedLeadsVault = lazy(() => import("./pages/DeletedLeadsVault"));

const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const AgentPortal = lazy(() => import("./pages/AgentPortal"));
const AgentCommandDashboard = lazy(() => import("./pages/AgentCommandDashboard"));
const OnboardingCourse = lazy(() => import("./pages/OnboardingCourse"));
const CourseCatalog = lazy(() => import("./pages/CourseCatalog"));
const MagicLogin = lazy(() => import("./pages/MagicLogin"));
const Numbers = lazy(() => import("./pages/Numbers"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Disclosures = lazy(() => import("./pages/Disclosures"));
const Install = lazy(() => import("./pages/Install"));
const CourseProgress = lazy(() => import("./pages/CourseProgress"));
const CourseContent = lazy(() => import("./pages/CourseContent"));
const PurchaseLeads = lazy(() => import("./pages/PurchaseLeads"));
const LeadsLanding = lazy(() => import("./pages/LeadsLanding"));
const CallCenter = lazy(() => import("./pages/CallCenter"));
// v9 Wave A complaint #2: LeadCenter no longer mounted; /dashboard/leads redirects.
// const LeadCenter = lazy(() => import("./pages/LeadCenter"));
const RecruiterDashboard = lazy(() => import("./pages/RecruiterDashboard"));
const AgentPipeline = lazy(() => import("./pages/AgentPipeline"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const NotificationHub = lazy(() => import("./pages/NotificationHub"));
const LinksPage = lazy(() => import("./pages/LinksPage"));
const AdminCalendar = lazy(() => import("./pages/AdminCalendar"));
const AdminBoardAccess = lazy(() => import("./pages/AdminBoardAccess"));
const AwardGraphics = lazy(() => import("./pages/AwardGraphics"));
const SeminarPage = lazy(() => import("./pages/SeminarPage"));
const ApplicantCheckin = lazy(() => import("./pages/ApplicantCheckin"));
const AgentFlow = lazy(() => import("./pages/AgentFlow"));
const InboxPage = lazy(() => import("./pages/InboxPage"));
const MyApplicants = lazy(() => import("./pages/admin/MyApplicants"));
const AddReferral = lazy(() => import("./pages/admin/AddReferral"));
const RecruitingInbox = lazy(() => import("./pages/admin/RecruitingInbox"));
const AutomationHub = lazy(() => import("./pages/AutomationHub"));
const AutomationHealth = lazy(() => import("./pages/AutomationHealth"));
const TeamHierarchy = lazy(() => import("./pages/TeamHierarchy"));
const AgentPipelineSimple = lazy(() => import("./pages/AgentPipelineSimple"));
const InstagramAutomation = lazy(() => import("./pages/InstagramAutomation"));
const ContentLibrary = lazy(() => import("./pages/ContentLibrary"));
const HiringPipeline = lazy(() => import("./pages/HiringPipeline"));
const BookOfBusiness = lazy(() => import("./pages/BookOfBusiness"));
const BusinessAnalytics = lazy(() => import("./pages/BusinessAnalytics"));
const TeamAnalytics = lazy(() => import("./pages/TeamAnalytics"));
const AwardsGallery = lazy(() => import("./pages/AwardsGallery"));
const HallOfFame = lazy(() => import("./pages/HallOfFame"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const DataDeletion = lazy(() => import("./pages/DataDeletion"));
const Contact = lazy(() => import("./pages/Contact"));
const BotToken = lazy(() => import("./pages/BotToken"));
const InstagramInbox = lazy(() => import("./pages/InstagramInbox"));
const Today = lazy(() => import("./pages/Today"));
const RecruitCommandCenter = lazy(() => import("./pages/RecruitCommandCenter"));
const TeamChat = lazy(() => import("./pages/TeamChat"));
const BulkDeals = lazy(() => import("./pages/BulkDeals"));
const AgentLinkSync = lazy(() => import("./pages/AgentLinkSync"));
const AgentLinkVault = lazy(() => import("./pages/AgentLinkVault"));
const ClientPipeline = lazy(() => import("./pages/ClientPipeline"));
const InboundLeads = lazy(() => import("./pages/InboundLeads"));
const SocialDashboard = lazy(() => import("./pages/SocialDashboard"));
const CallsTodayCockpit = lazy(() => import("./pages/CallsTodayCockpit"));
const ManagerCommandView = lazy(() => import("./pages/ManagerCommandView"));
const WhaleRecruiting = lazy(() => import("./pages/WhaleRecruiting"));
const CarrierContracts = lazy(() => import("./pages/CarrierContracts"));
const Challenges = lazy(() => import("./pages/Challenges"));
const Setup = lazy(() => import("./pages/admin/Setup"));
const SamHQ = lazy(() => import("./pages/admin/SamHQ"));
const UnclaimedLeads = lazy(() => import("./pages/admin/UnclaimedLeads"));
const ManagerDashboard = lazy(() => import("./pages/admin/ManagerDashboard"));
const LicensingTracker = lazy(() => import("./pages/admin/LicensingTracker"));
const CommissionRecovery = lazy(() => import("./pages/admin/CommissionRecovery"));
const Join = lazy(() => import("./pages/Join"));
const AgentDetail = lazy(() => import("./pages/AgentDetail"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Rewards = lazy(() => import("./pages/Rewards"));
const AgentManagement = lazy(() => import("./pages/AgentManagement"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const PrelicensingManager = lazy(() => import("./pages/PrelicensingManager"));
const MyCommissions = lazy(() => import("./pages/MyCommissions"));
const HiringManagerAssignments = lazy(() => import("./pages/HiringManagerAssignments"));
const GettingStarted = lazy(() => import("./pages/GettingStarted"));
const InactiveAgents = lazy(() => import("./pages/InactiveAgents"));
const PlaqueShare = lazy(() => import("./pages/PlaqueShare"));
const MyPlaques = lazy(() => import("./pages/MyPlaques"));
const EmailDeliveryLog = lazy(() => import("./pages/EmailDeliveryLog"));
const CompTiersSettings = lazy(() => import("./pages/admin/CompTiersSettings"));
const IntegrationsSettings = lazy(() => import("./pages/admin/IntegrationsSettings"));
const MyTeam = lazy(() => import("./pages/MyTeam"));
const MyDeals = lazy(() => import("./pages/MyDeals"));
const SeminarControl = lazy(() => import("./pages/SeminarControl"));
const SamInbox = lazy(() => import("./pages/SamInbox"));
const ReferralSubmit = lazy(() => import("./pages/ReferralSubmit"));
const ReferralPipeline = lazy(() => import("./pages/ReferralPipeline"));
const MyReferrals = lazy(() => import("./pages/MyReferrals"));
const MyNotifications = lazy(() => import("./pages/MyNotifications"));
const AdminStrikes = lazy(() => import("./pages/AdminStrikes"));
const MyStrikes = lazy(() => import("./pages/MyStrikes"));
// v9 Wave A complaint #19: ChargesAudit no longer mounted; route redirects.
// const ChargesAudit = lazy(() => import("./pages/ChargesAudit"));
const SocialMediaBot = lazy(() => import("./pages/admin/SocialMediaBot"));
const TelegramBot = lazy(() => import("./pages/admin/TelegramBot"));
// v9 Wave A complaint #20: ConductCommandCenter no longer mounted; route redirects.
// const ConductCommandCenter = lazy(() => import("./pages/ConductCommandCenter"));
const PreLicensing = lazy(() => import("./pages/PreLicensing"));
const BookReconciliation = lazy(() => import("./pages/BookReconciliation"));
const ReadyModeIntegration = lazy(() => import("./pages/ReadyModeIntegration"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ContentWheel = lazy(() => import("./pages/ContentWheel"));
const ContentCommand = lazy(() => import("./pages/admin/ContentCommand"));
const LeadPayments = lazy(() => import("./pages/LeadPayments"));
const OldApplicants = lazy(() => import("./pages/OldApplicants"));

// queryClient now lives in src/shared/api/queryClient.ts (smart retry + global error logging)

// wave-38 (2026-06-08): Toasters now mount on first user interaction (pointer/
// key/scroll/touch) with a 30s safety net, NOT on requestIdleCallback. Wave-37's
// live Lighthouse showed vendor-radix STILL on cold-landing transfers (47 KB gz)
// even after sonner static-imports were lazy-facaded. Root cause traced here:
// wave-17 idle-prefetched both `@/components/ui/toaster` (shadcn — pulls
// @radix-ui/react-toast = vendor-radix) and `@/components/ui/sonner` ~1s after
// mount, well inside Lighthouse's audit window. Both toaster libraries queue
// toasts to a module-level store before mount, so deferring the mount until first
// real user interaction loses no toasts — sonner + shadcn replay queued toasts
// when Toaster renders. Lighthouse runs without simulated interaction, so its
// audit window measures zero toaster fetch → vendor-radix drops off cold-landing
// transfers. Safety net (30s) covers the rare case where a silent toast (e.g.
// queryClient retry) needs to surface before the user touches the page.
function DeferredToasters() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let done = false;
    const arm = () => {
      if (done) return;
      done = true;
      cleanup();
      setArmed(true);
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    const opts = { passive: true } as const;
    const cleanup = () => events.forEach((e) => window.removeEventListener(e, arm, opts));
    events.forEach((e) => window.addEventListener(e, arm, opts));
    const safety = window.setTimeout(arm, 30000);
    return () => {
      cleanup();
      window.clearTimeout(safety);
    };
  }, []);
  if (!armed) return null;
  return (
    <Suspense fallback={null}>
      <ToasterShadcn />
      <SonnerToaster />
    </Suspense>
  );
}

// wave-23: Layout route wrapping every non-landing path with the lazy
// QueryClientProvider. Landing (`/`) is intentionally a sibling — Index.tsx +
// HeroSection.tsx wrap their own lazy Suspense blocks with LazyQueryRoot, so
// landing renders eager content (h1 + video poster + carrier marquee) without
// waiting for vendor-query to download.
function QueryShell() {
  return (
    <LazyQueryRoot>
      <Outlet />
    </LazyQueryRoot>
  );
}

// Page loading fallback
function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-12 w-48 mx-auto" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <SidebarProvider>
        <DeferredToasters />
          <Suspense fallback={null}>
            <SupabaseHealthBanner />
          </Suspense>
          <AuroraBackground />
          <BrowserRouter>
            <ScrollToTop />
            <RouteTelemetry />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Landing route — bare. No QCP wrapper at this level.
                    Index.tsx + HeroSection.tsx wrap their own lazy Suspense blocks
                    with LazyQueryRoot so the eager render path (h1 + video poster +
                    carrier marquee) does NOT pull vendor-query into the cold-landing
                    preload chain. wave-23 (2026-06-06). */}
                <Route path="/" element={<Index />} />
                {/* QueryShell layout — every non-landing path inherits the lazy
                    QueryClientProvider. log-numbers redirect + NotFound stay outside
                    because they make zero useQuery calls. */}
                <Route element={<QueryShell />}>
                <Route path="/careers/:state" element={<StateCareerLanding />} />
                  <Route path="/apply" element={<Apply />} />
                  <Route path="/apply/success" element={<ApplySuccess />} />
                  <Route path="/apply/success/licensed" element={<ApplySuccessLicensed />} />
                  <Route path="/apply/success/unlicensed" element={<ApplySuccessUnlicensed />} />
                  {/* Public status page — applicant can return at any time and see
                      assigned manager, next seminar, status step. Powered by
                      get_application_status() RPC (SECURITY DEFINER, anon-callable). */}
                  <Route path="/status/:applicationId" element={<ApplicationStatus />} />
                  <Route path="/get-licensed" element={<GetLicensed />} />
                  <Route path="/login" element={<Login />} />
                  {/* PL-014 — landing for Supabase password-reset email links */}
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/join" element={<Join />} />
                  {/* /agent-signup is the canonical recruiting URL referenced from
                      Install.tsx and recruiting CTAs. /join remains the separate
                      combined sign-in / create-account flow used by existing links. */}
                  <Route path="/agent-signup" element={<AgentSignup />} />
                  <Route path="/agent-login" element={<AgentNumbersLogin />} />
                  <Route path="/magic-login" element={<MagicLogin />} />
                  <Route path="/schedule-call" element={<ScheduleCall />} />
                  <Route path="/pending-approval" element={<PendingApproval />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/disclosures" element={<Disclosures />} />
                  <Route path="/install" element={<Install />} />
                  {/* /apex-daily-numbers is internal-only — was publicly exposing
                      production-entry UI. Now requires a logged-in user (any role). */}
                  <Route path="/apex-daily-numbers" element={<ProtectedRoute><LogNumbers /></ProtectedRoute>} />
                  <Route path="/links" element={<LinksPage />} />
                  <Route path="/seminar" element={<SeminarPage />} />
                  <Route path="/leads" element={<LeadsLanding />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/storefront" element={<Storefront />} />
                  <Route path="/get-leads" element={<LeadsLanding />} />
                  <Route path="/dialer" element={<LeadsLanding />} />
                  <Route path="/data-deletion" element={<DataDeletion />} />
                  <Route path="/delete-my-data" element={<DataDeletion />} />
                  <Route path="/checkin" element={<ApplicantCheckin />} />
                  <Route path="/daily-checkin" element={<ApplicantCheckin />} />
                  {/* field-checkin route removed */}
                  <Route path="/agent-flow" element={<AgentFlow />} />
                  {/* /awards exposes Instagram-ready award graphics generation.
                      Admin-only — was publicly accessible. */}
                  <Route path="/awards" element={<ProtectedRoute requireAdmin><AwardGraphics /></ProtectedRoute>} />
                  {/* Public plaque share — no auth required */}
                  <Route path="/plaque/:slug" element={<PlaqueShare />} />
                  {/* Authenticated shell - sidebar mounted once */}
                  <Route element={<AuthenticatedShell />}>
                    {/* Launch dashboard: role preview, live source-of-truth
                        numbers, and agent/manager/admin views live here.
                        The old command center stays available below. */}
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/dashboard/apex-control" element={<ProtectedRoute requireAdmin><ApexControl /></ProtectedRoute>} />
                    <Route path="/dashboard/builders" element={<ProtectedRoute requireAdmin><BuildersDashboard mode="builders" /></ProtectedRoute>} />
                    <Route path="/dashboard/builders/:builderId" element={<ProtectedRoute requireAdmin><BuildersDashboard mode="builders" /></ProtectedRoute>} />
                    <Route path="/dashboard/managers" element={<ProtectedRoute requireAdmin><BuildersDashboard mode="managers" /></ProtectedRoute>} />
                    <Route path="/dashboard/agency-owners" element={<ProtectedRoute requireAdmin><BuildersDashboard mode="agencyOwners" /></ProtectedRoute>} />
                    <Route path="/dashboard/legacy" element={<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>} />
                    <Route path="/dashboard/applicants" element={<DashboardApplicants />} />
                    {/* Manager self-serve: view their referrals + drop new ones (Sam 2026-06-03) */}
                    <Route path="/admin/my-applicants" element={<ProtectedRoute allowManagers><MyApplicants /></ProtectedRoute>} />
                    <Route path="/admin/add-referral" element={<ProtectedRoute allowManagers><AddReferral /></ProtectedRoute>} />
                    {/* PL-SAM-2026-06-03-001: uncontacted-first recruiting queue. v_recruiting_inbox is SECURITY INVOKER so RLS scopes rows per role. */}
                    <Route path="/admin/recruiting-inbox" element={<ProtectedRoute allowManagers><RecruitingInbox /></ProtectedRoute>} />
                    {/* Stale-recovery panel — admins/managers only. v_stale_applicants
                        feeds it. Additive: doesn't touch DashboardApplicants. */}
                    <Route path="/dashboard/stale-recovery" element={<ProtectedRoute allowManagers><StaleRecovery /></ProtectedRoute>} />
                    <Route path="/dashboard/accounts" element={<ProtectedRoute requireAdmin><DashboardAccounts /></ProtectedRoute>} />
                    <Route path="/dashboard/offers" element={<ProtectedRoute requireAdmin><OffersPage /></ProtectedRoute>} />
                    <Route path="/dashboard/xcel-pipeline" element={<ProtectedRoute requireAdmin><XcelPipeline /></ProtectedRoute>} />
                    <Route path="/dashboard/settings" element={<Settings />} />
                    <Route path="/dashboard/settings/deleted-leads" element={<ProtectedRoute requireAdmin><DeletedLeadsVault /></ProtectedRoute>} />
                    <Route path="/dashboard/team" element={<Navigate to="/dashboard/hierarchy" replace />} />
                    {/* Wave F v9: canonical CRM is /dashboard/clients (alias of ClientPipeline).
                        Legacy /dashboard/crm + /dashboard/client-pipeline redirect to it so
                        existing bookmarks survive. DashboardCRM.tsx kept for one cycle then
                        removable; the redirect makes its component unreachable in practice. */}
                    <Route path="/dashboard/clients" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                    <Route path="/dashboard/crm" element={<Navigate to="/dashboard/clients" replace />} />
                    <Route path="/dashboard/aged-leads" element={<DashboardAgedLeads />} />
                    <Route path="/dashboard/command" element={<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>} />
                    <Route path="/dashboard/team/next-step" element={<ProtectedRoute requireAdmin allowManagers><ManagerNextStepBoard /></ProtectedRoute>} />
                    <Route path="/admin/next-step/stuck" element={<ProtectedRoute requireAdmin><AdminStuckPool /></ProtectedRoute>} />
                    <Route path="/admin/next-step/funnel-health" element={<ProtectedRoute requireAdmin><AdminFunnelHealth /></ProtectedRoute>} />
                    <Route path="/dashboard/clients/:clientId" element={<ProtectedRoute><ClientDetail /></ProtectedRoute>} />
                    {/* Seminar control: admins, managers, and flagged presenters
                        such as KJ (agents.is_presenting=true). */}
                    <Route path="/dashboard/seminar" element={<ProtectedRoute requireAdmin allowManagers allowPresenters><SeminarControl /></ProtectedRoute>} />
                    <Route path="/dashboard/seminar-control" element={<ProtectedRoute requireAdmin allowManagers allowPresenters><SeminarControl /></ProtectedRoute>} />
                    <Route path="/dashboard/my-inbox" element={<ProtectedRoute requireAdmin><SamInbox /></ProtectedRoute>} />
                    {/* Manager referral pipeline: admin or manager. */}
                    <Route path="/dashboard/referrals" element={<ProtectedRoute requireAdmin allowManagers><ReferralPipeline /></ProtectedRoute>} />
                    {/* Agent self-service: any authenticated user. */}
                    <Route path="/dashboard/referrals/mine" element={<ProtectedRoute><MyReferrals /></ProtectedRoute>} />
                    <Route path="/dashboard/referrals/new" element={<ProtectedRoute><ReferralSubmit /></ProtectedRoute>} />
                    <Route path="/dashboard/notifications/mine" element={<ProtectedRoute><MyNotifications /></ProtectedRoute>} />
                    {/* Agents land on the new command dashboard. Legacy
                        portal (heavy card stack) kept at /agent-portal/legacy. */}
                    <Route path="/agent-portal" element={<AgentCommandDashboard />} />
                    <Route path="/agent-dashboard" element={<AgentCommandDashboard />} />
                    <Route path="/agent-portal/legacy" element={<AgentPortal />} />
                    <Route path="/onboarding-course" element={<OnboardingCourse />} />
                    <Route path="/course-catalog" element={<CourseCatalog />} />
                    <Route path="/course-progress" element={<CourseProgress />} />
                    <Route path="/course-progress/content" element={<CourseContent />} />
                    <Route path="/numbers" element={<Numbers />} />
                    <Route path="/purchase-leads" element={<PurchaseLeads />} />
                    <Route path="/dashboard/call-center" element={<CallCenter />} />
                     {/* v9 Wave A complaint #2: /dashboard/leads removed.
                         Inbound flow lives at /dashboard/inbound-leads now. */}
                     <Route path="/dashboard/leads" element={<Navigate to="/dashboard/inbound-leads" replace />} />
                     {/* v9 social dashboard: cross-platform IG / TikTok / YT / Snap analytics */}
                     <Route path="/dashboard/social" element={<ProtectedRoute requireAdmin><SocialDashboard /></ProtectedRoute>} />
                     {/* v9 calls cockpit: Google Calendar → apex_scheduled_calls → pre-filled inbound */}
                     <Route path="/dashboard/calls-today" element={<ProtectedRoute><CallsTodayCockpit /></ProtectedRoute>} />
                     {/* v18 admin-only whale recruiting tracker */}
                     <Route path="/dashboard/whales" element={<ProtectedRoute requireAdmin><WhaleRecruiting /></ProtectedRoute>} />
                     {/* v22 Wave B: carrier contracts (admin only) */}
                     <Route path="/dashboard/contracts" element={<ProtectedRoute requireAdmin><CarrierContracts /></ProtectedRoute>} />
                     {/* v22 Wave H: challenges/gamification */}
                     <Route path="/dashboard/challenges" element={<ProtectedRoute><Challenges /></ProtectedRoute>} />
                     <Route path="/dashboard/recruiter" element={<RecruiterDashboard />} />
                     {/* Recruit pipeline — applicants/license/contracting flow. Was /agent-pipeline. */}
                     <Route path="/recruit-pipeline" element={<ProtectedRoute><AgentPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/recruit-pipeline" element={<ProtectedRoute><AgentPipeline /></ProtectedRoute>} />
                     {/* Agent Pipeline — client/policy servicing book of business. */}
                     <Route path="/agent-pipeline" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/agent-pipeline" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/client-pipeline" element={<Navigate to="/dashboard/clients" replace />} />
                     <Route path="/dashboard/inbound-leads" element={<ProtectedRoute><InboundLeads /></ProtectedRoute>} />
                     <Route path="/dashboard/inbound" element={<ProtectedRoute><InboundLeads /></ProtectedRoute>} />
                     <Route path="/dashboard/calendar" element={<CalendarPage />} />
                     <Route path="/dashboard/notifications" element={<ProtectedRoute requireAdmin><NotificationHub /></ProtectedRoute>} />
                     <Route path="/dashboard/planner" element={<ProtectedRoute requireAdmin><AdminCalendar /></ProtectedRoute>} />
                       <Route path="/dashboard/inbox" element={<ProtectedRoute requireAdmin><InboxPage /></ProtectedRoute>} />
                       <Route path="/dashboard/automation" element={<ProtectedRoute requireAdmin><AutomationHub /></ProtectedRoute>} />
                       <Route path="/dashboard/book-of-business" element={<ProtectedRoute><BookOfBusiness /></ProtectedRoute>} />
                       <Route path="/dashboard/business-analytics" element={<ProtectedRoute><BusinessAnalytics /></ProtectedRoute>} />
                       <Route path="/dashboard/team-analytics" element={<ProtectedRoute><TeamAnalytics /></ProtectedRoute>} />
                       <Route path="/dashboard/awards" element={<ProtectedRoute><AwardsGallery /></ProtectedRoute>} />
                       <Route path="/dashboard/hall-of-fame" element={<ProtectedRoute><HallOfFame /></ProtectedRoute>} />
                       <Route path="/hall-of-fame" element={<HallOfFame />} />
                       {/* /privacy and /terms are public routes above — don't duplicate here */}
                       <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                       <Route path="/terms-of-service" element={<TermsOfService />} />
                       <Route path="/bot-token" element={<ProtectedRoute requireAdmin><BotToken /></ProtectedRoute>} />
                       <Route path="/dashboard/bot-token" element={<ProtectedRoute requireAdmin><BotToken /></ProtectedRoute>} />
                       <Route path="/dashboard/inbox/instagram" element={<ProtectedRoute><InstagramInbox /></ProtectedRoute>} />
                       <Route path="/dashboard/instagram-inbox" element={<ProtectedRoute><InstagramInbox /></ProtectedRoute>} />
                       <Route path="/dashboard/today" element={<ProtectedRoute><Today /></ProtectedRoute>} />
                       <Route path="/today" element={<ProtectedRoute><Today /></ProtectedRoute>} />
                       <Route path="/dashboard/recruit" element={<ProtectedRoute><RecruitCommandCenter /></ProtectedRoute>} />
                       <Route path="/recruit" element={<ProtectedRoute><RecruitCommandCenter /></ProtectedRoute>} />
                       <Route path="/dashboard/team-chat" element={<ProtectedRoute><TeamChat /></ProtectedRoute>} />
                       <Route path="/team-chat" element={<ProtectedRoute><TeamChat /></ProtectedRoute>} />
                       <Route path="/dashboard/bulk-deals" element={<ProtectedRoute><BulkDeals /></ProtectedRoute>} />
                       <Route path="/bulk-deals" element={<ProtectedRoute><BulkDeals /></ProtectedRoute>} />
                       <Route path="/dashboard/agentlink-sync" element={<ProtectedRoute><AgentLinkSync /></ProtectedRoute>} />
                       <Route path="/agentlink-sync" element={<ProtectedRoute><AgentLinkSync /></ProtectedRoute>} />
                       <Route path="/dashboard/agentlink-vault" element={<ProtectedRoute requireAdmin><AgentLinkVault /></ProtectedRoute>} />
                       <Route path="/setup" element={<ProtectedRoute requireAdmin><Setup /></ProtectedRoute>} />
                       <Route path="/dashboard/setup" element={<ProtectedRoute requireAdmin><Setup /></ProtectedRoute>} />
                       <Route path="/agent/:id" element={<ProtectedRoute><AgentDetail /></ProtectedRoute>} />
                       <Route path="/dashboard/agent/:id" element={<ProtectedRoute><AgentDetail /></ProtectedRoute>} />
                       <Route path="/dashboard/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
                       <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
                       <Route path="/dashboard/rewards" element={<ProtectedRoute><Rewards /></ProtectedRoute>} />
                       <Route path="/rewards" element={<ProtectedRoute><Rewards /></ProtectedRoute>} />
                       <Route path="/dashboard/automation-health" element={<ProtectedRoute requireAdmin><AutomationHealth /></ProtectedRoute>} />
                        <Route path="/dashboard/hierarchy" element={<ProtectedRoute><TeamHierarchy /></ProtectedRoute>} />
                        <Route path="/dashboard/pipeline-simple" element={<AgentPipelineSimple />} />
                         <Route path="/dashboard/instagram-automation" element={<ProtectedRoute requireAdmin><InstagramAutomation /></ProtectedRoute>} />
                          <Route path="/dashboard/content" element={<ProtectedRoute requireAdmin><ContentLibrary /></ProtectedRoute>} />
                           <Route path="/dashboard/hiring-pipeline" element={<ProtectedRoute requireAdmin allowManagers><HiringPipeline /></ProtectedRoute>} />
                          <Route path="/dashboard/admin/board-access" element={<ProtectedRoute requireAdmin><AdminBoardAccess /></ProtectedRoute>} />
                           <Route path="/dashboard/prelicensing" element={<ProtectedRoute><PrelicensingManager /></ProtectedRoute>} />
                           <Route path="/dashboard/agent-management" element={<ProtectedRoute requireAdmin><AgentManagement /></ProtectedRoute>} />
                           <Route path="/dashboard/system-health" element={<ProtectedRoute requireAdmin><SystemHealth /></ProtectedRoute>} />
                           <Route path="/dashboard/my-commissions" element={<ProtectedRoute><MyCommissions /></ProtectedRoute>} />
                           <Route path="/dashboard/hiring-routing" element={<ProtectedRoute requireAdmin><HiringManagerAssignments /></ProtectedRoute>} />
                           <Route path="/dashboard/getting-started" element={<ProtectedRoute><GettingStarted /></ProtectedRoute>} />
                           <Route path="/dashboard/inactive-agents" element={<ProtectedRoute><InactiveAgents /></ProtectedRoute>} />
                           <Route path="/dashboard/my-plaques" element={<ProtectedRoute><MyPlaques /></ProtectedRoute>} />
                           <Route path="/dashboard/email-log" element={<ProtectedRoute requireAdmin><EmailDeliveryLog /></ProtectedRoute>} />
                           <Route path="/dashboard/comp-tiers" element={<ProtectedRoute requireAdmin><CompTiersSettings /></ProtectedRoute>} />
                           <Route path="/dashboard/integrations" element={<ProtectedRoute requireAdmin><IntegrationsSettings /></ProtectedRoute>} />
                           <Route path="/dashboard/my-team" element={<ProtectedRoute><MyTeam /></ProtectedRoute>} />
                           <Route path="/dashboard/my-deals" element={<ProtectedRoute><MyDeals /></ProtectedRoute>} />
                           {/* ContentWheel — personal-brand + recruiting Content OS (admin-only). */}
                           <Route path="/admin/contentwheel" element={<ProtectedRoute requireAdmin><ContentWheel /></ProtectedRoute>} />
                           {/* Content Command — unified draft queue + approval command center */}
                           <Route path="/dashboard/admin/content-command" element={<ProtectedRoute requireAdmin><ContentCommand /></ProtectedRoute>} />
                           {/* Conduct: admin issues strikes; agents view their own record. */}
                           <Route path="/dashboard/strikes" element={<ProtectedRoute requireAdmin><AdminStrikes /></ProtectedRoute>} />
                           <Route path="/dashboard/my-strikes" element={<ProtectedRoute><MyStrikes /></ProtectedRoute>} />
                           {/* v9 Wave A complaint #19: charges-audit removed.
                             Redirect kept so old bookmarks land somewhere sane. */}
                           <Route path="/dashboard/charges-audit" element={<Navigate to="/dashboard" replace />} />
                           <Route path="/dashboard/lead-payments" element={<ProtectedRoute requireAdmin><LeadPayments /></ProtectedRoute>} />
                           <Route path="/dashboard/old-applicants/managers" element={<ProtectedRoute requireAdmin allowManagers><OldApplicants kind="managers" /></ProtectedRoute>} />
                           <Route path="/dashboard/old-applicants/licensed-recruiters" element={<ProtectedRoute requireAdmin allowManagers><OldApplicants kind="licensedRecruiters" /></ProtectedRoute>} />
                           {/* v9 Wave A complaint #20: conduct command center removed.
                             Strikes still at /dashboard/strikes for the actual use case. */}
                           <Route path="/dashboard/conduct" element={<Navigate to="/dashboard/strikes" replace />} />
                           {/* XCEL Solutions daily pre-licensing report viewer */}
                           <Route path="/dashboard/pre-licensing" element={<ProtectedRoute requireAdmin allowManagers><PreLicensing /></ProtectedRoute>} />
                           {/* Book Quality Engine — carrier-direct vs internal recon */}
                           <Route path="/dashboard/book-quality" element={<ProtectedRoute requireAdmin allowManagers><BookReconciliation /></ProtectedRoute>} />
                           {/* ReadyMode dialer integration — credentials live in system_settings */}
                           <Route path="/dashboard/readymode" element={<ProtectedRoute requireAdmin><ReadyModeIntegration /></ProtectedRoute>} />
                           {/* Social Media Bot — APEX content engine dashboard */}
                           <Route path="/dashboard/admin/social-media-bot" element={<ProtectedRoute requireAdmin><SocialMediaBot /></ProtectedRoute>} />
                           {/* Telegram Bot — APEX pre-hire + onboarding operating layer */}
                           <Route path="/dashboard/admin/telegram-bot" element={<ProtectedRoute requireAdmin><TelegramBot /></ProtectedRoute>} />
                           {/* Sam HQ — Sam's command surface: today's tasks, week strip, what shipped, leaks, bots */}
                           <Route path="/dashboard/admin/sam" element={<ProtectedRoute requireAdmin><SamHQ /></ProtectedRoute>} />
                           {/* Unclaimed Leads — bulk reassign + per-row claim back to Sam */}
                           <Route path="/dashboard/admin/unclaimed" element={<ProtectedRoute requireAdmin><UnclaimedLeads /></ProtectedRoute>} />
                           {/* Manager Command — 3 tabs (Recruiting / Licensing / Production) for any manager */}
                           <Route path="/dashboard/admin/manager" element={<ProtectedRoute requireAdmin allowManagers><ManagerDashboard /></ProtectedRoute>} />
                           {/* Licensing Tracker — 8-stage kanban + stalled-SLA pane */}
                           <Route path="/dashboard/admin/licensing" element={<ProtectedRoute requireAdmin allowManagers><LicensingTracker /></ProtectedRoute>} />
                           {/* Commission Recovery — ghost AP stays out of real AP until policy data is recovered */}
                           <Route path="/dashboard/admin/commission-recovery" element={<ProtectedRoute requireAdmin><CommissionRecovery /></ProtectedRoute>} />
                  </Route>
                </Route>

                {/* Legacy redirect — outside QueryShell (no useQuery) */}
                <Route path="/log-numbers" element={<Navigate to="/apex-daily-numbers" replace />} />

                {/* Catch-all — outside QueryShell (NotFound is static) */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
      </SidebarProvider>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
