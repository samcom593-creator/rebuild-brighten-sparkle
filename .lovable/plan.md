

# Stop Persistent Page Reloading (PWA Fix)

## Problem

The previous fix removed `skipWaiting` and `clientsClaim` from the workbox config, but the root cause remains: `registerType: "autoUpdate"` in the VitePWA plugin injects a virtual module that automatically calls `registration.update()` and reloads the page when a new service worker activates. Every time a new build deploys, the app still forces a refresh mid-session.

## Solution

Change the PWA registration from automatic to manual (prompt-based). This means updates download silently in the background but never force a reload. The existing guard in `main.tsx` already logs when an update is available -- this change simply ensures nothing else overrides that behavior.

## Changes

### File: `vite.config.ts`
- Change `registerType: "autoUpdate"` to `registerType: "prompt"`
- This tells vite-plugin-pwa to NOT auto-reload when a new service worker is found
- The service worker still gets registered and cached assets still work
- Updates will only apply on the next natural page load (closing and reopening the tab, or manual refresh)

### File: `src/main.tsx`
- No changes needed -- the existing service worker listener already handles update detection passively

## What stays the same
- All caching (offline support, API caching) works identically
- The manifest, icons, and install prompt are unchanged
- The app still works as a PWA on home screens
- Updates are still downloaded in the background -- they just won't interrupt the user

