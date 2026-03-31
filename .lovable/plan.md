

# CRM Improvements: Sort, Simplify, Split Tabs, Better Notes & Manager Display

## Changes

### 1. Live tab — sort by Week ALP (descending)
Already sorted by `weeklyALP` descending (line 681). Confirmed working. No change needed.

### 2. Remove "Contact" column from Onboarding, In-Field Training, and Live tabs
Currently all 4 tabs show a "Contact" column with last-contacted-at timestamps. Remove it from **Onboarding**, **In-Field Training**, and **Live** — keep it only in **Needs Follow-Up**.

**Files**: `DashboardCRM.tsx` — `getTableHeaders()` and `getTableCells()` functions

### 3. Split "Onboarding" into two separate tabs: "Onboarding" and "Pre-Licensed"
- **Onboarding** = agents in `onboarding`/`training_online` stage who were hired **this week** (created/start date within current week)
- **Pre-Licensed** = all other unlicensed agents in the licensing pipeline (replaces the bottom Unlicensed Pipeline section — move it into its own tab so it's not buried at the bottom)

Update `SECTIONS` array to add a new "Pre-Licensed" section. The Pre-Licensed tab will show the 5-column pipeline view (Course Not Purchased → Waiting on License) as a full-height scrollable layout inside the tab.

### 4. Make note-taking much easier — game-like quick input
Replace the tiny popover `InlineNotesButton` with a more prominent, always-visible quick-note input:
- Expand the notes button to show a small inline text input that appears on hover/click right in the table row
- Single-line input with Enter-to-submit, auto-clear after submit
- Show a green flash/checkmark animation on successful note save (gamification feel)
- Show latest note snippet (truncated) next to the notes icon so managers see activity at a glance

### 5. Make manager name bigger and more readable
Currently the manager name is a tiny `text-[8px]` badge. Change to:
- `text-[10px]` minimum with `font-medium`
- Show full first name (already does `split(" ")[0]`) but make it a more prominent colored pill
- Move it below the agent name instead of inline beside it for better readability

### Files Modified
- **`src/pages/DashboardCRM.tsx`** — All changes above (headers, cells, sections, notes UI, manager badge styling)

