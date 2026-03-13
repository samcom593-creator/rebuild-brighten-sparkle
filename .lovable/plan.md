

# Move Quote Engine Inside Main Sidebar

## Problem
The Quote Engine currently renders in a separate `QuoteEngineShell` with its own sidebar, completely outside the main dashboard navigation. The user wants it to be a regular page inside the existing `AuthenticatedShell` with the `GlobalSidebar`, accessible to all authenticated roles.

## Changes

### 1. `src/App.tsx`
- Remove the standalone `<QuoteEngineShell />` route block
- Move all three Quote Engine routes (`/quote-engine`, `/quote-engine/admin`, `/quote-engine/history`) inside the `<AuthenticatedShell />` route group
- Remove the redirect routes for `/dashboard/quote-engine`

### 2. `src/components/layout/GlobalSidebar.tsx`
- Change the Quote Engine nav item from admin+manager only to visible for all authenticated users
- Keep the href as `/quote-engine`

### 3. `src/pages/QuoteEngineAdmin.tsx`
- Fix the redirect path from `/dashboard/quote-engine` to `/quote-engine`

No other files need changes. The `QuoteEngineSidebar.tsx` and `QuoteEngineShell.tsx` become unused but won't cause issues.

