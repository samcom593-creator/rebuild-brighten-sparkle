

## Hide Team Performance Breakdown on Mobile

### The Problem
The `TeamPerformanceBreakdown` component on the Dashboard takes up significant vertical space on mobile devices, making the page feel "clunky" and pushing the important content (agency production and leaderboards) further down.

### The Solution
Hide the `TeamPerformanceBreakdown` section entirely when viewing on mobile devices (screens under 768px width). It will remain visible on desktop/tablet.

---

## Technical Details

### File to Change
`src/pages/Dashboard.tsx`

### Changes Required

1. **Import the mobile detection hook**
   - Add `useIsMobile` from `@/hooks/use-mobile`

2. **Use the hook in the component**
   - Call `const isMobile = useIsMobile();`

3. **Conditionally render TeamPerformanceBreakdown**
   - Change the condition from:
     ```tsx
     {(isManager || isAdmin) && (
       <div className="mb-6">
         <TeamPerformanceBreakdown />
       </div>
     )}
     ```
   - To:
     ```tsx
     {(isManager || isAdmin) && !isMobile && (
       <div className="mb-6">
         <TeamPerformanceBreakdown />
       </div>
     )}
     ```

This ensures the component only renders on desktop/tablet where there's adequate screen real estate.

---

## Result
On mobile, users will see:
- Production Snapshot (TeamSnapshotCard)
- Leaderboards (Production, Closing Rate, Referrals)
- Recruiting stats

Without the heavy performance breakdown table cluttering the view.

