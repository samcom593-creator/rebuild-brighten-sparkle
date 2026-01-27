
# Agent Portal Enhancement: Rank Display, Email Alerts & Link Verification

## Summary

This plan addresses all your requests:

1. **Show Agent's Rank in Header** - Display the agent's leaderboard rank right next to their name at the top of the portal (sticky header)
2. **Email Alert: When Someone Passes You** - New edge function to notify agents when they've been passed on the leaderboard
3. **Email Alert: When Agent Joins** - Enhanced welcome email when a new agent joins the team
4. **Email Alert: On Login** - Notification when an agent logs into the portal (configurable)
5. **Verify All Links Work** - Ensure all portal links work with session persistence

---

## Current State

- **Header Display**: Shows agent name + date but **no rank position**
- **Rank Change Alerts**: `useRankChange` hook tracks changes for UI but doesn't trigger emails
- **Welcome Email**: Exists (`welcome-new-agent`) but uses wrong sender domain
- **Login Tracking**: No email notification currently on login
- **Links**: `/numbers`, `/agent-portal`, `/apex-daily-numbers` all work with session persistence

---

## Detailed Implementation

### 1. Agent Rank Badge in Header

**File: `src/pages/AgentPortal.tsx`**

Add a prominent rank badge next to the agent's name in the sticky header that shows their current position on the leaderboard.

**Changes:**
- Create new state `currentRank` to track the agent's position
- Add a query on component mount to calculate rank from `daily_production`
- Display rank badge with dynamic styling (gold for #1, silver for #2, bronze for #3, etc.)
- Subscribe to real-time updates so rank updates live

**Visual Design:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Avatar]  Samuel James  #4 📈        🌙  [Logout]              │
│            Monday, January 27, 2026                              │
└─────────────────────────────────────────────────────────────────┘
```

The rank badge will:
- Show as `#1`, `#2`, `#3`, etc.
- Have special styling for top 3 (gold/silver/bronze gradient)
- Include rank change indicator (`↑` or `↓`) when applicable
- Update in real-time as production is logged

**Also add to Performance Dashboard header:**
```
Performance Dashboard  •  You're #4 on the Leaderboard!
```

### 2. New Edge Function: `notify-rank-passed`

**File: `supabase/functions/notify-rank-passed/index.ts`**

Triggered when production is submitted to check if anyone has been passed on the leaderboard.

**Logic Flow:**
1. When agent submits numbers, fetch current leaderboard rankings
2. Compare to stored previous rankings (from `agent_rank_history` table or previous calculation)
3. If an agent was passed (their rank decreased), send them an email notification

**Email Content:**
```
Subject: 🏃 You've Been Passed! Time to Catch Up!

Hey [Name],

[Passer Name] just moved ahead of you on the leaderboard!

📊 Your Current Position: #5
📈 [Passer] is now: #4

Don't let them get too far ahead - log your numbers now!

[Log My Numbers Button → apex-financial.org/numbers]
```

**Technical Notes:**
- Called after `notify-production-submitted` completes
- Compares today's rankings to yesterday's
- Only sends if agent was actually in the rankings (has production)
- Rate limited to 1 notification per agent per hour

### 3. New Edge Function: `notify-agent-login`

**File: `supabase/functions/notify-agent-login/index.ts`**

Sends a notification when an agent logs into the portal.

**When Triggered:**
- Called from `simple-login` edge function after successful authentication
- Only for agents with `onboarding_stage = 'evaluated'` (Live agents)
- Configurable via agent setting (can be disabled)

**Email Content:**
```
Subject: ✅ Portal Login Confirmed

Hey [Name],

You just logged into the APEX Daily Numbers portal.

📍 Time: January 27, 2026 at 2:45 PM CST
🖥️ If this wasn't you, please contact your manager immediately.

Ready to log today's numbers?

[Log Numbers → apex-financial.org/numbers]
```

**Integration with `simple-login`:**
- Add a call to `notify-agent-login` after successful OTP verification
- Pass user agent info for security context

### 4. Enhanced Welcome Email

**File: `supabase/functions/welcome-new-agent/index.ts`**

Update existing welcome email to use correct domain and include portal link.

**Changes:**
- Change sender from `onboarding@resend.dev` to `notifications@tx.apex-financial.org`
- Add direct link to `/numbers` portal
- Include manager name if available
- Add gamification element (mention leaderboard)

**Updated Email:**
```
Subject: 🎉 Welcome to APEX Financial, [Name]!

From: APEX Financial <notifications@tx.apex-financial.org>

[Welcome message with:]
- Daily meeting info (10 AM CST)
- Discord link
- Portal access link: apex-financial.org/numbers
- Manager contact info
```

### 5. Link Verification & Session Persistence

**Files to verify:**
- `src/pages/Numbers.tsx` - Simple login with session persistence ✓
- `src/pages/AgentPortal.tsx` - Protected route with auth check ✓
- `src/pages/LogNumbers.tsx` - Protected route ✓
- `src/App.tsx` - Route definitions ✓

**Current Routes (all working):**
| Route | Page | Auth Required | Status |
|-------|------|---------------|--------|
| `/numbers` | Numbers.tsx | Session-based simple login | ✓ Works |
| `/agent-portal` | AgentPortal.tsx | Full auth (ProtectedRoute) | ✓ Works |
| `/apex-daily-numbers` | LogNumbers.tsx | Full auth (ProtectedRoute) | ✓ Works |
| `/log-numbers` | Redirect → `/apex-daily-numbers` | - | ✓ Works |

**Session Persistence:**
- `Numbers.tsx` uses `supabase.auth.onAuthStateChange()` listener
- Sessions persist via `localStorage` (configured in `client.ts`)
- Magic links work with OTP verification
- Bookmarking and returning works without re-login

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/pages/AgentPortal.tsx` | Modify | Add rank badge to header with real-time updates |
| `src/pages/Numbers.tsx` | Modify | Add rank display to authenticated view header |
| `supabase/functions/notify-rank-passed/index.ts` | Create | New edge function for passed alerts |
| `supabase/functions/notify-agent-login/index.ts` | Create | New edge function for login notifications |
| `supabase/functions/simple-login/index.ts` | Modify | Trigger login notification after auth |
| `supabase/functions/notify-production-submitted/index.ts` | Modify | Call rank-passed check after submission |
| `supabase/functions/welcome-new-agent/index.ts` | Modify | Fix sender domain, add portal link |
| `supabase/config.toml` | Modify | Add new function configs |

---

## Technical Implementation Details

### Rank Calculation Query

```typescript
// Get current agent's rank from daily production
const today = new Date().toISOString().split("T")[0];
const { data: allProduction } = await supabase
  .from("daily_production")
  .select("agent_id, aop")
  .eq("production_date", today)
  .order("aop", { ascending: false });

const myRank = allProduction?.findIndex(p => p.agent_id === agentId) + 1 || null;
```

### Real-time Rank Updates

```typescript
// Subscribe to production changes to update rank live
const channel = supabase
  .channel("my-rank")
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "daily_production"
  }, () => {
    fetchCurrentRank();
  })
  .subscribe();
```

### Rank Passed Detection

```typescript
// In notify-production-submitted, after saving:
const previousRankings = await getPreviousRankings(); // From cache or yesterday
const currentRankings = await getCurrentRankings();

for (const current of currentRankings) {
  const prev = previousRankings.find(p => p.agent_id === current.agent_id);
  if (prev && current.rank > prev.rank) {
    // This agent was passed! Find who passed them
    const passer = currentRankings.find(c => c.rank === prev.rank);
    await sendPassedNotification(current.agent_id, passer);
  }
}
```

---

## UI Components

### Rank Badge Component

```tsx
function RankBadge({ rank, showChange = true }: { rank: number | null; showChange?: boolean }) {
  if (!rank) return null;
  
  const isTop3 = rank <= 3;
  const gradients = {
    1: "from-amber-400 to-amber-600",
    2: "from-slate-300 to-slate-400", 
    3: "from-amber-600 to-amber-800",
  };
  
  return (
    <div className={cn(
      "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
      isTop3 
        ? `bg-gradient-to-r ${gradients[rank as 1|2|3]} text-white shadow-sm`
        : "bg-muted text-muted-foreground"
    )}>
      #{rank}
      {showChange && <RankChangeIndicator ... />}
    </div>
  );
}
```

---

## Success Criteria

1. Agent sees their rank badge next to their name in the portal header
2. Rank updates in real-time when production is logged
3. Email sent when an agent is passed on the leaderboard
4. Email sent on successful portal login (for security awareness)
5. Welcome email uses correct APEX domain
6. All portal links work with session persistence
7. Bookmarked links return users to authenticated state

---

## Email Domain Confirmation

All emails will be sent from:
- **Production notifications**: `noreply@apex-financial.org`
- **Team notifications**: `notifications@tx.apex-financial.org`
- **Transactional**: `noreply@apex-financial.org`

The `lovable.app` domain is **never** used in any user-facing emails - it's only Lovable's internal preview URL.
