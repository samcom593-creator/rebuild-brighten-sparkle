
# Fix Remaining Console Errors and Route Conflict

## Issues Found

After a thorough review of the console logs and codebase, three specific issues remain:

### 1. Duplicate Route Definition (App.tsx)
Lines 130 and 132 both define `/dashboard/leads` -- the first renders `LeadCenter`, the second renders `DashboardApplicants`. React Router will always match the first one, making the second dead code. The "Legacy redirect" comment on line 131 is incorrect since it renders a full component, not a redirect.

**Fix**: Remove line 132 (the duplicate route). The LeadCenter component on line 130 is the intended destination.

### 2. forwardRef Warning on BulkLeadAssignment
The `BulkLeadAssignment` function component is rendered inside a Fragment alongside a `Dialog`. The Radix Dialog internally tries to pass a ref to the component, which fails because it's a plain function component.

**Fix**: Wrap the `BulkLeadAssignment` export with `React.forwardRef` so the Dialog ref forwarding works cleanly, eliminating the console warning.

### 3. forwardRef Warning on DropdownMenu in DashboardCommandCenter
Similar issue -- the `DropdownMenu` component on line 780 of DashboardCommandCenter is a Radix primitive that attempts ref forwarding to its children. The wrapping context triggers the warning.

**Fix**: This is actually caused by the same root issue as item 2 -- Radix components in the render tree attempting ref forwarding. Wrapping `BulkLeadAssignment` with forwardRef should resolve both warnings since they share the same component tree.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Remove the duplicate `/dashboard/leads` route on line 132 |
| `src/components/dashboard/BulkLeadAssignment.tsx` | Wrap component with `React.forwardRef` to fix ref warning |

## What Has Already Been Optimized

The following areas were confirmed as already optimized in previous iterations:

- Realtime event debouncing (800ms with random jitter)
- Fire-and-forget edge function calls for instant UI feedback
- Navigation guards clearing stuck overlays and pointer-events
- In-flight guards preventing refetch storms
- Query caching (120s staleTime) across all dashboard pages
- Lazy loading for all non-critical routes
- Singleton realtime channel for production updates
- AuthenticatedShell preventing sidebar re-mounts
- sessionStorage persistence on the Apply form
- ErrorBoundary for crash resilience
