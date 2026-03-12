import { RecommendationCard } from "./RecommendationCard";
import { EligibleProductsTable } from "./EligibleProductsTable";
import { ExcludedProductsTable } from "./ExcludedProductsTable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import type { QuoteResult } from "@/lib/quoteEngineTypes";

interface QuoteResultsProps {
  result: QuoteResult;
}

export function QuoteResults({ result }: QuoteResultsProps) {
  const { bestOverall, bestApproval, bestCommission, lowestPremium, immediateOption, gradedOption, giFallback, allEligible, excluded, warnings, hasVerifiedData } = result;

  return (
    <div className="space-y-6">
      {/* Warnings */}
      {warnings.map((w, i) => (
        <Alert key={i} variant={w.includes("limited") ? "destructive" : "default"} className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">{w}</AlertDescription>
        </Alert>
      ))}

      {!hasVerifiedData && allEligible.length > 0 && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
            Recommendation quality limited by missing verified carrier data. Load verified rates and underwriting rules in the Admin panel.
          </AlertDescription>
        </Alert>
      )}

      {allEligible.length === 0 && excluded.length === 0 && (
        <div className="text-center py-12">
          <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-lg font-medium text-muted-foreground">No products loaded yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Add carriers and products in the Admin panel to start generating recommendations.
          </p>
        </div>
      )}

      {allEligible.length === 0 && excluded.length > 0 && (
        <div className="text-center py-8">
          <AlertTriangle className="h-10 w-10 mx-auto text-amber-500 mb-3" />
          <p className="text-lg font-medium text-foreground">No eligible products for this client</p>
          <p className="text-sm text-muted-foreground mt-1">All products were excluded. See reasons below.</p>
        </div>
      )}

      {/* Top recommendation cards */}
      {allEligible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bestOverall && <RecommendationCard rec={bestOverall} categoryLabel="🏆 Best Overall" />}
          {bestApproval && bestApproval.product.id !== bestOverall?.product.id && (
            <RecommendationCard rec={bestApproval} categoryLabel="✅ Best Approval Odds" />
          )}
          {bestCommission && bestCommission.product.id !== bestOverall?.product.id && (
            <RecommendationCard rec={bestCommission} categoryLabel="💰 Best Commission" />
          )}
          {lowestPremium && lowestPremium.product.id !== bestOverall?.product.id && (
            <RecommendationCard rec={lowestPremium} categoryLabel="💲 Lowest Premium" />
          )}
          {immediateOption && immediateOption.product.id !== bestOverall?.product.id && (
            <RecommendationCard rec={immediateOption} categoryLabel="⚡ Immediate Coverage" />
          )}
          {gradedOption && (
            <RecommendationCard rec={gradedOption} categoryLabel="📋 Graded / Modified" />
          )}
          {giFallback && (
            <RecommendationCard rec={giFallback} categoryLabel="🛡️ Guaranteed Issue Fallback" />
          )}
        </div>
      )}

      {/* Full tables */}
      <EligibleProductsTable products={allEligible} />
      <ExcludedProductsTable products={excluded} />
    </div>
  );
}
