
# Update Copy Link to Agent Portal

## The Issue

In the Agent Portal page (`src/pages/AgentPortal.tsx`), there's a "Copy Link" card that currently shows and copies the old `/apex-daily-numbers` path. You want this to copy the full `https://apex-financial.org/agent-portal` link instead.

---

## Changes Required

### File: `src/pages/AgentPortal.tsx` (Lines 563-597)

Update the "Direct Portal Link" card to:
1. Change the title from "Apex Daily Numbers" to "Agent Portal"
2. Update the preview URL shown from `/apex-daily-numbers` to the full link
3. Change the copy functionality to copy `https://apex-financial.org/agent-portal`

**Current Code:**
```tsx
<h3 className="font-semibold">Apex Daily Numbers</h3>
<p className="text-xs text-muted-foreground truncate">/apex-daily-numbers</p>
// ...
const logLink = `${window.location.origin}/apex-daily-numbers`;
```

**Updated Code:**
```tsx
<h3 className="font-semibold">Agent Portal</h3>
<p className="text-xs text-muted-foreground truncate">apex-financial.org/agent-portal</p>
// ...
const logLink = "https://apex-financial.org/agent-portal";
```

---

## Result

After this change, when you tap "Copy Link" in the Agent Portal:
- It will copy: `https://apex-financial.org/agent-portal`
- This is the official link you can paste into emails and iMessage group chats
- When agents tap that link, they go directly to the Agent Portal
