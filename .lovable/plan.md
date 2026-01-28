

# Fix Plan: Published Site Showing Old Code (Cache Issue)

## What's Happening

I verified the codebase and **all the fixes are present in the code**:

| Fix | Status in Code |
|-----|----------------|
| Deal entry with separate input + "+ Add" button | ✅ Present |
| `type="text"` + `inputMode="decimal"` for mobile | ✅ Present |
| `stopPropagation()` + `preventDefault()` on Enter | ✅ Present |
| Form-level Enter key blocking | ✅ Present |
| "Admin View — testing purposes" banner | ✅ Removed (not found) |
| Loading screen says "Powered by Apex" | ✅ Present |

**The issue is that your published site is serving the old, cached version.** This is happening because:

1. The PWA Service Worker is caching the old JavaScript bundle
2. Users who visited the site before the fix are still seeing the old code
3. The published site URL needs to be updated with the new build

## The Fix

### Step 1: Re-publish the Site
Click the **"Publish"** button in Lovable to push the latest code to the published URL. This will create a new build with the correct code.

### Step 2: Force Cache Refresh for Users
After publishing, users on the old version need to refresh their cache. They can do this by:

**On iPhone/Safari:**
- Close Safari completely (swipe up to kill app)
- Go to Settings → Safari → Clear History and Website Data
- Re-open the site

**On Android/Chrome:**
- Open Chrome → tap the three dots menu → Settings
- Privacy and Security → Clear browsing data → Clear cache
- Re-open the site

**For PWA installed users:**
- Delete the app from their home screen
- Re-install it from the browser

### Step 3: Verify the Fix
After re-publishing, test the deal entry on the published site:
1. Go to Agent Portal or Numbers page
2. Type a multi-digit number (e.g., "30000")
3. Confirm it stays in the input field until you press "+ Add"
4. Confirm the admin banner is gone
5. Confirm loading screens say "Powered by Apex"

## Technical Details (for reference)

The current code structure is correct:

**BubbleDealEntry.tsx (lines 93-114):**
- Uses `type="text"` with `inputMode="decimal"` and `pattern="[0-9]*\.?[0-9]*"`
- Has inline `onKeyDown` with `e.stopPropagation()` and `e.preventDefault()` on Enter
- Separate input field + "+ Add" button design means typing doesn't auto-commit

**ALPCalculator.tsx (lines 167-189):**
- Same `type="text"` + `inputMode="decimal"` pattern
- Inline `onKeyDown` handler with proper event blocking
- "Active draft" pattern where last deal stays as input until explicitly committed

**CompactProductionEntry.tsx (lines 284-293):**
- Form-level `onKeyDown` handler blocks Enter on all inputs inside the form

**SkeletonLoader.tsx (lines 23-25):**
- Page variant displays "Powered by Apex" (correct text)

## Summary

No code changes are needed. The fix is to **re-publish the site** so the new bundle is deployed, then have users clear their cache or reinstall the PWA to get the updated code.

