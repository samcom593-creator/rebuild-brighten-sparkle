import { Navigate } from "react-router-dom";
import { SystemIntegrityCard } from "@/components/admin/SystemIntegrityCard";

export default function DashboardAdmin() {
  return <Navigate to="/dashboard/command" replace />;
}

// Export for use in DashboardCommandCenter
export { SystemIntegrityCard };
