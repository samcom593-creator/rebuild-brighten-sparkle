
# Self-Healing Health Monitor System

## Overview

Create a new edge function `system-health-check` that runs on a cron schedule every 15 minutes. It performs end-to-end synthetic tests on all critical flows and emails you immediately when something breaks, with a detailed diagnostic report.

## What It Monitors

### 1. Application Submission Pipeline
- Test that `partial_applications` table accepts anonymous INSERT and UPDATE (the exact RLS issue that just broke)
- Test that `applications` table accepts INSERT with valid data shape
- Test that the `submit-application` edge function responds with 200
- Verify `RESEND_API_KEY` is configured and valid

### 2. Onboarding Course System
- Verify `onboarding_modules` table is readable and has active modules
- Verify `onboarding_questions` table has questions for each module
- Verify `onboarding_progress` table accepts INSERT/UPDATE for authenticated agents

### 3. Edge Function Health
- Ping critical edge functions (`submit-application`, `get-active-managers`, `check-abandoned-applications`, `send-licensing-instructions`) and verify they respond (not 500)

### 4. Database Integrity
- Check that RLS policies on `partial_applications` allow anonymous access (prevents the exact bug you just had)
- Verify `agents`, `applications`, `daily_production` tables are queryable
- Check for orphaned records (agents with no profile, etc.)

### 5. Cron Job Verification
- Verify all expected cron jobs exist and are active in `cron.job`

## How It Works

```text
Every 15 minutes:
  +------------------+
  | system-health-   |
  | check runs       |
  +--------+---------+
           |
    Run all checks
           |
    +------+------+
    | All pass?   |
    +------+------+
    YES    |      NO
    |      |      |
  (silent) |  +---+----------+
           |  | Send ALERT   |
           |  | email with   |
           |  | diagnostics  |
           |  +--------------+
           |
    Log results to
    health_check_log table
```

## Alert Email

When any check fails, you receive an email like:

**Subject**: "SYSTEM ALERT: 2 health checks failed"

**Body**: A diagnostic table showing each check, its status (pass/fail), and the exact error message. Includes a direct "Fix Now" link to the dashboard.

## Cooldown Logic

To avoid email floods, the system only sends an alert email once per hour per failure type. It tracks the last alert timestamp in a `health_check_alerts` table.

## Implementation

### New Database Table: `health_check_log`
- `id` (uuid, PK)
- `check_name` (text) -- e.g. "partial_apps_insert", "submit_app_function"
- `status` (text) -- "pass" or "fail"
- `error_message` (text, nullable)
- `response_time_ms` (integer)
- `created_at` (timestamptz)

RLS: Admin-only read, service-role write (edge function uses service role key).

### New Edge Function: `system-health-check`
Single function that runs all checks sequentially and:
1. Logs every result to `health_check_log`
2. If any check fails and no alert was sent in the last hour, sends a diagnostic email to `info@apex-financial.org`
3. Auto-cleans logs older than 7 days to prevent table bloat

### New Cron Job
Runs `system-health-check` every 15 minutes.

### Checks Performed (in order)

| Check Name | What It Does |
|---|---|
| `partial_apps_rls` | Attempts anonymous INSERT into `partial_applications` with a test session, then deletes it |
| `submit_app_ping` | Sends OPTIONS request to `submit-application` function, expects 200 |
| `get_managers_ping` | Calls `get-active-managers`, expects 200 with managers array |
| `resend_api_key` | Verifies RESEND_API_KEY env var is set and non-empty |
| `modules_exist` | Queries `onboarding_modules` for active modules, expects >= 1 |
| `questions_exist` | Queries `onboarding_questions`, expects >= 1 per module |
| `agents_table` | Queries `agents` table, expects no error |
| `applications_table` | Queries `applications` table, expects no error |
| `cron_jobs_active` | Verifies key cron jobs exist and are active |
| `db_connections` | Simple SELECT 1 to verify DB connectivity |

### Files Created
1. `supabase/functions/system-health-check/index.ts` -- the health check function
2. Database migration -- `health_check_log` table + cron job

### Files Modified
None -- this is purely additive.
