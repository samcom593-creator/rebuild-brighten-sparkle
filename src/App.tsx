import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/shared/api/queryClient";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuroraBackground } from "@/components/layout/AuroraBackground";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { SidebarProvider } from "@/hooks/useSidebarState";
import { AuthProvider } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { RouteTelemetry } from "@/shared/telemetry/useRouteTelemetry";
import { SupabaseHealthBanner } from "@/components/SupabaseHealthBanner";
import { initTelemetry } from "@/shared/telemetry/track";

import { ProtectedRoute } from "@/components/ProtectedRoute";

initTelemetry();

// Eagerly loaded pages (critical path)
import Index from "./pages/Index";
import Login from "./pages/Login";
import Apply from "./pages/Apply";
import NotFound from "./pages/NotFound";

// Lazy loaded pages (heavy or less critical)
const LogNumbers = lazy(() => import("./pages/LogNumbers"));
const ApplySuccess = lazy(() => import("./pages/ApplySuccess"));
const ApplySuccessLicensed = lazy(() => import("./pages/ApplySuccessLicensed"));
const ApplySuccessUnlicensed = lazy(() => import("./pages/ApplySuccessUnlicensed"));
const GetLicensed = lazy(() => import("./pages/GetLicensed"));
const Signup = lazy(() => import("./pages/Signup"));
const AgentSignup = lazy(() => import("./pages/AgentSignup"));
const AgentNumbersLogin = lazy(() => import("./pages/AgentNumbersLogin"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DashboardApplicants = lazy(() => import("./pages/DashboardApplicants"));
const DashboardAdmin = lazy(() => import("./pages/DashboardAdmin"));
const DashboardAccounts = lazy(() => import("./pages/DashboardAccounts"));
const OffersPage = lazy(() => import("./pages/OffersPage"));
const Storefront = lazy(() => import("./pages/Storefront"));
const XcelPipeline = lazy(() => import("./pages/XcelPipeline"));
const DashboardCRM = lazy(() => import("./pages/DashboardCRM"));
const DashboardAgedLeads = lazy(() => import("./pages/DashboardAgedLeads"));
const DashboardCommandCenter = lazy(() => import("./pages/DashboardCommandCenter"));
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
const LeadCenter = lazy(() => import("./pages/LeadCenter"));
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
const AutomationHub = lazy(() => import("./pages/AutomationHub"));
const AutomationHealth = lazy(() => import("./pages/AutomationHealth"));
const TeamHierarchy = lazy(() => import("./pages/TeamHierarchy"));
const AgentPipelineSimple = lazy(() => import("./pages/AgentPipelineSimple"));
const InstagramAutomation = lazy(() => import("./pages/InstagramAutomation"));
const ContentLibrary = lazy(() => import("./pages/ContentLibrary"));
const HiringPipeline = lazy(() => import("./pages/HiringPipeline"));
const BookOfBusiness = lazy(() => import("./pages/BookOfBusiness"));
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
const Setup = lazy(() => import("./pages/admin/Setup"));
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
const ReferralSubmit = lazy(() => import("./pages/ReferralSubmit"));
const ReferralPipeline = lazy(() => import("./pages/ReferralPipeline"));
const MyReferrals = lazy(() => import("./pages/MyReferrals"));
const MyNotifications = lazy(() => import("./pages/MyNotifications"));
const AdminStrikes = lazy(() => import("./pages/AdminStrikes"));
const MyStrikes = lazy(() => import("./pages/MyStrikes"));
const ChargesAudit = lazy(() => import("./pages/ChargesAudit"));
const ConductCommandCenter = lazy(() => import("./pages/ConductCommandCenter"));

// queryClient now lives in src/shared/api/queryClient.ts (smart retry + global error logging)

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <SidebarProvider>
            <Toaster />
            <Sonner />
            <SupabaseHealthBanner />
            <AuroraBackground />
            <BrowserRouter>
              <ScrollToTop />
              <RouteTelemetry />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  {/* Public routes */}
                  <Route path="/" element={<Index />} />
                  <Route path="/apply" element={<Apply />} />
                  <Route path="/apply/success" element={<ApplySuccess />} />
                  <Route path="/apply/success/licensed" element={<ApplySuccessLicensed />} />
                  <Route path="/apply/success/unlicensed" element={<ApplySuccessUnlicensed />} />
                  <Route path="/get-licensed" element={<GetLicensed />} />
                  <Route path="/login" element={<Login />} />
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
                    <Route path="/dashboard/legacy" element={<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>} />
                    <Route path="/dashboard/applicants" element={<DashboardApplicants />} />
                    <Route path="/dashboard/admin" element={<DashboardAdmin />} />
                    <Route path="/dashboard/accounts" element={<ProtectedRoute requireAdmin><DashboardAccounts /></ProtectedRoute>} />
                    <Route path="/dashboard/offers" element={<ProtectedRoute requireAdmin><OffersPage /></ProtectedRoute>} />
                    <Route path="/dashboard/xcel-pipeline" element={<ProtectedRoute requireAdmin><XcelPipeline /></ProtectedRoute>} />
                    <Route path="/dashboard/settings" element={<Settings />} />
                    <Route path="/dashboard/settings/deleted-leads" element={<ProtectedRoute requireAdmin><DeletedLeadsVault /></ProtectedRoute>} />
                    <Route path="/dashboard/team" element={<Navigate to="/dashboard/hierarchy" replace />} />
                    <Route path="/dashboard/crm" element={<DashboardCRM />} />
                    <Route path="/dashboard/aged-leads" element={<DashboardAgedLeads />} />
                    <Route path="/dashboard/command" element={<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>} />
                    {/* Seminar control: admins, managers, and flagged presenters
                        such as KJ (agents.is_presenting=true). */}
                    <Route path="/dashboard/seminar-control" element={<ProtectedRoute requireAdmin allowManagers allowPresenters><SeminarControl /></ProtectedRoute>} />
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
                     <Route path="/dashboard/leads" element={<ProtectedRoute requireAdmin><LeadCenter /></ProtectedRoute>} />
                     <Route path="/dashboard/recruiter" element={<RecruiterDashboard />} />
                     {/* Recruit pipeline — applicants/license/contracting flow. Was /agent-pipeline. */}
                     <Route path="/recruit-pipeline" element={<ProtectedRoute><AgentPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/recruit-pipeline" element={<ProtectedRoute><AgentPipeline /></ProtectedRoute>} />
                     {/* Agent Pipeline — client/policy servicing book of business. */}
                     <Route path="/agent-pipeline" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/agent-pipeline" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/client-pipeline" element={<ProtectedRoute><ClientPipeline /></ProtectedRoute>} />
                     <Route path="/dashboard/calendar" element={<CalendarPage />} />
                     <Route path="/dashboard/notifications" element={<ProtectedRoute requireAdmin><NotificationHub /></ProtectedRoute>} />
                     <Route path="/dashboard/planner" element={<ProtectedRoute requireAdmin><AdminCalendar /></ProtectedRoute>} />
                       <Route path="/dashboard/inbox" element={<ProtectedRoute requireAdmin><InboxPage /></ProtectedRoute>} />
                       <Route path="/dashboard/automation" element={<ProtectedRoute requireAdmin><AutomationHub /></ProtectedRoute>} />
                       <Route path="/dashboard/book-of-business" element={<ProtectedRoute><BookOfBusiness /></ProtectedRoute>} />
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
                          <Route path="/dashboard/content" element={<ContentLibrary />} />
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
                           {/* Conduct: admin issues strikes; agents view their own record. */}
                           <Route path="/dashboard/strikes" element={<ProtectedRoute requireAdmin><AdminStrikes /></ProtectedRoute>} />
                           <Route path="/dashboard/my-strikes" element={<ProtectedRoute><MyStrikes /></ProtectedRoute>} />
                           {/* Finance: Stripe charge anomaly inspector (Jordan/$167 incident). */}
                           <Route path="/dashboard/charges-audit" element={<ProtectedRoute requireAdmin><ChargesAudit /></ProtectedRoute>} />
                           {/* Conduct war room: real-time view across strikes + charges + agent standing. */}
                           <Route path="/dashboard/conduct" element={<ProtectedRoute requireAdmin><ConductCommandCenter /></ProtectedRoute>} />
                  </Route>

                  {/* Legacy redirect */}
                  <Route path="/log-numbers" element={<Navigate to="/apex-daily-numbers" replace />} />

                  {/* Catch-all */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </SidebarProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
