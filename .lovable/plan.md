

## Plan: Remove King of Sales / Unitrust References — Replace with Apex Financial

This plan identifies and replaces all occurrences of "King of Sales", "Unitrust Financial", and the associated `kingofsales.net` email domain with **Apex Financial** branding throughout the entire codebase.

---

## Summary of Changes

| Category | Files Affected | Change |
|----------|----------------|--------|
| Frontend Consent | 1 file | Replace "King of Sales / Unitrust Financial" → "Apex Financial" |
| Frontend Legal Pages | 2 files | Replace `kingofsales.net` email → `apex-financial.org` |
| Edge Functions (Email From/To) | 20+ files | Replace email sender names and admin email addresses |

---

## 1. Frontend: Application Consent Form

**File:** `src/pages/Apply.tsx`

Replace all 4 occurrences:
- Line 783: `King of Sales / Unitrust Financial` → `Apex Financial`
- Line 798: `King of Sales / Unitrust Financial` → `Apex Financial`
- Line 810: `King of Sales / Unitrust Financial` → `Apex Financial`
- Line 823: `King of Sales / Unitrust Financial` → `Apex Financial`

**Before:**
```
I agree to receive SMS/text messages from King of Sales / Unitrust Financial. *
```

**After:**
```
I agree to receive SMS/text messages from Apex Financial. *
```

---

## 2. Frontend: Legal Pages

**File:** `src/pages/Privacy.tsx`
- Line 78: `info@kingofsales.net` → `info@apex-financial.org`
- Line 90: `info@kingofsales.net` → `info@apex-financial.org`

**File:** `src/pages/Terms.tsx`
- Line 114: `info@kingofsales.net` → `info@apex-financial.org`

---

## 3. Edge Functions: Email Sender Names & Admin Addresses

Replace all instances of:
- `"King of Sales <notifications@kingofsales.net>"` → `"Apex Financial <notifications@apex-financial.org>"`
- `"info@kingofsales.net"` → `"info@apex-financial.org"`
- `"King of Sales Team"` / `"King of Sales System"` → `"Apex Financial Team"` / `"Apex Financial"` in email bodies

**Files requiring updates:**

| Edge Function | Changes Needed |
|--------------|----------------|
| `notify-attendance-missing/index.ts` | From address (2x), signature (2x) |
| `notify-evaluation-result/index.ts` | From address (3x), admin email, signature (2x) |
| `notify-notes-added/index.ts` | From address, signature |
| `notify-evaluation-due/index.ts` | From address, signature |
| `notify-training-reminder/index.ts` | From address, signature |
| `notify-agent-live-field/index.ts` | Admin email |
| `notify-production-submitted/index.ts` | Admin email |
| `submit-application/index.ts` | Admin email |
| `notify-course-complete/index.ts` | Admin email |
| `check-abandoned-applications/index.ts` | Admin email |
| `send-application-notification/index.ts` | From addresses (2x), admin email |
| `confirm-agent-removal/index.ts` | Admin email |
| `send-outstanding-performance/index.ts` | Admin email |
| `send-weekly-analytics/index.ts` | Admin email |

---

## 4. Standardized Email Branding

All emails will now use consistent Apex Financial branding:

**From addresses:**
- Notifications: `Apex Financial <notifications@apex-financial.org>`
- Applications: `APEX Applications <applications@apex-financial.org>`
- Alerts: `APEX Alerts <alerts@apex-financial.org>`
- No-reply: `Apex Financial <noreply@apex-financial.org>`

**Admin notification email:**
- `info@apex-financial.org`

**Email signatures:**
- "Best regards, Apex Financial Team"
- "Apex Financial"

---

## Complete File List

### Frontend (3 files):
1. `src/pages/Apply.tsx` - Consent text (4 replacements)
2. `src/pages/Privacy.tsx` - Contact emails (2 replacements)
3. `src/pages/Terms.tsx` - Contact email (1 replacement)

### Edge Functions (15 files):
1. `supabase/functions/notify-attendance-missing/index.ts`
2. `supabase/functions/notify-evaluation-result/index.ts`
3. `supabase/functions/notify-notes-added/index.ts`
4. `supabase/functions/notify-evaluation-due/index.ts`
5. `supabase/functions/notify-training-reminder/index.ts`
6. `supabase/functions/notify-agent-live-field/index.ts`
7. `supabase/functions/notify-production-submitted/index.ts`
8. `supabase/functions/submit-application/index.ts`
9. `supabase/functions/notify-course-complete/index.ts`
10. `supabase/functions/check-abandoned-applications/index.ts`
11. `supabase/functions/send-application-notification/index.ts`
12. `supabase/functions/confirm-agent-removal/index.ts`
13. `supabase/functions/send-outstanding-performance/index.ts`
14. `supabase/functions/send-weekly-analytics/index.ts`
15. Any other edge functions with `kingofsales` references

---

## Verification After Implementation

1. Search codebase for "King of Sales" → Should return 0 results
2. Search codebase for "Unitrust" → Should return 0 results
3. Search codebase for "kingofsales" → Should return 0 results
4. Test application form to verify consent text displays "Apex Financial"
5. Verify Privacy and Terms pages show correct contact email

