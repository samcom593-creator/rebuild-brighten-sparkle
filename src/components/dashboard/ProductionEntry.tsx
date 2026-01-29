import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Save, Loader2, TrendingUp, DollarSign, Users, Clock, Target, Home, Handshake, Sparkles, Calendar as CalendarIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "./ConfettiCelebration";
import { ALPCalculator } from "./ALPCalculator";
import { format, subDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TeamMember {
  id: string;
  name: string;
}

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

interface ManagerGroup {
  managerId: string | null;
  managerName: string;
  agents: TeamMember[];
}

export function ProductionEntry({ agentId, existingData, onSaved }: ProductionEntryProps) {
  const [saving, setSaving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [allAgentsGrouped, setAllAgentsGrouped] = useState<ManagerGroup[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(agentId);
  const [currentUserFullName, setCurrentUserFullName] = useState<string>("Myself");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  
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

  // Check if user is manager/admin and fetch team members
  useEffect(() => {
    const checkRolesAndFetchTeam = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      const hasAdminRole = roles?.some(r => r.role === "admin");
      const hasManagerRole = roles?.some(r => r.role === "manager" || r.role === "admin");
      setIsAdmin(hasAdminRole || false);
      setIsManager(hasManagerRole || false);

      // Fetch current user's FULL name
      const { data: myProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle();
      
      if (myProfile?.full_name) {
        setCurrentUserFullName(myProfile.full_name);
      }

      // ADMIN: Fetch ALL agents grouped by manager
      if (hasAdminRole) {
        const { data: allAgents } = await supabase
          .from("agents")
          .select(`
            id,
            invited_by_manager_id,
            profile:profiles!agents_profile_id_fkey(full_name)
          `)
          .eq("is_deactivated", false)
          .order("profile(full_name)");

        if (allAgents) {
          // Get manager names
          const managerIds = [...new Set(allAgents.map(a => a.invited_by_manager_id).filter(Boolean))] as string[];
          const { data: managerAgents } = await supabase
            .from("agents")
            .select(`id, profile:profiles!agents_profile_id_fkey(full_name)`)
            .in("id", managerIds);

          const managerMap: Record<string, string> = {};
          managerAgents?.forEach(m => {
            managerMap[m.id] = m.profile?.full_name || "Unknown Manager";
          });

          // Group by manager
          const groups: Record<string, ManagerGroup> = {};
          
          allAgents.forEach(a => {
            const managerId = a.invited_by_manager_id || "unassigned";
            if (!groups[managerId]) {
              groups[managerId] = {
                managerId: a.invited_by_manager_id,
                managerName: managerMap[a.invited_by_manager_id || ""] || "No Manager",
                agents: [],
              };
            }
            if (a.profile?.full_name) {
              groups[managerId].agents.push({
                id: a.id,
                name: a.profile.full_name,
              });
            }
          });

          setAllAgentsGrouped(Object.values(groups).sort((a, b) => a.managerName.localeCompare(b.managerName)));
        }
      } else if (hasManagerRole) {
        // Manager: only their team
        const { data: myAgent } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (myAgent) {
          const { data: team } = await supabase
            .from("agents")
            .select(`
              id,
              profile:profiles!agents_profile_id_fkey(full_name)
            `)
            .eq("invited_by_manager_id", myAgent.id)
            .eq("is_deactivated", false);

          if (team) {
            const members: TeamMember[] = team
              .filter(t => t.profile?.full_name)
              .map(t => ({
                id: t.id,
                name: t.profile?.full_name || "Unknown",
              }));
            setTeamMembers(members);
          }
        }
      }
    };

    checkRolesAndFetchTeam();
  }, []);

  // When selected agent changes, fetch their existing data for today
  useEffect(() => {
    const fetchExistingData = async () => {
      if (selectedAgentId === agentId && existingData) {
        // Reset to original data if selecting self
        setFormData({
          presentations: existingData.presentations || 0,
          passed_price: existingData.passed_price || 0,
          hours_called: existingData.hours_called || 0,
          referrals_caught: existingData.referrals_caught || 0,
          booked_inhome_referrals: existingData.booked_inhome_referrals || 0,
          referral_presentations: existingData.referral_presentations || 0,
          deals_closed: existingData.deals_closed || 0,
          aop: existingData.aop || 0,
        });
        return;
      }

      // Fetch for the selected agent and selected date
      const productionDateStr = format(selectedDate, "yyyy-MM-dd");
      const { data } = await supabase
        .from("daily_production")
        .select("*")
        .eq("agent_id", selectedAgentId)
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
        } else {
          // Reset form for new entry
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
      }
    };

    fetchExistingData();
  }, [selectedAgentId, agentId, existingData, selectedDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const productionDate = format(selectedDate, "yyyy-MM-dd");
      
      const { error } = await supabase
        .from("daily_production")
        .upsert({
          agent_id: selectedAgentId,
          production_date: productionDate,
          ...formData,
          hours_called: Number(formData.hours_called),
          aop: Number(formData.aop),
        }, {
          onConflict: "agent_id,production_date",
        });

      if (error) throw error;

      // Trigger confetti celebration!
      setShowConfetti(true);
      
      // Find the selected agent's full name for notifications
      let selectedAgentName = currentUserFullName;
      if (selectedAgentId !== agentId) {
        const foundInTeam = teamMembers.find(m => m.id === selectedAgentId);
        if (foundInTeam) {
          selectedAgentName = foundInTeam.name;
        } else {
          for (const group of allAgentsGrouped) {
            const found = group.agents.find(a => a.id === selectedAgentId);
            if (found) {
              selectedAgentName = found.name;
              break;
            }
          }
        }
      }
      
      // Trigger notifications after confetti completes (deal alerts moved to daily leaderboard)
      if (formData.deals_closed > 0) {
        setTimeout(async () => {
          try {
            console.log("🔔 Triggering batched notifications for", selectedAgentName);
            
            // Batch notifications (deal alert removed - now sent as daily leaderboard at 9 PM)
            await Promise.allSettled([
              supabase.functions.invoke("notify-streak-alert", {
                body: {
                  agentId: selectedAgentId,
                  agentName: selectedAgentName,
                },
              }),
              supabase.functions.invoke("notify-rank-passed", {
                body: {
                  submittingAgentId: selectedAgentId,
                  productionDate: productionDate,
                },
              }),
              supabase.functions.invoke("notify-comeback-alert", {
                body: {
                  agentId: selectedAgentId,
                  agentName: selectedAgentName,
                  previousRank: 0,
                  newRank: 0,
                },
              }),
            ]);
            
            console.log("✅ All notifications sent");
          } catch (notifyError) {
            console.error("Failed to send notifications:", notifyError);
          }
        }, 2000);
      }
      
      // 🏆 MILESTONE PLAQUES: Check for single-day milestones (also delayed)
      const alpAmount = Number(formData.aop) || 0;
      if (alpAmount >= 3000) {
        setTimeout(async () => {
          try {
            const milestoneType = alpAmount >= 5000 ? "single_day" : "single_day_bronze";
            console.log(`🏆 Triggering ${milestoneType} plaque for ${selectedAgentName}: $${alpAmount.toLocaleString()}`);
            
            await supabase.functions.invoke("send-plaque-recognition", {
              body: {
                agentId: selectedAgentId,
                milestoneType,
                amount: alpAmount,
                date: productionDate,
              },
            });
          } catch (plaqueError) {
            console.error("Failed to send plaque recognition:", plaqueError);
          }
        }, 2200); // Slightly after deal notifications
      }
      
      const displayName = selectedAgentId === agentId ? "Your" : selectedAgentName + "'s";
      
      toast.success(
        <div className="flex flex-col gap-1">
          <span className="font-bold flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-amber-400" />
            {displayName} Numbers Saved!
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

  // Activity fields (not ALP-related)
  const activityFields = [
    { key: "presentations", label: "Presentations", icon: Target, emoji: "🎯" },
    { key: "passed_price", label: "Pitched Price", icon: DollarSign, emoji: "💰" },
    { key: "hours_called", label: "Hours Called", icon: Clock, step: "0.5", emoji: "⏱️" },
    { key: "referrals_caught", label: "Referrals Caught", icon: Users, emoji: "👥" },
    { key: "booked_inhome_referrals", label: "Booked In-Home", icon: Home, emoji: "🏠" },
    { key: "referral_presentations", label: "Referral Pres.", icon: Handshake, emoji: "🤝" },
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
        <GlassCard className="p-5 sm:p-8 relative overflow-hidden">
          {/* Premium background gradient when has production */}
          {hasProduction && (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-emerald-500/5 pointer-events-none" />
          )}
          
          <div className="relative">
            {/* Header with elite styling */}
            <div className="flex flex-col gap-4 mb-6">
              {/* Title Row */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-lg shadow-primary/10 shrink-0">
                  <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary via-violet-500 to-primary bg-clip-text text-transparent">
                    Log Production
                  </h2>
                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate">Enter numbers for the selected date</p>
                </div>
                
                {hasProduction && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="ml-auto px-3 py-1.5 bg-gradient-to-r from-primary/20 to-emerald-500/20 border border-primary/30 rounded-xl font-bold text-primary text-sm shadow-lg shadow-primary/10 shrink-0"
                  >
                    ${totalValue.toLocaleString()}
                  </motion.div>
                )}
              </div>
              
              {/* Controls Row - Full width on mobile */}
              <div className="flex flex-col sm:flex-row gap-2">
                {/* Date Picker for Backdating */}
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-sm h-10 gap-2 border-2 border-primary/20 font-medium justify-start w-full sm:w-auto",
                        format(selectedDate, "yyyy-MM-dd") !== format(new Date(), "yyyy-MM-dd") && "bg-amber-500/10 border-amber-500/40"
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") 
                          ? "Today" 
                          : format(selectedDate, "MMM d, yyyy")}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="p-3 border-b border-border">
                      <p className="text-sm font-medium">Select Production Date</p>
                      <p className="text-xs text-muted-foreground">You can log numbers for the past 30 days</p>
                    </div>
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
                
                {/* Admin: All agents grouped by manager with FULL NAMES */}
                {isAdmin && allAgentsGrouped.length > 0 && (
                  <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                    <SelectTrigger className="w-full sm:w-[220px] h-10 text-sm border-2 border-primary/20 bg-background/80 backdrop-blur-sm">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[400px] min-w-[280px]">
                      <SelectItem value={agentId} className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="text-base">🙋</span>
                          <span className="font-medium">{currentUserFullName}</span>
                          <span className="text-xs text-muted-foreground">(Me)</span>
                        </span>
                      </SelectItem>
                      {allAgentsGrouped.map((group) => (
                        <div key={group.managerId || "unassigned"}>
                          <div className="px-3 py-2 text-xs font-bold text-primary bg-primary/5 border-y border-primary/10 sticky top-0 backdrop-blur-sm">
                            📋 Manager: {group.managerName}
                          </div>
                          {group.agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id} className="pl-6 py-2">
                              <span className="flex items-center gap-2">
                                <span className="text-base">👤</span>
                                <span>{agent.name}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                {/* Manager: Just their team with FULL NAMES */}
                {!isAdmin && isManager && teamMembers.length > 0 && (
                  <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                    <SelectTrigger className="w-full sm:w-[200px] h-10 text-sm border-2 border-primary/20">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent className="min-w-[240px]">
                      <SelectItem value={agentId} className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="text-base">🙋</span>
                          <span className="font-medium">{currentUserFullName}</span>
                          <span className="text-xs text-muted-foreground">(Me)</span>
                        </span>
                      </SelectItem>
                      {teamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id} className="py-2">
                          <span className="flex items-center gap-2">
                            <span className="text-base">👤</span>
                            <span>{member.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            
            <form 
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
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-primary/20 flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Deals & ALP</h3>
                    <p className="text-[10px] text-muted-foreground">Enter monthly premiums for automatic ALP calculation</p>
                  </div>
                </div>
                
                <ALPCalculator
                  onALPChange={(alp) => setFormData(prev => ({ ...prev, aop: alp }))}
                  onDealsChange={(deals) => setFormData(prev => ({ ...prev, deals_closed: deals }))}
                  initialALP={formData.aop}
                  initialDeals={formData.deals_closed}
                />
              </div>

              {/* Activity Metrics Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                    <Target className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Activity Metrics</h3>
                    <p className="text-[10px] text-muted-foreground">Track presentations, calls, and referrals</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {activityFields.map((field, index) => {
                    const Icon = field.icon;
                    const value = formData[field.key as keyof typeof formData];
                    const hasValue = Number(value) > 0;
                    
                    return (
                      <motion.div
                        key={field.key}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04 }}
                      >
                        <div 
                          className={cn(
                            "relative p-4 rounded-xl border-2 transition-all duration-300",
                            "bg-gradient-to-br from-background to-muted/30",
                            "hover:border-primary/30 hover:shadow-md",
                            hasValue && "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10",
                            !hasValue && "border-border/50"
                          )}
                        >
                          <Label 
                            htmlFor={field.key} 
                            className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 block font-semibold"
                          >
                            {field.label}
                          </Label>
                          
                          <div className="relative">
                            <div className={cn(
                              "absolute left-0 top-1/2 -translate-y-1/2 h-10 w-10 rounded-lg flex items-center justify-center text-xl",
                              hasValue ? "bg-primary/10" : "bg-muted/50"
                            )}>
                              {field.emoji}
                            </div>
                            <Input
                              id={field.key}
                              type="number"
                              step={field.step}
                              min="0"
                              inputMode="numeric"
                              value={value}
                              onChange={(e) => setFormData(prev => ({
                                ...prev,
                                [field.key]: field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                              }))}
                              onFocus={(e) => e.target.select()}
                              className={cn(
                                "h-14 text-2xl font-bold text-center pl-12 border-0 bg-transparent focus:ring-0",
                                hasValue && "text-foreground"
                              )}
                            />
                          </div>
                          
                          {hasValue && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-primary shadow-lg shadow-primary/50"
                            />
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Premium Submit Button */}
              <Button 
                type="submit" 
                className={cn(
                  "w-full gap-3 h-14 text-lg font-bold rounded-xl transition-all duration-300",
                  "bg-gradient-to-r from-primary via-primary to-emerald-500 hover:from-primary/90 hover:to-emerald-500/90",
                  "shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30",
                  hasProduction && "animate-pulse"
                )}
                size="lg"
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Save className="h-6 w-6" />
                )}
                {saving ? "Saving..." : selectedAgentId === agentId ? "💾 Save Today's Numbers" : `💾 Save Numbers for ${allAgentsGrouped.flatMap(g => g.agents).find(a => a.id === selectedAgentId)?.name || teamMembers.find(m => m.id === selectedAgentId)?.name || "Agent"}`}
              </Button>
            </form>
          </div>
        </GlassCard>
      </motion.div>
    </>
  );
}
