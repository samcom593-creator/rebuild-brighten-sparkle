
# Fix Agent Portal Access - Magic Link Login

## The Problem

The emails are being sent and received (logs confirm 9 sent, 3+ opened). **The issue is what happens when agents click the link:**

1. Agent clicks "Access Your Portal" → Goes to `/agent-portal`
2. `/agent-portal` is protected by `ProtectedRoute`
3. No session exists → Redirected to `/login`
4. Agent sees the wrong login page and is stuck

## The Solution: One-Tap Magic Link

Replace the current email links with **magic links** that automatically sign the agent in when clicked. No password required on first access.

### How Magic Links Work

1. Generate a one-time token (OTT) tied to the agent's email
2. Store token in database with expiration (24 hours)
3. Email contains link: `https://apex-financial.org/magic-login?token=ABC123`
4. When clicked: validate token → create auth session → redirect to portal
5. Token is immediately invalidated after use

### Implementation

**1. New Database Table: `magic_login_tokens`**
```sql
CREATE TABLE magic_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours'),
  used_at TIMESTAMPTZ
);

CREATE INDEX idx_magic_token ON magic_login_tokens(token);
```

**2. New Edge Function: `generate-magic-link`**
- Creates a secure random token
- Stores in `magic_login_tokens`
- Returns the full magic link URL

**3. New Edge Function: `verify-magic-link`**
- Validates token exists and isn't expired/used
- Gets agent's email
- Signs them in via Supabase Auth (using `signInWithOtp` or admin API)
- Marks token as used
- Returns session or redirect

**4. New Page: `/magic-login`**
- Reads `?token=` from URL
- Calls `verify-magic-link` edge function
- On success: Automatically redirects to `/agent-portal`
- On failure: Shows error with link to manual login

**5. Update Email Templates**
- Replace `/agent-portal` links with magic link URLs
- Keep secondary "Log Numbers Now" button going to `/apex-daily-numbers`

### Updated Email Flow

| Button | Action |
|--------|--------|
| "Access Your Portal →" | Magic link → auto-login → `/agent-portal` |
| "Log Numbers Now →" | Magic link → auto-login → `/apex-daily-numbers` |

### Security Considerations

- Tokens are single-use (marked `used_at` after first use)
- 24-hour expiration
- Cryptographically random tokens (32 chars)
- If token is invalid/expired, fallback to password login

## Files to Create/Update

| File | Change |
|------|--------|
| Database | New `magic_login_tokens` table |
| `supabase/functions/generate-magic-link/index.ts` | NEW - Create magic tokens |
| `supabase/functions/verify-magic-link/index.ts` | NEW - Validate & sign in |
| `src/pages/MagicLogin.tsx` | NEW - Handle magic link arrival |
| `src/App.tsx` | Add `/magic-login` route |
| `supabase/functions/send-bulk-portal-logins/index.ts` | Use magic links |
| `supabase/functions/send-agent-portal-login/index.ts` | Use magic links |
| `supabase/config.toml` | Register new functions |

## New User Experience

**For any agent receiving the email:**
1. Opens email in inbox
2. Taps "Access Your Portal →"
3. **Instantly signed in** - lands on Agent Portal
4. Done. No password, no forms, no friction.

**Fallback if magic link expires:**
1. Taps expired link
2. Sees friendly message: "This link has expired"
3. Button: "Sign in with your email" → goes to `/agent-login`
4. Enters email → password flow as before

## Technical Details

**Token Generation (in edge function):**
```typescript
const token = crypto.randomUUID().replace(/-/g, '') + 
              crypto.randomUUID().replace(/-/g, '');
// 64-char hex string, cryptographically random
```

**Magic Link URL Format:**
```
https://apex-financial.org/magic-login?token=abc123...&dest=portal
```

**Supabase Auth Integration:**
Using `signInWithOtp` with `shouldCreateUser: false` or admin API to create session for existing user.
