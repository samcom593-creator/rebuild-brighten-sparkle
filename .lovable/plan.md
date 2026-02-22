

# PWA Push Notifications + Email-to-SMS Gateway

Two notification channels that work today with zero third-party SMS signup.

---

## Part A: Email-to-SMS Gateway (using Resend you already have)

Every US carrier has a free email-to-SMS gateway. Send an email to `{10-digit-number}@gateway` and it arrives as a text message.

**Carrier map** (covers ~95% of US phones):

| Carrier | Gateway |
|---------|---------|
| AT&T | txt.att.net |
| Verizon | vtext.com |
| T-Mobile | tmomail.net |
| Sprint (T-Mobile) | messaging.sprintpcs.com |
| US Cellular | email.uscc.net |
| Cricket | sms.cricketwireless.net |
| Metro | mymetropcs.com |
| Boost | sms.myboostmobile.com |

**Limitation**: You need to know the carrier. We solve this by adding a `carrier` dropdown to the application form and profile settings. When we know the carrier, we construct the gateway address and send via Resend.

### New edge function: `send-sms-via-email`
- Accepts `{ phone, carrier, message }` (or `{ agentId, message }` to auto-resolve)
- Looks up the carrier gateway address
- Sends a plain-text email via Resend to `{phone}@{gateway}`
- Returns success/failure

### Database changes
- Add `carrier` column (text, nullable) to `applications` table
- Add `carrier` column (text, nullable) to `profiles` table

### UI changes
- Add carrier dropdown to the Apply form (Step 1 where phone is collected)
- Add carrier dropdown to ProfileSettings
- Optional: add carrier dropdown to AddAgentModal

---

## Part B: PWA Push Notifications (Web Push API)

Works on Android, Windows, Mac. iOS 16.4+ supports it for installed PWAs.

### How it works
1. Generate VAPID keys (public + private key pair) -- stored as backend secrets
2. Frontend asks user for notification permission and subscribes via `pushManager.subscribe()`
3. Frontend sends the subscription object (endpoint + keys) to the database
4. Backend edge function uses the `web-push` library to send push notifications to all stored subscriptions

### New database table: `push_subscriptions`
- `id` (uuid, PK)
- `user_id` (uuid, references profiles.user_id)
- `endpoint` (text, not null)
- `p256dh` (text, not null)
- `auth` (text, not null)
- `created_at` (timestamptz)
- RLS: users can INSERT/SELECT/DELETE their own subscriptions

### New secrets needed
- `VAPID_PUBLIC_KEY` -- I will generate this for you (also exposed to frontend via an edge function)
- `VAPID_PRIVATE_KEY` -- I will generate this for you

### New edge function: `get-vapid-public-key`
- Returns the public VAPID key so the frontend can subscribe

### New edge function: `send-push-notification`
- Accepts `{ userId, title, body, url }` (or `{ userIds: [...] }` for bulk)
- Fetches all push subscriptions for the user(s)
- Sends web push via the `web-push` npm package
- Cleans up expired/invalid subscriptions automatically

### Frontend changes
- New hook: `usePushNotifications` -- handles permission request, subscription, and saving to DB
- Add "Enable Notifications" button/prompt to Agent Portal and Settings page
- Service worker already exists (via vite-plugin-pwa) -- add a `push` event listener in a custom service worker snippet

### Integration with existing notifications
- After building both channels, add a helper `sendNotification(userId, message, title)` that:
  1. Sends a push notification (if subscription exists)
  2. Sends an email-to-SMS (if carrier is known)
  3. Falls back to email only (existing behavior)
- Wire this into key flows: deal alerts, streak alerts, milestone congrats, etc.

---

## Implementation Order

1. Database migration: add `carrier` column to `applications` and `profiles`, create `push_subscriptions` table
2. Create `send-sms-via-email` edge function
3. Add carrier dropdown to Apply form and ProfileSettings
4. Generate VAPID keys and store as secrets
5. Create `get-vapid-public-key` and `send-push-notification` edge functions
6. Add push event listener to service worker
7. Create `usePushNotifications` hook and UI prompt
8. Create unified `sendNotification` helper and wire into existing notification flows
