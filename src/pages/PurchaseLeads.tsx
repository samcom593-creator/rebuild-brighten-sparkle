import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { LeadPaymentTracker } from "@/components/dashboard/LeadPaymentTracker";
import { FreeLeadsStatusCard } from "@/components/dashboard/FreeLeadsStatusCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

type InventorySource = "readymode" | "manual" | "unavailable";

// Package data
const packages = [
  {
    id: "gold",
    name: "Gold Leads",
    description: "Quality leads that are 30 days old or less. Perfect for agents building a consistent pipeline with proven prospects.",
    features: [
      "No per-lead cap",
      "Leads 30 days or less old",
      "Direct from opt-in form",
      "Weekly delivery",
    ],
    price: 250,
    popular: false,
    stripeTier: "gold",
  },
  {
    id: "platinum",
    name: "Platinum Vet Leads",
    description: "Fresh leads logged within the past week. Ideal for agents who want first crack at this week's opt-ins.",
    features: [
      "No per-lead cap",
      "Leads logged this week",
      "Direct from opt-in form",
      "First-priority access",
    ],
    price: 500,
    popular: true,
    stripeTier: "platinum",
  },
];

function parseInventoryCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

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
  const { user, isAdmin } = useAuth();
  const { playSound } = useSoundEffects();
  const [readyModeCount, setReadyModeCount] = useState<number | null>(null);
  const [manualLeadCount, setManualLeadCount] = useState<number | null>(null);
  const [inventorySource, setInventorySource] = useState<InventorySource>("unavailable");
  const [inventoryUpdatedAt, setInventoryUpdatedAt] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  // FreeLeadsStatusCard keys on agents.id (get_agent_free_leads_status(p_agent_id)), NOT auth.uid().
  const myAgent = useQuery({
    queryKey: ["purchase-leads-my-agent", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });
  const myAgentId = myAgent.data ?? null;

  const handleStripeCheckout = async (tier: string) => {
    if (!user) {
      toast.error("Log in first so we can attach the purchase to your agent account.");
      return;
    }

    setCheckingOut(tier);
    try {
      const { data, error } = await supabase.functions.invoke("create-lead-checkout", {
        body: { tier },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      console.error("Stripe checkout error:", err);
      toast.error("Failed to start checkout: " + (err.message || "something went wrong — try again"));
      playSound("error");
    } finally {
      setCheckingOut(null);
    }
  };

  const nextSunday = useMemo(() => getNextSundayMidnightCST(), []);
  const countdown = useCountdown(nextSunday);

  useEffect(() => {
    fetchLeadInventory();
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      toast.success("Stripe checkout complete. Access updates after the payment webhook confirms.");
      playSound("celebrate");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("canceled") === "true") {
      toast.info("Checkout canceled. You can try again anytime.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const fetchLeadInventory = async () => {
    setInventoryLoading(true);
    const { data: settings } = await supabase
      .from("system_settings" as any)
      .select("key, value, updated_at")
      .in("key", ["readymode_available_leads", "readymode_inventory_count", "readymode_inventory_updated_at"]);
    const settingRows = (settings as any[]) ?? [];
    const byKey = new Map(settingRows.map((row) => [row.key, row]));
    const readyCount = parseInventoryCount(byKey.get("readymode_available_leads")?.value ?? byKey.get("readymode_inventory_count")?.value);

    const { data: manual } = await supabase
      .from("lead_counter")
      .select("count, updated_at")
      .limit(1)
      .maybeSingle();

    const manualCount = parseInventoryCount(manual?.count);
    const readyUpdatedAt = byKey.get("readymode_inventory_updated_at")?.value ?? byKey.get("readymode_available_leads")?.updated_at ?? null;

    setReadyModeCount(readyCount);
    setManualLeadCount(manualCount);
    setInventoryUpdatedAt(readyUpdatedAt || manual?.updated_at || null);
    setInventorySource(readyCount !== null ? "readymode" : manualCount !== null ? "manual" : "unavailable");
    setEditValue(manualCount !== null ? String(manualCount) : "");
    setInventoryLoading(false);
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
      setManualLeadCount(newCount);
      setInventorySource(readyModeCount !== null ? "readymode" : "manual");
      setInventoryUpdatedAt(new Date().toISOString());
      setIsEditing(false);
      toast.success("Manual lead counter updated");
      playSound("success");
    }
  };

  const inventoryDisplay = inventoryLoading
    ? "Loading"
    : readyModeCount !== null
      ? `${readyModeCount.toLocaleString()}`
      : manualLeadCount !== null
        ? `${manualLeadCount.toLocaleString()}+`
        : "Unavailable";

  const inventoryStatusCopy = inventorySource === "readymode"
    ? `ReadyMode inventory${inventoryUpdatedAt ? ` · updated ${new Date(inventoryUpdatedAt).toLocaleString()}` : ""}`
    : inventorySource === "manual"
      ? "Manual fallback only. ReadyMode live inventory is not configured yet."
      : "ReadyMode inventory and manual fallback are unavailable.";

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {!user && (
          <Card className="border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-amber-200">Login required</p>
                <p className="text-sm text-muted-foreground">
                  Lead purchases must be attached to your agent profile before Stripe checkout starts.
                </p>
              </div>
              <Button asChild>
                <Link to="/login">Log in</Link>
              </Button>
            </div>
          </Card>
        )}

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
            Fresh warm leads dropped weekly. Pick a pack. Start dialing today.
          </p>
        </div>

        {/* Live Counter + Timer Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Live Lead Counter */}
          <Card className="p-6 bg-white dark:bg-card border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-md bg-primary/20">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">ReadyMode Available Leads</p>
                  {isEditing ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-24 h-8 text-lg font-bold"
                      />
                      <Button size="icon"
                      aria-label="Save quantity" variant="ghost" className="h-8 w-8" onClick={handleSaveCount}>
                        <Check className="h-4 w-4 text-green-500" />
                      </Button>
                      <Button size="icon"
                      aria-label="Cancel edit" variant="ghost" className="h-8 w-8" onClick={() => setIsEditing(false)}>
                        <X className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-bold text-primary">
                        {inventoryDisplay}
                      </span>
                      {isAdmin && inventorySource !== "readymode" && (
                        <Button
                          size="icon"
                          aria-label="Edit quantity"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => {
                            setEditValue(String(manualLeadCount ?? ""));
                            setIsEditing(true);
                          }}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                  <p className={cn(
                    "mt-1 flex items-center gap-1 text-xs",
                    inventorySource === "readymode" ? "text-emerald-500" : inventorySource === "manual" ? "text-amber-500" : "text-destructive"
                  )}>
                    {inventorySource !== "readymode" && <AlertTriangle className="h-3 w-3" />}
                    {inventoryStatusCopy}
                  </p>
                </div>
              </div>
              <div className={cn(
                "w-2 h-2 rounded-full",
                inventorySource === "readymode" ? "bg-green-500 animate-pulse" : inventorySource === "manual" ? "bg-amber-500" : "bg-red-500"
              )} />
            </div>
          </Card>

          {/* Timer */}
          <Card className="p-6 bg-white dark:bg-card border-amber-500/20">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-md bg-amber-500/20">
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

        {user && myAgentId && <FreeLeadsStatusCard agentId={myAgentId} />}

        {/* Package Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {packages.map((pkg) => (
            <Card
              key={pkg.id}
              className={cn(
                "relative overflow-hidden transition-all duration-300 hover:scale-[1.02]",
                pkg.popular
                  ? "border-primary/40 bg-white dark:bg-card"
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
                      "p-3 rounded-md",
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
                  {pkg.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
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
                    disabled={!user || checkingOut === pkg.stripeTier}
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
