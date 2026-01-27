import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  ChevronRight
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
import { cn } from "@/lib/utils";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a name or email");
      return;
    }

    setSearching(true);
    try {
      // Search for Live agents (evaluated stage) by name or email
      const { data: agents, error } = await supabase
        .from("agents")
        .select(`
          id,
          onboarding_stage,
          profile:profiles!agents_profile_id_fkey(
            full_name,
            email
          )
        `)
        .eq("onboarding_stage", "evaluated")
        .eq("is_deactivated", false);

      if (error) throw error;

      // Filter by name or email match
      const query = searchQuery.toLowerCase().trim();
      const matches = (agents || [])
        .filter((a: any) => {
          const name = a.profile?.full_name?.toLowerCase() || "";
          const email = a.profile?.email?.toLowerCase() || "";
          return name.includes(query) || email.includes(query);
        })
        .map((a: any) => ({
          id: a.id,
          name: a.profile?.full_name || "Unknown",
          email: a.profile?.email || "",
          onboardingStage: a.onboarding_stage
        }));

      setMatchedAgents(matches);

      if (matches.length === 0) {
        // No match found, show new agent form
        setNewAgentForm(prev => ({
          ...prev,
          fullName: searchQuery.includes("@") ? "" : searchQuery,
          email: searchQuery.includes("@") ? searchQuery : ""
        }));
        setStep("new-agent");
      } else if (matches.length === 1) {
        // Exact match, go directly to production
        setSelectedAgent(matches[0]);
        setStep("production");
      } else {
        // Multiple matches, let them select
        setStep("select");
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Failed to search for agent");
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
      toast.error("Please fill in all fields");
      return;
    }

    setCreatingAgent(true);
    try {
      // Create a profile first
      const profileId = crypto.randomUUID();
      const agentId = crypto.randomUUID();
      const userId = crypto.randomUUID();

      const { error: profileError } = await supabase
        .from("profiles")
        .insert({
          id: profileId,
          user_id: userId,
          full_name: newAgentForm.fullName.trim(),
          email: newAgentForm.email.trim().toLowerCase(),
          phone: newAgentForm.phone.trim()
        });

      if (profileError) throw profileError;

      // Create the agent record
      const { error: agentError } = await supabase
        .from("agents")
        .insert({
          id: agentId,
          user_id: userId,
          profile_id: profileId,
          onboarding_stage: "evaluated",
          license_status: newAgentForm.licenseStatus,
          status: "active",
          start_date: new Date().toISOString().split("T")[0]
        });

      if (agentError) throw agentError;

      // Set the newly created agent as selected
      setSelectedAgent({
        id: agentId,
        name: newAgentForm.fullName.trim(),
        email: newAgentForm.email.trim().toLowerCase(),
        onboardingStage: "evaluated"
      });

      toast.success("Agent added to CRM!");
      setStep("production");
    } catch (error: any) {
      console.error("Create agent error:", error);
      toast.error(error.message || "Failed to create agent");
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleSubmitProduction = async () => {
    if (!selectedAgent) return;

    setSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];

      // Upsert production data
      const { error } = await supabase
        .from("daily_production")
        .upsert({
          agent_id: selectedAgent.id,
          production_date: today,
          ...productionData,
          hours_called: Number(productionData.hours_called),
          aop: Number(productionData.aop),
        }, {
          onConflict: "agent_id,production_date",
        });

      if (error) throw error;

      // Trigger admin notification
      await supabase.functions.invoke("notify-production-submitted", {
        body: { 
          agentId: selectedAgent.id, 
          agentName: selectedAgent.name,
          productionData 
        }
      });

      // Fetch leaderboard data
      await fetchLeaderboard();

      // Show celebration
      setShowConfetti(true);
      setStep("leaderboard");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save numbers");
    } finally {
      setSaving(false);
    }
  };

  const fetchLeaderboard = async () => {
    if (!selectedAgent) return;

    try {
      // Get this week's start date (Sunday)
      const today = new Date();
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      const weekStartStr = weekStart.toISOString().split("T")[0];

      // Fetch all Live agents with their weekly production
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select(`
          id,
          profile:profiles!agents_profile_id_fkey(full_name)
        `)
        .eq("onboarding_stage", "evaluated")
        .eq("is_deactivated", false);

      if (agentsError) throw agentsError;

      // Fetch weekly production for all agents
      const { data: production, error: prodError } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations")
        .gte("production_date", weekStartStr);

      if (prodError) throw prodError;

      // Aggregate by agent
      const agentMap = new Map<string, LeaderboardEntry>();
      
      for (const agent of agents || []) {
        agentMap.set(agent.id, {
          agentId: agent.id,
          agentName: agent.profile?.full_name || "Unknown",
          weeklyALP: 0,
          weeklyDeals: 0,
          weeklyPresentations: 0,
          closingRate: 0,
          rank: 0
        });
      }

      for (const prod of production || []) {
        const entry = agentMap.get(prod.agent_id);
        if (entry) {
          entry.weeklyALP += Number(prod.aop) || 0;
          entry.weeklyDeals += prod.deals_closed || 0;
          entry.weeklyPresentations += prod.presentations || 0;
        }
      }

      // Calculate closing rates and sort by ALP
      const entries = Array.from(agentMap.values())
        .map(e => ({
          ...e,
          closingRate: e.weeklyPresentations > 0 
            ? Math.round((e.weeklyDeals / e.weeklyPresentations) * 100) 
            : 0
        }))
        .sort((a, b) => b.weeklyALP - a.weeklyALP)
        .map((e, idx) => ({ ...e, rank: idx + 1 }));

      setLeaderboard(entries);

      // Find current agent's stats
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
    { key: "presentations", label: "Presentations", icon: Target },
    { key: "passed_price", label: "Pitched Price", icon: CheckCircle2 },
    { key: "hours_called", label: "Hours Called", icon: Phone, step: "0.5" },
    { key: "referrals_caught", label: "Referrals Caught", icon: UserPlus },
    { key: "booked_inhome_referrals", label: "Booked In-Home", icon: User },
    { key: "referral_presentations", label: "Referral Pres.", icon: Target },
    { key: "deals_closed", label: "Deals Closed", icon: TrendingUp },
    { key: "aop", label: "ALP ($)", icon: Sparkles, step: "0.01", highlight: true },
  ];

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

        <AnimatePresence mode="wait">
          {/* Step 1: Search */}
          {step === "search" && (
            <motion.div
              key="search"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <GlassCard className="p-6">
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
              <GlassCard className="p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">{selectedAgent.name}</div>
                    <div className="text-xs text-muted-foreground">{selectedAgent.email}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {productionFields.map((field, index) => {
                    const Icon = field.icon;
                    const value = productionData[field.key as keyof typeof productionData];
                    const hasValue = Number(value) > 0;

                    return (
                      <motion.div
                        key={field.key}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className={cn(
                          "relative",
                          field.highlight && "col-span-2"
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
                          type="number"
                          step={field.step}
                          min="0"
                          value={value}
                          onChange={(e) => setProductionData(prev => ({
                            ...prev,
                            [field.key]: field.step ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0
                          }))}
                          className={cn(
                            "h-12 text-lg font-bold text-center transition-all duration-200",
                            hasValue && "border-primary/50 bg-primary/5",
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
                  onClick={handleSubmitProduction}
                  className="w-full mt-4 h-12 text-base font-semibold"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-5 w-5 mr-2" />
                  )}
                  {saving ? "Submitting..." : "Submit Numbers"}
                </Button>
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
