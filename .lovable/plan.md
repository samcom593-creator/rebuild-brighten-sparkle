

## Fix: Evening Cron Job "Clog" at 6-7 PM

### The Problem

Three heavy notification jobs run back-to-back around 6-7 PM CST, each using inefficient sequential processing:

| Time (CST) | Job | Issue |
|------------|-----|-------|
| 6:00 PM | notify-top-performer | Loops all agents, 1 email at a time with 300ms delays |
| 7:00 PM | notify-fill-numbers | Same pattern |
| 7:30 PM | notify-missed-dialer | Same pattern + extra DB query per agent |

With 50 agents, each function takes 15-30+ seconds just in artificial delays, plus sequential DB queries that could be batched.

### Solution

1. **Stagger the job times** - spread them out by 30+ minutes
2. **Batch database queries** - fetch all profiles in one query instead of per-agent
3. **Use batch email sending** - Resend supports up to 100 recipients in one API call
4. **Remove unnecessary delays** - Resend's rate limit is 100/second, not 3/second

---

### Implementation Details

#### A) Reschedule cron jobs to avoid pileup

Current:
- notify-top-performer: 0 0 * * * (6 PM CST)
- notify-fill-numbers-7pm: 0 1 * * * (7 PM CST)
- notify-missed-dialer: 30 1 * * * (7:30 PM CST)

New (spread across 2 hours):
- notify-top-performer: 0 0 * * * (6 PM CST) - keep as is
- notify-fill-numbers-7pm: 0 2 * * * (8 PM CST) - move 1 hour later
- notify-missed-dialer: 0 4 * * * (10 PM CST) - move to end of day

This requires a SQL migration to update the cron.job table.

#### B) Optimize notify-fill-numbers (and similar functions)

**Before (slow):**
```typescript
for (const agent of agentsNeedingReminder) {
  // 1 query per agent
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", agent.user_id)
    .single();
  
  // 1 email per agent
  await resend.emails.send({ ... });
  
  // Artificial delay
  await new Promise(resolve => setTimeout(resolve, 300));
}
```

**After (fast):**
```typescript
// 1 query for ALL profiles
const userIds = agentsNeedingReminder.map(a => a.user_id);
const { data: profiles } = await supabase
  .from("profiles")
  .select("user_id, full_name, email")
  .in("user_id", userIds);

// Build profile map
const profileMap = new Map(profiles.map(p => [p.user_id, p]));

// Send emails in parallel batches of 10
const BATCH_SIZE = 10;
for (let i = 0; i < agentsNeedingReminder.length; i += BATCH_SIZE) {
  const batch = agentsNeedingReminder.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(agent => {
    const profile = profileMap.get(agent.user_id);
    if (!profile?.email) return;
    return resend.emails.send({ ... });
  }));
}
```

This reduces:
- 50 DB queries to 1
- 50 sequential emails to 5 parallel batches
- 15 seconds of delays to 0

#### C) Apply same optimization to all 3 functions

Files to update:
- `supabase/functions/notify-fill-numbers/index.ts`
- `supabase/functions/notify-top-performer/index.ts`
- `supabase/functions/notify-missed-dialer/index.ts`

---

### Database Migration

SQL to reschedule jobs (run via migration tool):

```sql
-- Move notify-fill-numbers-7pm from 7 PM CST (0 1 UTC) to 8 PM CST (0 2 UTC)
UPDATE cron.job 
SET schedule = '0 2 * * *' 
WHERE jobname = 'notify-fill-numbers-7pm';

-- Move notify-missed-dialer from 7:30 PM CST (30 1 UTC) to 10 PM CST (0 4 UTC)
UPDATE cron.job 
SET schedule = '0 4 * * *' 
WHERE jobname = 'notify-missed-dialer-daily';
```

---

### Expected Results

- **Before**: 3 jobs running 90+ seconds total between 6-7:30 PM, causing DB and email API contention
- **After**: Jobs spread across 4 hours (6 PM, 8 PM, 10 PM), each completing in under 5 seconds

---

### Technical Details

| Function | Before (50 agents) | After (50 agents) |
|----------|-------------------|-------------------|
| DB Queries | 50 sequential | 1 batched |
| Emails | 50 sequential | 5 parallel batches |
| Delays | 15 seconds | 0 seconds |
| Total Time | ~30 seconds | ~3 seconds |

### Files to Modify

1. `supabase/functions/notify-fill-numbers/index.ts` - batch optimization
2. `supabase/functions/notify-top-performer/index.ts` - batch optimization  
3. `supabase/functions/notify-missed-dialer/index.ts` - batch optimization
4. SQL Migration - reschedule cron jobs

