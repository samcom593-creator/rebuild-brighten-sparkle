

## Quick Fix: Remove "King of Sales" Default

### Issue Found

There's one remaining instance of "King of Sales" on **line 140** that sets the default when parsing the request body. This overrides the correct "Standard of Excellence" default in the function signature (line 37).

### Single Change Required

**File: `supabase/functions/send-outstanding-performance/index.ts`**

| Line | Current | Change To |
|------|---------|-----------|
| 140 | `ownerName = "King of Sales"` | `ownerName = "Standard of Excellence"` |

### Technical Details

The destructuring on line 140 currently reads:
```typescript
ownerName = "King of Sales",
```

This will be changed to:
```typescript
ownerName = "Standard of Excellence",
```

This ensures that when no `ownerName` is passed in the request, it defaults to "Standard of Excellence" throughout the entire certificate.

### After the Fix

The certificate will show:
- **Cursive signature**: "Standard of Excellence"  
- **Title block**: "Standard of Excellence, Chief Executive Officer, APEX Financial Group"

I'll deploy the fix and send a fresh test email so you can verify it looks perfect.

