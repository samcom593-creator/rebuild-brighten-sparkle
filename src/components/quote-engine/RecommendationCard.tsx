import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProductBadges } from "./ProductBadges";
import { CheckCircle, AlertTriangle, XCircle, Shield, DollarSign, TrendingUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { QuoteRecommendation } from "@/lib/quoteEngineTypes";

const FIT_COLORS: Record<string, string> = {
  "Strong Fit": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "Good Fit": "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  "Borderline": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  "Fallback Only": "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  "Not Eligible": "bg-destructive/15 text-destructive border-destructive/30",
};

const LABEL_COLORS: Record<string, string> = {
  "Recommend First": "bg-primary text-primary-foreground",
  "Strong Backup": "bg-blue-600 text-white",
  "Commission Play": "bg-amber-600 text-white",
  "Cheapest Viable": "bg-emerald-600 text-white",
  "Fallback Only": "bg-orange-600 text-white",
  "Do Not Use": "bg-destructive text-destructive-foreground",
};

interface RecommendationCardProps {
  rec: QuoteRecommendation;
  categoryLabel: string;
}

export function RecommendationCard({ rec, categoryLabel }: RecommendationCardProps) {
  const FitIcon = rec.approvalFitLabel === "Strong Fit" ? CheckCircle
    : rec.approvalFitLabel === "Good Fit" ? Shield
    : rec.approvalFitLabel === "Borderline" ? AlertTriangle
    : XCircle;

  return (
    <Card className="relative overflow-hidden border-border/60 hover:border-primary/30 transition-colors">
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{categoryLabel}</p>
          <Badge className={`text-[10px] ${LABEL_COLORS[rec.recommendationLabel] || "bg-muted"}`}>
            {rec.recommendationLabel}
          </Badge>
        </div>
        <CardTitle className="text-base font-bold mt-1">
          {rec.carrier.name} — {rec.product.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {/* Key metrics row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <DollarSign className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-lg font-bold text-foreground">
              {rec.monthlyPremium !== null ? `$${rec.monthlyPremium.toFixed(2)}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Monthly</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <Shield className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-lg font-bold text-foreground">
              {rec.faceAmount !== null ? `$${rec.faceAmount.toLocaleString()}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Face Amount</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <TrendingUp className="h-3.5 w-3.5 mx-auto text-muted-foreground mb-0.5" />
            <p className="text-lg font-bold text-foreground">
              {rec.commissionValue !== null ? `$${rec.commissionValue.toFixed(0)}` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Est. Comp</p>
          </div>
        </div>

        {/* Approval fit + benefit type */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${FIT_COLORS[rec.approvalFitLabel]}`}>
            <FitIcon className="h-3 w-3" />
            {rec.approvalFitLabel}
          </span>
          <Badge variant="outline" className="text-xs capitalize">
            {rec.benefitType.replace('_', ' ')}
          </Badge>
          {rec.firstYearPct !== null && (
            <Badge variant="outline" className="text-xs">{rec.firstYearPct}% FYC</Badge>
          )}
          {rec.needsVerification && (
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Unverified
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Needs carrier-source verification</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Badges */}
        <ProductBadges badges={rec.badges} />

        {/* Reason summary */}
        <p className="text-xs text-muted-foreground">{rec.reasonSummary}</p>

        {/* Advantages & Risks */}
        {rec.advantages.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Advantages</p>
            <ul className="space-y-0.5">
              {rec.advantages.map((a, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                  <CheckCircle className="h-3 w-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rec.risks.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">Risks</p>
            <ul className="space-y-0.5">
              {rec.risks.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Why not first */}
        {rec.whyNotFirst && (
          <div className="flex items-start gap-1.5 pt-1 border-t border-border/50">
            <Info className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground italic">{rec.whyNotFirst}</p>
          </div>
        )}

        {/* Score breakdown */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1 pt-1 cursor-help">
              <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, rec.scores.overallScore)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                {rec.scores.overallScore.toFixed(0)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="text-xs space-y-1">
            <p>Approval: {rec.scores.approvalScore.toFixed(0)}</p>
            <p>Suitability: {rec.scores.suitabilityScore.toFixed(0)}</p>
            <p>Premium: {rec.scores.premiumScore.toFixed(0)}</p>
            <p>Commission: {rec.scores.commissionScore.toFixed(0)}</p>
            <p>Placement: {rec.scores.placementScore.toFixed(0)}</p>
            <p>Persistency: {rec.scores.persistencyScore.toFixed(0)}</p>
          </TooltipContent>
        </Tooltip>
      </CardContent>
    </Card>
  );
}
