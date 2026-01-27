

# Rename "Quick Log Numbers Link" to "Apex Daily Numbers"

## Summary

This is a simple text update to rebrand the quick log numbers feature to "Apex Daily Numbers" for clearer branding consistency.

---

## Changes

### 1. Agent Portal Link Section (Primary Change)

**File:** `src/pages/AgentPortal.tsx`

Update the card heading and description:

| Current Text | New Text |
|--------------|----------|
| "Quick Log Numbers Link" | "Apex Daily Numbers" |
| "Share this link with your team for quick number entry:" | "Share this link with your team for daily number entry:" |

### 2. Log Numbers Page Title (Optional Consistency)

**File:** `src/pages/LogNumbers.tsx`

Update the page heading:

| Current Text | New Text |
|--------------|----------|
| "Log Your Numbers" | "Apex Daily Numbers" |
| "Quick entry for daily production" | "Daily production entry" |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/AgentPortal.tsx` | Update section heading from "Quick Log Numbers Link" to "Apex Daily Numbers" |
| `src/pages/LogNumbers.tsx` | Update page title to match the new branding |

---

## Result

After implementation, the Agent Portal will show "Apex Daily Numbers" as the heading for the shareable link section, providing clearer branding alignment.

