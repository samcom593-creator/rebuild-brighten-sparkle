

# Fix Page Reloading Issue

## Root Cause

The PWA (Progressive Web App) configuration in `vite.config.ts` has two conflicting settings:

- `skipWaiting: true` -- tells new service workers to activate immediately
- `clientsClaim: true` -- tells the new worker to take control of all open tabs right away

Combined with `registerType: "autoUpdate"`, this causes the page to reload itself every time a new build is deployed, because the service worker immediately takes over and forces a refresh. The guard in `main.tsx` only logs a message but cannot prevent the reload since the workbox config overrides it.

## The Fix

**File: `vite.config.ts`** -- Remove `skipWaiting` and `clientsClaim` from the workbox configuration. This lets the service worker update passively: it installs in the background and only activates on the next natural page load (tab close/reopen, manual refresh), which is exactly what the `main.tsx` guard intends.

Changes:
- Remove `skipWaiting: true` (line 51)
- Remove `clientsClaim: true` (line 52)

The rest of the PWA config (caching, manifest, icons) stays the same. Updates will still be downloaded in the background but won't force a mid-session reload.

