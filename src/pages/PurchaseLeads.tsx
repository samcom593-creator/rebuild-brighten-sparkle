import { useState, useEffect, useMemo } from "react";
import { 
  Package, 
  Clock, 
  Users, 
  Zap, 
  Star,
  Edit2,
  Check,
  X,
  DollarSign,
  Flame,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { LeadPaymentTracker } from "@/components/dashboard/LeadPaymentTracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Package data
const packages = [
  {
    id: "gold",
    name: "Gold Leads",
    description: "Quality leads that are 30 days old or less. Perfect for agents building a consistent pipeline with proven prospects.",
    features: [
      "Unlimited leads",
      "Leads 30 days or less old",
      "Pre-qualified prospects",
      "Weekly delivery",
    ],
    price: 250,
    popular: false,
    stripeTier: "gold",
  },
  {
    id: "platinum",
    name: "Platinum Vet Leads",
    description: "Fresh leads logged within the past week. Ideal for agents who want the hottest prospects with maximum conversion potential.",
    features: [
      "Unlimited leads",
      "Leads logged this week",
      "Highest conversion rates",
      "First-priority access",
    ],
    price: 500,
    popular: true,
    stripeTier: "platinum",
  },
];

function getNextSundayMidnightCST(): Date {
  const now = new Date();
  const cstOffset = -6 * 60;
  const utcOffset = now.getTimezoneOffset();
  const cstNow = new Date(now.getTime() + (cstOffset - utcOffset) * 60000);
  
  const daysUntilSunday = (7 - cstNow.getDay()) % 7 || 7;
  const nextSunday = new Date(cstNow);
  nextSunday.setDate(nextSunday.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  
  return new Date(nextSunday.getTime() - (cstOffset - utcOffset) * 60000);
}

function useCountdown(targetDate: Date) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const diff = targetDate.getTime() - Date.now();
      if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      return {
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      };
    };

    setTimeLeft(calculateTimeLeft());
    const interval = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

export default function PurchaseLeads() {
  const { user, isAdmin, profile } = useAuth();
  const { playSound } = useSoundEffects();
  const [leadCount, setLeadCount] = useState(800);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const handleStripeCheckout = async (tier: string) => {
    setCheckingOut(tier);
    try {
      const { data, error } = await supabase.functions.invoke("create-lead-checkout", {
        body: { tier },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      console.error("Stripe checkout error:", err);
      toast.error("Failed to start checkout: " + (err.message || "Unknown error"));
      playSound("error");
    } finally {
      setCheckingOut(null);
    }
  };

  const nextSunday = useMemo(() => getNextSundayMidnightCST(), []);
  const countdown = useCountdown(nextSunday);

  useEffect(() => {
    fetchLeadCount();
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast.success("🎉 Subscription activated! Your leads will start flowing.");
      playSound("celebrate");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("canceled") === "true") {
      toast.info("Checkout canceled. You can try again anytime.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchLeadCount = async () => {
    const { data } = await supabase
      .from("lead_counter")
      .select("count")
      .limit(1)
      .maybeSingle();
    
    if (data) {
      setLeadCount(data.count);
      setEditValue(String(data.count));
    }
  };

  const handleSaveCount = async () => {
    if (!isAdmin) {
      toast.error("Only admins can edit the lead count.");
      return;
    }

    const newCount = parseInt(editValue, 10);
    if (isNaN(newCount) || newCount < 0) {
      toast.error("Please enter a valid number");
      return;
    }

    const { error } = await supabase
      .from("lead_counter")
      .update({ count: newCount, updated_at: new Date().toISOString() })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      toast.error("Failed to update lead count");
      playSound("error");
    } else {
      setLeadCount(newCount);
      setIsEditing(false);
      toast.success("Lead count updated!");
      playSound("success");
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
            <Flame className="h-4 w-4" />
            Exclusive Lead Packages
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Fuel Your Pipeline
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Premium leads delivered weekly. Invest in your growth with our curated lead packages.
          </p>
        </div>

        {/* Live Counter + Timer Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Live Lead Counter */}
          <Card className="p-6 bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/20">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Available Leads</p>
                  {isEditing ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 h-8 text-lg font-bold"
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSaveCount}>
                        <Check className="h-4 w-4 text-green-500" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setIsEditing(false)}>
                        <X className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-bold text-primary">
                        {leadCount.toLocaleString()}+
                      </span>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => {
                            setEditValue(String(leadCount));
                            setIsEditing(true);
                          }}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
          </Card>

          {/* Timer */}
          <Card className="p-6 bg-gradient-to-br from-amber-500/10 via-background to-background border-amber-500/20">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-amber-500/20">
                <Clock className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Next Drop Opens</p>
                <p className="text-xs text-muted-foreground/70">Sunday 12:00 AM CST</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-4">
              {[
                { value: countdown.days, label: "Days" },
                { value: countdown.hours, label: "Hours" },
                { value: countdown.minutes, label: "Mins" },
                { value: countdown.seconds, label: "Secs" },
              ].map((item) => (
                <div key={item.label} className="text-center p-2 rounded-lg bg-muted/50">
                  <span className="text-2xl font-bold text-foreground">
                    {String(item.value).padStart(2, "0")}
                  </span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Package Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {packages.map((pkg) => (
            <Card
              key={pkg.id}
              className={cn(
                "relative overflow-hidden transition-all duration-300 hover:scale-[1.02]",
                pkg.popular
                  ? "border-primary/40 bg-gradient-to-br from-primary/5 via-background to-background"
                  : "border-border/50"
              )}
            >
              {pkg.popular && (
                <div className="absolute top-4 right-4">
                  <Badge className="bg-primary text-primary-foreground gap-1">
                    <Star className="h-3 w-3" fill="currentColor" />
                    Most Popular
                  </Badge>
                </div>
              )}
              
              <div className="p-6 space-y-6">
                {/* Package Header */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-3 rounded-xl",
                      pkg.popular ? "bg-primary/20" : "bg-muted"
                    )}>
                      <Package className={cn(
                        "h-6 w-6",
                        pkg.popular ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <h3 className="text-xl font-bold">{pkg.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {pkg.description}
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-2">
                  {pkg.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Price */}
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">${pkg.price}</span>
                  <span className="text-muted-foreground">/week</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-4">
                  Recurring subscription • Cancel anytime
                </p>

                {/* Single Stripe Button */}
                <div className="pt-2">
                  <Button
                    onClick={() => handleStripeCheckout(pkg.stripeTier)}
                    disabled={checkingOut === pkg.stripeTier}
                    className="w-full gap-2 h-11 text-sm font-semibold"
                    size="lg"
                  >
                    {checkingOut === pkg.stripeTier ? (
                      <><Clock className="h-4 w-4 animate-spin" /> Processing...</>
                    ) : (
                      <><DollarSign className="h-4 w-4" /> Purchase Now</>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Admin Payment Tracker */}
        {isAdmin && <LeadPaymentTracker />}

        {/* Support Footer */}
        <div className="text-center py-8 border-t border-border/50">
          <p className="text-sm text-muted-foreground">
            Questions about lead packages?{" "}
            <span className="text-primary font-medium">
              Join our Discord for support
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
