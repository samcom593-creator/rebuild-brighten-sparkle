

# Fix: Standardize Admin Email + CC on All Notifications

## Problem

Two systemic issues preventing you from seeing all system activity:

1. **20 edge functions still use `info@apex-financial.org`** — an old/wrong admin email. Emails sent there never reach you.
2. **Many functions send emails without CC'ing you at all** — deal alerts, course notifications, daily summaries, etc. go out and you have no visibility.

## Fix

### 1. Replace all `info@apex-financial.org` → `sam@apex-financial.org`

These 20 functions need the admin email updated:

| Function | Current Admin Email |
|----------|-------------------|
| `submit-application` | `info@` (line 372) |
| `welcome-new-agent` | `info@` |
| `check-abandoned-applications` | `info@` |
| `track-email-click` | `info@` |
| `notify-evaluation-result` | `info@` |
| `send-outreach-email` | `info@` |
| `notify-test-reminder` | `info@` |
| `send-manual-followup` | `info@` |
| `send-aged-lead-email` | `info@` |
| `notify-course-complete` | `info@` |
| `send-course-enrollment-email` | `info@` |
| `send-outstanding-performance` | `info@` |
| `notify-admin-daily-summary` | `info@` |
| `notify-agent-live-field` | `info@` |
| `send-abandoned-followup` | `info@` |
| `send-post-call-followup` | `info@` |
| `notify-test-scheduled` | `info@` |
| `send-bulk-unlicensed-outreach` | `info@` |
| `send-followup-emails` | `info@` |
| `send-course-hurry-emails` | `info@` |

### 2. Add admin CC to functions that currently lack it

Several functions send emails to agents/managers but don't CC the admin. I'll add `cc: ["sam@apex-financial.org"]` (or include admin in recipients) to all outbound notification emails so you have full visibility.

Key functions missing admin CC:
- `notify-deal-alert` (sends via BCC to agents, no admin CC)
- `notify-streak-alert` (BCC only)
- `notify-comeback-alert` (BCC only)
- `notify-daily-summary` (to agent only)
- `notify-stage-change` (to agent only)
- `notify-milestone-congrats` (to agent only)
- `notify-no-deal-today` (to agent only)
- `notify-missed-dialer` (to agent only)
- `notify-monthly-leaderboard` (to agent only)
- `notify-rank-passed` (to agent only)
- `notify-top-performer` (BCC only)
- `notify-top-performers-morning` (to agent only)

### 3. Standardize sender domain

All functions will use `notifications@tx.apex-financial.org` as the verified sender, replacing the mix of `noreply@apex-financial.org`, `info@apex-financial.org`, and other variants.

## Summary

| Change | Count |
|--------|-------|
| Replace `info@` → `sam@` | 20 functions |
| Add admin CC where missing | ~12 functions |
| Standardize sender domain | All functions using `noreply@` |

**Total: ~32 edge function files updated.** No database or frontend changes needed. All changes are simple find-and-replace within existing email send calls.

