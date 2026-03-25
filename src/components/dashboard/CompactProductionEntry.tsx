import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Save, Loader2, Target, DollarSign, Users, FileText, Home, Handshake, TrendingUp, Sparkles, Check, CalendarIcon, Plus, Link2, Share2 } from "lucide-react";
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
import { format, subDays } from "date-fns";
import { BubbleDealEntry } from "./BubbleDealEntry";
import { BubbleStatInput } from "./BubbleStatInput";

interface CompactProductionEntryProps {
  agentId: string;
  agentName?: string;
  onSaved?: () => void;
}

export function CompactProductionEntry({ agentId, agentName, onSaved }: CompactProductionEntryProps) {
  const [saving, setSaving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [initialDeals, setInitialDeals] = useState<{ id: string; amount: string; frequency: "monthly" | "annual" }[] | undefined>(undefined);
  const [dealEntryKey, setDealEntryKey] = useState(0);
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

  // Fetch existing production data when component mounts or date changes
  useEffect(() => {
    const fetchExistingData = async () => {
      setLoadingExisting(true);
      try {
        const productionDateStr = format(selectedDate, "yyyy-MM-dd");
        const { data } = await supabase
          .from("daily_production")
          .select("*")
          .eq("agent_id", agentId)
          .eq("production_date", productionDateStr)
          .maybeSingle();

        if (data) {
          setFormData({
            presentations: data.presentations || 0,
            passed_price: data.passed_price || 0,
            hours_called: data.hours_called || 0,
            referrals_caught: data.referrals_caught || 0,
            booked_inhome_referrals: data.booked_inhome_referrals || 0,
            referral_presentations: data.referral_presentations || 0,
            deals_closed: data.deals_closed || 0,
            aop: data.aop || 0,
          });

          // Reconstruct deal bubbles from existing AOP if there are deals
          if (data.aop > 0 && data.deals_closed > 0) {
            // Split AOP evenly across deals as best approximation
            const perDeal = Math.round(Number(data.aop) / data.deals_closed);
            const remainder = Number(data.aop) - (perDeal * (data.deals_closed - 1));
            const deals = Array.from({ length: data.deals_closed }, (_, i) => ({
              id: crypto.randomUUID(),
              amount: String(i === data.deals_closed - 1 ? remainder : perDeal),
              frequency: "annual" as const,
            }));
            setInitialDeals(deals);
          } else {
            setInitialDeals(undefined);
          }
          setDealEntryKey(prev => prev + 1);
        } else {
          // No existing data - reset form
          setFormData({
            presentations: 0,
            passed_price: 0,
            hours_called: 0,
            referrals_caught: 0,
            booked_inhome_referrals: 0,
            referral_presentations: 0,
            deals_closed: 0,
            aop: 0,
          });
          setInitialDeals(undefined);
          setDealEntryKey(prev => prev + 1);
        }
      } catch (err) {
        console.error("Error fetching existing production:", err);
      } finally {
        setLoadingExisting(false);
      }
    };

    fetchExistingData();
  }, [agentId, selectedDate]);

  // Handle ALP from calculator
  const handleALPChange = useCallback((alp: number) => {
    setFormData(prev => ({ ...prev, aop: alp }));
  }, []);


  const handleFieldChange = (key: string, value: number) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const productionDate = format(selectedDate, "yyyy-MM-dd");
      
      const upsertPayload = {
        agent_id: agentId,
        production_date: productionDate,
        ...formData,
        hours_called: Number(formData.hours_called),
        aop: Number(formData.aop),
      };

      const { error } = await supabase
        .from("daily_production")
        .upsert(upsertPayload, {
          onConflict: "agent_id,production_date",
        });

      if (error) {
        console.warn("Direct upsert failed, falling back to edge function:", error.message);
        // Fallback: use the log-production edge function (service role, bypasses RLS)
        try {
          const fallbackRes = await supabase.functions.invoke("log-production", {
            body: {
              action: "submit",
              agentId,
              date: productionDate,
              productionData: formData,
            },
          });
          if (fallbackRes.error) throw fallbackRes.error;
          if (fallbackRes.data?.error) throw new Error(fallbackRes.data.error);
          console.log("✅ Saved via edge function fallback");
        } catch (fallbackErr: any) {
          console.error("Edge function fallback also failed:", fallbackErr);
          toast.error("Failed to save numbers. Please try again or contact your manager.");
          setSaving(false);
          return;
        }
      }

      // Auto-mark daily_sale attendance if deals > 0
      if (formData.deals_closed > 0) {
        try {
          await supabase
            .from("agent_attendance")
            .upsert({
              agent_id: agentId,
              attendance_date: productionDate,
              attendance_type: "daily_sale" as any,
              status: "present" as any,
            }, {
              onConflict: "agent_id,attendance_date,attendance_type",
            });
        } catch (attErr) {
          console.error("Failed to auto-mark daily_sale:", attErr);
        }
      }

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
            {formData.deals_closed} deals • ${Number(formData.aop).toLocaleString()} AOP
          </span>
        </div>
      );

      // Trigger notifications after confetti completes (deal alerts moved to daily leaderboard)
      if (formData.deals_closed > 0) {
        setTimeout(async () => {
          try {
            console.log("🔔 Triggering batched notifications for", agentName);
            
            // Batch notifications (deal alert removed - now sent as daily leaderboard at 9 PM)
            await Promise.allSettled([
              supabase.functions.invoke("notify-streak-alert", {
                body: {
                  agentId,
                  agentName: agentName || "Agent",
                },
              }),
              supabase.functions.invoke("notify-rank-passed", {
                body: {
                  submittingAgentId: agentId,
                  productionDate,
                },
              }),
              supabase.functions.invoke("notify-comeback-alert", {
                body: {
                  agentId,
                  agentName: agentName || "Agent",
                  previousRank: 0,
                  newRank: 0,
                },
              }),
              supabase.functions.invoke("notify-production-submitted", {
                body: {
                  agentId,
                  agentName: agentName || "Agent",
                  productionData: formData,
                },
              }),
            ]);
            
            console.log("✅ All notifications sent");
          } catch (notifyError) {
            console.error("Failed to send notifications:", notifyError);
          }
        }, 2000); // Wait for confetti animation to complete
      } else {
        // No deals - just notify production submitted (can run immediately)
        supabase.functions.invoke("notify-production-submitted", {
          body: {
            agentId,
            agentName: agentName || "Agent",
            productionData: formData,
          },
        }).catch(err => console.error("Failed to send notification:", err));
      }
      
      onSaved?.();
    } catch (error) {
      console.error("Error saving production:", error);
      toast.error("Failed to save numbers");
    } finally {
      setSaving(false);
    }
  };

  // Stat fields with bubble styling
  const statFields = [
    { key: "presentations", label: "Presentations", icon: Target, emoji: "🎯" },
    { key: "hours_called", label: "Hours Called", icon: FileText, step: 1, emoji: "📄" },
    { key: "referrals_caught", label: "Referrals", icon: Users, emoji: "👥" },
    { key: "referral_presentations", label: "Ref. Pres.", icon: Handshake, emoji: "🤝" },
    { key: "deals_closed", label: "Closes", icon: TrendingUp, emoji: "🏆" },
  ];

  const totalALP = Number(formData.aop) || 0;
  const hasData = totalALP > 0 || Object.values(formData).some(v => Number(v) > 0);

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      
      <motion.div 
        className="relative bg-card/80 backdrop-blur-md rounded-2xl border border-border/50 shadow-xl overflow-hidden"
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
              className="absolute inset-0 bg-primary/15 pointer-events-none z-10"
            />
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-lg shadow-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Log Numbers</h2>
                <p className="text-xs text-muted-foreground">Enter your daily production</p>
              </div>
            </div>
            
            <AnimatePresence mode="popLayout">
              {totalALP > 0 && (
                <motion.div
                  key={totalALP}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="px-4 py-2 bg-gradient-to-r from-primary/20 to-emerald-500/20 border border-primary/30 rounded-xl font-bold text-primary shadow-lg"
                >
                  ${totalALP.toLocaleString()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Date Picker */}
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-medium h-12 border-2",
                  selectedDate.toDateString() !== new Date().toDateString() 
                    ? "border-amber-500/50 bg-amber-500/5" 
                    : "border-border/50"
                )}
              >
                <CalendarIcon className="mr-3 h-5 w-5 text-primary" />
                <span className="flex-1">{format(selectedDate, "EEEE, MMM d, yyyy")}</span>
                {selectedDate.toDateString() !== new Date().toDateString() && (
                  <span className="text-[10px] text-amber-600 font-bold uppercase bg-amber-500/10 px-2 py-1 rounded">Past Date</span>
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
          
          {loadingExisting ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Loading existing data...</span>
            </div>
          ) : (
            <form 
              ref={formRef} 
              onSubmit={handleSubmit} 
              onKeyDown={(e) => {
                // Prevent Enter from submitting form unless on submit button
                if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                  e.preventDefault();
                }
              }}
              className="space-y-6"
            >
              {/* Deal Entry Section - Premium Bubble System */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-primary/20 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-bold">💰 Deal Amounts</h3>
                  <p className="text-[10px] text-muted-foreground">Enter each deal amount below</p>
                </div>
                
                <BubbleDealEntry
                  key={dealEntryKey}
                  onALPChange={handleALPChange}
                  initialDeals={initialDeals}
                />
              </div>

              {/* Activity Stats - Bubble Format */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                    <Target className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">📊 Activity Stats</h3>
                    <p className="text-[10px] text-muted-foreground">Track your daily activity</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {statFields.map((field, index) => (
                    <BubbleStatInput
                      key={field.key}
                      label={field.label}
                      emoji={field.emoji}
                      value={formData[field.key as keyof typeof formData] as number}
                      onChange={(value) => handleFieldChange(field.key, value)}
                      step={field.step}
                      delay={index * 0.05}
                    />
                  ))}
                </div>
              </div>

              {/* Premium Submit Button */}
              <motion.div
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button 
                  type="submit" 
                  className={cn(
                    "w-full gap-3 h-14 text-base font-bold rounded-xl transition-all duration-300",
                    "bg-gradient-to-r from-primary via-primary to-emerald-500 hover:from-primary/90 hover:to-emerald-500/90",
                    "shadow-lg hover:shadow-xl",
                    hasData && "shadow-primary/30 hover:shadow-primary/40"
                  )} 
                  size="lg"
                  disabled={saving}
                >
                  <AnimatePresence mode="popLayout">
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

              {/* Share Numbers Link */}
              <div className="flex items-center justify-center gap-4 pt-4 border-t border-border/30 mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-primary gap-2"
                  onClick={() => {
                    const shareUrl = `${window.location.origin}/numbers`;
                    navigator.clipboard.writeText(shareUrl);
                    toast.success("Link copied! Share with your team");
                  }}
                >
                  <Link2 className="h-4 w-4" />
                  Copy Link
                </Button>
                
                {typeof navigator !== 'undefined' && 'share' in navigator && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-primary gap-2"
                    onClick={() => {
                      navigator.share({
                        title: "APEX Daily Numbers",
                        text: "Log your numbers in under 30 seconds!",
                        url: `${window.location.origin}/numbers`,
                      });
                    }}
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                )}
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </>
  );
}
