import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getTodayPST, getWeekStartPST } from "@/lib/dateUtils";
import { 
  Search, 
  User, 
  Mail, 
  Phone, 
  Loader2, 
  Trophy, 
  TrendingUp, 
  Target,
  Sparkles,
  CheckCircle2,
  UserPlus,
  ChevronRight,
  DollarSign
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { BubbleDealEntry } from "@/components/dashboard/BubbleDealEntry";
import { BubbleStatInput } from "@/components/dashboard/BubbleStatInput";
import { GradientButton } from "@/components/ui/gradient-button";
import apexIcon from "@/assets/apex-icon.png";

interface MatchedAgent {
  id: string;
  name: string;
  email: string;
  onboardingStage: string;
}

interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  weeklyALP: number;
  weeklyDeals: number;
  weeklyPresentations: number;
  closingRate: number;
  rank: number;
}

type Step = "search" | "select" | "new-agent" | "production" | "leaderboard";

export default function LogNumbers() {
  const { playSound } = useSoundEffects();
  const [step, setStep] = useState<Step>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matchedAgents, setMatchedAgents] = useState<MatchedAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<MatchedAgent | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  
  // New agent form
  const [newAgentForm, setNewAgentForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    licenseStatus: "unlicensed" as "licensed" | "unlicensed"
  });
  const [creatingAgent, setCreatingAgent] = useState(false);

  // Production form
  const [saving, setSaving] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [productionData, setProductionData] = useState({
    presentations: 0,
    passed_price: 0,
    hours_called: 0,
    referrals_caught: 0,
    booked_inhome_referrals: 0,
    referral_presentations: 0,
    deals_closed: 0,
    aop: 0,
  });

  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [agentRank, setAgentRank] = useState<number | null>(null);
  const [agentStats, setAgentStats] = useState<LeaderboardEntry | null>(null);

  // Set document title
  useEffect(() => {
    document.title = "Apex Daily Numbers";
    return () => {
      document.title = "Apex";
    };
  }, []);

  // Load existing production data when agent is selected
  useEffect(() => {
    if (!selectedAgent || step !== "production") return;

    const loadExisting = async () => {
      setLoadingExisting(true);
      try {
        const today = getTodayPST();
        const { data, error } = await supabase.functions.invoke("log-production", {
          body: { action: "load-existing", agentId: selectedAgent.id, date: today }
        });

        if (error) throw error;

        if (data?.data) {
          setProductionData({
            presentations: data.data.presentations || 0,
            passed_price: 0,
            hours_called: data.data.hours_called || 0,
            referrals_caught: data.data.referrals_caught || 0,
            booked_inhome_referrals: 0,
            referral_presentations: data.data.referral_presentations || 0,
            deals_closed: data.data.deals_closed || 0,
            aop: data.data.aop || 0,
          });
        }
      } catch (err) {
        console.error("Failed to load existing production:", err);
      } finally {
        setLoadingExisting(false);
      }
    };

    loadExisting();
  }, [selectedAgent, step]);

  const handleALPChange = useCallback((alp: number) => {
    setProductionData(prev => ({ ...prev, aop: alp }));
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a name or email"); playSound("error");
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("log-production", {
        body: { action: "search", query: searchQuery }
      });

      if (error) throw error;

      const matches: MatchedAgent[] = data?.agents || [];

      setMatchedAgents(matches);

      if (matches.length === 0) {
        setNewAgentForm(prev => ({
          ...prev,
          fullName: searchQuery.includes("@") ? "" : searchQuery,
          email: searchQuery.includes("@") ? searchQuery : ""
        }));
        setStep("new-agent");
      } else if (matches.length === 1) {
        setSelectedAgent(matches[0]);
        setStep("production");
      } else {
        setStep("select");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Failed to search for agent"); playSound("error");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectAgent = (agent: MatchedAgent) => {
    setSelectedAgent(agent);
    setStep("production");
  };

  const handleCreateAgent = async () => {
    if (!newAgentForm.fullName.trim() || !newAgentForm.email.trim() || !newAgentForm.phone.trim()) {
      toast.error("Please fill in all fields"); playSound("error");
      return;
    }

    setCreatingAgent(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-agent-from-leaderboard", {
        body: {
          fullName: newAgentForm.fullName.trim(),
          email: newAgentForm.email.trim().toLowerCase(),
          phone: newAgentForm.phone.trim(),
          licenseStatus: newAgentForm.licenseStatus,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const agentId = data?.agentId || data?.agent_id;
      if (!agentId) throw new Error("No agent ID returned");

      setSelectedAgent({
        id: agentId,
        name: newAgentForm.fullName.trim(),
        email: newAgentForm.email.trim().toLowerCase(),
        onboardingStage: "onboarding"
      });

      toast.success("Agent added to CRM!"); playSound("success");
      setStep("production");
    } catch (error: any) {
      console.error("Create agent error:", error);
      toast.error(error.message || "Failed to create agent"); playSound("error");
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleSubmitProduction = async () => {
    if (!selectedAgent) return;

    setSaving(true);
    try {
      const today = getTodayPST();

      console.log("Submitting production:", { agentId: selectedAgent.id, date: today, productionData });

      const res = await supabase.functions.invoke("log-production", {
        body: {
          action: "submit",
          agentId: selectedAgent.id,
          date: today,
          productionData,
        }
      });

      console.log("Production response:", res);

      // Handle errors from the edge function
      if (res.error) {
        const msg = res.error?.message || "Failed to save numbers";
        throw new Error(msg);
      }

      if (res.data?.error) throw new Error(res.data.error);

      // Show success feedback
      toast.success("Numbers saved! 🎉"); playSound("celebrate");
      setShowConfetti(true);
      setStep("leaderboard");

      // Fire-and-forget: notifications + leaderboard load in background
      supabase.functions.invoke("notify-production-submitted", {
        body: { 
          agentId: selectedAgent.id, 
          agentName: selectedAgent.name,
          productionData 
        }
      }).catch(err => console.error("Notification error:", err));

      fetchLeaderboard().catch(err => console.error("Leaderboard fetch error:", err));
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message || "Failed to save numbers"); playSound("error");
    } finally {
      setSaving(false);
    }
  };

  const fetchLeaderboard = async () => {
    if (!selectedAgent) return;

    try {
      const weekStartStr = getWeekStartPST();

      const { data, error } = await supabase.functions.invoke("log-production", {
        body: {
          action: "leaderboard",
          weekStart: weekStartStr,
          currentAgentId: selectedAgent.id,
        }
      });

      if (error) throw error;

      const entries: LeaderboardEntry[] = data?.entries || [];
      setLeaderboard(entries);

      const currentAgentEntry = entries.find(e => e.agentId === selectedAgent.id);
      if (currentAgentEntry) {
        setAgentRank(currentAgentEntry.rank);
        setAgentStats(currentAgentEntry);
      }
    } catch (error) {
      console.error("Leaderboard fetch error:", error);
    }
  };

  const productionFields = [
    { key: "presentations", label: "Presentations", emoji: "🎯", step: 1 },
    { key: "hours_called", label: "Hours Called", emoji: "📄", step: 1 },
    { key: "referrals_caught", label: "Referrals", emoji: "🤝", step: 1 },
    { key: "referral_presentations", label: "Ref. Pres.", emoji: "📋", step: 1 },
    { key: "deals_closed", label: "Closes", emoji: "🏆", step: 1 },
  ];

  const steps: Step[] = ["search", "select", "new-agent", "production", "leaderboard"];
  const currentStepIndex = steps.indexOf(step);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-6">
          <motion.img 
            src={apexIcon} 
            alt="Apex" 
            className="h-16 w-16 mx-auto mb-3 rounded-xl shadow-lg"
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
          />
          <h1 className="text-3xl font-bold gradient-text">Apex Daily Numbers</h1>
          <p className="text-muted-foreground mt-1">Daily production entry</p>
        </div>

        {/* Step Progress Indicator */}
        <div className="flex items-center justify-center gap-1.5 mb-5">
          {steps.filter(s => s !== "new-agent" || step === "new-agent").map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                s === step ? "w-8 bg-primary" : i < currentStepIndex ? "w-4 bg-primary/50" : "w-4 bg-muted"
              )}
            />
          ))}
        </div>

        <AnimatePresence initial={false}>
          {/* Step 1: Search */}
          {step === "search" && (
            <motion.div
              key="search"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-4 sm:p-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="search" className="text-sm text-muted-foreground">
                      Enter your name or email
                    </Label>
                    <div className="flex gap-2 mt-1.5">
                      <Input
                        id="search"
                        placeholder="John Smith or john@email.com"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="h-12 text-lg"
                      />
                      <Button 
                        onClick={handleSearch} 
                        disabled={searching}
                        className="h-12 px-6"
                      >
                        {searching ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Search className="h-5 w-5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 2: Select from multiple matches */}
          {step === "select" && (
            <motion.div
              key="select"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold mb-4">Select Your Profile</h2>
                <div className="space-y-2">
                  {matchedAgents.map((agent) => (
                    <Button
                      key={agent.id}
                      variant="outline"
                      className="w-full justify-between h-auto py-3"
                      onClick={() => handleSelectAgent(agent)}
                    >
                      <div className="text-left">
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-muted-foreground">{agent.email}</div>
                      </div>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ))}
                </div>
                <Button 
                  variant="ghost" 
                  className="w-full mt-4"
                  onClick={() => {
                    setStep("search");
                    setSearchQuery("");
                    setMatchedAgents([]);
                  }}
                >
                  ← Back to Search
                </Button>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 3: New Agent Form */}
          {step === "new-agent" && (
            <motion.div
              key="new-agent"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold mb-1">Welcome, New Agent!</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  We didn't find you in our system. Let's get you set up.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      placeholder="John Smith"
                      value={newAgentForm.fullName}
                      onChange={(e) => setNewAgentForm(prev => ({ ...prev, fullName: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@email.com"
                      value={newAgentForm.email}
                      onChange={(e) => setNewAgentForm(prev => ({ ...prev, email: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={newAgentForm.phone}
                      onChange={(e) => setNewAgentForm(prev => ({ ...prev, phone: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="license">License Status</Label>
                    <Select
                      value={newAgentForm.licenseStatus}
                      onValueChange={(v: "licensed" | "unlicensed") => 
                        setNewAgentForm(prev => ({ ...prev, licenseStatus: v }))
                      }
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="licensed">Licensed</SelectItem>
                        <SelectItem value="unlicensed">Unlicensed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <Button 
                    onClick={handleCreateAgent} 
                    className="w-full" 
                    disabled={creatingAgent}
                  >
                    {creatingAgent ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <UserPlus className="h-4 w-4 mr-2" />
                    )}
                    Continue to Log Numbers
                  </Button>
                  
                  <Button 
                    variant="ghost" 
                    className="w-full"
                    onClick={() => {
                      setStep("search");
                      setSearchQuery("");
                    }}
                  >
                    ← Back to Search
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 4: Production Entry */}
          {step === "production" && selectedAgent && (
            <motion.div
              key="production"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-6 relative overflow-hidden">
                {/* Faint Apex Financial watermark */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none select-none -rotate-12 opacity-[0.04]">
                  <span className="text-5xl font-black tracking-tight whitespace-nowrap text-foreground">
                    APEX FINANCIAL
                  </span>
                </div>
                
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border relative z-10">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">{selectedAgent.name}</div>
                    <div className="text-xs text-muted-foreground">{selectedAgent.email}</div>
                  </div>
                </div>

                {loadingExisting ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <>
                    {/* Deal Amounts - Primary Action */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-primary/20 flex items-center justify-center">
                          <DollarSign className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold">💰 Deal Amounts</h3>
                          <p className="text-[10px] text-muted-foreground">Type amount and tap + Add for each deal</p>
                        </div>
                      </div>
                      <BubbleDealEntry onALPChange={handleALPChange} />
                    </div>

                    {/* Activity Stats */}
                    <div className="space-y-3 mt-6 pt-4 border-t border-border/50">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold">📊 Activity Stats</h3>
                          <p className="text-[10px] text-muted-foreground">Track your daily activity</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {productionFields.map((field, index) => (
                          <BubbleStatInput
                            key={field.key}
                            label={field.label}
                            emoji={field.emoji}
                            value={productionData[field.key as keyof typeof productionData]}
                            onChange={(val) => setProductionData(prev => ({
                              ...prev,
                              [field.key]: val
                            }))}
                            step={field.step}
                            delay={index * 0.03}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <GradientButton
                  onClick={handleSubmitProduction}
                  className="w-full mt-6"
                  size="lg"
                  disabled={saving || loadingExisting}
                  loading={saving}
                >
                  {!saving && <Sparkles className="h-5 w-5 mr-2" />}
                  {saving ? "Submitting..." : "Submit Numbers"}
                </GradientButton>
              </GlassCard>
            </motion.div>
          )}

          {/* Step 5: Leaderboard Reveal */}
          {step === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", duration: 0.6 }}
            >
              <GlassCard className="p-6 text-center">
                <motion.div
                  initial={{ y: -20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <Trophy className="h-16 w-16 text-amber-400 mx-auto mb-3" />
                  <h2 className="text-2xl font-bold gradient-text mb-2">
                    Numbers Submitted! 🎉
                  </h2>
                </motion.div>

                {agentStats && (
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="bg-primary/10 rounded-xl p-4 mb-4"
                  >
                    <div className="text-4xl font-bold text-primary mb-1">
                      #{agentRank}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      of {leaderboard.length} agents this week
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 mt-4">
                      <div className="bg-background/50 rounded-lg p-2">
                        <div className="text-lg font-bold text-primary">
                          ${agentStats.weeklyALP.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Weekly ALP</div>
                      </div>
                      <div className="bg-background/50 rounded-lg p-2">
                        <div className="text-lg font-bold">
                          {agentStats.weeklyPresentations}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Presentations</div>
                      </div>
                      <div className="bg-background/50 rounded-lg p-2">
                        <div className="text-lg font-bold text-emerald-400">
                          {agentStats.closingRate}%
                        </div>
                        <div className="text-[10px] text-muted-foreground">Close Rate</div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Mini Leaderboard */}
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="space-y-1"
                >
                  <h3 className="text-sm font-semibold text-left mb-2">This Week's Leaders</h3>
                  {leaderboard.slice(0, 5).map((entry, idx) => (
                    <motion.div
                      key={entry.agentId}
                      initial={{ x: -20, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.7 + idx * 0.1 }}
                      className={cn(
                        "flex items-center justify-between p-2 rounded-lg",
                        entry.agentId === selectedAgent?.id 
                          ? "bg-primary/20 border border-primary/30" 
                          : "bg-muted/30"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                          idx === 0 && "bg-amber-400 text-amber-900",
                          idx === 1 && "bg-gray-300 text-gray-800",
                          idx === 2 && "bg-amber-600 text-amber-100",
                          idx > 2 && "bg-muted text-muted-foreground"
                        )}>
                          {idx + 1}
                        </span>
                        <span className={cn(
                          "text-sm",
                          entry.agentId === selectedAgent?.id && "font-semibold"
                        )}>
                          {entry.agentName}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        ${entry.weeklyALP.toLocaleString()}
                      </Badge>
                    </motion.div>
                  ))}
                </motion.div>

                <Button 
                  variant="outline" 
                  className="w-full mt-4"
                  onClick={() => {
                    setStep("search");
                    setSearchQuery("");
                    setSelectedAgent(null);
                    setProductionData({
                      presentations: 0,
                      passed_price: 0,
                      hours_called: 0,
                      referrals_caught: 0,
                      booked_inhome_referrals: 0,
                      referral_presentations: 0,
                      deals_closed: 0,
                      aop: 0,
                    });
                  }}
                >
                  Log Another Agent
                </Button>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
