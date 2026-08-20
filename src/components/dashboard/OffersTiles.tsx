// OffersTiles — admin click-to-pay surface mounted on the main Dashboard.
// Shows all 7 SKUs from the live Stripe account (acct_1TKTj3C3Khd8IPVm).
// Each tile invokes the create-lead-checkout edge function which returns a
// Stripe Checkout URL. Subscriptions vs one-time is per-SKU.
import { useState } from "react";
import { Loader2, Zap, ShieldCheck, Crown, Dumbbell, GraduationCap, Award, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Sku = {
  id: string;
  name: string;
  category: "leads" | "social" | "fitness" | "course" | "high_ticket";
  cadence: "weekly" | "monthly" | "one-time";
  amount: number;
  blurb: string;
  Icon: React.ComponentType<any>;
  accent: string; // tailwind color
  /** Direct Stripe Payment Link URL — bypasses the create-lead-checkout
   *  edge function (which currently 500s with `client.auth.getClaims is
   *  not a function` because the deployed SDK is older than the source).
   *  Sam: "click and pay links don't work" — fix is the direct link. */
  paymentLink?: string;
};

const SKUS: Sku[] = [
  { id: "gold",               name: "Gold Leads",                category: "leads",       cadence: "weekly",   amount: 250,  blurb: "Quality leads ≤30 days old · weekly drop", Icon: ShieldCheck, accent: "from-amber-500 to-yellow-300", paymentLink: "https://buy.stripe.com/dRm28q56XbDN7uH8w97ss02" },
  { id: "platinum",           name: "Platinum Vet Leads",        category: "leads",       cadence: "weekly",   amount: 500,  blurb: "Hottest leads from this week · first access", Icon: Crown,       accent: "from-violet-500 to-purple-300", paymentLink: "https://buy.stripe.com/28E8wOfLB7nx8yLcMp7ss03" },
  { id: "auto_dm",            name: "Auto-DM Engine",            category: "social",      cadence: "monthly",  amount: 250,  blurb: "Hands-off Instagram DM outreach", Icon: Mail,        accent: "from-emerald-500 to-teal-300" },
  { id: "social_growth",      name: "Full Social Growth Suite",  category: "social",      cadence: "monthly",  amount: 500,  blurb: "DM + content + manager-managed growth", Icon: Zap,         accent: "from-emerald-500 to-cyan-300" },
  { id: "fitness_reset",      name: "Fitness Reset Blueprint",   category: "fitness",     cadence: "one-time", amount: 97,   blurb: "Sam's reset routine · pdf + audio", Icon: Dumbbell,    accent: "from-rose-500 to-orange-300" },
  { id: "kingofsales_course", name: "King of Sales Course",      category: "course",      cadence: "one-time", amount: 497,  blurb: "Full sales course · lifetime access", Icon: GraduationCap, accent: "from-sky-500 to-indigo-300" },
  { id: "work_with_sam",      name: "1:1 Work With Sam",         category: "high_ticket", cadence: "one-time", amount: 5000, blurb: "Direct sessions · application required", Icon: Award,       accent: "from-yellow-500 to-amber-300" },
];

function fmt$(n: number) { return "$" + n.toLocaleString("en-US"); }

export function OffersTiles() {
  const [busy, setBusy] = useState<string | null>(null);

  const buy = async (sku: Sku) => {
    // Direct Stripe Payment Link — never breaks, no edge fn dependency.
    if (sku.paymentLink) {
      window.open(sku.paymentLink, "_blank", "noopener");
      return;
    }
    // Fallback: edge fn (only used for SKUs without a Payment Link yet).
    setBusy(sku.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-lead-checkout", {
        body: { tier: sku.id, sku: sku.id },
      });
      if (error) throw error;
      const url = (data as any)?.url ?? (data as any)?.checkout_url;
      if (!url) throw new Error("no checkout URL");
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error("Checkout for this SKU is being wired up — DM Sam to buy directly.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard className="p-4 md:p-5 space-y-4 border-emerald-500/30">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-base text-white tracking-wide uppercase">Offers · click → pay</h3>
          <p className="text-xs text-muted-foreground">All 7 live SKUs · Stripe acct_1TKTj3C3Khd8IPVm</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {SKUS.map((sku) => (
          <button
            key={sku.id}
            onClick={() => buy(sku)}
            disabled={busy !== null}
            className={`group relative text-left p-3 rounded-md bg-white dark:bg-background/60 border border-slate-200 dark:border-border hover:border-emerald-400/60 transition-all overflow-hidden disabled:opacity-50`}
          >
            <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full  ${sku.accent} opacity-20 blur-2xl group-hover:opacity-40 transition-opacity`} />
            <div className="relative space-y-2">
              <div className="flex items-center gap-2">
                <sku.Icon className="h-5 w-5 text-emerald-400" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{sku.category}</span>
              </div>
              <div className="font-bold text-sm text-white leading-tight">{sku.name}</div>
              <div className="text-[11px] text-muted-foreground leading-snug min-h-[28px]">{sku.blurb}</div>
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-black text-xl text-white">{fmt$(sku.amount)}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{sku.cadence}</span>
              </div>
              <div className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider pt-1">
                {busy === sku.id ? <Loader2 className="h-3 w-3 inline animate-spin" /> : "tap to pay →"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
