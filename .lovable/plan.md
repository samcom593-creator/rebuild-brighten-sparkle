

# Add Admin CC to All Remaining Edge Functions

## Problem
Several edge functions send emails without CC'ing `sam@apex-financial.org`. The universal CC policy requires the admin to be CC'd on every outbound email.

## Functions Missing Admin CC (need fix)

| Function | Issue |
|---|---|
| `send-monthly-motivation` | No CC at all |
| `create-agent-from-leaderboard` | No CC on portal access email |
| `send-whatsapp-onboarding-blast` | No CC on WhatsApp onboarding emails |
| `send-unlicensed-process-update` | No CC on licensing update emails |
| `check-stale-onboarding` | No CC on stale course emails (agent or manager) |
| `notify-manager-referral` | No CC on referral notification to manager |
| `send-daily-sales-leaderboard` | No CC (bulk leaderboard — admin already a recipient, but no CC field) |
| `notify-evaluation-result` | Sends separate admin email but no CC on agent/manager emails |

## Functions Already Correct (no changes needed)
`notify-missed-dialer`, `notify-training-reminder`, `send-daily-checkin-prompt`, `send-licensing-instructions`, `send-post-call-followup`, `send-followup-emails`, `notify-manager-downline-production`, `notify-milestone-congrats`, `send-course-enrollment-email`, `send-aged-lead-email`, `welcome-new-agent`, `notify-notes-added`, `send-bulk-portal-logins`, `send-bulk-unlicensed-outreach`, `notify-agent-contracted`, `notify-attendance-missing`, `send-abandoned-followup`, `send-outreach-email`, `send-manual-followup`, `schedule-interview`, `notify-top-performers-morning`, `notify-rank-passed`

## Plan
Add `cc: ["sam@apex-financial.org"]` to each `resend.emails.send` call in the 8 functions listed above. For functions using `fetch("https://api.resend.com/emails")`, add `cc` to the JSON body. For `notify-evaluation-result`, add CC to the agent and manager emails (admin email already sent separately). For `send-daily-sales-leaderboard`, admin is already a recipient so no change needed.

**7 edge function files to edit, ~1 line change each.**

