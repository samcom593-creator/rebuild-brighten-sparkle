import { useState } from "react";
import { motion } from "framer-motion";
import { Save, Loader2, TrendingUp, DollarSign, Users, Clock, Target, Home, Handshake } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

      toast.success("Production numbers saved!");
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
    { key: "booked_inhome_referrals", label: "Booked In-Home Referrals", icon: Home, type: "number" },
    { key: "referral_presentations", label: "Referral Presentations", icon: Handshake, type: "number" },
    { key: "deals_closed", label: "Deals Closed", icon: TrendingUp, type: "number" },
    { key: "aop", label: "AOP ($)", icon: DollarSign, type: "number", step: "0.01" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassCard className="p-4 sm:p-6">
        <h2 className="text-lg font-semibold mb-4 gradient-text">Today's Numbers</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {fields.map((field, index) => {
              const Icon = field.icon;
              return (
                <motion.div
                  key={field.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Label htmlFor={field.key} className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                    <Icon className="h-3 w-3" />
                    {field.label}
                  </Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    step={field.step}
                    min="0"
                    value={formData[field.key as keyof typeof formData]}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      [field.key]: field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                    }))}
                    className={cn(
                      "h-12 text-lg font-bold text-center",
                      formData[field.key as keyof typeof formData] > 0 && "border-primary/50 bg-primary/5"
                    )}
                  />
                </motion.div>
              );
            })}
          </div>

          <Button 
            type="submit" 
            className="w-full gap-2" 
            size="lg"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Today's Numbers
          </Button>
        </form>
      </GlassCard>
    </motion.div>
  );
}
