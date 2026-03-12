import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { QuoteInputForm } from "@/components/quote-engine/QuoteInputForm";
import { QuoteResults } from "@/components/quote-engine/QuoteResults";
import { runQuoteEngine } from "@/lib/quoteEngine";
import { Crown, Calculator, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { QuoteClientInput, QuoteResult, QuoteEngineData, QEScoringWeights } from "@/lib/quoteEngineTypes";
import { toast } from "@/hooks/use-toast";

export default function QuoteEngine() {
  const { user, isAdmin } = useAuth();
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [engineData, setEngineData] = useState<QuoteEngineData | null>(null);

  // Pre-load engine data
  useEffect(() => {
    loadEngineData();
  }, []);

  const loadEngineData = async () => {
    const [
      { data: carriers },
      { data: products },
      { data: productStates },
      { data: rateTables },
      { data: commissions },
      { data: knockouts },
      { data: buildCharts },
      { data: gradedRules },
      { data: paymentMethods },
      { data: badges },
      { data: weightsData },
    ] = await Promise.all([
      supabase.from("qe_carriers").select("*").eq("is_active", true),
      supabase.from("qe_products").select("*").eq("is_active", true),
      supabase.from("qe_product_states").select("*"),
      supabase.from("qe_rate_tables").select("*"),
      supabase.from("qe_commission_schedules").select("*"),
      supabase.from("qe_underwriting_knockouts").select("*"),
      supabase.from("qe_build_charts").select("*"),
      supabase.from("qe_graded_routing_rules").select("*"),
      supabase.from("qe_payment_methods").select("*"),
      supabase.from("qe_product_badges").select("*"),
      supabase.from("qe_scoring_weights").select("*").eq("is_default", true).single(),
    ]);

    const weights: QEScoringWeights = weightsData ? {
      approval_weight: weightsData.approval_weight,
      suitability_weight: weightsData.suitability_weight,
      premium_weight: weightsData.premium_weight,
      commission_weight: weightsData.commission_weight,
      placement_weight: weightsData.placement_weight,
      persistency_weight: weightsData.persistency_weight,
    } : { approval_weight: 0.35, suitability_weight: 0.20, premium_weight: 0.15, commission_weight: 0.15, placement_weight: 0.10, persistency_weight: 0.05 };

    setEngineData({
      carriers: (carriers ?? []) as any,
      products: (products ?? []) as any,
      productStates: (productStates ?? []) as any,
      rateTables: (rateTables ?? []) as any,
      commissions: (commissions ?? []) as any,
      knockouts: (knockouts ?? []) as any,
      buildCharts: (buildCharts ?? []) as any,
      gradedRules: (gradedRules ?? []) as any,
      paymentMethods: (paymentMethods ?? []) as any,
      badges: (badges ?? []) as any,
      weights,
    });
  };

  const handleSubmit = useCallback(async (input: QuoteClientInput) => {
    if (!engineData) {
      toast({ title: "Loading", description: "Engine data is still loading. Please wait.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const quoteResult = runQuoteEngine(input, engineData);
      setResult(quoteResult);

      // Log the quote
      await supabase.from("qe_quote_logs").insert({
        agent_user_id: user?.id,
        client_inputs: input as any,
        products_considered: quoteResult.allEligible.map(r => ({ carrier: r.carrier.name, product: r.product.name, rank: r.rank })) as any,
        products_excluded: quoteResult.excluded.map(e => ({ carrier: e.carrier.name, product: e.product.name, reason: e.exclusionReason })) as any,
        ranking_output: quoteResult.allEligible.slice(0, 5).map(r => ({ rank: r.rank, carrier: r.carrier.name, product: r.product.name, score: r.scores.overallScore })) as any,
      });
    } catch (err) {
      toast({ title: "Error", description: "Failed to run quote engine", variant: "destructive" });
    }
    setLoading(false);
  }, [engineData, user]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Input Form */}
      <QuoteInputForm onSubmit={handleSubmit} loading={loading} />

      {/* Results */}
      {result && <QuoteResults result={result} />}
    </div>
  );
}
