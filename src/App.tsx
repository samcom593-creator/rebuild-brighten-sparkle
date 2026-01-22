import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScrollToTop } from "@/components/ui/scroll-to-top";
import Index from "./pages/Index";
import Apply from "./pages/Apply";
import ApplySuccess from "./pages/ApplySuccess";
import ApplySuccessLicensed from "./pages/ApplySuccessLicensed";
import ApplySuccessUnlicensed from "./pages/ApplySuccessUnlicensed";
import GetLicensed from "./pages/GetLicensed";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import DashboardApplicants from "./pages/DashboardApplicants";
import DashboardAdmin from "./pages/DashboardAdmin";
import Settings from "./pages/Settings";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/NotFound";

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
          <Route path="/apply" element={<Apply />} />
          <Route path="/apply/success" element={<ApplySuccess />} />
          <Route path="/apply/success/licensed" element={<ApplySuccessLicensed />} />
          <Route path="/apply/success/unlicensed" element={<ApplySuccessUnlicensed />} />
          <Route path="/get-licensed" element={<GetLicensed />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
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
            path="/dashboard/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
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