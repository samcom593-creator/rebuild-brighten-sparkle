import { useState } from "react";
import { motion } from "framer-motion";
import { Save, Loader2, TrendingUp, DollarSign, Users, Clock, Target, Home, Handshake, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "./ConfettiCelebration";

interface ProductionEntryProps {
  agentId: string;
  existingData?: {
    presentations: number;
    passed_price: number;
    hours_called: number;
    referrals_caught: number;
    booked_inhome_referrals: number;
    referral_presentations: number;
    deals_closed: number;
    aop: number;
  };
  onSaved?: () => void;
}

export function ProductionEntry({ agentId, existingData, onSaved }: ProductionEntryProps) {
  const [saving, setSaving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [formData, setFormData] = useState({
    presentations: existingData?.presentations || 0,
    passed_price: existingData?.passed_price || 0,
    hours_called: existingData?.hours_called || 0,
    referrals_caught: existingData?.referrals_caught || 0,
    booked_inhome_referrals: existingData?.booked_inhome_referrals || 0,
    referral_presentations: existingData?.referral_presentations || 0,
    deals_closed: existingData?.deals_closed || 0,
    aop: existingData?.aop || 0,
  });

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

      // Trigger confetti celebration!
      setShowConfetti(true);
      
      toast.success(
        <div className="flex flex-col gap-1">
          <span className="font-bold flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Numbers Saved!
          </span>
          <span className="text-sm opacity-80">
            {formData.deals_closed} deals • ${Number(formData.aop).toLocaleString()} ALP
          </span>
        </div>
      );
      
      onSaved?.();
    } catch (error) {
      console.error("Error saving production:", error);
      toast.error("Failed to save production numbers");
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: "presentations", label: "Presentations", icon: Target, type: "number" },
    { key: "passed_price", label: "Passed Price", icon: DollarSign, type: "number" },
    { key: "hours_called", label: "Hours Called", icon: Clock, type: "number", step: "0.5" },
    { key: "referrals_caught", label: "Referrals Caught", icon: Users, type: "number" },
    { key: "booked_inhome_referrals", label: "Booked In-Home", icon: Home, type: "number" },
    { key: "referral_presentations", label: "Referral Pres.", icon: Handshake, type: "number" },
    { key: "deals_closed", label: "Deals Closed", icon: TrendingUp, type: "number" },
    { key: "aop", label: "ALP ($)", icon: DollarSign, type: "number", step: "0.01", highlight: true },
  ];

  const totalValue = Number(formData.aop) || 0;
  const hasProduction = totalValue > 0 || formData.deals_closed > 0;

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard className="p-4 sm:p-6 relative overflow-hidden">
          {/* Subtle background gradient when has production */}
          {hasProduction && (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-emerald-500/5 pointer-events-none" />
          )}
          
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold gradient-text flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Log Today's Numbers
              </h2>
              {hasProduction && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-xs px-2 py-1 bg-primary/20 text-primary rounded-full font-medium"
                >
                  ${totalValue.toLocaleString()} ALP
                </motion.span>
              )}
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {fields.map((field, index) => {
                  const Icon = field.icon;
                  const value = formData[field.key as keyof typeof formData];
                  const hasValue = Number(value) > 0;
                  
                  return (
                    <motion.div
                      key={field.key}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className={cn(
                        "relative",
                        field.highlight && "sm:col-span-2"
                      )}
                    >
                      <Label 
                        htmlFor={field.key} 
                        className="text-xs text-muted-foreground flex items-center gap-1 mb-1"
                      >
                        <Icon className={cn(
                          "h-3 w-3",
                          hasValue && "text-primary"
                        )} />
                        {field.label}
                      </Label>
                      <Input
                        id={field.key}
                        type={field.type}
                        step={field.step}
                        min="0"
                        value={value}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          [field.key]: field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                        }))}
                        className={cn(
                          "h-12 text-lg font-bold text-center transition-all duration-200",
                          hasValue && "border-primary/50 bg-primary/5 shadow-[0_0_10px_rgba(20,184,166,0.1)]",
                          field.highlight && hasValue && "text-xl text-primary"
                        )}
                      />
                      {hasValue && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary"
                        />
                      )}
                    </motion.div>
                  );
                })}
              </div>

              <Button 
                type="submit" 
                className="w-full gap-2 h-12 text-base font-semibold" 
                size="lg"
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Save className="h-5 w-5" />
                )}
                {saving ? "Saving..." : "Save Today's Numbers"}
              </Button>
            </form>
          </div>
        </GlassCard>
      </motion.div>
    </>
  );
}
