
# Fix Course Notification Emails to Managers

## Current State
- **notify-course-complete**: Already sends emails to both admin and manager on course completion. However, it looks up agent profiles using `profile_id`, which 5 out of 20 agents don't have -- causing those agents' names/emails to silently fail. Should also use `user_id` as a fallback.
- **notify-course-started**: Only notifies the admin (sam@apex-financial.org). Does NOT notify the agent's manager at all.
- **notify-module-progress**: Already notifies managers per-module (working correctly via `user_id` lookup).

## Changes

### 1. Fix `notify-course-complete` profile lookup
Add a `user_id` fallback when `profile_id` is missing so that all agents' names and emails are correctly resolved. Currently 5 agents have no `profile_id` set, which means the function can't find their profile and defaults to "Agent" with no email.

### 2. Update `notify-course-started` to also notify the manager
Currently this function only emails the admin. Add a manager lookup (same pattern as `notify-course-complete`) and include the manager in the recipients list so they know when their agent starts the course.

---

## Technical Details

### File: `supabase/functions/notify-course-complete/index.ts`
- After the `profile_id` lookup (lines 45-55), add a fallback: if no profile found via `profile_id`, try looking up by `user_id`
- This ensures all 20 agents get properly identified

### File: `supabase/functions/notify-course-started/index.ts`
- After fetching the agent, also fetch `invited_by_manager_id`
- Look up the manager's profile email (same pattern used in `notify-course-complete`)
- Add the manager to the email recipients list alongside the admin
- No changes to the email template needed -- just add the manager as a recipient
