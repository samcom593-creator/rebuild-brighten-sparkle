import { useState, useEffect, useMemo } from "react";
import {
  Clock,
  Users,
  Edit2,
  Check,
  X,
  Flame,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { LeadPaymentTracker } from "@/components/dashboard/LeadPaymentTracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { toast } from "sonner";
import { OffersPanel } from "@/components/offers/OffersPanel";

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
  const { isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [leadCount, setLeadCount] = useState(800);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const nextSunday = useMemo(() => getNextSundayMidnightCST(), []);
  const countdown = useCountdown(nextSunday);

  useEffect(() => {
    fetchLeadCount();
    const params = new URLSearchParams(window.location.search);
    const sku = params.get("sku");
    if (params.get("success") === "true") {
      const isSocial = sku === "auto_dm" || sku === "social_growth";
      toast.success(
        isSocial
          ? "🎉 Package activated! We'll reach out within 1 business day to onboard you."
          : "🎉 Subscription activated! Your leads will start flowing.",
      );
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
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
            <Flame className="h-4 w-4" />
            Leads + Social Growth Marketplace
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Fuel Your Pipeline. Grow Your Audience.
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Two ways to win: get hot leads delivered every week, or own the social-media growth stack that
            replaces ManyChat and runs your DMs while you sleep.
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

        <OffersPanel
          category="leads"
          heading="Lead Subscriptions"
          subheading="Fresh leads delivered every Sunday at midnight CST. Cancel anytime."
        />

        <OffersPanel
          category="social"
          heading="Social Media Growth Packages"
          subheading="White-label automation that does what ManyChat does — and more — without the per-message fees."
        />

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
