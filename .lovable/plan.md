

# Standalone Quote Engine with Dedicated Sidebar

## Problem
The Quote Engine is currently rendered as a child page inside the `AuthenticatedShell` with the main dashboard `GlobalSidebar`. The user wants it to feel like its own standalone tool with a dedicated side navigation — separate from the main app sidebar — for a focused, fluid underwriting experience.

## Approach

### 1. Create a dedicated Quote Engine shell layout
Create `src/components/quote-engine/QuoteEngineShell.tsx` — a new authenticated layout wrapper (similar to `AuthenticatedShell`) with its own sidebar specifically for the Quote Engine. This sidebar will have:
- **Quote** — main quoting page (`/quote-engine`)
- **Saved Quotes** — quote history/logs (`/quote-engine/history`)
- **Admin** — carrier/product management (`/quote-engine/admin`, admin-only)
- **Back to Dashboard** link

The sidebar will be slim, clean, and focused — no clutter from the main dashboard nav.

### 2. Move Quote Engine routes outside `AuthenticatedShell`
Pull the quote engine routes out of the main `AuthenticatedShell` and wrap them with the new `QuoteEngineShell` instead:

```
<Route element={<QuoteEngineShell />}>
  <Route path="/quote-engine" element={<QuoteEngine />} />
  <Route path="/quote-engine/admin" element={<QuoteEngineAdmin />} />
  <Route path="/quote-engine/history" element={<QuoteHistory />} />
</Route>
```

### 3. Update GlobalSidebar link
Change the existing "Quote Engine" nav item in `GlobalSidebar.tsx` to point to `/quote-engine` instead of `/dashboard/quote-engine`.

### 4. Create Quote History page
Simple page (`src/pages/QuoteHistory.tsx`) showing `qe_quote_logs` for the current user — date, client summary, top result. Clicking opens the full quote detail.

### 5. Clean up QuoteEngine.tsx
- Remove the header back-link to dashboard (sidebar handles navigation)
- Remove the admin button from the header (sidebar handles it)
- Keep the page focused purely on the input form + results

## Files to create
- `src/components/quote-engine/QuoteEngineShell.tsx` — layout with dedicated sidebar + `<Outlet />`
- `src/components/quote-engine/QuoteEngineSidebar.tsx` — slim sidebar with QE-specific nav
- `src/pages/QuoteHistory.tsx` — quote log viewer

## Files to edit
- `src/App.tsx` — move QE routes to new shell, update paths
- `src/pages/QuoteEngine.tsx` — remove redundant header nav
- `src/pages/QuoteEngineAdmin.tsx` — remove back-link header (sidebar handles it)
- `src/components/layout/GlobalSidebar.tsx` — update href to `/quote-engine`

## Sidebar Design
The QE sidebar will be a clean, compact left nav with:
- Apex logo + "Quote Engine" branding at top
- Nav items with icons (Calculator for Quote, History for Saved, Shield for Admin)
- Collapse/expand toggle
- "← Dashboard" link at bottom
- Same glass styling as main sidebar for visual consistency

