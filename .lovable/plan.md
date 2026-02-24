

# Fix: Application Submission "Failed" Error for Duplicate Applicants

## Root Cause

The applicant (**bjdavidson52604@gmail.com**) already has an existing application in the system. The backend correctly detects the duplicate and returns a **409 Conflict** response with a clear message. However, the frontend error handling in `Apply.tsx` fails to properly parse this response, so the user sees the generic "Failed to submit application" instead of the helpful duplicate message.

The issue is in the catch block (lines 422-466). When `supabase.functions.invoke()` returns a non-2xx response, it sets `error` as a `FunctionsHttpError` object. The code tries to read `error.context.body` but the parsing logic doesn't reliably extract the JSON body or the HTTP status code from this error type. Specifically:

1. `error.context.body` is a `ReadableStream`, and the code tries `.json()` on it — but `ReadableStream` doesn't have `.json()` directly
2. `error?.status` and `error?.code` don't match `409` because `FunctionsHttpError` stores the status differently

## Fix (in `src/pages/Apply.tsx`)

Rewrite the catch block to properly handle `FunctionsHttpError` from `@supabase/supabase-js`:

1. Check if the error has a `context` property (indicating a `FunctionsHttpError`)
2. Use `error.context.json()` (which is available on the `Response` object) to read the body
3. Check `error.context.status` for the HTTP status code (e.g., 409 for duplicates)
4. Show the correct user-facing message based on the response

**Changes:**
- **`src/pages/Apply.tsx` lines ~422-466** — Rewrite the error handler to properly read `error.context` as a `Response` object, checking `.status` for 409 and parsing `.json()` for the error message

This ensures duplicate applicants see: *"An application with this email already exists. If you need to update your application, please contact us."* instead of the confusing generic failure.

## No backend changes needed

The edge function is working correctly — it returns proper 409 responses with clear error messages. Only the frontend parsing needs fixing.

