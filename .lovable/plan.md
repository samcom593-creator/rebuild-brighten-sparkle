
# Plaque Recognition System, Team Visibility & Goal Updates

## Overview

Building a comprehensive reward system with AI-generated plaques, recognition emails, team visibility controls, and leaderboard improvements.

---

## 1. AI-Generated Plaque Certificate System

### New Edge Function: `send-plaque-recognition`

Creates a dedicated function that:
1. Uses Lovable AI (google/gemini-3-pro-image-preview) to generate professional plaque images
2. Sends recognition email with:
   - AI-generated downloadable plaque image
   - HTML certificate they can screenshot
3. Also sends to the agent's manager (invited_by_manager_id)

### Milestone Triggers

| Milestone | Trigger | Badge Color |
|-----------|---------|-------------|
| Bronze Star | $3,000+ single day | Bronze/Copper |
| Gold Star | $5,000+ single day | Gold |
| Diamond | $10,000+ weekly | Diamond/Platinum |
| Elite Producer | $25,000+ monthly | Black & Gold |

### Email Template Features
- AI-generated plaque with agent name, achievement, and date
- Professional certificate HTML they can screenshot
- Download link for the plaque image
- Celebratory design with confetti effects
- Both agent AND manager receive the recognition

---

## 2. Team Total Summary Visibility (Admin Only)

### File: `src/pages/AgentPortal.tsx`

Update the quick stats section to ONLY show team totals for admin users:

**Current behavior**: Shows team stats for both admin AND manager
**New behavior**: Shows team stats ONLY for admin

```tsx
// Change from:
const showTeamStats = (isAdmin || isManager) && teamTodayStats.totalALP > 0;

// Change to:
const showTeamStats = isAdmin && teamTodayStats.totalALP > 0;
```

This ensures managers see their personal stats while only the admin (you) sees agency-wide totals.

---

## 3. Update Team Goals (January → $75K)

### File: `src/components/dashboard/TeamGoalsTracker.tsx`

Update the monthly targets:

```tsx
const MONTHLY_TARGETS = {
  alp: 75000,  // Changed from 100000 to 75000 for January
  deals: 40,   // Adjusted proportionally
  presentations: 150,
  referrals: 25,
};
```

**Note**: For February's $400K goal, I recommend making these targets database-configurable rather than hardcoded. This would allow you to set monthly goals from the admin panel.

---

## 4. Auto-Trigger Milestones on Production Submit

### File: `src/components/dashboard/ProductionEntry.tsx`

Add milestone detection logic after production is saved:

```tsx
// After saving production, check for milestones
const checkMilestones = async (agentId: string, alp: number, productionDate: string) => {
  // Check single-day milestones ($3K, $5K)
  if (alp >= 5000) {
    await supabase.functions.invoke("send-plaque-recognition", {
      body: { agentId, milestoneType: "single_day", amount: alp, date: productionDate }
    });
  } else if (alp >= 3000) {
    await supabase.functions.invoke("send-plaque-recognition", {
      body: { agentId, milestoneType: "single_day_bronze", amount: alp, date: productionDate }
    });
  }
  
  // Weekly milestone check will be handled by a separate cron function
};
```

---

## 5. Weekly/Monthly Milestone Cron Jobs

### New Edge Functions:

**`check-weekly-milestones`** (runs Sunday night)
- Calculates weekly ALP per agent
- Triggers $10K+ plaque for agents who hit it
- Sends to agent + manager

**`check-monthly-milestones`** (runs on 1st of month)
- Calculates previous month's total ALP
- Triggers $25K+ elite producer plaque
- Sends to agent + manager

---

## 6. Smooth Portal Navigation

### Current Issue
The agent portal navigation drawer already exists but may not be obvious.

### Improvements to `src/pages/AgentPortal.tsx`:
- Add a persistent "Menu" indicator with pulse animation for first-time users
- Ensure all links in the Sheet work correctly
- Add quick-access buttons in the main view for Dashboard, My Team, etc.

---

## 7. Make Muhammad (Moody) Plaque Now

As part of this implementation, I'll manually trigger a recognition for Muhammad who did $5,000 ALP:
- Send the plaque email immediately upon deployment
- Include his manager in the recognition

---

## Summary of Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/send-plaque-recognition/index.ts` | **CREATE** | AI plaque generation + email sending |
| `supabase/functions/check-weekly-milestones/index.ts` | **CREATE** | Weekly $10K check cron |
| `supabase/functions/check-monthly-milestones/index.ts` | **CREATE** | Monthly $25K check cron |
| `src/pages/AgentPortal.tsx` | **MODIFY** | Admin-only team stats visibility |
| `src/components/dashboard/TeamGoalsTracker.tsx` | **MODIFY** | Update January goal to $75K |
| `src/components/dashboard/ProductionEntry.tsx` | **MODIFY** | Add milestone trigger on save |
| `supabase/config.toml` | **MODIFY** | Add new edge functions |

---

## How the Plaque System Works

```text
┌─────────────────────────────────────────────────────────────────┐
│                    PLAQUE RECOGNITION FLOW                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐  │
│  │ Agent Logs  │────▶│ Check if ALP │────▶│ Trigger Plaque  │  │
│  │ Production  │     │ >= Milestone │     │ Edge Function   │  │
│  └─────────────┘     └──────────────┘     └────────┬────────┘  │
│                                                     │           │
│                      ┌──────────────────────────────┘           │
│                      ▼                                          │
│              ┌───────────────┐                                  │
│              │ Lovable AI    │                                  │
│              │ Generate      │                                  │
│              │ Plaque Image  │                                  │
│              └───────┬───────┘                                  │
│                      │                                          │
│         ┌────────────┴────────────┐                            │
│         ▼                         ▼                            │
│  ┌─────────────┐          ┌─────────────┐                      │
│  │ Store Image │          │ Send Email  │                      │
│  │ to Storage  │          │ to Agent &  │                      │
│  │             │          │ Manager     │                      │
│  └─────────────┘          └─────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps After Approval

1. Create the plaque recognition edge function with AI image generation
2. Update team visibility to admin-only
3. Update January team goal to $75K
4. Add milestone triggers to production entry
5. Create weekly/monthly cron functions
6. Send Muhammad his $5K plaque immediately

When you provide the list of deals, I'll also add that data to ensure the leaderboard and stats are accurate.
