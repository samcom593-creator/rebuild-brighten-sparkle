import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import Index from "./pages/Index";
import LogNumbers from "./pages/LogNumbers";
import Apply from "./pages/Apply";
import ApplySuccess from "./pages/ApplySuccess";
import ApplySuccessLicensed from "./pages/ApplySuccessLicensed";
import ApplySuccessUnlicensed from "./pages/ApplySuccessUnlicensed";
import GetLicensed from "./pages/GetLicensed";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import AgentSignup from "./pages/AgentSignup";
import AgentNumbersLogin from "./pages/AgentNumbersLogin";
import Dashboard from "./pages/Dashboard";
import DashboardApplicants from "./pages/DashboardApplicants";
import DashboardAdmin from "./pages/DashboardAdmin";
import DashboardAccounts from "./pages/DashboardAccounts";
import DashboardCRM from "./pages/DashboardCRM";
import DashboardAgedLeads from "./pages/DashboardAgedLeads";
import DashboardCommandCenter from "./pages/DashboardCommandCenter";
import ScheduleCall from "./pages/ScheduleCall";
import Settings from "./pages/Settings";
import TeamDirectory from "./pages/TeamDirectory";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";
import AgentPortal from "./pages/AgentPortal";
import OnboardingCourse from "./pages/OnboardingCourse";
import MagicLogin from "./pages/MagicLogin";
import Numbers from "./pages/Numbers";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Disclosures from "./pages/Disclosures";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
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
          <Route
            path="/agent-portal"
            element={
              <ProtectedRoute>
                <AgentPortal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding-course"
            element={
              <ProtectedRoute>
                <OnboardingCourse />
              </ProtectedRoute>
            }
          />
          {/* Legal pages */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/disclosures" element={<Disclosures />} />
          {/* Legacy redirect */}
          <Route path="/dashboard/leads" element={<DashboardApplicants />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;