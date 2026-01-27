

# Automated Plaque Recognition System

## Overview

Create a fully automated, nightly plaque distribution system that triggers recognition for:
1. **Daily Production Plaques** - Bronze ($1K+), Gold ($3K+), Platinum ($5K+)
2. **Weekly Diamond Plaques** - $10K+ weekly production
3. **Monthly Elite Plaques** - $25K+ monthly production
4. **Recruiting Plaques** - Hiring milestones (3+ or 5+ contracted in a day)
5. **Streak Plaques** - Multi-day deal streaks (5-day, 10-day, etc.)
6. **Comeback Champion** - Biggest improvement week-over-week

---

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| `send-plaque-recognition` | Exists | Sends Bronze, Gold, Weekly, Monthly plaques |
| `check-weekly-milestones` | Exists | Checks $10K+ weekly (not scheduled) |
| `check-monthly-milestones` | Exists | Checks $25K+ monthly (not scheduled) |
| Daily plaque check | Missing | No automated nightly check |
| Recruiting plaques | Missing | No hiring milestone recognition |
| Streak detection | Missing | No streak tracking for plaques |

**Existing Cron Jobs** (17 total):
- No plaque-related cron jobs currently scheduled

---

## Implementation Plan

### 1. Create New Edge Function: `check-daily-plaques`

**Purpose**: Run nightly at 11:00 PM CST to distribute that day's production plaques

**File**: `supabase/functions/check-daily-plaques/index.ts`

**Logic**:
```text
1. Get today's date (CST timezone)
2. Query all daily_production for today
3. For each agent with production:
   - $5,000+ → Platinum Achievement (NEW tier)
   - $3,000+ → Gold Achievement
   - $1,000+ → Bronze Achievement
4. Call send-plaque-recognition for each qualifier
5. Log results
```

**Plaque Tiers**:
| Tier | Threshold | Color | Badge |
|------|-----------|-------|-------|
| Bronze | $1,000+ | #CD7F32 | BRONZE ACHIEVEMENT |
| Gold | $3,000+ | #C9A962 | GOLD ACHIEVEMENT |
| Platinum | $5,000+ | #E5E4E2 | PLATINUM ACHIEVEMENT |

### 2. Create New Edge Function: `check-recruiting-milestones`

**Purpose**: Run nightly to recognize hiring achievements

**File**: `supabase/functions/check-recruiting-milestones/index.ts`

**Milestone Types**:
| Achievement | Trigger | Badge |
|-------------|---------|-------|
| Recruiter Rising | 3 contracted in one day | RECRUITER RISING |
| Hiring Champion | 5+ contracted in one day | HIRING CHAMPION |
| Team Builder | 10+ contracted in one week | TEAM BUILDER |

**Logic**:
```text
1. Query applications where contracted_at = today
2. Group by assigned_agent_id (the recruiter)
3. For recruiters with 3+ → Recruiter Rising plaque
4. For recruiters with 5+ → Hiring Champion plaque
5. Also check weekly: 10+ contracted → Team Builder plaque
```

### 3. Create New Edge Function: `check-streak-milestones`

**Purpose**: Track consecutive days with deals and reward streaks

**File**: `supabase/functions/check-streak-milestones/index.ts`

**Streak Tiers**:
| Streak | Days | Badge |
|--------|------|-------|
| Hot Streak | 5 consecutive deal days | HOT STREAK |
| On Fire | 10 consecutive deal days | ON FIRE |
| Unstoppable | 20 consecutive deal days | UNSTOPPABLE |

**Logic**:
```text
1. For each active agent:
   a. Query daily_production ordered by date DESC
   b. Count consecutive days where deals_closed > 0
   c. If streak crosses 5/10/20 threshold today → trigger plaque
2. Prevent duplicate plaques by checking if streak plaque already sent
```

### 4. Create New Edge Function: `check-comeback-milestones`

**Purpose**: Weekly check for biggest improvement (week-over-week)

**File**: `supabase/functions/check-comeback-milestones/index.ts`

**Logic**:
```text
1. Calculate this week's production per agent
2. Calculate last week's production per agent
3. Find agent with biggest $ improvement
4. If improvement is $3,000+ → Comeback Champion plaque
```

### 5. Update `send-plaque-recognition` for New Milestone Types

**Add to milestoneType union**:
```typescript
milestoneType: 
  | "single_day_bronze" 
  | "single_day" 
  | "single_day_platinum"  // NEW
  | "weekly" 
  | "monthly"
  | "recruiter_rising"     // NEW
  | "hiring_champion"      // NEW
  | "team_builder"         // NEW
  | "hot_streak"           // NEW
  | "on_fire"              // NEW
  | "unstoppable"          // NEW
  | "comeback_champion";   // NEW
```

**Add milestone details**:
```typescript
case "single_day_platinum":
  return {
    title: "Platinum Achievement",
    description: `Elite single-day production of $${amount.toLocaleString()}`,
    color: "#E5E4E2",  // Platinum silver
    threshold: "$5,000+",
    badge: "PLATINUM ACHIEVEMENT",
  };

case "recruiter_rising":
  return {
    title: "Recruiter Rising",
    description: `Contracted ${amount} agents in a single day`,
    color: "#22C55E",  // Green
    threshold: "3+ Hired",
    badge: "RECRUITER RISING",
  };

case "hiring_champion":
  return {
    title: "Hiring Champion",
    description: `Exceptional recruiting: ${amount} agents contracted in one day`,
    color: "#FBBF24",  // Yellow gold
    threshold: "5+ Hired",
    badge: "HIRING CHAMPION",
  };

// ... etc for other types
```

### 6. Schedule Cron Jobs

**New Cron Jobs to Add**:

| Job Name | Schedule | Time (CST) | Function |
|----------|----------|------------|----------|
| check-daily-plaques-11pm | `0 5 * * *` | 11 PM CST | check-daily-plaques |
| check-weekly-milestones-sat | `0 6 * * 6` | 12 AM CST Sat | check-weekly-milestones |
| check-monthly-milestones-1st | `0 6 1 * *` | 12 AM 1st | check-monthly-milestones |
| check-recruiting-milestones | `0 5 * * *` | 11 PM CST | check-recruiting-milestones |
| check-streak-milestones | `0 5 * * *` | 11 PM CST | check-streak-milestones |
| check-comeback-weekly | `0 6 * * 0` | 12 AM Sun | check-comeback-milestones |

**Note**: UTC offset for CST is UTC-6, so 11 PM CST = 5 AM UTC

### 7. Add Duplicate Prevention

**Create table**: `plaque_awards` (tracking table)

```sql
CREATE TABLE plaque_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  milestone_type TEXT NOT NULL,
  milestone_date DATE NOT NULL,
  amount NUMERIC,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, milestone_type, milestone_date)
);
```

This prevents sending duplicate plaques for the same achievement on the same day.

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/check-daily-plaques/index.ts` | Nightly daily production check |
| `supabase/functions/check-recruiting-milestones/index.ts` | Hiring achievement check |
| `supabase/functions/check-streak-milestones/index.ts` | Consecutive deal day tracking |
| `supabase/functions/check-comeback-milestones/index.ts` | Week-over-week improvement |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/send-plaque-recognition/index.ts` | Add new milestone types and designs |
| `supabase/config.toml` | Add new function configs |

## Database Changes

| Change | Purpose |
|--------|---------|
| Create `plaque_awards` table | Track awarded plaques to prevent duplicates |
| Add cron jobs | Schedule automated checks |

---

## Plaque Recognition Matrix

### Production Plaques (Daily)
| Achievement | Threshold | Frequency |
|-------------|-----------|-----------|
| Bronze | $1,000/day | Nightly 11 PM |
| Gold | $3,000/day | Nightly 11 PM |
| Platinum | $5,000/day | Nightly 11 PM |

### Production Plaques (Weekly/Monthly)
| Achievement | Threshold | Frequency |
|-------------|-----------|-----------|
| Weekly Diamond | $10,000/week | Saturday midnight |
| Monthly Elite | $25,000/month | 1st of month |

### Recruiting Plaques
| Achievement | Threshold | Frequency |
|-------------|-----------|-----------|
| Recruiter Rising | 3 hires/day | Nightly 11 PM |
| Hiring Champion | 5 hires/day | Nightly 11 PM |
| Team Builder | 10 hires/week | Saturday midnight |

### Performance Plaques
| Achievement | Threshold | Frequency |
|-------------|-----------|-----------|
| Hot Streak | 5 consecutive deal days | Nightly |
| On Fire | 10 consecutive deal days | Nightly |
| Unstoppable | 20 consecutive deal days | Nightly |
| Comeback Champion | Biggest weekly improvement ($3K+) | Sunday midnight |

---

## Email Design Consistency

All plaques follow the existing institutional design:
- Dark background (#0a0a0a)
- Playfair Display for headers
- Inter for body text
- Color-coded by achievement tier
- Clean, hedge-fund aesthetic

---

## Summary

This system will:
1. **Automatically** send daily production plaques every night at 11 PM CST
2. **Track hiring milestones** and recognize top recruiters
3. **Celebrate deal streaks** with escalating achievements
4. **Highlight comebacks** with weekly improvement awards
5. **Prevent duplicates** with a tracking table
6. **Run on schedule** with no manual intervention needed

Once implemented, you'll never need to manually trigger plaques again - the system handles everything automatically based on production data.

