

# Dashboard Accuracy, Empty States, and Data Readiness

## What I Found

### 1. Agency Roster: 8 Licensed Agents IS Accurate (Per Database)
The database currently has exactly **8 licensed** and **7 unlicensed** active agents. If some agents should be licensed but aren't, I need to update their `license_status` in the database. Here are the 7 currently marked as unlicensed:

| Agent | Current Status |
|-------|---------------|
| Aisha Kebbeh (duplicate) | unlicensed / terminated |
| Ashton McPhaul | unlicensed |
| Brennan Barker | unlicensed |
| Deondric Williams | unlicensed |
| Jacob Causer | unlicensed |
| Michael Kayembe | unlicensed |
| Mitchell Urewuji | unlicensed |

**Action needed from you**: Let me know which of these should actually be "licensed" and I'll update the database immediately.

Also found: **duplicate "Samuel James"** records (one lowercase "samuel james", one proper case). These should likely be merged.

### 2. Dashboard Empty Spaces (Closing Rate + Referral Leaderboards)
When leaderboards have no qualifying data, they show a blank card with tiny "Min. 3 presentations required" text, creating dead white space. This week only 2 agents qualify for closing rate and 3 for referrals.

**Fix**: When a leaderboard has no entries, render a compact "No activity yet this week" message with reduced card height instead of a full-size empty card. This eliminates wasted vertical space.

### 3. Production Number Entry for Missing Data
You mentioned agents forgot to log numbers last week. Once you provide those numbers, I can import them via the existing `import-production-data` backend function. Just share the data in this format:
- Agent name, ALP amount, date

### 4. General Performance / Loading
Some queries in the dashboard run 5+ sequential database calls. I'll add query caching with longer stale times so navigation between sidebar sections doesn't trigger full reloads.

---

## Code Changes

### `src/components/dashboard/ClosingRateLeaderboard.tsx`
- Reduce empty state card height (change `py-4` to `py-2`)
- Show friendlier message: "No qualifying data yet" with a subtle icon

### `src/components/dashboard/ReferralLeaderboard.tsx`
- Same compact empty state treatment
- Ensure consistent height with the closing rate card so they align in the 2-column grid

### `src/pages/Dashboard.tsx`
- No structural changes needed -- layout already aligns the two leaderboards in `grid-cols-2`

### Database Updates (Data Fixes)
- Pending your confirmation on which agents should be marked "licensed"
- Ready to merge the duplicate Samuel James records once confirmed
- Ready to import production numbers once you provide them

---

## Summary

| Item | Status |
|------|--------|
| Empty space on dashboard (leaderboards) | Code fix: compact empty states |
| 8 licensed agents count | Accurate per DB -- need your input on who to relicense |
| Duplicate Samuel James | Ready to merge on confirmation |
| Production number import | Ready once you share the data |
| Dashboard loading speed | Cache optimization for sidebar nav |

