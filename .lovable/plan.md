

# Plan: Ensure All Applicant/Agent Emails CC the Manager

## Audit Summary

I reviewed all edge functions that send emails. Most already CC the manager correctly. Here are the ones that **don't**:

### Functions Missing Manager CC

| Function | Issue |
|----------|-------|
| `send-application-notification` | Applicant confirmation email (line 229) goes to applicant with NO CC at all — no admin, no manager |
| `notify-agent-live-field` | Email to agent (line 156) has no CC — admin/manager get a separate email but aren't CC'd on the agent's email |
| `notify-course-complete` | Congratulations email to agent (line 264) has no CC — admin/manager get separate email but aren't CC'd |
| `send-abandoned-followup` | CC's admin only (line 92), no manager CC (partial applications don't have assigned agents, so this is expected — but if an application match exists, we should try) |

### Functions Already Correct (no changes needed)
- `send-post-call-followup` — already resolves manager email and CCs
- `send-followup-emails` — already resolves manager email and CCs all 3 email types
- `send-licensing-instructions` — already CCs manager via `managerEmail` param
- `notify-agent-contracted` — already CCs manager
- `welcome-new-agent` — already CCs manager
- `send-aged-lead-email` — already CCs manager
- `schedule-interview` — already CCs manager
- `send-course-enrollment-email` — already CCs manager
- `send-agent-portal-login` — already CCs manager
- `send-course-reminder` — already CCs manager
- `send-manual-followup` — already CCs manager
- `send-outreach-email` — already CCs manager
- `send-bulk-portal-logins` — already CCs manager
- `notify-notes-added` — sends TO manager (correct)
- `notify-attendance-missing` — sends separate emails to agent and manager (correct)
- `notify-training-reminder` — CCs admin (agents in training, appropriate)

## Changes

### 1. `send-application-notification/index.ts`
- The applicant confirmation email (line 229) currently sends with no CC
- This is a new application so there's no assigned agent/manager yet — but the admin should be CC'd
- Add `cc: ["sam@apex-financial.org"]` to the applicant confirmation email

### 2. `notify-agent-live-field/index.ts`  
- The agent email (line 156) sends without CC
- Add `cc` with admin + manager email (already resolved at line 61-76)
- Build ccList from adminEmail + managerEmail, add to the agent email send

### 3. `notify-course-complete/index.ts`
- The agent congratulations email (line 264) sends without CC
- Add `cc` with adminRecipients (admin + manager, already resolved)
- This ensures the manager sees the same congratulations the agent gets

### 4. `send-abandoned-followup/index.ts`
- Currently only CCs admin — this is acceptable since partial applications have no assigned agent/manager
- No change needed here (abandoned leads are pre-application)

## Files to Edit
1. `supabase/functions/send-application-notification/index.ts` — add admin CC to applicant confirmation
2. `supabase/functions/notify-agent-live-field/index.ts` — add admin+manager CC to agent email  
3. `supabase/functions/notify-course-complete/index.ts` — add admin+manager CC to agent congratulations email

