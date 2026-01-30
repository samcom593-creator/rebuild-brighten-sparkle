import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import { SidebarProvider } from "@/hooks/useSidebarState";
import { Skeleton } from "@/components/ui/skeleton";

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
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SidebarProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
            <Route path="/" element={<Index />} />
            <Route
              path="/apex-daily-numbers"
              element={
                <ProtectedRoute>
                  <LogNumbers />
                </ProtectedRoute>
              }
            />
            <Route path="/log-numbers" element={<Navigate to="/apex-daily-numbers" replace />} />
            <Route path="/agent-login" element={<AgentNumbersLogin />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/apply/success" element={<ApplySuccess />} />
            <Route path="/apply/success/licensed" element={<ApplySuccessLicensed />} />
            <Route path="/apply/success/unlicensed" element={<ApplySuccessUnlicensed />} />
            <Route path="/get-licensed" element={<GetLicensed />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/join" element={<AgentSignup />} />
            <Route path="/magic-login" element={<MagicLogin />} />
            <Route path="/numbers" element={<Numbers />} />
            <Route path="/schedule-call" element={<ScheduleCall />} />
            <Route path="/pending-approval" element={<PendingApproval />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/applicants"
              element={
                <ProtectedRoute>
                  <DashboardApplicants />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/admin"
              element={
                <ProtectedRoute>
                  <DashboardAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/accounts"
              element={
                <ProtectedRoute>
                  <DashboardAccounts />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/team"
              element={
                <ProtectedRoute>
                  <TeamDirectory />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/crm"
              element={
                <ProtectedRoute>
                  <DashboardCRM />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/aged-leads"
              element={
                <ProtectedRoute>
                  <DashboardAgedLeads />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/command"
              element={
                <ProtectedRoute>
                  <DashboardCommandCenter />
                </ProtectedRoute>
              }
            />
            <Route path="/agent-portal" element={<AgentPortal />} />
            <Route
              path="/onboarding-course"
              element={
                <ProtectedRoute>
                  <OnboardingCourse />
                </ProtectedRoute>
              }
            />
            {/* Course Progress - Admin only */}
            <Route
              path="/course-progress"
              element={
                <ProtectedRoute>
                  <CourseProgress />
                </ProtectedRoute>
              }
            />
            {/* Full Course Content View */}
            <Route
              path="/course-progress/content"
              element={
                <ProtectedRoute>
                  <CourseContent />
                </ProtectedRoute>
              }
            />
            {/* Legal pages */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/disclosures" element={<Disclosures />} />
            {/* PWA Install page */}
            <Route path="/install" element={<Install />} />
            {/* Legacy redirect */}
            <Route path="/dashboard/leads" element={<DashboardApplicants />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </SidebarProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
