

# Fix CRM License Revert Bug + Attendance Reminders + Numbers Input + Data Import

## Summary
Multiple issues to address: (1) license status reverting in CRM, (2) attendance reminder emails, (3) numbers input bug, (4) search bar fix, (5) SMS alongside all emails, (6) new production data import.

---

## 1. CRM License Status Revert Bug (Critical)

**Root cause**: When a manager marks someone as "licensed" via the `LicenseProgressSelector`, it only updates the `applications` table (`license_status`). But the CRM reads `agentLicenseStatus` from the `agents` table (`agent.license_status` on line 741). So on refetch, the old unlicensed value comes back from the agents table.

**Fix** — `src/components/dashboard/LicenseProgressSelector.tsx`:
- After updating the `applications` table with `license_status = "licensed"`, also update the corresponding `agents` table record (find agent by matching email) to set `license_status = 'licensed'`.
- Use a lookup: query `agents` joined with `profiles` by the application's email, then update the agent's `license_status`.

**Also fix** — `src/pages/DashboardCRM.tsx`:
- After `onProgressUpdated` is called, invalidate the CRM query cache so the UI refetches immediately.

---

## 2. Daily Attendance Reminder Emails

**New edge function**: `supabase/functions/notify-attendance-reminder/index.ts`
- At **9:00 AM CST** — send email to Obiajulu Ifediora (look up by name in agents/profiles) reminding him to mark training room attendance
- At **9:30 AM CST** — send email to Sam (sam@apex-financial.org) reminding him to mark agency meeting attendance
- Clean, simple email with a direct link to the CRM page where attendance is marked

**Schedule**: Two pg_cron jobs (9:00 AM and 9:30 AM CST = 15:00 and 15:30 UTC)

---

## 3. Optimize Attendance Marking

**Current UX problem**: The attendance grid is embedded deep inside each agent's expanded CRM row — you have to expand each agent individually and click tiny 5px buttons.

**Fix** — Add a "Quick Attendance" bulk mode at the top of the CRM page:
- A new component `QuickAttendancePanel` that shows all agents in a simple checklist format
- Two columns: "Training" and "Meeting"
- One-tap toggle per agent per type (present/absent)
- Batch save all at once
- Accessible from CRM header as a toggle button

---

## 4. Fix Numbers Input Bug

**Likely cause**: The `daily_production` upsert requires a unique constraint on `(agent_id, production_date)`. If the agent's record doesn't exist yet or RLS blocks the insert, the fallback edge function is used. If both fail silently, the user sees no error but numbers aren't saved.

**Fix** — `src/components/dashboard/CompactProductionEntry.tsx`:
- Add explicit error toast when both direct upsert AND edge function fallback fail
- Ensure the `BubbleStatInput` component properly handles mobile keyboard input (the `pattern` attribute on inputs can interfere on some devices)
- Add better error handling and user feedback

**Also check**: The `BubbleStatInput` uses `type="number"` which can cause issues on some mobile browsers. Ensure `inputMode="numeric"` is set and the input allows proper entry.

---

## 5. Search Bar Fix

**Current implementation**: The sidebar search calls `log-production` edge function with `action: "search"`, which joins agents with profiles via `agents_profile_id_fkey`. If agents don't have a `profile_id` set (only `user_id`), the join returns null and the search finds nothing.

**Fix** — `supabase/functions/log-production/index.ts`:
- Update the search query to also try joining via `user_id` to `profiles.user_id` as a fallback
- Or query agents and profiles separately, then match by `user_id`

---

## 6. SMS with Every Email

**Approach**: This is a large cross-cutting change. Rather than modifying all 86+ edge functions, create a wrapper approach:
- Add a `send-sms-auto-detect` call alongside key notification emails (attendance reminders, course enrollment, etc.)
- For the new attendance reminder, include SMS delivery automatically
- Document the pattern for future functions

---

## 7. Import New Production Data (03/24 updates)

New deals for 03/24:
| Agent | ALP | Deals |
|-------|-----|-------|
| Aisha Kebbeh | $2,035.08 | 2 |
| Kaeden Vaughns | $1,135.20 | 1 |
| Chukwudi Ifediora | $1,391.76 | 1 |
| Jacob Causer | $2,616.00 | 2 |
| Obiajulu Ifediora | $2,075.16 | 1 |
| Mahmod Imran | $2,016.00 | 1 |

Single call to `import-production-data` with all deals using `skip_existing: false`.

---

## Files Modified
- `src/components/dashboard/LicenseProgressSelector.tsx` — Sync agent table on license change
- `src/pages/DashboardCRM.tsx` — Add quick attendance panel, better cache invalidation
- `supabase/functions/notify-attendance-reminder/index.ts` — **New** daily reminder
- `supabase/functions/log-production/index.ts` — Fix search join
- `src/components/dashboard/CompactProductionEntry.tsx` — Better error handling
- `src/components/dashboard/BubbleStatInput.tsx` — Mobile input fix
- pg_cron jobs for attendance reminders
- Data import via edge function invocation

