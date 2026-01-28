
# Fix Plan: Deal Entry Not Working on Mobile

## Problem Analysis

From the screenshot and user feedback, I've identified these issues:

1. **Deal Input Auto-Submits**: When users type a number (like "1"), it immediately becomes a deal bubble instead of letting them complete typing "10000" or "30000"
2. **Blank Screen on Left Side**: The AgentPortal layout appears broken on mobile, showing blank space where content should be

## Root Cause

After investigating, I found there are **two different deal entry components**:

| Component | Used In | Location |
|-----------|---------|----------|
| `ALPCalculator.tsx` | ProductionEntry.tsx | AgentPortal page |
| `BubbleDealEntry.tsx` | CompactProductionEntry.tsx | Numbers page |

The `ALPCalculator.tsx` was updated in the previous response to fix the auto-submit issue, but it seems the fix isn't working. Looking at the code:

**Current `ALPCalculator.tsx` logic** (lines 44-56):
- Uses "active draft" concept where last deal is the input
- Bubbles only render for `deals.slice(0, -1)` (committed deals)
- Commit happens on Enter or "+ Add" button click

This should work, BUT there may be an issue with how the component is rendering or the fix wasn't deployed properly.

## Technical Fix

### 1. Verify ALPCalculator Fix is Working
The ALPCalculator code looks correct, but I'll add extra safeguards:
- Ensure the input field has proper event handling for mobile
- Add `onKeyDown` with explicit `stopPropagation()` for all keyboard events
- Ensure `type="text"` instead of `type="number"` to prevent mobile number keyboard issues

### 2. Fix BubbleDealEntry (CompactProductionEntry)
The BubbleDealEntry already has the correct pattern (separate input + explicit Add button), but needs:
- Add `stopImmediatePropagation()` to prevent any parent form handling
- Ensure mobile keyboards don't trigger auto-submit

### 3. Mobile Layout Fix
The blank left side on mobile suggests the tab content might not be rendering. Add defensive checks to ensure components render even when data is loading.

## Files to Modify

1. **`src/components/dashboard/ALPCalculator.tsx`**
   - Use `type="text"` with `inputMode="decimal"` for better mobile control
   - Add additional event propagation guards
   - Ensure focus management works on mobile

2. **`src/components/dashboard/BubbleDealEntry.tsx`**  
   - Same mobile keyboard fixes
   - Ensure Enter key doesn't submit parent form

3. **`src/components/dashboard/ProductionEntry.tsx`**
   - Wrap the form with `onKeyDown` handler to prevent accidental submissions
   - Add defensive rendering for mobile

## Implementation Details

### ALPCalculator.tsx Changes
```tsx
// Change input type from "number" to "text" with inputMode for mobile
<Input
  ref={inputRef}
  type="text"  // Changed from "number" 
  inputMode="decimal"
  pattern="[0-9]*\.?[0-9]*"
  placeholder="Enter premium..."
  value={activeDeal.amount}
  onChange={(e) => {
    // Only allow numeric input
    const value = e.target.value.replace(/[^0-9.]/g, '');
    handleDealChange(activeDeal.id, value);
  }}
  onKeyDown={(e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitDeal();
    }
  }}
  className="pl-9 pr-2 h-12 text-lg font-semibold"
/>
```

### BubbleDealEntry.tsx Changes
```tsx
// Same pattern - use text input with pattern validation
<input
  ref={inputRef}
  type="text"
  inputMode="decimal"
  pattern="[0-9]*\.?[0-9]*"
  placeholder="Enter ALP"
  value={inputValue}
  onChange={(e) => {
    const value = e.target.value.replace(/[^0-9.]/g, '');
    setInputValue(value);
  }}
  onKeyDown={(e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      addDeal();
    }
  }}
  className="flex-1 h-12 bg-transparent border-0 text-lg font-semibold..."
/>
```

### Form-Level Protection
Add to ProductionEntry.tsx form element:
```tsx
<form 
  onSubmit={handleSubmit}
  onKeyDown={(e) => {
    // Prevent Enter from submitting form unless on submit button
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
    }
  }}
  className="space-y-6"
>
```

## Summary of Changes

| File | Change |
|------|--------|
| `ALPCalculator.tsx` | Use `type="text"` + `inputMode="decimal"` for mobile-safe number entry |
| `BubbleDealEntry.tsx` | Same text input pattern with numeric validation |
| `ProductionEntry.tsx` | Add form-level Enter key prevention |
| `CompactProductionEntry.tsx` | Same form-level protection |

This will ensure users can type full numbers (30000, 20000) without the input being auto-submitted or turning into a bubble prematurely.
