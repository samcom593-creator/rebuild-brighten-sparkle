

# Complete Recruiter HQ: AI Summarization + Lead Coverage + Missing Features

## What's Already Working

- Kanban board with 5 columns, mobile segmented tabs
- Lead scoring (0-100), auto-stage suggestions, smart follow-ups
- Activity timeline on cards, call outcome tracking
- Performance metrics strip, XP system, focus mode
- InterviewScheduler wired in, global ScheduleBar
- ai-assistant edge function handles coaching, summaries, chat, and performance breakdowns

## What's Missing (Gap Analysis)

### 1. AI Insight Panel for Recruiter HQ
The `AIInsightsCard` and `AICoachingPanel` components exist but are NOT rendered anywhere on the Recruiter HQ page. Aisha has no AI-powered intelligence panel showing:
- Hot Leads Today
- At-Risk Leads
- Suggested Stage Moves
- Leads Not Contacted in 48h
- Recruiter-specific coaching

### 2. AI Summarization for Individual Leads
There is no way for Aisha to get an AI summary of a specific lead directly from the Recruiter HQ card. The `ApplicantSummary` component exists but is not integrated into lead cards.

### 3. Lead Coverage Gap
The current query only pulls from the `applications` table (57 leads). The user wants ALL leads that are not licensed. There are 925 aged leads (`aged_leads` table) that are NOT contacted yet. The user said: "all leads except aged leads, unless they were contacted." This means:
- All `applications` that are not licensed (currently working)
- Plus `aged_leads` WHERE `status = 'contacted'` (these SHOULD appear since they've been contacted)

### 4. `ai-assistant` Edge Function Missing `recruiter_insights` Type
Need a new request type that generates a recruiter-specific daily brief from lead data.

---

## Implementation Plan

### Step 1: Add `recruiter_insights` type to `ai-assistant` edge function

Add a new case to the `ai-assistant` edge function that accepts recruiter stats (total leads, overdue count, hot leads, at-risk count, pipeline breakdown) and returns a structured daily brief with actionable items.

### Step 2: Create `RecruiterAIPanel` component

New component: `src/components/recruiter/RecruiterAIPanel.tsx`

Features:
- "Get AI Brief" button that calls `ai-assistant` with type `recruiter_insights`
- Shows 4 quick-stat cards: Hot Leads, At-Risk, Overdue, Suggested Moves
- Expandable AI-generated daily brief text
- Auto-generates local insights (like `AIInsightsCard` does) for instant feedback
- "Summarize Lead" button on each lead card that calls `ai-assistant` with type `summary`

### Step 3: Add AI Summary Button to LeadCard

Add a small Brain icon button to each lead card's action row. When clicked:
- Calls `ai-assistant` with the lead's data
- Shows a popover/dialog with the AI-generated summary
- Helps Aisha quickly assess any lead without manual review

### Step 4: Include Contacted Aged Leads

Modify `fetchLeads` in `RecruiterDashboardInner` to also query `aged_leads` WHERE `status = 'contacted'`, normalize them to the same `Lead` interface, and merge them into the lead list. These will appear in the "Needs Outreach" column since they don't have a `license_progress` value.

### Step 5: Render AI Panel on Recruiter HQ

Insert `RecruiterAIPanel` between the stat bubbles and the search/filter bar on the Recruiter HQ page. It will be collapsible so it doesn't take up space when Aisha wants to focus on the Kanban.

---

## Files Changed/Created

| File | Action |
|---|---|
| `supabase/functions/ai-assistant/index.ts` | Add `recruiter_insights` request type |
| `src/components/recruiter/RecruiterAIPanel.tsx` | New component -- AI daily brief + insights |
| `src/pages/RecruiterDashboard.tsx` | Import RecruiterAIPanel, add lead AI summary button, include contacted aged leads in query |

## Technical Details

### ai-assistant edge function -- new type

```
case 'recruiter_insights':
  - System prompt: "You are a recruiting operations analyst..."
  - User prompt: pipeline breakdown, overdue count, hot leads, at-risk, velocity
  - Returns: 3-4 sentence daily brief with priorities
```

### Aged leads normalization

Aged leads from the `aged_leads` table will be mapped to the `Lead` interface:
- `license_progress` defaults to `"unlicensed"`
- `license_status` defaults to `"unlicensed"`
- `contacted_at` maps from `contacted_at`
- `last_contacted_at` maps from `last_contacted_at`
- Only include where `status = 'contacted'` per user requirement

### LeadCard AI Summary

- New Brain icon button in the action row
- On click: opens a small dialog/popover
- Calls `ai-assistant` with type `summary` passing lead data
- Shows loading spinner then the AI-generated text
- Cached per lead to avoid redundant API calls

