

# Fix Leaderboards, Import Full Book of Business, and Production Fixes

## Investigation Summary

### Current State of Data
- **Samuel James** (admin) has production for 2/25 ($5,200 AOP) and 2/26 ($5,200 AOP) -- these ARE in the database
- **Several agents** already have some deals imported for 2/25 (Chukwudi, KJ Vaughns, Aisha, Moody, Brennan, Michael Kayembe)
- **The full book of business** provided contains ~250+ deals spanning from Nov 2025 through Feb 2026 that need importing

### Why Leaderboard May Not Show Numbers
The CompactLeaderboard filters agents with `.eq("is_inactive", false)`. Several producing agents are marked `is_inactive: true` (Bryan Ross, Codey Salazar, Leslie Patino Galeana, etc.), which hides their production from the leaderboard entirely. The leaderboard should show all agents who have production regardless of inactive status.

### Agent Mapping for Import
Agents found in the system:
- Samuel James, Moody Imran, Aisha Kebbeh, Brennan Barker, Chukwudi Ifediora, Obiajulu Ifediora, Michael Kayembe, Landon Boyd, Bryan Ross, Jacob Causer, Leslie Patino Galeana, Samuel Lugo Puga
- "Kaeden Vaughns" maps to **KJ Vaughns** in the system
- Codey Salazar (deactivated but can still log numbers)
- Joseph Sebasco (deactivated but can still log numbers)

**Agents NOT in the system** (deals will be skipped per user instruction -- do not create agents):
- Parrish Lyon, Josiah Darden, Alex Wordu, Noah Ellison, Joseph Intwan, Richard Hall

---

## Changes

### 1. Fix CompactLeaderboard -- Remove `is_inactive` Filter

**File: `src/components/dashboard/CompactLeaderboard.tsx`**

Remove `.eq("is_inactive", false)` from the agent query (line 278). Agents with production should appear on the leaderboard regardless of inactive status. Keep the `is_deactivated: false` filter.

### 2. Fix ProductionForecast -- Rename "AOP" Label and Make Admin-Only

**File: `src/components/dashboard/ProductionForecast.tsx`**
- Change "30-Day AOP Forecast" to "30-Day AOP Forecast" (it already says AOP -- user said it says ALP, will verify and fix)

**File: `src/pages/AgentPortal.tsx`**
- Wrap the `<ProductionForecast>` section in an `isAdmin` check so only admins see it

### 3. Import Full Book of Business via Edge Function

**Using: `supabase/functions/import-production-data`**

Parse all ~250 deals from the provided data into structured `{ agent_name, annual_alp, posted_date }` records. Call the edge function which:
- Matches agent names to existing agents (case-insensitive)
- Aggregates deals by agent + date
- Uses SET logic (not additive) to prevent duplicates
- Skips agents not found in the system
- Reports which agents were missing

The import will be done via direct edge function invocation with the parsed data.

### 4. Verify Numbers Submission Works

The edge function `log-production` submit action already maps columns explicitly. The `passed_price` and `booked_inhome_referrals` columns DO exist in the `daily_production` table (confirmed from schema), so this is not the issue. The submission should work. Will verify by testing the edge function directly after deployment.

---

## Technical Details

### Files to Modify
| File | Change |
|------|--------|
| `src/components/dashboard/CompactLeaderboard.tsx` | Remove `.eq("is_inactive", false)` filter |
| `src/pages/AgentPortal.tsx` | Wrap ProductionForecast in `isAdmin` check |
| `src/components/dashboard/ProductionForecast.tsx` | Fix label if it says "ALP" |

### Data Import
- ~250 deals parsed from the provided book of business
- Imported via `import-production-data` edge function
- Agents not in system will be reported as missing (Parrish Lyon, Josiah Darden, Alex Wordu, Noah Ellison, Joseph Intwan, Richard Hall)
- No new agents will be created
- SET logic prevents duplicates

### No Database Schema Changes Required

