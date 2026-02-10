
# Fix LogNumbers.tsx -- The Missing Production Entry Page

## The Real Problem

There are THREE separate production entry forms in the app, but only two were updated in previous fixes. The third one -- `src/pages/LogNumbers.tsx` (served at `/apex-daily-numbers`) -- was completely missed. This is the page agents are using and complaining about because it still shows:

- "Presentations" and "Pitched Price" as separate fields
- "Booked In-Home" (should be removed)
- A raw "ALP ($)" text input instead of the bubble deal entry
- No easy way to enter deal amounts
- All fields start at 0 with no existing data loading

## What Will Be Fixed

### 1. Update `productionFields` in LogNumbers.tsx (line 347)

Remove "Pitched Price" (`passed_price`), remove "Booked In-Home" (`booked_inhome_referrals`), and remove the raw "ALP ($)" field. The final fields will be:

1. **Presentations** -- covers pitching price (maps to `presentations`)
2. **Hours Called** -- decimal input (maps to `hours_called`)
3. **Referrals** -- (maps to `referrals_caught`)
4. **Ref. Pres.** -- (maps to `referral_presentations`)
5. **Closes** -- manual deal count (maps to `deals_closed`)

### 2. Add BubbleDealEntry for premium/deal amounts

Replace the raw "ALP ($)" input with the existing `BubbleDealEntry` component (the same bubble system used on `/numbers`). This gives agents:
- A simple "Enter premium" input with "+ Add" button
- Deal bubbles showing each amount with delete
- Auto-calculated total

### 3. Load existing production data

Add a fetch when an agent is selected to load any existing production for today, preventing the "zeros overwrite" bug. Same pattern already working in `CompactProductionEntry.tsx`.

### 4. Keep `passed_price` and `booked_inhome_referrals` in the data object as 0

These fields still exist in the database, so they'll be sent as 0 to avoid breaking the upsert.

## Files to Modify

- **`src/pages/LogNumbers.tsx`** -- Update field list, add BubbleDealEntry import, add existing data loading, remove old fields from UI
