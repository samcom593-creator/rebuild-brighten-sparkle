

# Diagnosis: Why Nobody Joined the WhatsApp Group

I found **two concrete problems** after investigating the logs, sent messages, and edge function code:

## Problem 1: SMS messages are truncated — WhatsApp link is cut off
The WhatsApp onboarding blast truncates SMS to 160 characters with `.substring(0, 160)`. The actual SMS sent looks like:

> "Hey Darian! Update your licensing progress: https://rebuild-brighten-sparkle.lovable.app/checkin?id=cf43d44c-... | Join our WhatsApp gro"

The WhatsApp link is **completely cut off** — recipients see "Join our WhatsApp gro" with no clickable link. SMS was 98+ of the sent messages, and every single one had the link chopped.

## Problem 2: Seminar invite emails use wrong sender domain
The seminar blast sends from `notifications@apex-financial.org` while the WhatsApp blast sends from `notifications@tx.apex-financial.org`. If the first domain isn't verified with Resend, those emails may be silently dropped or sent to spam. The notification_log says "sent" because Resend accepted the API call, but that doesn't mean delivery.

## Problem 3: SMS for seminar invites also truncated
The seminar SMS messages also get cut off at the registration URL — recipients see "Register here: https://rebuild-brig" with no complete link.

## Fix Plan

### 1) Fix WhatsApp blast SMS — send WhatsApp link as its own short message
Instead of cramming everything into 160 chars, send the WhatsApp link as a **standalone SMS** (or at minimum, put it first before the check-in URL so it doesn't get cut):
> "Hey {name}! Join our APEX WhatsApp group for daily updates & support: {whatsappLink}"

### 2) Fix seminar blast SMS — shorter message with just the link
> "Hey {name}! Free Career Seminar Thursday 7PM CST. Register: {shortUrl}"

### 3) Standardize email sender domain
Use `notifications@tx.apex-financial.org` consistently (the verified domain) across both functions.

### 4) Re-send the WhatsApp blast with fixed messages
After fixing, trigger a new blast so everyone gets a working, clickable WhatsApp link.

### 5) Add WhatsApp link to the seminar invite email too
Since the goal is to get people into the group, include the WhatsApp CTA in the seminar invite email as well.

## Technical changes
- **Edit** `supabase/functions/send-whatsapp-onboarding-blast/index.ts` — remove `.substring(0, 160)`, restructure SMS to prioritize the WhatsApp link
- **Edit** `supabase/functions/send-seminar-invite-blast/index.ts` — fix sender domain, shorten SMS, add WhatsApp CTA
- **Deploy and re-trigger** both functions

