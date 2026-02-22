

# Notification Hub + Bulk Blast + Carrier Assignment

Three major deliverables in one build.

---

## 1. Notification Log (Database Table)

Create a `notification_log` table to record every notification sent across all channels:

- `id` (uuid, PK)
- `recipient_user_id` (uuid, nullable -- for agents/managers)
- `recipient_email` (text)
- `recipient_phone` (text, nullable)
- `channel` (text -- 'push', 'sms', 'email')
- `title` (text)
- `message` (text)
- `status` (text -- 'sent', 'failed', 'pending')
- `error_message` (text, nullable)
- `metadata` (jsonb -- extra context like lead name, trigger type)
- `created_at` (timestamptz)

RLS: Admin-only read access. Edge functions write via service role.

---

## 2. Update `send-notification` Edge Function

Modify the unified notification function to log every send attempt to `notification_log` with channel, status, and error details.

---

## 3. Notification Dashboard Page (`/dashboard/notifications`)

A new admin-only page showing:

- **Summary stats** at top: Total sent today, Push count, SMS count, Email count, Failed count
- **Filterable table** of all notifications:
  - Date/time, recipient email, channel (color-coded badge), title, message preview, status
  - Filters: channel type, status, date range
  - Search by recipient email or title
- Auto-refreshes via realtime subscription

---

## 4. Add to Sidebar Navigation

Add a "Notifications" nav item (Bell icon) under the TOOLS section in `GlobalSidebar.tsx`, visible only to admins.

---

## 5. Carrier Assignment Tool

Add a section to the Notification Dashboard (or a tab) where the admin can:

- See all leads/agents with phone numbers but no carrier
- Quick-assign a carrier from a dropdown for each one
- Bulk-assign carriers (select multiple, assign same carrier)

This updates the `carrier` field on `applications` and/or `profiles`.

---

## 6. Bulk Blast Function + UI

Create a new edge function `send-bulk-notification-blast` that:

1. Fetches all active applicants (86) and all aged leads (925)
2. For each applicant: sends licensing instructions email (same template as `send-licensing-instructions`)
3. For each aged lead with email: sends the re-engagement email (same template as `send-aged-lead-email`)
4. For any with carrier set: also sends SMS via `send-sms-via-email`
5. Logs everything to `notification_log`
6. Rate-limits at 1000ms between sends

Add a "Blast All Leads" button on the Notification Dashboard with a confirmation dialog showing counts before sending.

---

## 7. Route + App.tsx

- Add `/dashboard/notifications` route (admin-only, lazy-loaded)
- Add `NotificationHub.tsx` page component

---

## Technical Details

### Files to create:
- `src/pages/NotificationHub.tsx` -- main dashboard page
- Migration SQL for `notification_log` table + realtime

### Files to modify:
- `supabase/functions/send-notification/index.ts` -- add logging to `notification_log`
- `src/components/layout/GlobalSidebar.tsx` -- add nav item
- `src/App.tsx` -- add route
- `supabase/config.toml` -- add `send-bulk-notification-blast` config

### Files to create (edge functions):
- `supabase/functions/send-bulk-notification-blast/index.ts`

### Implementation order:
1. Database migration (notification_log table)
2. Update send-notification to log
3. Create NotificationHub page with stats, table, carrier tool, blast button
4. Create send-bulk-notification-blast edge function
5. Add sidebar nav + route
6. Deploy and test

