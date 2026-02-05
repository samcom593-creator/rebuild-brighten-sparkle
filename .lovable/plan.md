
## Fix: Landing Page Resetting When Scrolling/Tab Switching

### Problem Summary
The homepage resets (scroll position, animations replay, state resets) when users scroll away or switch browser tabs. This is caused by React component re-rendering issues and missing stability patterns.

### Root Causes Identified

1. **Missing `forwardRef` on Components**
   - `CTASection` and `Footer` are missing `forwardRef`, causing React warnings
   - These warnings indicate React is attempting to pass refs that fail, potentially triggering re-renders

2. **Tab Visibility Triggering Re-renders**
   - The `HeroSection` and `DealsTicker` use `setInterval` for rotating content
   - When the tab loses focus and regains it, these intervals can behave unexpectedly

3. **Animation Libraries Re-triggering**
   - Framer Motion's `whileInView` animations may re-trigger in certain conditions
   - Components remounting causes all `useEffect` hooks to re-run

---

### Implementation Plan

#### Step 1: Add `forwardRef` to Landing Components
Wrap `CTASection` and `Footer` with `forwardRef` to eliminate React warnings and prevent ref-related re-renders.

**Files to update:**
- `src/components/landing/CTASection.tsx`
- `src/components/landing/Footer.tsx`

#### Step 2: Add Tab Visibility Guards to Interval-Based Components
Pause intervals when the browser tab is not visible to prevent state drift and unnecessary updates.

**Files to update:**
- `src/components/landing/HeroSection.tsx` - carrier rotation interval
- `src/components/landing/DealsTicker.tsx` - carrier index interval

#### Step 3: Stabilize Animation Initial States
Ensure animations only run once and don't re-trigger on scroll position changes.

**Files to update:**
- `src/components/landing/BenefitsSection.tsx`
- `src/components/landing/CTASection.tsx`
- All sections using `whileInView`

#### Step 4: Memoize the Index Page Structure
Wrap heavy sections in `React.memo` to prevent unnecessary re-renders when parent state changes.

**Files to update:**
- `src/pages/Index.tsx` - add memo wrappers

---

### Technical Details

**Tab Visibility Pattern:**
```typescript
useEffect(() => {
  let intervalId: NodeJS.Timeout;
  
  const startInterval = () => {
    intervalId = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 3000);
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      clearInterval(intervalId);
    } else {
      startInterval();
    }
  };

  startInterval();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    clearInterval(intervalId);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}, []);
```

**forwardRef Pattern:**
```typescript
export const CTASection = forwardRef<HTMLElement, object>((_, ref) => {
  return <section ref={ref}>...</section>;
});
CTASection.displayName = "CTASection";
```

---

### Files to Modify

| File | Change |
|------|--------|
| `src/components/landing/CTASection.tsx` | Add `forwardRef` wrapper |
| `src/components/landing/Footer.tsx` | Add `forwardRef` wrapper |
| `src/components/landing/HeroSection.tsx` | Add tab visibility guard to interval |
| `src/components/landing/DealsTicker.tsx` | Add tab visibility guard to interval |

---

### Expected Outcome
- No more React ref warnings in console
- Page scroll position preserved when switching tabs
- Animations don't replay when returning to the page
- Carrier rotation pauses when tab is hidden, preventing drift
