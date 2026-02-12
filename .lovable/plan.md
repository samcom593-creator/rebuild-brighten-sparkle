

# Fix Course, Stop Auto-Reload, Ensure Emails Work

## Current Situation

14 agents are enrolled in the course. 3 have completed it. 7 are stuck at 0% video progress -- they may have logged in but video tracking isn't registering. 1 agent (Johnivan Bush) still has a duplicate record with a different email.

---

## 1. Kill the Auto-Reload (Highest Priority)

The PWA service worker in `main.tsx` reloads the page every time you switch back to the tab (if an update was detected). When you have multiple tabs open, this creates a reload loop because each tab triggers an update, and switching to any tab causes a reload.

**Fix:** Remove the `visibilitychange` reload entirely. Instead, only flag that an update is available and let the user continue working. The update will apply naturally on the next full page load (closing and reopening the browser). This completely eliminates the mid-session reload problem.

**File:** `src/main.tsx` -- Remove the `visibilitychange` event listener block entirely. Keep the `updatefound` listener to log that an update is available but never call `window.location.reload()`.

---

## 2. Fix Video Progress Tracking

7 agents have progress records with 0% video watched. The YouTube IFrame API may not be loading or firing events on mobile/restricted browsers. Two fixes:

**Fix A -- Lower the fallback timer from 2 minutes to 30 seconds:** The "Mark as Watched" fallback button in `CourseVideoPlayer.tsx` currently shows after 2 minutes. Agents on mobile with restricted autoplay may never get the YouTube API to fire. Show the fallback button after 30 seconds instead.

**Fix B -- Auto-create progress on page load, not just on video play:** Currently, progress is only created when `updateVideoProgress` is called (which requires the YouTube API to fire). Change `OnboardingCourse.tsx` to automatically create a progress record (0%) when the agent views a module, ensuring the "time-based safety net" in `canTakeQuiz` works (it checks `started_at` elapsed time).

**Files:**
- `src/components/course/CourseVideoPlayer.tsx` -- Change fallback timer from 120000ms to 30000ms
- `src/pages/OnboardingCourse.tsx` -- Auto-initialize progress when viewing a module

---

## 3. Clean Up Duplicate Agent Record

Johnivan Bush has two agent records:
- `974f7934` with email `jbbush3736@gmail.com`
- `c32f0e05` with email `jzbush3736@gmail.com`

These are different emails so they may be intentional (typo in one). Delete the older duplicate that has no progress.

**Action:** Database cleanup -- delete the older record and its associated progress (if any).

---

## 4. Verify Email CC Chain

The welcome email and course enrollment email both already CC the admin and the agent's manager. The manager lookup works correctly via `profile_id`. No code changes needed here -- just confirming the chain is intact.

The `add-agent` function already:
1. Creates the agent account
2. Fetches the manager's contracting link
3. Sends the welcome email with contracting link, portal link, Discord link, and coursework link
4. CCs admin + manager

The `AddToCourseButton` already:
1. Sets `has_training_course = true` and stage to `training_online`
2. Creates initial progress record
3. Sends the course enrollment email with magic link
4. CCs admin + manager

---

## 5. Re-send Course Emails to Stuck Agents

After the fixes are deployed, trigger a fresh course enrollment email to all 7 stuck agents so they get a new magic link and clear instructions.

---

## Technical Summary

| File | Change |
|------|--------|
| `src/main.tsx` | Remove `visibilitychange` reload listener entirely |
| `src/components/course/CourseVideoPlayer.tsx` | Reduce fallback timer from 120s to 30s |
| `src/pages/OnboardingCourse.tsx` | Auto-initialize progress record when viewing any module |
| Database | Delete duplicate Johnivan Bush record |

