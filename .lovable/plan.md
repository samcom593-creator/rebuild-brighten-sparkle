

# WhatsApp Group Integration — Current State and Options

## What exists today
- The `send-unlicensed-process-update` edge function accepts an optional `whatsappLink` parameter
- If provided, it renders a "Join WhatsApp Group" button in the email
- No frontend UI currently passes this parameter
- No WhatsApp Business API integration exists

## What's possible

### Option A: Include WhatsApp invite link in outreach emails (simple)
- Store a WhatsApp group invite URL in a settings/config table or as a secret
- Pass it automatically when sending unlicensed process emails, onboarding emails, etc.
- Recipients click the link to join — no API needed
- **Limitation**: Users must manually click; no auto-add

### Option B: WhatsApp Business API integration (complex)
- Requires a WhatsApp Business account and API access (Meta Business Platform)
- Would need an API key stored as a secret
- Could send templated messages directly to leads' phone numbers
- Cannot auto-add people to groups (WhatsApp API doesn't support this)
- Can send 1:1 messages and use approved message templates

### Recommendation
Option A is practical and can be done immediately — just store your WhatsApp group invite link and include it in the relevant email templates. Option B requires a paid WhatsApp Business API account and Meta approval for message templates.

**Which approach would you like?** Or were you asking about something else — like whether applicants are being directed to join a specific WhatsApp group as part of onboarding?

