

# Fix Blast Timeout, Ensure All Notifications Work, Add Site-Wide Sound Effects

## Root Cause: Blast is Timing Out

The blast function processes **97 applicants + 925 aged leads = 1,022 leads** with a 1-second delay each. That's ~17 minutes of execution time. Edge functions timeout at ~60 seconds. The function silently dies mid-execution, which is why it appears "frozen" and only partial notifications get sent.

## Fix Strategy

### 1. Rewrite Blast to Process in Batches (Client-Side Orchestration)

Instead of one giant edge function call that processes everything, break it into small batches processed from the client. The UI shows a **live progress bar** with per-batch results.

**New approach in `NotificationHub.tsx` `BulkBlastSection`:**
- Fetch all applicant IDs and aged lead IDs client-side
- Process in batches of 5 leads per edge function call
- Show a live progress bar with percentage + current count
- Accumulate stats across batches
- Fire confetti + celebrate sound only after ALL batches complete
- If any batch fails, continue with remaining batches (resilient)

**New edge function: `send-batch-blast`** -- takes a small array of lead IDs + type (applicant or aged), processes just those 5, returns stats. This runs in ~10 seconds max, well within timeout.

### 2. Fix Quick Action "Text All Applicants" (Same Timeout Issue)

The "Text All Applicants" button calls the same `send-bulk-notification-blast` function. Replace with the same batch approach.

### 3. Fix Duplicate `key` Warning

Line 224-225 in `NotificationHub.tsx`: `<Fragment key={log.id}>` wraps a `<TableRow key={log.id}>`. Remove the duplicate key from the inner `TableRow`.

### 4. Add Sound Effects to Pages Missing Them

Pages that currently lack sound effects:
- **`Dashboard.tsx` (Manager/Admin dashboard)**: Add sounds on tab switches, refresh clicks, production entry saves
- **`Index.tsx` (Landing page)**: Add subtle click sounds on CTA buttons  
- **`Login.tsx`**: Add success sound on login, error sound on failure
- **`GlobalSidebar.tsx`**: Add click sound on navigation item clicks

### 5. Ensure SMS Auto-Detect Works Properly

The edge function logs confirm SMS auto-detect is working (6/8 and 5/8 gateways accepted). No changes needed -- it's functioning correctly.

---

## Technical Details

### New Edge Function: `send-batch-blast`

```text
Input: { leadIds: string[], type: "applicant" | "aged" }
Process: For each lead ID:
  - Fetch lead data
  - Send push (if profile exists)
  - Send SMS (carrier known → direct, unknown → auto-detect)
  - Send email
  - 200ms delay between leads
Output: { stats: { push_sent, sms_sent, emailed, failed } }
```

Max 5 leads per call = ~5-8 seconds execution time. Safe.

### Client-Side Batch Loop (BulkBlastSection)

```text
1. Fetch all applicant IDs (terminated_at IS NULL)
2. Fetch all aged lead IDs
3. Chunk into batches of 5
4. For each batch:
   - Call send-batch-blast
   - Update progress bar (batch N / total batches)
   - Accumulate stats
   - 500ms pause between batches
5. Show final stats + confetti
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/send-batch-blast/index.ts` | **NEW** -- processes 5 leads at a time |
| `supabase/config.toml` | Add `send-batch-blast` config |
| `src/pages/NotificationHub.tsx` | Replace BulkBlastSection with batch orchestration + live progress bar; fix duplicate key; update "Text All" quick action to use batches |
| `src/pages/Dashboard.tsx` | Add `useSoundEffects` for tab switches, refresh, date range changes |
| `src/components/layout/GlobalSidebar.tsx` | Add click sound on nav item clicks |
| `src/pages/Login.tsx` | Add success/error sounds on login result |

### Progress Bar UI

```text
┌─────────────────────────────────────────────┐
│  Sending... 45/205 batches (22%)            │
│  ████████░░░░░░░░░░░░░░░░░░  Push: 12       │
│                               SMS: 38       │
│                               Email: 89     │
└─────────────────────────────────────────────┘
```

This replaces the current "Sending..." spinner that gives no feedback.

