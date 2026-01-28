

# Direct ALP Entry - Simplified System

## Current Issue
The system currently takes monthly premium and multiplies by 12 to get ALP. This adds unnecessary complexity.

## Solution
**Just enter the ALP directly.** No math, no conversion.

---

## User Flow (New)

```text
┌─────────────────────────────────────────────────────┐
│  💰 Deals                                           │
│                                                     │
│  [Deal #1: $3,600 ×]  [Deal #2: $2,400 ×]          │
│                                                     │
│  ┌───────────────────────────────┐  ┌───────────┐  │
│  │ $  3600                       │  │ + Add Deal│  │
│  │     Enter ALP                 │  │           │  │
│  └───────────────────────────────┘  └───────────┘  │
│                                                     │
│  Total: 2 Deals • $6,000 ALP                       │
└─────────────────────────────────────────────────────┘
```

---

## Code Changes

### File: `src/components/dashboard/BubbleDealEntry.tsx`

| Change | Before | After |
|--------|--------|-------|
| Placeholder text | "Enter monthly premium" | "Enter ALP" |
| Calculation | `premium * 12` | None - value IS the ALP |
| Bubble display | `$${getALP(deal.premium)}` | `$${deal.premium}` |
| Total calculation | Sum of `(premium * 12)` | Sum of premiums directly |

### Specific Code Updates:

1. **Remove `getALP` function** - No longer needed
2. **Update placeholder** - "Enter ALP" instead of "Enter monthly premium"
3. **Bubble shows value directly** - No multiplication
4. **Total is simple sum** - `deals.reduce((sum, d) => sum + d.premium, 0)`

---

## Technical Implementation

```typescript
// BEFORE
const getALP = (premium: number) => Math.round(premium * 12);
const totalALP = deals.reduce((sum, deal) => sum + getALP(deal.premium), 0);

// AFTER - Much simpler
const totalALP = deals.reduce((sum, deal) => sum + deal.premium, 0);
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/BubbleDealEntry.tsx` | Remove ×12 calculation, update placeholder to "Enter ALP" |

---

## Result
- User types ALP amount directly (e.g., 3600)
- Taps "+ Add Deal"
- Bubble shows exactly what they entered
- Done. No math required.

