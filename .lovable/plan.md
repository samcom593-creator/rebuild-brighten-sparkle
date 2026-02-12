

# Fix Magic Link Course Access + Application Flow Audit

## Issues Found

### 1. Magic Link Edge Function Not Deployed
The grace window code is in the source file but the **deployed version is still the old code**. The logs from just minutes ago show `"Token already used: 3d0666f4..."` (without "beyond grace window"), confirming the fix from the previous message was never deployed. This is why agents clicking the course email link still see "Edge Function returned a non-2xx status code."

**Fix:** Redeploy the `verify-magic-link` edge function. No code changes needed -- the source is already correct.

### 2. Application Name Validation Mismatch (Root Cause of Apply Failures)
The frontend Zod schema allows any characters in names (`z.string().min(2).max(50)`) but the **edge function** requires names to match `/^[a-zA-Z\s'-]+$/`. Anyone with an accent, period, or special character in their name (e.g., "Jose", "O'Brien Jr.", "Mary-Ann") will pass frontend validation, submit, and then get a silent server-side rejection with a generic error.

**Fix:** Relax the edge function regex to allow common name characters: accents, periods, commas, and Unicode letters.

**File:** `supabase/functions/submit-application/index.ts` (lines 78-79)

Change:
```
firstName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
lastName: z.string().min(1).max(100).regex(/^[a-zA-Z\s'-]+$/, "Invalid name format"),
```
To:
```
firstName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
lastName: z.string().min(1).max(100).regex(/^[\p{L}\s'.\-,]+$/u, "Invalid name format"),
```

This allows Unicode letters (accents, non-Latin), periods (Jr.), commas, hyphens, and apostrophes.

### 3. Application Error Messages Not Specific Enough
When the edge function returns a validation error (400), the frontend catches it but shows a generic "Failed to submit application" toast. The actual validation error details from the server are lost.

**Fix:** In `src/pages/Apply.tsx`, extract the `details` array from the error response to show which field failed validation.

**File:** `src/pages/Apply.tsx` (lines 418-445)

Add handling for Zod validation errors from the edge function response:
```typescript
} catch (error: any) {
  const errorMessage = error?.message?.toLowerCase() || "";
  const errorStatus = error?.status || error?.code;
  
  // Also check if there's a response body with details
  if (error?.context?.json) {
    const body = error.context.json;
    if (body.details) {
      const fields = body.details.map((d: any) => d.path?.join(".")).filter(Boolean);
      toast.error(`Please fix: ${fields.join(", ")}`, { duration: 6000 });
      return;
    }
  }
  // ... rest of error handling
}
```

### 4. Motivation Step Visibility
The motivation step already exists in the code and works correctly for unlicensed/pending applicants. It appears after the referral step (Step 5). No changes needed here -- it is functioning as designed.

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/verify-magic-link/index.ts` | Redeploy only (no code changes) |
| `supabase/functions/submit-application/index.ts` | Relax name regex to support Unicode/accented names and common punctuation |
| `src/pages/Apply.tsx` | Improve error handling to surface specific validation failures from edge function |

## Deployment Steps
1. Deploy `verify-magic-link` edge function (fixes course access immediately)
2. Deploy `submit-application` edge function (fixes name validation blocking)
3. Update `Apply.tsx` error handling

