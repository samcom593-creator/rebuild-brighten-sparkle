import { useState } from "react";
import { motion } from "framer-motion";
import { Save, Loader2, Target, DollarSign, Users, Clock, Home, Handshake, TrendingUp, Sparkles } from "lucide-react";
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
  const { playSound } = useSoundEffects();
  
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
    { key: "passed_price", label: "Passed Price", icon: DollarSign },
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
      
      <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-border/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Log Numbers
          </h2>
          {totalALP > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-xs px-2 py-1 bg-primary/20 text-primary rounded-full font-bold"
            >
              ${totalALP.toLocaleString()}
            </motion.span>
          )}
        </div>
        
        <form onSubmit={handleSubmit}>
          {/* 2x4 compact grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {fields.map((field, index) => {
              const Icon = field.icon;
              const value = formData[field.key as keyof typeof formData];
              const hasValue = Number(value) > 0;
              
              return (
                <motion.div
                  key={field.key}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="relative"
                >
                  <Label 
                    htmlFor={field.key} 
                    className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5"
                  >
                    <Icon className={cn("h-2.5 w-2.5", hasValue && "text-primary")} />
                    {field.label}
                  </Label>
                  <Input
                    id={field.key}
                    type="number"
                    step={field.step}
                    min="0"
                    inputMode="numeric"
                    value={value || ""}
                    placeholder="0"
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      [field.key]: field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                    }))}
                    className={cn(
                      "h-12 text-lg font-bold text-center transition-all",
                      hasValue && "border-primary/50 bg-primary/5",
                      field.highlight && hasValue && "text-primary ring-1 ring-primary/30"
                    )}
                  />
                </motion.div>
              );
            })}
          </div>

          <Button 
            type="submit" 
            className="w-full gap-2 h-12 text-base font-bold" 
            size="lg"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            {saving ? "Saving..." : "Submit Numbers"}
          </Button>
        </form>
      </div>
    </>
  );
}
