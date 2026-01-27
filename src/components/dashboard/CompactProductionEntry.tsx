import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, Loader2, Target, DollarSign, Users, Clock, Home, Handshake, TrendingUp, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "./ConfettiCelebration";
import { useSoundEffects } from "@/hooks/useSoundEffects";

interface CompactProductionEntryProps {
  agentId: string;
  agentName?: string;
  onSaved?: () => void;
}

export function CompactProductionEntry({ agentId, agentName, onSaved }: CompactProductionEntryProps) {
  const [saving, setSaving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [pulsingField, setPulsingField] = useState<string | null>(null);
  const { playSound } = useSoundEffects();
  const formRef = useRef<HTMLFormElement>(null);
  
  const [formData, setFormData] = useState({
    presentations: 0,
    passed_price: 0,
    hours_called: 0,
    referrals_caught: 0,
    booked_inhome_referrals: 0,
    referral_presentations: 0,
    deals_closed: 0,
    aop: 0,
  });

  const handleFieldChange = (key: string, value: number) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setPulsingField(key);
    setTimeout(() => setPulsingField(null), 200);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const today = new Date().toISOString().split("T")[0];
      
      const { error } = await supabase
        .from("daily_production")
        .upsert({
          agent_id: agentId,
          production_date: today,
          ...formData,
          hours_called: Number(formData.hours_called),
          aop: Number(formData.aop),
        }, {
          onConflict: "agent_id,production_date",
        });

      if (error) throw error;

      // Success flash
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 500);

      // Celebration!
      setShowConfetti(true);
      if (formData.aop >= 5000) {
        playSound("celebrate");
      } else {
        playSound("success");
      }
      
      toast.success(
        <div className="flex flex-col gap-0.5">
          <span className="font-bold flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Numbers Saved!
          </span>
          <span className="text-sm opacity-80">
            {formData.deals_closed} deals • ${Number(formData.aop).toLocaleString()} ALP
          </span>
        </div>
      );

      // 🚨 DEAL ALERT: If deals were closed, notify the whole team!
      if (formData.deals_closed > 0) {
        try {
          console.log("🚨 Triggering deal alert for", agentName);
          await supabase.functions.invoke("notify-deal-alert", {
            body: {
              agentId,
              agentName: agentName || "Agent",
              deals: formData.deals_closed,
              aop: formData.aop,
            },
          });
          
          // 🔥 Also check for streaks
          await supabase.functions.invoke("notify-streak-alert", {
            body: {
              agentId,
              agentName: agentName || "Agent",
            },
          });
        } catch (notifyError) {
          console.error("Failed to send deal/streak notifications:", notifyError);
        }
      }

      // Notify admin/manager
      try {
        await supabase.functions.invoke("notify-production-submitted", {
          body: {
            agentId,
            agentName: agentName || "Agent",
            productionData: formData,
          },
        });
      } catch (notifyError) {
        console.error("Failed to send notification:", notifyError);
      }
      
      onSaved?.();
    } catch (error) {
      console.error("Error saving production:", error);
      toast.error("Failed to save numbers");
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: "presentations", label: "Presentations", icon: Target },
    { key: "passed_price", label: "Pitched Price", icon: DollarSign },
    { key: "hours_called", label: "Hours Called", icon: Clock, step: "0.5" },
    { key: "referrals_caught", label: "Referrals", icon: Users },
    { key: "booked_inhome_referrals", label: "Booked Home", icon: Home },
    { key: "referral_presentations", label: "Ref. Pres.", icon: Handshake },
    { key: "deals_closed", label: "Deals", icon: TrendingUp },
    { key: "aop", label: "ALP ($)", icon: DollarSign, step: "0.01", highlight: true },
  ];

  const totalALP = Number(formData.aop) || 0;

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      
      <motion.div 
        className="relative bg-card/60 backdrop-blur-md rounded-2xl border border-border/40 p-5 shadow-lg overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Success flash overlay */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-primary/10 pointer-events-none z-10"
            />
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 3 }}
            >
              <Sparkles className="h-4 w-4 text-primary" />
            </motion.div>
            Log Numbers
          </h2>
          <AnimatePresence mode="wait">
            {totalALP > 0 && (
              <motion.span
                key={totalALP}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="text-xs px-3 py-1.5 bg-gradient-to-r from-primary/20 to-primary/10 text-primary rounded-full font-bold border border-primary/30"
              >
                ${totalALP.toLocaleString()}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        
        <form ref={formRef} onSubmit={handleSubmit}>
          {/* 2x4 compact grid with staggered animation */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {fields.map((field, index) => {
              const Icon = field.icon;
              const value = formData[field.key as keyof typeof formData];
              const hasValue = Number(value) > 0;
              const isPulsing = pulsingField === field.key;
              
              return (
                <motion.div
                  key={field.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.25 }}
                  className="relative group"
                >
                  <Label 
                    htmlFor={field.key} 
                    className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1 font-medium"
                  >
                    <Icon className={cn(
                      "h-3 w-3 transition-colors duration-200", 
                      hasValue ? "text-primary" : "text-muted-foreground/60"
                    )} />
                    {field.label}
                  </Label>
                  <div className="relative">
                    <Input
                      id={field.key}
                      type="number"
                      step={field.step}
                      min="0"
                      inputMode="numeric"
                      value={value || ""}
                      placeholder="0"
                      onChange={(e) => handleFieldChange(
                        field.key, 
                        field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                      )}
                      onFocus={(e) => {
                        // Select all on focus for easy editing on mobile - fixes cursor position bug
                        e.target.select();
                      }}
                      className={cn(
                        "h-14 text-xl font-bold text-center transition-all duration-200 input-focus-glow",
                        "bg-background/50 hover:bg-background/80",
                        hasValue && "border-primary/40 bg-primary/5",
                        field.highlight && hasValue && "text-primary ring-2 ring-primary/20 border-primary/50",
                        isPulsing && "animate-value-pop"
                      )}
                    />
                    {/* Value indicator glow */}
                    {hasValue && (
                      <motion.div 
                        className="absolute inset-0 rounded-md pointer-events-none"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{
                          background: `radial-gradient(ellipse at center, hsl(168 84% 42% / 0.08) 0%, transparent 70%)`
                        }}
                      />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
          >
            <Button 
              type="submit" 
              className={cn(
                "w-full gap-2 h-14 text-base font-bold rounded-xl transition-all duration-300",
                "bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary",
                "shadow-lg hover:shadow-xl hover:shadow-primary/20",
                saving && "opacity-80"
              )} 
              size="lg"
              disabled={saving}
            >
              <AnimatePresence mode="wait">
                {saving ? (
                  <motion.div
                    key="saving"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Saving...
                  </motion.div>
                ) : showSuccess ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-2"
                  >
                    <Check className="h-5 w-5" />
                    Saved!
                  </motion.div>
                ) : (
                  <motion.div
                    key="default"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-2"
                  >
                    <Save className="h-5 w-5" />
                    Submit Numbers
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </motion.div>
        </form>
      </motion.div>
    </>
  );
}
