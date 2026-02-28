import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { SidebarProvider } from "@/hooks/useSidebarState";
import { AuthProvider } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";

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
const DashboardCRM = lazy(() => import("./pages/DashboardCRM"));
const DashboardAgedLeads = lazy(() => import("./pages/DashboardAgedLeads"));
const DashboardCommandCenter = lazy(() => import("./pages/DashboardCommandCenter"));
const ScheduleCall = lazy(() => import("./pages/ScheduleCall"));
const Settings = lazy(() => import("./pages/Settings"));
const DeletedLeadsVault = lazy(() => import("./pages/DeletedLeadsVault"));
const TeamDirectory = lazy(() => import("./pages/TeamDirectory"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const AgentPortal = lazy(() => import("./pages/AgentPortal"));
const OnboardingCourse = lazy(() => import("./pages/OnboardingCourse"));
const MagicLogin = lazy(() => import("./pages/MagicLogin"));
const Numbers = lazy(() => import("./pages/Numbers"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Disclosures = lazy(() => import("./pages/Disclosures"));
const Install = lazy(() => import("./pages/Install"));
const CourseProgress = lazy(() => import("./pages/CourseProgress"));
const CourseContent = lazy(() => import("./pages/CourseContent"));
const PurchaseLeads = lazy(() => import("./pages/PurchaseLeads"));
const CallCenter = lazy(() => import("./pages/CallCenter"));
const LeadCenter = lazy(() => import("./pages/LeadCenter"));
const RecruiterDashboard = lazy(() => import("./pages/RecruiterDashboard"));
const AgentPipeline = lazy(() => import("./pages/AgentPipeline"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const NotificationHub = lazy(() => import("./pages/NotificationHub"));
const LinksPage = lazy(() => import("./pages/LinksPage"));
const GrowthDashboard = lazy(() => import("./pages/GrowthDashboard"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120000, // 2 minutes - data stays "fresh"
      gcTime: 300000,    // 5 minutes - keep in cache
      refetchOnWindowFocus: false, // Prevent focus-triggered refetches
      retry: 1,
    },
  },
});

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
            <BrowserRouter>
              <ScrollToTop />
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
                  <Route path="/join" element={<AgentSignup />} />
                  <Route path="/agent-login" element={<AgentNumbersLogin />} />
                  <Route path="/magic-login" element={<MagicLogin />} />
                  <Route path="/schedule-call" element={<ScheduleCall />} />
                  <Route path="/pending-approval" element={<PendingApproval />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/disclosures" element={<Disclosures />} />
                  <Route path="/install" element={<Install />} />
                  <Route path="/apex-daily-numbers" element={<LogNumbers />} />
                  <Route path="/links" element={<LinksPage />} />

                  {/* Authenticated shell - sidebar mounted once */}
                  <Route element={<AuthenticatedShell />}>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/dashboard/applicants" element={<DashboardApplicants />} />
                    <Route path="/dashboard/admin" element={<DashboardAdmin />} />
                    <Route path="/dashboard/accounts" element={<ProtectedRoute requireAdmin><DashboardAccounts /></ProtectedRoute>} />
                    <Route path="/dashboard/settings" element={<Settings />} />
                    <Route path="/dashboard/settings/deleted-leads" element={<ProtectedRoute requireAdmin><DeletedLeadsVault /></ProtectedRoute>} />
                    <Route path="/dashboard/team" element={<TeamDirectory />} />
                    <Route path="/dashboard/crm" element={<DashboardCRM />} />
                    <Route path="/dashboard/aged-leads" element={<ProtectedRoute requireAdmin><DashboardAgedLeads /></ProtectedRoute>} />
                    <Route path="/dashboard/command" element={<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>} />
                    <Route path="/agent-portal" element={<AgentPortal />} />
                    <Route path="/onboarding-course" element={<OnboardingCourse />} />
                    <Route path="/course-progress" element={<CourseProgress />} />
                    <Route path="/course-progress/content" element={<CourseContent />} />
                    <Route path="/numbers" element={<Numbers />} />
                    <Route path="/purchase-leads" element={<PurchaseLeads />} />
                    <Route path="/dashboard/call-center" element={<CallCenter />} />
                     <Route path="/dashboard/leads" element={<ProtectedRoute requireAdmin><LeadCenter /></ProtectedRoute>} />
                     <Route path="/dashboard/recruiter" element={<RecruiterDashboard />} />
                     <Route path="/agent-pipeline" element={<AgentPipeline />} />
                     <Route path="/dashboard/calendar" element={<CalendarPage />} />
                     <Route path="/dashboard/notifications" element={<ProtectedRoute requireAdmin><NotificationHub /></ProtectedRoute>} />
                     <Route path="/dashboard/growth" element={<GrowthDashboard />} />
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
