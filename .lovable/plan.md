
## Goal (what “working” means)
Agents can tap a link from any email client/device and be taken straight into:
- **Daily numbers entry** (primary goal), and/or
- **Agent portal**
…without getting sent to a Lovable login screen, without “nothing happens”, and with a clean fallback when something is wrong.

## What’s actually going wrong (based on the current code)
There are two independent failure sources:

### A) Redirect / environment mismatch (very likely)
Your email links always go to:
- `https://apex-financial.org/magic-login?token=...`

But the token is created in whichever backend environment the “send email” function was triggered from. If a bulk send is triggered from the **preview/test** environment but the link points to the **live/public** domain, then:
- token exists in **test DB**
- click happens on **live site** → it calls **live backend**
- token is missing → flow fails / falls back / appears broken

This also explains why some auth emails (password reset, magic link) “open and nothing happens” or route users somewhere unexpected: the auth system will fall back to configured “Site URL / Redirect URLs” rules when it can’t use the redirect you requested.

### B) The current magic login method depends on an external redirect
Right now `MagicLogin.tsx` does:
1) call `verify-magic-link`
2) receive `otpData.properties.action_link`
3) `window.location.href = action_link`

That `action_link` sends the user through the auth provider’s `/verify` endpoint and then redirects back to your site. If Redirect URLs are not perfectly allowlisted (and consistent across environments/domains), users can end up on:
- a Lovable login wall (preview URL), or
- the wrong site URL,
- or a dead-end in an in-app browser.

## The fix (design decision)
We remove the “external redirect” dependency completely.

Instead of redirecting the user to `action_link`, we will:
1) use the backend to generate a **hashed token** (token_hash) for that user
2) return that hash to the frontend
3) the frontend calls **`supabase.auth.verifyOtp()`** directly to create the session in-app
4) then we navigate to `/apex-daily-numbers` or `/agent-portal`

This eliminates the biggest source of “Lovable login / nothing happens” behavior because it keeps the whole login inside your app (same origin).

## Planned changes

### 1) Update the backend auth configuration (required)
In Lovable Cloud backend settings, we will ensure:
- **Site URL** is your primary domain (apex-financial.org)
- **Redirect URLs** include:
  - `https://apex-financial.org/*`
  - your published Lovable domain `https://rebuild-brighten-sparkle.lovable.app/*`
  - your preview domain `https://id-preview--f583945a-f8ff-4a81-8442-9fc61f88a855.lovable.app/*` (so preview testing doesn’t bounce to a login wall)

Why this still matters even after the in-app verifyOtp approach:
- It fixes password reset flows and any other auth links that rely on redirects.
- It prevents “wrong domain fallback” behavior.

### 2) Change `verify-magic-link` to return `hashed_token` (not `action_link`)
Current behavior:
- returns `authLink: otpData.properties.action_link`

New behavior:
- returns:
  - `email`
  - `destination`
  - `tokenHash` (from `otpData.properties.hashed_token` or equivalent field)
  - `type` = `"magiclink"` (so frontend knows what to pass to verifyOtp)

Also improve token consumption safety:
- Do **not** mark `magic_login_tokens.used_at` before we have successfully generated the OTP payload.
- Preferably: mark it used **after** OTP payload is generated (and optionally after successful verifyOtp via a second “consume token” call).
- Add extra logging (token prefix, destination, and whether otp payload contained hashed_token) so we can prove where it fails.

### 3) Change `MagicLogin.tsx` to use `verifyOtp` and then navigate
Replace:
- `window.location.href = data.authLink`

With:
- `await supabase.auth.verifyOtp({ email: data.email, token: data.tokenHash, type: "magiclink" })`
- then `navigate("/apex-daily-numbers")` or `navigate("/agent-portal")`

Add robust UX behavior:
- If verification fails, show a clear error and three buttons:
  1) “Try again”
  2) “Go to Agent Login”
  3) “Send me a fresh link” (input email → calls a backend function to send a new magic link)
- This gives agents a way out even if their token was already used/expired.

### 4) Fix `ProtectedRoute` so agents never land on the wrong login screen
Right now:
- `/apex-daily-numbers` redirects to `/agent-login`
- `/agent-portal` redirects to `/login` (manager login)

We’ll update ProtectedRoute so **both**:
- `/apex-daily-numbers`
- `/agent-portal`
redirect to `/agent-login` when unauthenticated.

This prevents the “I clicked it and got the wrong login page” failure mode even if magic login fails.

### 5) Make email link base URL environment-safe
Right now both email functions hardcode:
- `const BASE_URL = "https://apex-financial.org";`

We will make base URL deterministic and safe:
- Prefer `Deno.env.get("APP_BASE_URL")` (configurable per environment)
- Else fall back to request Origin (when invoked from the web UI)
- Else fall back to apex-financial.org

This prevents “tokens created in test, link points to live” mistakes during testing, and also allows you to intentionally test flows in preview without sending agents to a domain they can’t access.

### 6) Testing strategy (how we prove it works)
We will test in a way that mirrors real user behavior:

**Backend-level tests**
1) Trigger `send-bulk-portal-logins`
2) Pick one generated token from the DB
3) Call `verify-magic-link` directly (tooling) and confirm it returns:
   - `success: true`
   - `email`
   - `tokenHash`
4) Call `verifyOtp` from the frontend flow (by opening the `/magic-login?token=...` route in the browser) and confirm:
   - session is created
   - navigation to destination happens
   - `/apex-daily-numbers` loads without redirect loops

**Real click test**
- Open the email on mobile + desktop and confirm it lands in numbers entry.
- Confirm the fallback buttons function when token is expired/used.

### 7) Rollback / safety
If anything goes wrong, the changes are isolated:
- `/magic-login` remains a standalone route.
- We can revert to manual login easily.
- Tokens are time-limited and single-use; we will avoid burning tokens prematurely during verification.

## What I still need from you (only the minimum)
Because your last answers were understandably frustrated/unclear, I need one precise fact to avoid chasing ghosts:

- When you click the email link and it fails, what domain is in the address bar?
  - `apex-financial.org/...`
  - or an `id-preview--...lovable.app/...`
  - or something else

This single detail confirms whether we’re dealing with environment mismatch vs redirect allowlist vs in-app-browser behavior.

## What you’ll get after this
- Agents can tap the link and immediately log numbers.
- If they’re on weird email clients/in-app browsers, it still works because the session is created in-app via `verifyOtp`.
- If anything fails, they get a clear “send fresh link” option instead of being stuck.

