

# Agent CRM & Leaderboard Major Enhancements

## Overview

This plan implements a comprehensive set of improvements to the Agent CRM and Leaderboard to make them cleaner, more informative, and more interactive. The enhancements focus on:

1. **CRM Integration with Production Data** - Auto-populate AOP stats on agent cards
2. **Enhanced Agent Cards** - Show weekly + monthly AOP, cleaner layout
3. **Clickable Stage Circles** - Replace arrows with interactive progress circles
4. **Stage Change Email Notifications** - Alert agents when their stage changes
5. **Enhanced Leaderboard Metrics** - Clearer labels and more totals
6. **"Where You Rank" Pop-up** - Team averages, graphs, and AI summary

---

## Part 1: CRM Agent Card Enhancements

### 1.1 Add Weekly + Monthly AOP Display

Currently, agent cards show some weekly stats in a small row. We'll enhance this to prominently display:
- **Week AOP**: Total ALP for current week
- **Month AOP**: Total ALP for current month

This fills the blank space the user mentioned and gives instant context on each agent's performance.

**File: `src/pages/DashboardCRM.tsx`**

Changes needed:
- Extend the `fetchAgents` function to also fetch monthly production data (lines 303-332)
- Add `monthlyALP` to the `AgentCRM` interface
- Update `renderAgentCard` to display both weekly and monthly AOP prominently

**New AgentCRM interface addition:**
```typescript
interface AgentCRM {
  // ... existing fields
  weeklyALP: number;
  monthlyALP: number;  // NEW
  weeklyPresentations: number;
  weeklyDeals: number;
  weeklyClosingRate: number;
}
```

**Agent Card Display Update:**
```tsx
{/* Weekly + Monthly AOP Stats - Prominent Display */}
{isInFieldActive && (
  <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20">
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Week:</span>
      <span className="text-sm font-bold text-primary">${agent.weeklyALP.toLocaleString()}</span>
    </div>
    <div className="w-px h-4 bg-border" />
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Month:</span>
      <span className="text-sm font-bold text-foreground">${agent.monthlyALP.toLocaleString()}</span>
    </div>
  </div>
)}
```

---

### 1.2 Clickable Stage Circles (Replace Arrows)

Replace the arrow buttons with clickable stage circles that have smooth animations. Clicking a circle moves the agent to that stage.

**File: `src/components/dashboard/OnboardingTracker.tsx`**

Current implementation uses `ChevronLeft` and `ChevronRight` buttons (lines 216-251). Replace with clickable circles:

**New Implementation:**
```tsx
{ONBOARDING_STAGES.map((stage, index) => {
  const isCompleted = index < currentIndex;
  const isCurrent = index === currentIndex;
  const isClickable = canNavigate && (index === currentIndex - 1 || index === currentIndex + 1);
  const Icon = stage.icon;

  return (
    <div key={stage.key} className="flex items-center">
      <motion.button
        whileHover={isClickable ? { scale: 1.15 } : undefined}
        whileTap={isClickable ? { scale: 0.95 } : undefined}
        onClick={() => isClickable && handleStageClick(index)}
        disabled={!isClickable || loading}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer",
          isCompleted && "bg-primary text-primary-foreground shadow-lg shadow-primary/30",
          isCurrent && "bg-primary/20 ring-2 ring-primary text-primary animate-pulse",
          !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
          isClickable && "hover:ring-2 hover:ring-primary/50",
          !isClickable && "cursor-default"
        )}
        title={isClickable ? `Click to move to ${stage.label}` : stage.label}
      >
        {loading && isCurrent ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isCompleted ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </motion.button>
      
      {/* Animated Connector Line */}
      {index < ONBOARDING_STAGES.length - 1 && (
        <motion.div 
          className={cn(
            "w-6 h-0.5 mx-1",
            index < currentIndex ? "bg-primary" : "bg-muted"
          )}
          animate={{
            backgroundColor: index < currentIndex ? "var(--primary)" : "var(--muted)"
          }}
          transition={{ duration: 0.3 }}
        />
      )}
    </div>
  );
})}
```

**New Handler Function:**
```typescript
const handleStageClick = async (targetIndex: number) => {
  if (loading) return;
  if (targetIndex === currentIndex) return;
  
  const direction = targetIndex > currentIndex ? "forward" : "backward";
  await handleStageChange(direction);
};
```

---

### 1.3 Stage Change Email Notification

Create a new edge function that sends an email when an agent's stage changes.

**New File: `supabase/functions/notify-stage-change/index.ts`**

```typescript
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agentId, previousStage, newStage, agentName } = await req.json();
    
    // Get agent email and send stage change notification
    // Email includes: new stage info, what to expect, action items
    
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // Error handling
  }
});
```

**Update `OnboardingTracker.tsx` to call the notification:**
```typescript
// After successful stage update (around line 114)
await supabase.functions.invoke("notify-stage-change", {
  body: {
    agentId,
    previousStage: currentStage,
    newStage: targetStage.key,
    agentName,
  }
});
```

---

## Part 2: Leaderboard Enhancements

### 2.1 Rename Metrics Labels

**File: `src/components/dashboard/LeaderboardTabs.tsx`**

Update the table header (lines 351-358):

**Current:**
```tsx
<div className="col-span-1 text-center">D</div>
<div className="col-span-1 text-center">P</div>
<div className="col-span-2 text-center">%</div>
<div className="col-span-3 text-right">ALP</div>
```

**New:**
```tsx
<div className="col-span-1 text-center" title="Hours Dialed">H</div>
<div className="col-span-1 text-center" title="Presentations">P</div>
<div className="col-span-1 text-center" title="Deals Closed">C</div>
<div className="col-span-1 text-center" title="Referrals Generated">R</div>
<div className="col-span-1 text-center" title="Closing Rate">%</div>
<div className="col-span-2 text-right" title="Annual Life Premium">ALP</div>
```

This requires:
1. Adding `hoursCalled` and `referrals` to the `LeaderboardEntry` interface
2. Fetching these fields from `daily_production`
3. Updating the grid layout from `grid-cols-12` to accommodate new columns

### 2.2 Add Total Referrals and Total Presentations to Footer

**Update footer section (lines 470-481):**
```tsx
{sortedEntries.length > 0 && (
  <div className="mt-3 pt-3 border-t border-border/50">
    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
      <span>
        <span className="font-semibold text-foreground">{sortedEntries.length}</span> ranked
      </span>
      <div className="flex items-center gap-4">
        <span>
          Presentations: <span className="font-bold text-foreground">
            {entries.reduce((sum, e) => sum + e.presentations, 0)}
          </span>
        </span>
        <span>
          Referrals: <span className="font-bold text-foreground">
            {entries.reduce((sum, e) => sum + e.referrals, 0)}
          </span>
        </span>
        <span>
          Total: <span className="font-bold text-primary">
            ${entries.reduce((sum, e) => sum + e.alp, 0).toLocaleString()}
          </span>
        </span>
      </div>
    </div>
  </div>
)}
```

### 2.3 "Where You Rank" Pop-up with Team Averages, Graphs, and AI Summary

**Create new component: `src/components/dashboard/PerformanceBreakdownModal.tsx`**

This modal will include:
1. **Team Averages Comparison** - Visual bars comparing agent vs team average
2. **Performance Graphs** - Recharts bar/radar charts
3. **AI Summary** - Generated performance analysis

```tsx
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Brain, X, TrendingUp, Target, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";

interface PerformanceBreakdownModalProps {
  currentAgentId: string;
  entries: LeaderboardEntry[];
  period: string;
}

export function PerformanceBreakdownModal({ currentAgentId, entries, period }: PerformanceBreakdownModalProps) {
  const [open, setOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const currentAgent = entries.find(e => e.agentId === currentAgentId);
  const currentRank = entries.findIndex(e => e.agentId === currentAgentId) + 1;

  // Calculate team averages
  const teamAverages = {
    alp: entries.reduce((sum, e) => sum + e.alp, 0) / entries.length,
    presentations: entries.reduce((sum, e) => sum + e.presentations, 0) / entries.length,
    deals: entries.reduce((sum, e) => sum + e.deals, 0) / entries.length,
    closingRate: entries.reduce((sum, e) => sum + e.closingRate, 0) / entries.length,
  };

  const getAISummary = async () => {
    setLoadingAI(true);
    try {
      const { data } = await supabase.functions.invoke("ai-assistant", {
        body: {
          type: "performance_breakdown",
          agentStats: currentAgent,
          teamAverages,
          rank: currentRank,
          totalAgents: entries.length,
        }
      });
      setAiSummary(data.content);
    } catch (error) {
      console.error("AI summary error:", error);
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <BarChart3 className="h-3.5 w-3.5" />
          Where You Rank
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Your Performance Breakdown
          </DialogTitle>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Rank Summary */}
          <GlassCard className="p-4 text-center">
            <p className="text-4xl font-bold text-primary">#{currentRank}</p>
            <p className="text-sm text-muted-foreground">out of {entries.length} agents</p>
          </GlassCard>

          {/* Team Averages Comparison */}
          <div className="space-y-3">
            <h4 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              vs Team Averages
            </h4>
            {/* Progress bars comparing agent to team average */}
          </div>

          {/* Visual Charts */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                {/* Comparison chart */}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* AI Summary */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4" />
                AI Performance Analysis
              </h4>
              <Button size="sm" onClick={getAISummary} disabled={loadingAI}>
                {loadingAI ? "Analyzing..." : aiSummary ? "Refresh" : "Get Analysis"}
              </Button>
            </div>
            {aiSummary && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 rounded-lg bg-primary/5 border border-primary/20"
              >
                <p className="text-sm">{aiSummary}</p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
```

**Update AI Assistant to handle performance breakdown:**

Add new request type to `supabase/functions/ai-assistant/index.ts`:
```typescript
case 'performance_breakdown': {
  const { agentStats, teamAverages, rank, totalAgents } = body;
  systemPrompt = `You are an expert sales performance analyst. Provide a brief, encouraging analysis of the agent's performance compared to their team.`;
  
  userPrompt = `Analyze this agent's performance:
  
  Rank: #${rank} out of ${totalAgents} agents
  
  Agent Stats:
  - ALP: $${agentStats.alp}
  - Presentations: ${agentStats.presentations}
  - Deals: ${agentStats.deals}
  - Closing Rate: ${agentStats.closingRate}%
  
  Team Averages:
  - ALP: $${teamAverages.alp.toFixed(0)}
  - Presentations: ${teamAverages.presentations.toFixed(1)}
  - Deals: ${teamAverages.deals.toFixed(1)}
  - Closing Rate: ${teamAverages.closingRate.toFixed(1)}%
  
  Provide a 3-4 sentence analysis highlighting their strengths, areas to improve, and specific advice to climb the rankings.`;
  break;
}
```

---

## Part 3: Unknown Agents Handling

For agents whose email/phone isn't in the CRM, they should see a bare-bones interface prompting them to set up their account.

**File: `src/pages/AgentPortal.tsx`**

Add a check after fetching agent data. If the agent exists but has minimal info:
```tsx
{!agentProfile.email && !agentProfile.phone ? (
  <GlassCard className="p-6 text-center">
    <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
    <h3 className="text-lg font-semibold mb-2">Complete Your Profile</h3>
    <p className="text-sm text-muted-foreground mb-4">
      Please complete your profile to access all features and track your production.
    </p>
    <Button onClick={() => navigate('/settings')}>
      Set Up Profile
    </Button>
  </GlassCard>
) : (
  // Normal agent portal content
)}
```

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/pages/DashboardCRM.tsx` | **Modify** | Add monthly AOP to agent cards, enhance stats display |
| `src/components/dashboard/OnboardingTracker.tsx` | **Modify** | Replace arrows with clickable stage circles, add animations |
| `src/components/dashboard/LeaderboardTabs.tsx` | **Modify** | Update column labels (H, P, C, R, %), add totals to footer |
| `src/components/dashboard/PerformanceBreakdownModal.tsx` | **Create** | "Where You Rank" pop-up with graphs and AI summary |
| `supabase/functions/notify-stage-change/index.ts` | **Create** | Email notification when agent stage changes |
| `supabase/functions/ai-assistant/index.ts` | **Modify** | Add `performance_breakdown` request type |
| `supabase/config.toml` | **Modify** | Register new `notify-stage-change` function |

---

## Animation Details

**Stage Circle Click Animation:**
- `whileHover`: scale 1.15 with spring physics
- `whileTap`: scale 0.95 for tactile feedback
- Current stage: gentle pulse animation
- Completed stages: glow effect with shadow

**Performance Modal:**
- Slide-up entrance with fade
- Staggered bar chart animations
- Smooth progress bar fills

**Leaderboard Enhancements:**
- Tooltip hover states on column headers
- Subtle glow on category leaders

---

## Benefits

1. **Instant Performance Context** - Weekly + monthly AOP visible at a glance
2. **Faster Stage Navigation** - Click circles directly instead of arrow buttons
3. **Agent Engagement** - Email notifications keep agents informed of progress
4. **Clearer Metrics** - Explicit labels remove confusion
5. **Self-Improvement Tool** - "Where You Rank" gives actionable insights
6. **Clean Animations** - Professional, polished feel throughout

