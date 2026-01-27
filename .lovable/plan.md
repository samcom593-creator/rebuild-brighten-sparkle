

# Update Agent Portal Link & Dashboard Navigation

## Summary

This plan consolidates the login experience to use `/agent-portal` as the primary link for agents, adds "Agent Portal" to the manager/admin sidebar navigation, and ensures the forgot password flow is streamlined (email → reset → done).

---

## Official Link to Share

The **official link** you'll send via emails and iMessage group chats:

```
https://apex-financial.org/agent-portal
```

When agents tap this link:
1. If logged in → They land directly on the Agent Portal (ready to log numbers)
2. If not logged in → Redirected to `/agent-login` with a simple login flow

---

## Changes Required

### 1. Add "Agent Portal" to Sidebar Navigation

**File: `src/components/dashboard/DashboardLayout.tsx`**

Add an "Agent Portal" link for managers and admins in the sidebar navigation so they can quickly access it.

```typescript
// Add to navItems array (line 38-51)
import { BarChart3 } from "lucide-react"; // Add to imports

const navItems = useMemo(() => [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Users, label: "Applicants", href: "/dashboard/applicants" },
  ...(isAdmin || isManager ? [
    { icon: BarChart3, label: "Agent Portal", href: "/agent-portal" }, // NEW
    { icon: Briefcase, label: "CRM", href: "/dashboard/crm" },
    { icon: Archive, label: "Aged Leads", href: "/dashboard/aged-leads" },
  ] : []),
  // ... rest of items
], [isAdmin, isManager]);
```

### 2. Update Login Redirect Destination

**File: `src/pages/AgentNumbersLogin.tsx`**

Change the default redirect after login from `/apex-daily-numbers` to `/agent-portal`.

Lines to update:
- Line 71: `navigate("/agent-portal", { replace: true });`
- Line 141-142: Change default `from` to `/agent-portal`
- Line 176-177: Change default `from` to `/agent-portal`
- Line 210-211: Change default `from` to `/agent-portal`

```typescript
// Line 141-142 - existing user login redirect
const from = (location.state as any)?.from?.pathname || "/agent-portal";

// Line 176-177 - set password redirect
const from = (location.state as any)?.from?.pathname || "/agent-portal";

// Line 210-211 - create account redirect
const from = (location.state as any)?.from?.pathname || "/agent-portal";
```

### 3. Update Password Reset Redirect

**File: `supabase/functions/send-password-reset/index.ts`**

Change the redirect after password reset from `/apex-daily-numbers` to `/agent-portal`.

```typescript
// Line 57-58
options: {
  redirectTo: "https://apex-financial.org/agent-portal",
},
```

### 4. Update Magic Link Default Destination

**File: `src/pages/MagicLogin.tsx`**

The magic link already redirects to `/agent-portal` by default (line 57-58), so no changes needed here. Just confirming the flow:
- `destination === "numbers"` → goes to `/apex-daily-numbers`
- Otherwise → goes to `/agent-portal` ✓

### 5. Update Email Links to Use Agent Portal

**File: `supabase/functions/send-agent-portal-login/index.ts`**

The email already generates magic links that go to `/agent-portal`. No changes needed.

**File: `supabase/functions/send-bulk-portal-logins/index.ts`**

Same as above - already configured correctly.

### 6. Verify Forgot Password Flow is Simple

Current flow in `AgentNumbersLogin.tsx` (lines 221-243):
1. User enters email/phone → Continue
2. User clicks "Forgot password?" 
3. Email is sent with reset link
4. User clicks link → lands on password reset page
5. User enters new password → done

The flow is already simple! The `send-password-reset` edge function:
- Takes just the email
- Sends a branded reset email
- Link expires in 1 hour
- User clicks → sets new password → auto-logged in

---

## Summary of File Changes

| File | Action | What Changes |
|------|--------|--------------|
| `src/components/dashboard/DashboardLayout.tsx` | **Modify** | Add "Agent Portal" link to sidebar for managers/admins |
| `src/pages/AgentNumbersLogin.tsx` | **Modify** | Change default redirect from `/apex-daily-numbers` to `/agent-portal` |
| `supabase/functions/send-password-reset/index.ts` | **Modify** | Change password reset redirect to `/agent-portal` |

---

## Flow After Changes

### Agent Taps Link (https://apex-financial.org/agent-portal)

```
User taps link
     ↓
ProtectedRoute checks auth
     ↓
┌─────────────────┐     ┌──────────────────────────────┐
│ Already logged  │ YES │     Agent Portal Loads       │
│ in?             │────→│  (Leaderboard, Log Numbers)  │
└─────────────────┘     └──────────────────────────────┘
     │ NO
     ↓
┌──────────────────┐
│ /agent-login     │
│ - Enter email    │
│ - Enter password │
│ → Redirect to    │
│   /agent-portal  │
└──────────────────┘
```

### Forgot Password Flow

```
User on login page
     ↓
Clicks "Forgot password?"
     ↓
Edge function sends email
     ↓
User opens email, clicks link
     ↓
Supabase auth handles reset
     ↓
User sets new password
     ↓
Redirects to /agent-portal ✓
```

---

## Benefits

1. **Single Link** - `apex-financial.org/agent-portal` works for everything
2. **Sidebar Access** - Managers can quickly jump to the portal from any dashboard page
3. **Streamlined Password Reset** - Just email → reset → done (no extra questions)
4. **Better UX** - All paths lead to the Agent Portal with leaderboard + log numbers in one place

