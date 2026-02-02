

## Outstanding Performance Certificate Update

### Part 1: Remove Duplicate "Standard of Excellence"

**Current Signature Block (lines 101-112):**
```html
<p style="cursive...">${ownerName}</p>           <!-- Signature -->
<div style="line..."></div>                       <!-- Underline -->
<p style="...">
  ${ownerName}<br>                                <!-- REMOVE THIS -->
  Chief Executive Officer<br>
  APEX Financial Group
</p>
```

**Updated Signature Block:**
```html
<p style="cursive...">${ownerName}</p>           <!-- Signature only -->
<div style="line..."></div>                       <!-- Underline -->
<p style="...">
  Chief Executive Officer<br>                     <!-- Title only -->
  APEX Financial Group
</p>
```

---

### Part 2: Send Outstanding Performance Emails

**Logic:**
1. Query `daily_production` for last month (January 2026)
2. Aggregate AOP by agent
3. For agents with **$10K+ last month** → send email with monthly total and end date of January 31
4. For agents with **under $10K last month** → query last 2 weeks production and send email with that total

**Date Ranges:**
- Last month: January 1-31, 2026
- Last 2 weeks: January 19 - February 1, 2026

---

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/send-outstanding-performance/index.ts` | Remove duplicate `${ownerName}` from title block |

### After Template Fix

I'll execute the email sends by:
1. Querying production data for all agents
2. Calculating totals for each period
3. Calling `send-outstanding-performance` for each qualifying agent

