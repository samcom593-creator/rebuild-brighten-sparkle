import { useState } from "react";
import { Check, Shield, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const packages = [
  {
    name: "Gold Leads",
    price: 250,
    features: ["Unlimited leads", "30 days old or less", "Pre-qualified prospects", "ReadyMode dialer included", "Weekly delivery"],
    popular: false,
    tier: "gold",
    paymentUrl: "https://buy.stripe.com/dRm28q56XbDN7uH8w97ss02",
  },
  {
    name: "Platinum Vet Leads",
    price: 500,
    features: ["Unlimited leads", "Fresh this week", "Highest conversion rates", "ReadyMode dialer included", "First-priority drop"],
    popular: true,
    tier: "platinum",
    paymentUrl: "https://buy.stripe.com/28E8wOfLB7nx8yLcMp7ss03",
  },
];

const trustSignals = [
  { icon: Shield, text: "Real people who requested info" },
  { icon: Check, text: "Verified phone numbers" },
  { icon: TrendingUp, text: "Agents average 3.2x ROI" },
];

export function ApexLeadsSection() {
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const handlePurchase = async (tier: string, fallbackUrl: string) => {
    setCheckingOut(tier);
    try {
      // Public visitors: send to direct payment link (no login needed).
      // Logged-in agents: try edge function so checkout attaches agent_id.
      const { data, error } = await supabase.functions.invoke("create-lead-checkout", {
        body: { tier },
      });
      if (!error && data?.url) {
        window.open(data.url, "_blank");
      } else {
        window.open(fallbackUrl, "_blank");
      }
    } catch {
      // Always fall back to the direct Stripe Payment Link.
      window.open(fallbackUrl, "_blank");
    } finally {
      setCheckingOut(null);
    }
  };

  return (
    <section id="leads" className="py-20 px-6 relative overflow-hidden" style={{ background: "#030712" }}>
      <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full opacity-5" style={{ background: "#22d3a5", filter: "blur(100px)" }} />
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs tracking-[0.3em] text-primary uppercase mb-4" style={{ fontFamily: "Syne" }}>APEX LEAD MARKETPLACE</div>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white mb-4" style={{ fontFamily: "Syne", lineHeight: 1.1 }}>
            Warm Leads. Real Conversations.<br />
            <span className="text-primary">Faster Closes.</span>
          </h2>
          <p className="text-white/60 max-w-lg mx-auto">
            Stop cold calling. APEX agents get access to pre-qualified leads who are already interested in life insurance.
          </p>
        </div>

        {/* Packages */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {packages.map(pkg => (
            <div key={pkg.name} className={`relative bg-white/[0.03] border rounded-2xl p-6 ${pkg.popular ? "border-primary/50 ring-1 ring-primary/20" : "border-white/10"}`}>
              {pkg.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full" style={{ fontFamily: "Syne" }}>
                  MOST POPULAR
                </div>
              )}
              <h3 className="text-xl font-bold text-white mb-1" style={{ fontFamily: "Syne" }}>{pkg.name}</h3>
              <p className="text-3xl font-extrabold text-primary mb-4" style={{ fontFamily: "Syne" }}>${pkg.price}</p>
              <ul className="space-y-2 mb-6">
                {pkg.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/70">
                    <Check className="h-4 w-4 text-primary flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => handlePurchase(pkg.tier, pkg.paymentUrl)}
                disabled={checkingOut === pkg.tier}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                style={{ fontFamily: "Syne", fontWeight: 700 }}
              >
                {checkingOut === pkg.tier ? "Processing..." : <>Activate Now <ArrowRight className="h-4 w-4 ml-2" /></>}
              </Button>
              <p className="mt-2 text-[11px] text-center text-white/40">
                Card · Apple Pay · Cash App · Link · ACH
              </p>
            </div>
          ))}
        </div>

        {/* Trust signals */}
        <div className="flex flex-wrap justify-center gap-8 mb-12">
          {trustSignals.map(s => (
            <div key={s.text} className="flex items-center gap-2 text-sm text-white/50">
              <s.icon className="h-4 w-4 text-primary" /> {s.text}
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="text-center">
          <h3 className="text-lg font-bold text-white mb-6" style={{ fontFamily: "Syne" }}>How It Works</h3>
          <div className="flex flex-wrap justify-center gap-8">
            {["Choose your package above", "Complete secure checkout via Stripe", "Leads delivered — start closing"].map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-white/60">
                <div className="h-8 w-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm" style={{ fontFamily: "Syne" }}>{i + 1}</div>
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
