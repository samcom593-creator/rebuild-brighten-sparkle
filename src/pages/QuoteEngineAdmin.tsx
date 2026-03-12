import { useAuth } from "@/hooks/useAuth";
import { AdminTabs } from "@/components/quote-engine/AdminTabs";
import { Calculator, ArrowLeft, Crown, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, Navigate } from "react-router-dom";

export default function QuoteEngineAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) return <Navigate to="/dashboard/quote-engine" replace />;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/quote-engine">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              Quote Engine Admin
              <Crown className="h-4 w-4 text-primary" />
            </h1>
            <p className="text-xs text-muted-foreground">Manage carriers, products, rates, underwriting rules, and data sources</p>
          </div>
        </div>
        <Link to="/dashboard/quote-engine">
          <Button variant="outline" size="sm">
            <Calculator className="h-4 w-4 mr-2" /> Back to Quoting
          </Button>
        </Link>
      </div>

      {/* Admin Tabs */}
      <AdminTabs />
    </div>
  );
}
