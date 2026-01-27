

# Fix Apex Daily Numbers Link - Urgent

## Problem Summary

The `/apex-daily-numbers` route exists in the code but the published site hasn't been updated. People clicking the link are hitting a 404 or getting redirected to an unexpected page.

## Solution

### 1. Add Backward Compatibility Redirect

Add a redirect from the old `/log-numbers` URL to `/apex-daily-numbers` so any old links still work.

**File: `src/App.tsx`**
- Add: `<Route path="/log-numbers" element={<Navigate to="/apex-daily-numbers" replace />} />`
- Import `Navigate` from react-router-dom

### 2. Protect the Route (Login Required)

Wrap the `/apex-daily-numbers` route in `ProtectedRoute` so users must log in before submitting numbers.

**File: `src/App.tsx`**
- Change the route to use ProtectedRoute wrapper

### 3. Republish the Site

After these changes, the site needs to be **published** so the live site at apex-financial.org gets the new route.

---

## Technical Changes

| File | Change |
|------|--------|
| `src/App.tsx` | Import `Navigate`, wrap `/apex-daily-numbers` in ProtectedRoute, add redirect from `/log-numbers` |

---

## After Implementation

1. Changes will be applied to the preview
2. You need to **publish** the site for changes to go live
3. Share the full link: `https://apex-financial.org/apex-daily-numbers`
4. Users will need to log in before they can submit their numbers

