import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, Loader2, Target, DollarSign, Users, Clock, Home, Handshake, TrendingUp, Sparkles, Check, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "./ConfettiCelebration";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { ALPCalculator } from "./ALPCalculator";
import { format, subDays } from "date-fns";

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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
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

  // Handle ALP from calculator
  const handleALPChange = (alp: number) => {
    setFormData(prev => ({ ...prev, aop: alp }));
  };

  // Handle deals count from calculator
  const handleDealsChange = (deals: number) => {
    setFormData(prev => ({ ...prev, deals_closed: deals }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const productionDate = format(selectedDate, "yyyy-MM-dd");
      
      const { error } = await supabase
        .from("daily_production")
        .upsert({
          agent_id: agentId,
          production_date: productionDate,
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
          
          // 📊 Check if we passed anyone on the leaderboard
          try {
            await supabase.functions.invoke("notify-rank-passed", {
              body: {
                submittingAgentId: agentId,
                productionDate,
              },
            });
          } catch (rankError) {
            console.error("Failed to check rank changes:", rankError);
          }
          
          // ⚡ Trigger comeback alert for big moves
          try {
            await supabase.functions.invoke("notify-comeback-alert", {
              body: {
                agentId,
                agentName: agentName || "Agent",
                previousRank: 0,
                newRank: 0,
              },
            });
          } catch (comebackError) {
            console.error("Failed to check comeback:", comebackError);
          }
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

  // Fields WITHOUT aop and deals_closed (handled by ALPCalculator)
  const fields = [
    { key: "presentations", label: "Presentations", icon: Target },
    { key: "passed_price", label: "Pitched Price", icon: DollarSign },
    { key: "hours_called", label: "Hours Called", icon: Clock, step: "0.5" },
    { key: "referrals_caught", label: "Referrals", icon: Users },
    { key: "booked_inhome_referrals", label: "Booked Home", icon: Home },
    { key: "referral_presentations", label: "Ref. Pres.", icon: Handshake },
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

        {/* Date Picker */}
        <div className="mb-4">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-medium h-11",
                  selectedDate.toDateString() !== new Date().toDateString() && "border-primary/50 bg-primary/5"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                {format(selectedDate, "EEEE, MMM d, yyyy")}
                {selectedDate.toDateString() !== new Date().toDateString() && (
                  <span className="ml-auto text-[10px] text-primary font-semibold uppercase">Past Date</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    setDatePickerOpen(false);
                  }
                }}
                disabled={(date) => date > new Date() || date < subDays(new Date(), 30)}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
        
        <form ref={formRef} onSubmit={handleSubmit}>
          {/* 2x3 compact grid for activity stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
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

          {/* ALP Calculator Section - Deal Entry */}
          <div className="mb-5 p-4 rounded-xl bg-gradient-to-br from-primary/5 to-emerald-500/5 border border-primary/20">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5" />
              💰 Log Your Deals
            </h3>
            <ALPCalculator
              onALPChange={handleALPChange}
              onDealsChange={handleDealsChange}
              initialALP={formData.aop}
              initialDeals={formData.deals_closed}
            />
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
