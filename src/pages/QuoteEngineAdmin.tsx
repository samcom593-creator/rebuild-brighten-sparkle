import { useAuth } from "@/hooks/useAuth";
import { AdminTabs } from "@/components/quote-engine/AdminTabs";
import { Navigate } from "react-router-dom";

export default function QuoteEngineAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) return <Navigate to="/quote-engine" replace />;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <AdminTabs />
    </div>
  );
}
