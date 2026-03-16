

# Fix All Email Buttons Across Edge Functions

## Problem
32 edge functions use `background: linear-gradient(...)` on `<a>` tags for email buttons. Gmail, Outlook, and many mobile email clients strip CSS gradients, making buttons invisible or unclickable — just plain text with no background.

The `send-licensing-instructions` function was already fixed using the "bulletproof button" pattern (`<table><tr><td bgcolor="..."><a>...</a></td></tr></table>`). The same fix needs to be applied to all other email-sending functions.

## Fix Pattern
Replace every `<a style="...background: linear-gradient(...)...">` button with:
```text
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr>
    <td align="center" bgcolor="#SOLID_COLOR" style="border-radius:8px;">
      <a href="..." style="display:inline-block;color:#fff;text-decoration:none;padding:14px 28px;font-weight:600;">
        Button Text
      </a>
    </td>
  </tr>
</table>
```
Each gradient is replaced with its primary solid color (e.g., `#059669→#047857` becomes `#059669`).

## Files to Update (applicant-facing are highest priority)

### Applicant-Facing Emails (users report these broken)
1. **send-aged-lead-email** — "REAPPLY NOW" button
2. **send-password-reset** — "Sign In to Portal" and "Reset Password" buttons
3. **send-course-hurry-emails** — "Continue My Training" / "Finish My Course Now"
4. **notify-stage-change** — "Access Your Portal"
5. **notify-agent-contracted** — "Set Up Your CRM Access"
6. **send-daily-checkin-prompt** — "Complete My Check-In"
7. **send-whatsapp-onboarding-blast** — "Join WhatsApp Group" / "Complete Daily Check-In"
8. **send-seminar-invite-blast** — "Register Now" / "Join WhatsApp"
9. **notify-set-goals** — "Set My Goals"

### Internal/Admin Emails
10. **system-health-check** — "Fix Now"
11. **confirm-agent-removal** — header gradient (decorative, not a button)
12. **test-email-flows** — all test buttons
13. **send-push-optin-email** — notification opt-in button
14. + remaining ~18 functions with gradient buttons

### Additional functions to scan and fix
- notify-admin-earnings, send-application-notification, send-course-enrollment-email, send-course-reminder, send-followup-emails, send-manual-followup, send-outreach-email, send-agent-portal-login, welcome-new-agent, notify-hire-announcement, notify-evaluation-result, send-bulk-unlicensed-outreach, send-outstanding-performance, send-plaque-recognition, notify-deal-alert, send-daily-sales-leaderboard, send-weekly-team-summary, send-monthly-motivation

## Approach
- Fix all files in batches, replacing gradient `<a>` buttons with the bulletproof `<table>` pattern
- Use primary color from each gradient as the solid `bgcolor`
- Redeploy all updated edge functions
- Decorative gradient backgrounds on `<div>` containers (not buttons) can stay — those are non-interactive

