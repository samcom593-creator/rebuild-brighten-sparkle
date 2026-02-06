

# Plan: Fix Coursework Link in Welcome Email

## Summary

Update the welcome email to use the correct XcelSolutions licensing course link for unlicensed agents.

---

## Issue Found

In `supabase/functions/welcome-new-agent/index.ts`:

- **Line 23**: Default course link is set to `https://apex-financial.org/onboarding-course`
- This is the **internal coursework** for agents who are already licensed
- For unlicensed agents, the correct link should be the **XcelSolutions licensing course**: `https://partners.xcelsolutions.com/afe`

---

## Changes Required

### File: `supabase/functions/welcome-new-agent/index.ts`

**Update line 23:**

```typescript
// Before
const defaultCourseLink = "https://apex-financial.org/onboarding-course";

// After
const defaultCourseLink = "https://partners.xcelsolutions.com/afe";
```

---

## Context

The welcome email is sent to **new unlicensed recruits** as their first steps. The flow is:

1. **Step 1**: Complete Licensing (contracting link) ✅ Correct
2. **Step 2**: Complete Coursework → This is the **licensing course** at XcelSolutions, not the internal onboarding course

The internal onboarding course (`/onboarding-course`) is for **after** they get licensed and contracted.

---

## Result

After this fix, unlicensed agents receiving the welcome email will see:

| Step | Action | Link |
|------|--------|------|
| 1 | Complete Licensing | Manager's contracting link |
| 2 | Complete Coursework | `https://partners.xcelsolutions.com/afe` |

