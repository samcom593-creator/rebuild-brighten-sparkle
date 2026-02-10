
# CC Manager + Admin on All Agent Emails + Fix Welcome Email

## Problem
Most outgoing emails to agents only go to the agent -- the manager and admin have no visibility. The welcome email also lacks a portal link and Discord link.

## Changes

### 1. Fix `welcome-new-agent` to include portal link, Discord, and CC manager + admin
**File: `supabase/functions/welcome-new-agent/index.ts`**
- Add `cc` field to the Resend call with `sam@apex-financial.org` (admin) and the manager's email
- Look up the manager's email using the `managerId` parameter (already accepted but not used for CC)
- Add a portal link section: `https://apex-financial.org/agent-portal`
- Add a Discord section: `https://discord.gg/GygkGEhb`
- Remove the contracting/licensing link section (per user request -- no contract link, just portal)

### 2. Fix `add-agent` to pass `managerId` to welcome email
**File: `supabase/functions/add-agent/index.ts`**
- Pass `managerId` in the body when invoking `welcome-new-agent` so the function can look up the manager's email for CC

### 3. Add CC to `send-agent-portal-login`
**File: `supabase/functions/send-agent-portal-login/index.ts`**
- Look up the agent's manager (`invited_by_manager_id`) and their email
- Add `cc: [adminEmail, managerEmail]` to the Resend call

### 4. Add CC to `send-licensing-instructions`
**File: `supabase/functions/send-licensing-instructions/index.ts`**
- Accept optional `managerId` or `managerEmail` parameter
- Add `cc: [adminEmail, managerEmail]` to the Resend call
- Update the frontend caller (`ResendLicensingButton.tsx`) to pass the manager info

### 5. Add CC to `send-course-reminder`
**File: `supabase/functions/send-course-reminder/index.ts`**
- Look up the agent's manager email via `invited_by_manager_id`
- Add `cc: [adminEmail, managerEmail]` to the Resend call

### 6. Add CC to `notify-agent-contracted`
**File: `supabase/functions/notify-agent-contracted/index.ts`**
- Already fetches manager info but only sends to the applicant
- Add `cc: [adminEmail, managerEmail]` to the Resend call

### 7. Add CC to `notify-agent-login`
**File: `supabase/functions/notify-agent-login/index.ts`**
- This is a login notification -- add CC so admin/manager know when agents log in
- Accept optional `managerId` parameter, look up manager email
- Add `cc` to the Resend call

## Summary of CC pattern applied everywhere

| Function | Sends to | CC Added |
|----------|----------|----------|
| `welcome-new-agent` | Agent | Admin + Manager |
| `send-agent-portal-login` | Agent | Admin + Manager |
| `send-licensing-instructions` | Agent | Admin + Manager |
| `send-course-reminder` | Agent | Admin + Manager |
| `notify-agent-contracted` | Agent | Admin + Manager |
| `notify-agent-login` | Agent | Admin + Manager |
| `notify-course-complete` | Already done | No change |
| `notify-course-started` | Already done | No change |
| `notify-agent-live-field` | Already done | No change |

## Technical Details

- Admin email constant: `sam@apex-financial.org`
- Manager email: resolved via `invited_by_manager_id` -> `agents.profile_id` -> `profiles.email`
- CC uses the Resend `cc` field (array of emails), filtering out duplicates
- Portal link: `https://apex-financial.org/agent-portal`
- Discord link: `https://discord.gg/GygkGEhb`
- The welcome email will be restructured to: (1) Portal link, (2) Discord link, (3) Coursework link, (4) Production standard -- removing the contracting/licensing step since there "shouldn't be a contract link"
- Frontend change in `ResendLicensingButton.tsx`: pass `managerEmail` if available from the call center context
