

# Fix Production Entry: Simplify Fields + Add Closes + Update Deal Placeholder

## Changes

### 1. Update BubbleDealEntry placeholder text
**File: `src/components/dashboard/BubbleDealEntry.tsx`**
- Change placeholder from "Enter ALP" to "Enter premium" (line 98)
- This is the deal amount input field

### 2. Merge "Presentations" and "Pitched Price" into one field, add "Closes"

**CompactProductionEntry.tsx** -- Update `statFields` array (line 234):
- Combine "Presentations" and "Pitched Price" into a single field called "Presentations" that maps to `presentations` (the number of times they presented/pitched price)
- Remove `passed_price` as a separate field (keep it in formData as 0 for DB compatibility)
- Add a new "Closes" field that maps to `deals_closed` so agents can type in the number of deals closed directly in the stats grid
- Remove the automatic `deals_closed` count from BubbleDealEntry (the agent will type it manually in the Closes bubble)

New stat fields:
1. Presentations (presentations count -- includes pitching price)
2. Hours Called
3. Referrals
4. Ref. Pres.
5. Closes (deals_closed -- typed manually)

**ProductionEntry.tsx** -- Same changes to `activityFields` array (line 363):
- Merge presentations/pitched price into one "Presentations" field
- Remove `passed_price` as separate field
- Add "Closes" field for `deals_closed`

### 3. Disconnect deals_closed from BubbleDealEntry count

Currently `BubbleDealEntry` calls `onDealsChange(dealCount)` which auto-sets `deals_closed` based on how many deal bubbles are added. Since the user wants a manual "Closes" input, we need to:
- Remove the `onDealsChange` callback from `BubbleDealEntry`
- Remove the `handleDealsChange` callback from both `CompactProductionEntry` and `ProductionEntry`
- The `deals_closed` value will now only come from the manual "Closes" bubble input

## Technical Details

### BubbleDealEntry.tsx
- Remove `onDealsChange` from props and internal `useEffect`
- Change placeholder to "Enter premium"

### CompactProductionEntry.tsx
- Remove `handleDealsChange` callback
- Remove `onDealsChange` prop from `BubbleDealEntry`
- Update `statFields` to remove `passed_price`, add `deals_closed` as "Closes"

### ProductionEntry.tsx
- Same field changes as CompactProductionEntry
- Remove any auto-setting of `deals_closed` from deal count

### Files to modify
- `src/components/dashboard/BubbleDealEntry.tsx`
- `src/components/dashboard/CompactProductionEntry.tsx`
- `src/components/dashboard/ProductionEntry.tsx`
