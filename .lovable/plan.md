

# Import Production Data + Schedule Daily 10:30 PM Summary Email

## Part 1: Import These Deals (No Overlap)

The user pasted 11 deals all posted on **2026-03-12**. I'll use the existing `import-production-data` edge function which already handles deduplication via SET (upsert) logic — if an agent already logged numbers for that date, the import overwrites with the carrier data (which is the source of truth per the existing import integrity memory).

However, to truly prevent overlap (don't touch agents who already logged), I need to **modify the import function** to support a `skip_existing` mode that leaves existing records untouched and only imports for agent-date combos that have no entry yet.

**Deals to import** (all posted_date: `2026-03-12`):

| Agent | Annual ALP |
|-------|-----------|
| Samuel James | $2,781.48 |
| Mahmod Imran | $696.00 + $2,016.00 = $2,712.00 (2 deals) |
| Michael Kayembe | $908.76 + $1,492.44 = $2,401.20 (2 deals) |
| Chukwudi Ifediora | $1,452.00 + $973.20 = $2,425.20 (2 deals) |
| Obiajulu Ifediora | $890.16 |
| Kaeden Vaughns | $900.60 |
| Brennan Barker | $716.52 + $990.72 = $1,707.24 (2 deals) |

### Changes to `import-production-data` edge function:
- Add `skip_existing: true` parameter support
- When `skip_existing` is true: if an agent already has a production record for that date, skip them entirely (no overwrite)
- This ensures agents who manually logged their numbers aren't affected

### Invoke the import:
After updating the function, invoke it with the 11 deals and `skip_existing: true`.

## Part 2: Schedule Daily 10:30 PM CST Production Summary Email

The `notify-admin-daily-summary` edge function already exists and sends a comprehensive daily production summary to the admin + all managers. It just needs a cron job to fire at **10:30 PM CST** daily.

### Create cron job (via insert tool, not migration):
```sql
SELECT cron.schedule(
  'daily-production-summary-1030pm',
  '30 4 * * *',  -- 10:30 PM CST = 4:30 AM UTC
  $$
  SELECT net.http_post(
    url:='https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/notify-admin-daily-summary',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;
  $$
);
```

## Files to Edit
1. **`supabase/functions/import-production-data/index.ts`** — add `skip_existing` mode
2. **Invoke import** with the 11 deals via the edge function
3. **Insert cron schedule** for 10:30 PM CST daily summary

