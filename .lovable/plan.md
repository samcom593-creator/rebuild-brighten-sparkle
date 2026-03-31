

# Full Site Audit + Training/Live Timers + Production Data Import

## 1. Add Duration Timers to CRM (In-Field Training & Live tabs)

**Problem**: No visibility into how long agents have been in training or live.

**Changes to `src/pages/DashboardCRM.tsx`**:
- Add `onboardingCompletedAt` to the `AgentCRM` interface, map from `agent.onboarding_completed_at` in the fetch query
- **In-Field Training tab**: Add a "Days in Training" column showing `differenceInDays(now, fieldTrainingStartedAt)` with color coding (green <14d, amber 14-30d, red >30d)
- **Live tab**: Add a "Days Live" column showing `differenceInDays(now, onboardingCompletedAt)` with a neutral badge

Both displayed as prominent badges in the table headers and the expanded rows.

## 2. Visual Polish Pass (Make Everything 10x Better)

### CRM (`DashboardCRM.tsx`)
- **Status cards**: Increase font sizes, add subtle hover animations, improve spacing
- **Tab triggers**: Make active tab more prominent with filled background instead of just underline
- **Pre-Licensed pipeline cards**: Add subtle gradient borders, improve card spacing, larger agent names
- **Table rows**: Better alternating row colors, more breathing room (py-3 instead of py-2)
- **Expanded rows**: Cleaner grid layout with card-based sections instead of plain divs
- **Manager badge**: Already 10px sky pill — bump to 11px with bolder weight

### Landing Page
- **HeroSection**: Already solid — no changes needed
- **DealsTicker**: Already cleaned up — no changes needed

### Dashboard (`Dashboard.tsx`)
- **Stat cards**: Ensure consistent spacing and visual hierarchy
- No dummy data remaining (already cleaned)

## 3. Import New Production Data (03/30 + updates)

Parse the provided dataset for new deals posted 03/28–03/30:

| Date | Agent | ALP | Deals |
|------|-------|-----|-------|
| 03/30 | Alyjah Rowland | $600.00 | 1 |
| 03/30 | Kaeden Vaughns | $754.44 | 1 |
| 03/30 | Chukwudi Ifediora | $1,224.00 | 1 |
| 03/30 | Obiajulu Ifediora | $855.84 | 1 |
| 03/30 | Mahmod Imran | $2,832.00 | 1 |
| 03/28 | Mahmod Imran | $1,452.00 | 1 |

Plus all historical data re-synced via `import-production-data` with `skip_existing: false`.

## Files Modified
- **`src/pages/DashboardCRM.tsx`** — Add `onboardingCompletedAt` field, training/live duration columns, visual polish across all sections
- **Data import** via `import-production-data` edge function call with full dataset

