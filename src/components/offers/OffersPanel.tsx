import { useState } from "react";
import { Check, Clock, DollarSign, Star, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { OFFERS, accentClasses, type OfferDef, type OfferSku } from "./offers.config";

interface OffersPanelProps {
  /** Show only one category (defaults to all four). */
  category?: "all" | "leads" | "social";
  /** When set, the manager is purchasing on behalf of this agent. */
  agentId?: string;
  /** Compact card padding for embedded contexts (manager dashboard). */
  compact?: boolean;
  /** Heading shown above the grid. Pass null to hide. */
  heading?: string | null;
  /** Subheading shown below the heading. Pass null to hide. */
  subheading?: string | null;
}

export function OffersPanel({
  category = "all",
  agentId,
  compact = false,
  heading = "Choose your package",
  subheading = "Cancel subscriptions any time. One-time packages activate immediately.",
}: OffersPanelProps) {
  const { playSound } = useSoundEffects();
  const [checkingOut, setCheckingOut] = useState<OfferSku | null>(null);

  const visible = OFFERS.filter(
    (o) => category === "all" || o.category === category,
  );

  const handleCheckout = async (offer: OfferDef) => {
    setCheckingOut(offer.sku);
    try {
      const { data, error } = await supabase.functions.invoke("create-lead-checkout", {
        body: { sku: offer.sku, agent_id: agentId },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      console.error("Stripe checkout error:", err);
      toast.error("Failed to start checkout: " + (err?.message || "Unknown error"));
      playSound?.("error");
    } finally {
      setCheckingOut(null);
    }
  };

  return (
    <div className="space-y-6">
      {(heading || subheading) && (
        <div className={compact ? "space-y-1" : "text-center space-y-2"}>
          {heading && (
            <h2 className={cn("font-bold tracking-tight", compact ? "text-lg" : "text-2xl md:text-3xl")}>
              {heading}
            </h2>
          )}
          {subheading && (
            <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
              {subheading}
            </p>
          )}
        </div>
      )}

      <div
        className={cn(
          "grid gap-4",
          visible.length >= 4
            ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
            : "grid-cols-1 md:grid-cols-2",
        )}
      >
        {visible.map((offer) => {
          const accent = accentClasses[offer.accent];
          const Icon = offer.icon;
          const busy = checkingOut === offer.sku;
          return (
            <Card
              key={offer.sku}
              className={cn(
                "relative overflow-hidden transition-all duration-300 hover:scale-[1.01]",
                offer.popular ? `${accent.ring} bg-gradient-to-br ${accent.gradient}` : "border-border/50",
              )}
            >
              {offer.popular && (
                <div className="absolute top-3 right-3">
                  <Badge className="bg-primary text-primary-foreground gap-1">
                    <Star className="h-3 w-3" fill="currentColor" />
                    Most Popular
                  </Badge>
                </div>
              )}

              <div className={cn("space-y-4", compact ? "p-4" : "p-6")}>
                <div className="flex items-center gap-3">
                  <div className={cn("p-3 rounded-xl", accent.bg)}>
                    <Icon className={cn("h-6 w-6", accent.text)} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold truncate">{offer.name}</h3>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {offer.tagline}
                    </p>
                  </div>
                </div>

                <p className={cn("text-muted-foreground leading-relaxed", compact ? "text-xs" : "text-sm")}>
                  {offer.description}
                </p>

                <ul className="space-y-1.5">
                  {offer.features.slice(0, compact ? 4 : offer.features.length).map((feature, i) => (
                    <li key={i} className={cn("flex items-start gap-2", compact ? "text-[11px]" : "text-sm")}>
                      <Check className={cn("h-4 w-4 flex-shrink-0 mt-0.5", accent.text)} />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-baseline gap-1">
                  <span className={cn("font-bold", compact ? "text-2xl" : "text-3xl")}>
                    ${offer.price}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {offer.cadence === "weekly" ? "/week" : "one-time"}
                  </span>
                </div>

                <Button
                  onClick={() => handleCheckout(offer)}
                  disabled={busy}
                  className="w-full gap-2 h-10 text-sm font-semibold"
                  size={compact ? "default" : "lg"}
                >
                  {busy ? (
                    <>
                      <Clock className="h-4 w-4 animate-spin" /> Processing…
                    </>
                  ) : (
                    <>
                      <DollarSign className="h-4 w-4" />
                      {agentId ? "Purchase for agent" : "Purchase"}
                    </>
                  )}
                </Button>
                {offer.cadence === "weekly" && (
                  <p className="text-[10px] text-muted-foreground -mt-2 text-center">
                    Recurring subscription · Cancel anytime
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
