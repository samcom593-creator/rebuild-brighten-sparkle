# Compatibility and internal redirects

Each registered alias gets its own scoped prompt and executable redirect pattern. Keep the existing route placement and wrappers shown below. The sample uses the current `legacyRedirectTarget` contract: encode path parameters, retain incoming query/hash, let the target’s fixed query keys win, and navigate with `replace`. No duplicate page or fetch is needed.

## `/start-contracting` → `/dashboard/contracting-profile`
<a id="alias-2e9aa8cd06f3"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** public. **Wrappers:** QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting-profile" />}`.

```text
Keep /start-contracting as a compatibility redirect to /dashboard/contracting-profile; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /start-contracting with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample2e9aa8cd06f3() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting-profile", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/privacy-policy` → `/privacy`
<a id="alias-39ce28de9b50"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** public. **Wrappers:** QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/privacy" />}`.

```text
Keep /privacy-policy as a compatibility redirect to /privacy; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /privacy-policy with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample39ce28de9b50() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/privacy", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/terms-of-service` → `/terms`
<a id="alias-ad5beb9b14d3"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** public. **Wrappers:** QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/terms" />}`.

```text
Keep /terms-of-service as a compatibility redirect to /terms; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /terms-of-service with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplead5beb9b14d3() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/terms", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/seminar` → `/apply`
<a id="alias-bbdb425633f5"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** public. **Wrappers:** QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/apply" />}`.

```text
Keep /seminar as a compatibility redirect to /apply; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /seminar with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplebbdb425633f5() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/apply", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training` → `/dashboard/training`
<a id="alias-92352778cfb3"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training" />}`.

```text
Keep /dashboard/recruiting/training as a compatibility redirect to /dashboard/training; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample92352778cfb3() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/library` → `/dashboard/training/library`
<a id="alias-590ed03b8928"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/library" />}`.

```text
Keep /dashboard/recruiting/training/library as a compatibility redirect to /dashboard/training/library; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/library with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample590ed03b8928() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/library", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/library/course/:courseId` → `/dashboard/training/library/course/:courseId`
<a id="alias-b2f5a3efc57f"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/library/course/:courseId" />}`.

```text
Keep /dashboard/recruiting/training/library/course/:courseId as a compatibility redirect to /dashboard/training/library/course/:courseId; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/library/course/:courseId with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleb2f5a3efc57f() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/library/course/:courseId", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/sales-course` → `/dashboard/training/sales-course`
<a id="alias-7fa04b64acb6"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/sales-course" />}`.

```text
Keep /dashboard/recruiting/training/sales-course as a compatibility redirect to /dashboard/training/sales-course; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/sales-course with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample7fa04b64acb6() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/sales-course", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/progress` → `/dashboard/training/progress`
<a id="alias-d6676c6342e6"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/progress" />}`.

```text
Keep /dashboard/recruiting/training/progress as a compatibility redirect to /dashboard/training/progress; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/progress with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampled6676c6342e6() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/progress", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/content` → `/dashboard/training/content`
<a id="alias-65bf947ffe2c"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/content" />}`.

```text
Keep /dashboard/recruiting/training/content as a compatibility redirect to /dashboard/training/content; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/content with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample65bf947ffe2c() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/content", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting/training/annuities` → `/dashboard/training/annuities`
<a id="alias-5d440452a2f5"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/annuities" />}`.

```text
Keep /dashboard/recruiting/training/annuities as a compatibility redirect to /dashboard/training/annuities; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting/training/annuities with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample5d440452a2f5() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/annuities", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/content` → `/dashboard/launch-board?tab=queue`
<a id="alias-e8fa49830a11"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/launch-board?tab=queue" />}`.

```text
Keep /dashboard/content as a compatibility redirect to /dashboard/launch-board?tab=queue; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/content with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplee8fa49830a11() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/launch-board?tab=queue", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/downlines` → `/dashboard/grow`
<a id="alias-6ebb9a91a3c5"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/grow" /></ProtectedRoute>}`.

```text
Keep /dashboard/contracting/downlines as a compatibility redirect to /dashboard/grow; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/downlines with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample6ebb9a91a3c5() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/grow", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/contracts` → `/dashboard/contracting/documents`
<a id="alias-306d2295851e"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting/documents" />}`.

```text
Keep /dashboard/contracting/contracts as a compatibility redirect to /dashboard/contracting/documents; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/contracts with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample306d2295851e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting/documents", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/ops` → `/dashboard/contracting`
<a id="alias-8f3690dd7ad6"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting" />}`.

```text
Keep /dashboard/contracting/ops as a compatibility redirect to /dashboard/contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/ops with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample8f3690dd7ad6() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/requests` → `/dashboard/contracting`
<a id="alias-d69c24ab02ea"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin><LegacyWorkspaceRedirect to="/dashboard/contracting" /></ProtectedRoute>}`.

```text
Keep /dashboard/contracting/requests as a compatibility redirect to /dashboard/contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/requests with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampled69c24ab02ea() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/audit` → `/dashboard/contracting`
<a id="alias-bb26817bf57f"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting" />}`.

```text
Keep /dashboard/contracting/audit as a compatibility redirect to /dashboard/contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/audit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplebb26817bf57f() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/ethos` → `/dashboard/team?view=contracting`
<a id="alias-9490a41c2d94"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team?view=contracting" />}`.

```text
Keep /dashboard/contracting/ethos as a compatibility redirect to /dashboard/team?view=contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/ethos with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample9490a41c2d94() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team?view=contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/aflac` → `/dashboard/contracting`
<a id="alias-19247cc81660"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting" />}`.

```text
Keep /dashboard/contracting/aflac as a compatibility redirect to /dashboard/contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/aflac with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample19247cc81660() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracting/cases` → `/dashboard/team?view=contracting`
<a id="alias-4893ddec07c4"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team?view=contracting" />}`.

```text
Keep /dashboard/contracting/cases as a compatibility redirect to /dashboard/team?view=contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracting/cases with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample4893ddec07c4() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team?view=contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/resources` → `/dashboard/training/library`
<a id="alias-eff3a4698bd4"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/library" />}`.

```text
Keep /dashboard/resources as a compatibility redirect to /dashboard/training/library; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/resources with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleeff3a4698bd4() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/library", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/managers` → `/dashboard/team`
<a id="alias-f0d5dec164d9"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/managers as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/managers with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplef0d5dec164d9() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/billers` → `/dashboard/team`
<a id="alias-161a1a95a1b7"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/billers as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/billers with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample161a1a95a1b7() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/applicants` → `/dashboard/recruiting`
<a id="alias-f7818e7fe79e"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/recruiting" />}`.

```text
Keep /dashboard/applicants as a compatibility redirect to /dashboard/recruiting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/applicants with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplef7818e7fe79e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruiting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/admin/recruiting-inbox` → `/dashboard/admin`
<a id="alias-582e6d52b9ae"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /admin/recruiting-inbox as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /admin/recruiting-inbox with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample582e6d52b9ae() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/clients` → `/dashboard/agent-pipeline`
<a id="alias-16f85a28274b"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/agent-pipeline" />}`.

```text
Keep /dashboard/clients as a compatibility redirect to /dashboard/agent-pipeline; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/clients with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample16f85a28274b() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agent-pipeline", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/crm` → `/dashboard/team`
<a id="alias-031482bf9375"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/crm as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/crm with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample031482bf9375() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/command` → `/dashboard/admin`
<a id="alias-659bcc282658"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/command as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/command with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample659bcc282658() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/admin/licensed-inbox` → `/dashboard/recruiting/licensed`
<a id="alias-a2d8164d8d71"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/recruiting/licensed" />}`.

```text
Keep /admin/licensed-inbox as a compatibility redirect to /dashboard/recruiting/licensed; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /admin/licensed-inbox with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplea2d8164d8d71() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruiting/licensed", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/admin/apex-toolkit` → `/dashboard/training`
<a id="alias-edf14efbd269"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training" />}`.

```text
Keep /admin/apex-toolkit as a compatibility redirect to /dashboard/training; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /admin/apex-toolkit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleedf14efbd269() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/admin/producer-trends` → `/dashboard/producer-trends`
<a id="alias-194538945d3b"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin><LegacyWorkspaceRedirect to="/dashboard/producer-trends" /></ProtectedRoute>}`.

```text
Keep /admin/producer-trends as a compatibility redirect to /dashboard/producer-trends; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /admin/producer-trends with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample194538945d3b() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/producer-trends", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/admin/agentlink-backfill` → `/dashboard/book-of-business`
<a id="alias-c0e46c7278c0"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/book-of-business" />}`.

```text
Keep /admin/agentlink-backfill as a compatibility redirect to /dashboard/book-of-business; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /admin/agentlink-backfill with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplec0e46c7278c0() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/book-of-business", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/seminar-control` → `/dashboard/seminar`
<a id="alias-198414a73098"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin / manager / active_presenter. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin allowManagers allowPresenters><LegacyWorkspaceRedirect to="/dashboard/seminar" /></ProtectedRoute>}`.

```text
Keep /dashboard/seminar-control as a compatibility redirect to /dashboard/seminar; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/seminar-control with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample198414a73098() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/seminar", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/onboarding-course` → `/dashboard/training/sales-course`
<a id="alias-7198ca996f2a"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/sales-course" />}`.

```text
Keep /onboarding-course as a compatibility redirect to /dashboard/training/sales-course; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /onboarding-course with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample7198ca996f2a() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/sales-course", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/course-catalog` → `/dashboard/training/sales-course`
<a id="alias-253dc96b25d3"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/sales-course" />}`.

```text
Keep /course-catalog as a compatibility redirect to /dashboard/training/sales-course; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /course-catalog with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample253dc96b25d3() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/sales-course", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/training-hub` → `/dashboard/training/library`
<a id="alias-ef0e66f91332"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/library" />}`.

```text
Keep /dashboard/training-hub as a compatibility redirect to /dashboard/training/library; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/training-hub with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleef0e66f91332() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/library", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/training-hub/course/:courseId` → `/dashboard/training/library/course/:courseId`
<a id="alias-74ced05e6203"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/library/course/:courseId" />}`.

```text
Keep /dashboard/training-hub/course/:courseId as a compatibility redirect to /dashboard/training/library/course/:courseId; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/training-hub/course/:courseId with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample74ced05e6203() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/library/course/:courseId", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/course-progress` → `/dashboard/training/progress`
<a id="alias-1eed0298a19d"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/progress" />}`.

```text
Keep /course-progress as a compatibility redirect to /dashboard/training/progress; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /course-progress with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample1eed0298a19d() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/progress", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/course-progress/content` → `/dashboard/training/content`
<a id="alias-6f2d4695bc25"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/training/content" />}`.

```text
Keep /course-progress/content as a compatibility redirect to /dashboard/training/content; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /course-progress/content with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample6f2d4695bc25() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/content", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/leads` → `/dashboard/admin`
<a id="alias-84722035131a"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/leads as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/leads with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample84722035131a() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/contracts` → `/dashboard/contracting`
<a id="alias-eeeb77d999ec"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/contracting" />}`.

```text
Keep /dashboard/contracts as a compatibility redirect to /dashboard/contracting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/contracts with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleeeeb77d999ec() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/contracting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/recruit-pipeline` → `/dashboard/recruit-pipeline`
<a id="alias-cdd4d6e810f7"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/recruit-pipeline" /></ProtectedRoute>}`.

```text
Keep /recruit-pipeline as a compatibility redirect to /dashboard/recruit-pipeline; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /recruit-pipeline with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplecdd4d6e810f7() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruit-pipeline", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/agent-pipeline` → `/dashboard/agent-pipeline`
<a id="alias-bc4e8306bef4"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/agent-pipeline" />}`.

```text
Keep /agent-pipeline as a compatibility redirect to /dashboard/agent-pipeline; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /agent-pipeline with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplebc4e8306bef4() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agent-pipeline", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/client-pipeline` → `/dashboard/agent-pipeline`
<a id="alias-6517cb7c93ea"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/agent-pipeline" />}`.

```text
Keep /dashboard/client-pipeline as a compatibility redirect to /dashboard/agent-pipeline; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/client-pipeline with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample6517cb7c93ea() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agent-pipeline", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/inbound-leads` → `/dashboard/admin`
<a id="alias-b0113aaa8263"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/inbound-leads as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/inbound-leads with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleb0113aaa8263() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/inbound` → `/dashboard/admin`
<a id="alias-c950d2d3037e"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/inbound as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/inbound with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplec950d2d3037e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/headhunters-calendar` → `/dashboard/admin`
<a id="alias-8589cc47da7c"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/headhunters-calendar as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/headhunters-calendar with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample8589cc47da7c() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/interviews` → `/dashboard/calendar`
<a id="alias-401dfd491f40"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/calendar" />}`.

```text
Keep /dashboard/interviews as a compatibility redirect to /dashboard/calendar; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/interviews with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample401dfd491f40() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/calendar", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/interview-recovery` → `/dashboard/recruiting`
<a id="alias-8e3cc6d2abc0"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/recruiting" />}`.

```text
Keep /dashboard/interview-recovery as a compatibility redirect to /dashboard/recruiting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/interview-recovery with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample8e3cc6d2abc0() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruiting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/hierarchy` → `/dashboard/team`
<a id="alias-0343ee660224"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/hierarchy as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/hierarchy with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample0343ee660224() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/team-hierarchy` → `/dashboard/team`
<a id="alias-ada20028beca"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/team-hierarchy as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/team-hierarchy with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleada20028beca() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/business-analytics` → `/dashboard/analytics`
<a id="alias-5e7bfebddeaf"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/analytics" />}`.

```text
Keep /dashboard/business-analytics as a compatibility redirect to /dashboard/analytics; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/business-analytics with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample5e7bfebddeaf() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/analytics", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/carriers` → `/dashboard/book-of-business`
<a id="alias-1674623841cb"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/book-of-business" />}`.

```text
Keep /dashboard/carriers as a compatibility redirect to /dashboard/book-of-business; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/carriers with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample1674623841cb() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/book-of-business", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/announcements` → `/dashboard/community`
<a id="alias-1897cca9b6f9"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/community" />}`.

```text
Keep /dashboard/announcements as a compatibility redirect to /dashboard/community; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/announcements with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample1897cca9b6f9() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/community", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/annuity-training` → `/dashboard/training/annuities`
<a id="alias-e73bae54f167"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/training/annuities" /></ProtectedRoute>}`.

```text
Keep /dashboard/annuity-training as a compatibility redirect to /dashboard/training/annuities; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/annuity-training with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplee73bae54f167() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/training/annuities", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting-funnels` → `/dashboard/admin`
<a id="alias-68284a1a527e"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/recruiting-funnels as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting-funnels with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample68284a1a527e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruiting-tracker` → `/dashboard/admin`
<a id="alias-7134e8c0836b"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/recruiting-tracker as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruiting-tracker with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample7134e8c0836b() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/team-analytics` → `/dashboard/admin`
<a id="alias-7c8ad5abfe3b"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/admin" />}`.

```text
Keep /dashboard/team-analytics as a compatibility redirect to /dashboard/admin; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/team-analytics with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample7c8ad5abfe3b() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/admin", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/hall-of-fame` → `/dashboard/hall-of-fame`
<a id="alias-17f86b765690"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/hall-of-fame" />}`.

```text
Keep /hall-of-fame as a compatibility redirect to /dashboard/hall-of-fame; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /hall-of-fame with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample17f86b765690() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/hall-of-fame", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/instagram-inbox` → `/dashboard/inbox/instagram`
<a id="alias-11bd82d58555"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/inbox/instagram" />}`.

```text
Keep /dashboard/instagram-inbox as a compatibility redirect to /dashboard/inbox/instagram; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/instagram-inbox with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample11bd82d58555() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/inbox/instagram", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/today` → `/dashboard/today`
<a id="alias-19f66d97436b"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/today" />}`.

```text
Keep /today as a compatibility redirect to /dashboard/today; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /today with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample19f66d97436b() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/today", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/recruit` → `/dashboard/recruiting`
<a id="alias-2b720e147c00"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/recruiting" />}`.

```text
Keep /dashboard/recruit as a compatibility redirect to /dashboard/recruiting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/recruit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample2b720e147c00() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruiting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/recruit` → `/dashboard/recruiting`
<a id="alias-070a30dd49b3"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/recruiting" />}`.

```text
Keep /recruit as a compatibility redirect to /dashboard/recruiting; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /recruit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample070a30dd49b3() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/recruiting", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/team-chat` → `/dashboard/team-chat`
<a id="alias-ee53cde7253e"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/team-chat" /></ProtectedRoute>}`.

```text
Keep /team-chat as a compatibility redirect to /dashboard/team-chat; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /team-chat with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleee53cde7253e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team-chat", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/bulk-deals` → `/dashboard/bulk-deals`
<a id="alias-9526c919f31f"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin / manager. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin allowManagers><LegacyWorkspaceRedirect to="/dashboard/bulk-deals" /></ProtectedRoute>}`.

```text
Keep /bulk-deals as a compatibility redirect to /dashboard/bulk-deals; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /bulk-deals with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample9526c919f31f() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/bulk-deals", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/agent-link-sync` → `/dashboard/agentlink-sync`
<a id="alias-dbe06703d75f"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/agentlink-sync" />}`.

```text
Keep /dashboard/agent-link-sync as a compatibility redirect to /dashboard/agentlink-sync; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/agent-link-sync with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampledbe06703d75f() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agentlink-sync", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/agentlink-sync` → `/dashboard/agentlink-sync`
<a id="alias-c9a12a830762"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin><LegacyWorkspaceRedirect to="/dashboard/agentlink-sync" /></ProtectedRoute>}`.

```text
Keep /agentlink-sync as a compatibility redirect to /dashboard/agentlink-sync; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /agentlink-sync with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplec9a12a830762() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agentlink-sync", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/agents` → `/dashboard/team`
<a id="alias-d0b1f5a9bd5e"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/agents as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/agents with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampled0b1f5a9bd5e() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/agents/:id` → `/dashboard/agent/:id`
<a id="alias-b5e5665b0377"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/agent/:id" /></ProtectedRoute>}`.

```text
Keep /dashboard/agents/:id as a compatibility redirect to /dashboard/agent/:id; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/agents/:id with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleb5e5665b0377() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/agent/:id", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/leaderboard` → `/dashboard/leaderboard`
<a id="alias-898668814cfb"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/leaderboard" /></ProtectedRoute>}`.

```text
Keep /leaderboard as a compatibility redirect to /dashboard/leaderboard; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /leaderboard with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample898668814cfb() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/leaderboard", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/rewards` → `/dashboard/my-plaques?source=reward`
<a id="alias-628a298e44f6"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/my-plaques?source=reward" /></ProtectedRoute>}`.

```text
Keep /dashboard/rewards as a compatibility redirect to /dashboard/my-plaques?source=reward; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/rewards with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample628a298e44f6() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/my-plaques?source=reward", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/rewards` → `/dashboard/my-plaques?source=reward`
<a id="alias-25fa56c26632"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute><LegacyWorkspaceRedirect to="/dashboard/my-plaques?source=reward" /></ProtectedRoute>}`.

```text
Keep /rewards as a compatibility redirect to /dashboard/my-plaques?source=reward; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /rewards with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample25fa56c26632() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/my-plaques?source=reward", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/my-commissions` → `/dashboard/finances`
<a id="alias-6c9613e55f05"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/finances" />}`.

```text
Keep /dashboard/my-commissions as a compatibility redirect to /dashboard/finances; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/my-commissions with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample6c9613e55f05() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/finances", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/my-team` → `/dashboard/team`
<a id="alias-b56f69cdf329"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/team" />}`.

```text
Keep /dashboard/my-team as a compatibility redirect to /dashboard/team; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/my-team with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleb56f69cdf329() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/team", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/my-deals` → `/dashboard/production`
<a id="alias-517e90f1e5ac"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/production" />}`.

```text
Keep /dashboard/my-deals as a compatibility redirect to /dashboard/production; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/my-deals with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample517e90f1e5ac() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/production", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/charges-audit` → `/dashboard`
<a id="alias-81415d225a42"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard" />}`.

```text
Keep /dashboard/charges-audit as a compatibility redirect to /dashboard; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/charges-audit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample81415d225a42() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/admin/charges-audit` → `/dashboard`
<a id="alias-cd8014229719"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard" />}`.

```text
Keep /dashboard/admin/charges-audit as a compatibility redirect to /dashboard; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/admin/charges-audit with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExamplecd8014229719() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/conduct` → `/dashboard/strikes`
<a id="alias-0b9ad4e70ce1"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/strikes" />}`.

```text
Keep /dashboard/conduct as a compatibility redirect to /dashboard/strikes; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/conduct with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample0b9ad4e70ce1() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/strikes", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/lead-bundles` → `/dashboard/lead-manager`
<a id="alias-ed7d38eb51c9"></a>

**State:** Completed in the new local consolidation changes; production publication is a separate receipt.
**Existing access:** admin / manager. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<ProtectedRoute requireAdmin allowManagers><LegacyWorkspaceRedirect to="/dashboard/lead-manager" /></ProtectedRoute>}`.

```text
Keep /dashboard/lead-bundles as a compatibility redirect to /dashboard/lead-manager; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/lead-bundles with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampleed7d38eb51c9() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/lead-manager", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/ayro-book` → `/dashboard/book-of-business`
<a id="alias-5866f67f58e5"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/book-of-business" />}`.

```text
Keep /dashboard/ayro-book as a compatibility redirect to /dashboard/book-of-business; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/ayro-book with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample5866f67f58e5() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/book-of-business", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/dashboard/admin/book-quality` → `/dashboard/book-quality`
<a id="alias-dbc954ea496a"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** authenticated. **Wrappers:** AuthenticatedShell, QueryShell. **Exact route element:** `{<LegacyWorkspaceRedirect to="/dashboard/book-quality" />}`.

```text
Keep /dashboard/admin/book-quality as a compatibility redirect to /dashboard/book-quality; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /dashboard/admin/book-quality with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExampledbc954ea496a() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/dashboard/book-quality", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.

## `/log-numbers` → `/apex-daily-numbers`
<a id="alias-948648f5a3b4"></a>

**State:** Already implemented in the committed baseline; production publication is a separate receipt.
**Existing access:** public. **Wrappers:** public route. **Exact route element:** `{<LegacyWorkspaceRedirect to="/apex-daily-numbers" />}`.

```text
Keep /log-numbers as a compatibility redirect to /apex-daily-numbers; do not implement a second page.
Retain the existing route wrappers and role checks. Use legacyRedirectTarget with useParams/useLocation and replace navigation. Preserve valid query parameters and the incoming hash; fixed target query keys must override conflicts.
Verify the destination resolves in the current App route table, path parameters are encoded once, the redirect is one hop, and a bookmarked /log-numbers with unrelated campaign/filter query and #fragment survives. A denied visitor must not gain access through the alias.
Do not delete compatibility URLs, run a live mutation or claim a deployment from this source-only change.
```

```tsx
import { Navigate, useLocation, useParams } from "react-router-dom";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

export function RedirectExample948648f5a3b4() {
  const location = useLocation();
  const params = useParams();
  return (
    <Navigate
      to={legacyRedirectTarget("/apex-daily-numbers", location, params)}
      replace
      state={{ migratedFrom: location.pathname }}
    />
  );
}
```

**Validation:** use the existing `legacyRedirect.test.ts` / `appRoutingContract.test.ts` contracts and assert this exact source/destination pair, current guard, query/hash preservation and any dynamic parameter. For the reward aliases, `source=reward` must actually filter MyPlaques; for the contracting requests alias, retain the real admin wrapper.
