
# Comprehensive Optimization & Feature Enhancement Plan

## Summary of Changes Needed

Based on the analysis, I've identified the following issues and enhancements:

1. **Team Hierarchy: Admin name visibility & categories** - Your name should always be visible with a "You" badge
2. **Team Hierarchy: Add Course & Edit Profile buttons** - Already present but need verification
3. **Course Progress: Score breakdowns per module** - Currently shows pass/fail, need actual quiz scores
4. **Course Progress: Automated hurry-up emails** - Create a cron job to send emails within 4 hours and for 2 days
5. **Pipeline/CRM Loading Speed** - Optimize `AnimatePresence mode="wait"` blocking navigation
6. **Agent Portal Glitch** - Multiple `AnimatePresence mode="wait"` blocks causing issues on mobile
7. **Dashboard: Admin should see agency stats, not personal** - The TeamSnapshotCard already does this, but verify it's working correctly
8. **Monthly Reset Preparation** - Create an edge function for monthly goal resets

---

## 1. Team Hierarchy - Admin Name Visibility

**File:** `src/components/dashboard/TeamHierarchyManager.tsx`

**Current Behavior:** The admin's row shows a "You" badge but may be hidden in certain filter views

**Fix:** Ensure the admin agent is ALWAYS visible at the top of the list regardless of filter, with clear "You" indication

```tsx
// Add to filteredAgents logic (around line 294)
// Always include admin at top
const filteredAgents = [
  // Admin agent first (if exists)
  ...agents.filter(a => a.id === adminAgentId),
  // Then filtered agents (excluding admin to avoid duplicate)
  ...(filterManager === "all" 
    ? agents.filter(a => a.id !== adminAgentId)
    : filterManager === "orphaned"
    ? agents.filter(a => !a.managerId && a.id !== adminAgentId)
    : agents.filter(a => a.managerId === filterManager && a.id !== adminAgentId))
];
```

---

## 2. Course Progress - Module Score Breakdown

**File:** `src/pages/CourseProgress.tsx`

**Current Behavior:** Shows pass/fail status per module, but not actual quiz scores

**Enhancement:** Add score display for each module quiz

```tsx
// Update the AgentProgress interface to include scores
interface AgentProgress {
  // ... existing fields
  modules: Record<string, { 
    passed: boolean; 
    completedAt: string | null; 
    watchedPercent: number;
    quizScore: number | null;  // NEW: Add quiz score
    totalQuestions: number;    // NEW: Add total questions
  }>;
}

// In the query, also fetch quiz attempt scores
const { data: quizAttempts } = await supabase
  .from("quiz_attempts")
  .select("agent_id, module_id, score, created_at")
  .in("agent_id", agentIds);
```

**Display Change:** Show score percentage in each module cell:
```tsx
// Instead of just checkmark, show: "85%" or "✓ 100%"
<span className="text-xs">{module.quizScore !== null ? `${module.quizScore}%` : '—'}</span>
```

---

## 3. Course Progress - Automated Hurry-Up Emails

**New Edge Function:** `supabase/functions/send-course-hurry-emails/index.ts`

**Logic:**
1. Find agents who started the course (have at least one progress entry)
2. If **within first 4 hours** of starting and not completed → send "most people finish by now" email
3. If **24 hours since start** and not completed → send first follow-up
4. If **48 hours since start** and not completed → send urgent reminder
5. Track sent emails in a new table to prevent duplicates

**Cron Schedule:** Set up a cron job to run this function every 2 hours

```typescript
// Pseudo-code for the edge function
const now = new Date();

// Get agents in training with incomplete course
const { data: trainingAgents } = await supabase
  .from("agents")
  .select("id, user_id, created_at")
  .in("onboarding_stage", ["onboarding", "training_online"])
  .eq("is_deactivated", false);

for (const agent of trainingAgents) {
  const hoursSinceStart = (now - new Date(agent.created_at)) / (1000 * 60 * 60);
  
  // Check if 100% complete
  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("passed")
    .eq("agent_id", agent.id);
  
  const passedCount = progress?.filter(p => p.passed).length || 0;
  if (passedCount >= totalModules) continue; // Already done
  
  // Send appropriate email based on timing
  if (hoursSinceStart >= 4 && hoursSinceStart < 6 && !emailAlreadySent('4hour', agent.id)) {
    await sendHurryEmail(agent, "most-finish-by-now");
    await logEmailSent('4hour', agent.id);
  } else if (hoursSinceStart >= 24 && hoursSinceStart < 26 && !emailAlreadySent('24hour', agent.id)) {
    await sendHurryEmail(agent, "first-followup");
    await logEmailSent('24hour', agent.id);
  } else if (hoursSinceStart >= 48 && hoursSinceStart < 50 && !emailAlreadySent('48hour', agent.id)) {
    await sendHurryEmail(agent, "urgent-reminder");
    await logEmailSent('48hour', agent.id);
  }
}
```

---

## 4. Pipeline/CRM Loading Speed Optimization

**File:** `src/pages/DashboardCRM.tsx`

**Issue:** Multiple `AnimatePresence mode="wait"` blocks are forcing sequential animations, slowing perceived load

**Fix:** Replace `mode="wait"` with `mode="popLayout"` or remove entirely for non-critical sections

```tsx
// Lines 871, 974, 1024 - Change:
<AnimatePresence mode="wait">
// To:
<AnimatePresence initial={false}>
```

This allows overlapping animations and prevents the queue buildup.

---

## 5. Agent Portal Glitch Fix

**File:** `src/pages/AgentPortal.tsx`

**Issue:** Lines 546, 564, 596 have `AnimatePresence mode="wait"` which can cause glitches on rapid tab switching

**Fix:** Same pattern - remove `mode="wait"`:

```tsx
// Line 546, 564, 596 - Change:
<AnimatePresence mode="wait">
// To:
<AnimatePresence initial={false}>
```

---

## 6. Dashboard - Agency Stats for Admin (Not Personal)

**Analysis:** The `TeamSnapshotCard` component (used in Dashboard.tsx) already correctly shows:
- **Admin:** Agency Production (all agents)
- **Manager:** Team Production (downline + self)
- **Agent:** My Production (self only)

**Verification Needed:** The AgentPortal.tsx also shows stats. Currently it shows personal stats for regular agents and team stats for admin. This appears correct.

**No Code Changes Needed** - The current implementation is correct per the code analysis.

---

## 7. Monthly Reset Preparation

**New Edge Function:** `supabase/functions/reset-monthly-goals/index.ts`

**Purpose:** Reset team goals at the start of each month with new targets

**Implementation:**

```typescript
// Reset team goals for new month
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Get current month
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Archive previous month's achievements
  // Note: Production data is already date-based, so no reset needed for daily_production
  
  // Reset team goals if a team_goals table exists, or create month-specific entries
  const newGoals = {
    month: monthKey,
    deals_goal: 300000,      // Default: $300K deals closed
    presentations_goal: 350, // Default: 350 presentations
    referrals_goal: 50,      // Default: 50 referrals
    created_at: now.toISOString(),
  };

  // Upsert monthly goal record
  await supabase
    .from("monthly_goals")
    .upsert(newGoals, { onConflict: "month" });

  return new Response(
    JSON.stringify({ success: true, month: monthKey }),
    { headers: { "Content-Type": "application/json" } }
  );
});
```

**Database Migration Needed:** Create `monthly_goals` table if it doesn't exist

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/dashboard/TeamHierarchyManager.tsx` | Ensure admin is always visible at top of filtered list |
| `src/pages/CourseProgress.tsx` | Add quiz score display per module |
| `src/pages/DashboardCRM.tsx` | Remove `AnimatePresence mode="wait"` for faster loading |
| `src/pages/AgentPortal.tsx` | Remove `AnimatePresence mode="wait"` to fix glitches |
| `supabase/functions/send-course-hurry-emails/index.ts` | **NEW** - Create hurry-up email cron job |
| `supabase/functions/reset-monthly-goals/index.ts` | **NEW** - Create monthly reset function |

## New Database Tables (if needed)

| Table | Purpose |
|-------|---------|
| `course_reminder_log` | Track which hurry-up emails have been sent to prevent duplicates |
| `monthly_goals` | Store monthly goal targets for reset functionality |

---

## Expected Results

1. **Team Hierarchy:** Your name always visible with "You" badge, categories work correctly, Add Course and Edit Profile buttons functional
2. **Course Progress:** Shows actual quiz scores per module (e.g., "85%") not just pass/fail
3. **Automated Emails:** Agents receive hurry-up emails at 4 hours, 24 hours, and 48 hours if not complete
4. **CRM/Pipeline:** Loads instantly without animation blocking
5. **Agent Portal:** No more glitches on mobile tab switching
6. **Dashboard:** Admin sees agency-wide stats (already working correctly)
7. **Monthly Reset:** Ready to trigger at month-end to set new goals
