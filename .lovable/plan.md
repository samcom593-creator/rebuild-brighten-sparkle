

# Add Application Date + Time-Since to Recruiter HQ and Call Center

## What Changes

### 1. Recruiter HQ (RecruiterDashboard.tsx) — Add "Applied" column to the desktop table
- Add a new table column header **"Applied"** between "Location" and "License Progress" (update `colSpan` accordingly)
- In each row, display:
  - The application date formatted as `MMM d` (e.g. "Mar 14")
  - Below it, a time-since badge showing days/hours (e.g. "4d 6h ago") using `formatDistanceToNow` — styled in muted text
- Increase `min-w` from `1100px` to `1200px` to accommodate the new column
- Column width: `w-[110px]`

### 2. Call Center Card (CallCenterLeadCard.tsx) — Add time-since next to existing "Lead Added" line
- The card already shows `Lead Added: MMM d, yyyy at h:mm a` on line 288
- Append a time-since indicator right after the date: e.g. `"(4d 6h ago)"` in muted/amber styling
- Uses `formatDistanceToNow` from date-fns which is already imported

### Files Modified
- `src/pages/RecruiterDashboard.tsx` — new "Applied" column in table header + row
- `src/components/callcenter/CallCenterLeadCard.tsx` — append elapsed time to existing "Lead Added" line

### Technical Details
- Both components already import `date-fns` utilities (`format`, `formatDistanceToNow`)
- No database changes needed — `created_at` / `createdAt` is already fetched in both components
- The elapsed time uses `formatDistanceToNow(new Date(created_at), { addSuffix: true })` for a human-readable string like "4 days ago"

