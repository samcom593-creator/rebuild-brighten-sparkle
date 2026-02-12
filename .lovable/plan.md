

# Fix Course Access: Make It Dead Simple for Agents to Start Coursework

## Problem Summary

Agents enrolled in the training course are not getting clear instructions on how to access it. The portal login email sent during enrollment talks about "production numbers" and "leaderboard" but never mentions the course or provides a direct link to it. Agents end up confused, going to the wrong login page, or not knowing the course exists.

## Root Causes

1. **Portal login email is wrong context for course enrollment** -- When an agent is enrolled via "Add to Course," the system sends the generic portal-welcome email (send-agent-portal-login). This email says "You're Now LIVE!" and talks about logging production numbers. It never mentions the training course or links to `/onboarding-course`.

2. **No dedicated course enrollment email exists** -- There's a `notify-course-started` function (notifies the admin), but nothing that sends the AGENT a "here's how to start your course" email with a direct magic link to the course.

3. **Magic link destinations are limited** -- The magic link system only supports `portal` and `numbers` destinations. There's no `course` destination that would take agents directly to `/onboarding-course`.

## The Fix (3 Changes)

### Change 1: Add "course" as a Magic Link Destination

**File**: `supabase/functions/send-agent-portal-login/index.ts`
- Add support for a `destination` parameter in the request body (default: "portal")
- When destination is "course", generate a magic link that goes to `/onboarding-course`

**File**: `supabase/functions/verify-magic-link/index.ts`  
- No changes needed -- it already stores and returns the destination field

**File**: `src/pages/MagicLogin.tsx`
- Add "course" to the destination mapping so `data.destination === "course"` routes to `/onboarding-course`

### Change 2: Create a Dedicated Course Enrollment Email

**File**: `supabase/functions/send-course-enrollment-email/index.ts` (NEW)
- Sends the enrolled agent a branded email specifically about their training course
- Subject: "Your APEX Training Course Is Ready"
- Contains a one-tap magic link that goes directly to `/onboarding-course`
- Clear instructions: "Tap below to start your training"
- CCs admin and the agent's manager (per system policy)
- Includes fallback login instructions pointing to `/agent-login`

### Change 3: Wire Up the Add to Course Button

**File**: `src/components/dashboard/AddToCourseButton.tsx`
- Replace the call to `send-agent-portal-login` with the new `send-course-enrollment-email`
- This ensures enrolled agents get the RIGHT email with course-specific context

## Technical Details

### New Edge Function: send-course-enrollment-email

```text
Input: { agentId: string }

Flow:
1. Look up agent -> profile (name, email)
2. Look up manager email for CC
3. Generate magic link with destination = "course"
4. Send branded email via Resend:
   - Subject: "Your APEX Training Course Is Ready"
   - Body: Welcome message, one-tap "Start My Course" button
   - Fallback: "Sign in at apex-financial.org/agent-login"
   - CC: admin + manager
5. Return success/failure
```

### Magic Link Destination Update

The `generateMagicToken` function in send-agent-portal-login already accepts a destination parameter. The new email function will use `destination: "course"` when generating the token.

MagicLogin.tsx destination mapping update:
- `"course"` maps to route `"onboarding-course"`

### Email Content

The course enrollment email will:
- Use the same APEX branded template style (dark theme, teal accents)
- Have a large "Start My Course" CTA button
- Explain what the course is (video modules + quizzes)
- Set expectations (complete at your own pace)
- Include Discord link for support
- Include fallback login instructions

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/send-course-enrollment-email/index.ts` | CREATE | New edge function for course-specific enrollment email |
| `src/pages/MagicLogin.tsx` | MODIFY | Add "course" destination mapping to `/onboarding-course` |
| `src/components/dashboard/AddToCourseButton.tsx` | MODIFY | Call `send-course-enrollment-email` instead of `send-agent-portal-login` |
| `supabase/config.toml` | MODIFY | Add JWT config for new function (verify_jwt = false) |

