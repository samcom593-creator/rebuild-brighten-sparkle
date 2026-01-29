
## Mobile Dashboard + Agent Portal + Numbers Page Fix Plan

### What's Still Happening

Based on my investigation:

1. **The code fixes have already been implemented** from the previous approved plan
2. **But they're not visible on the published site** because the PWA Service Worker is serving cached JavaScript bundles to users

Additionally, I found:

3. **4 active agents with non-"evaluated" stages** (2 in "onboarding", 2 in "in_field_training") - The code fix allows them access, but again, only if users get the new code

4. **Numbers.tsx has a subtle bug** - If a user is authenticated but has no agent record, the code sets `isAuthenticated = true` but leaves `agentId = null`, so the production entry shows but can't submit numbers

---

### Implementation

#### 1. Force PWA Update (Critical)

The primary fix is ensuring users get the new code. I'll add a service worker update prompt that forces a reload when new code is available.

**File:** `src/main.tsx`

Add a listener for service worker updates that shows a toast and reloads:

```typescript
// Register service worker with update handling
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // New version available - reload
            window.location.reload();
          }
        });
      });
    });
  });
}
```

**File:** `vite.config.ts`

Update PWA plugin to use `autoUpdate` behavior:

```typescript
VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    skipWaiting: true,
    clientsClaim: true,
  },
  // ...
})
```

#### 2. Fix Numbers.tsx Auth State (Quick Win)

**File:** `src/pages/Numbers.tsx`

If user is authenticated but has no agent record, show a helpful message instead of a broken state:

```typescript
// Lines 64-79: Update loadAgentData
if (agent) {
  setAgentId(agent.id);
  setAgentName(agent.profile?.full_name || "Agent");
  setIsAuthenticated(true);
} else {
  // User exists but no agent record - don't set isAuthenticated
  // This will show the "Account Not Linked" UI instead of broken entry form
  setAgentId(null);
  setIsAuthenticated(false);
}
```

Wait - actually looking at lines 77-78, it DOES set `isAuthenticated = true` even without an agent. This means authenticated users without agent records see a broken form. Fix this by only setting authenticated when there's an agent:

```typescript
if (!agent) {
  setLoading(false);
  // Don't set isAuthenticated - let them see login/error UI
  return;
}
```

#### 3. Add Cache-Busting Meta Tags

**File:** `index.html`

Add cache control headers to help prevent stale JS:

```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
```

---

### Files to Modify

| File | Change |
|------|--------|
| `vite.config.ts` | Enable PWA autoUpdate with skipWaiting |
| `src/main.tsx` | Add service worker update reload listener |
| `src/pages/Numbers.tsx` | Fix auth state when no agent record exists |
| `index.html` | Add cache-busting meta tags |

---

### Expected Results After Publishing

1. **Dashboard** - No more layout shift on mobile (margin-left fix already in code)
2. **Agent Portal** - Active agents can access regardless of onboarding stage (already in code)
3. **Numbers page** - Users without agent records see proper message instead of broken form
4. **PWA Updates** - Users automatically get new code instead of cached bundles

---

### Verification Steps

After publishing:
1. Open the published site on mobile
2. Clear browser cache OR wait for auto-update prompt
3. Verify dashboard loads without shifting
4. Test login on `/agent-portal` with an active agent email
5. Test `/numbers` page entry and submission

