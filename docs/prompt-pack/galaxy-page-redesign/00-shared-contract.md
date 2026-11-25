# Shared design, data and implementation contract

This guide describes the local Galaxy source. It is a set of bounded implementation prompts and code seams, not permission to send messages, initiate calls, submit real records or publish technical material. The committed starting point is `4e52c06771d3edfcfcb4271c30953f91524f2599`; the current local release includes style, finance, contracting, consolidation and private recording playback changes. The index and coverage receipt pin the refreshed checkout and source hashes. Production publication and runtime verification require their own receipts.

## How to use a page prompt

Open the route in [the complete index](README.md). Read its source and the imported data/permission helpers, then make the smallest change that achieves the page's stated purpose. A section shared by several routes lists all modes; keep their distinct params, query state and permissions. An alias has a destination-specific prompt instead of a duplicate page implementation.

Each page sample is an actual JSX expression from the named source snapshot. It is deliberately an **in-place example**: keep the original lexical scope, row mapping, variables, event handlers, imports and authorization branch. A `row` expression must remain inside its row map. A loading/error expression must retain its condition. These snippets are not standalone page modules and have not been represented as independently typechecked components. The coverage check verifies source provenance and TSX syntax; full application checks remain separate.

Use the concrete shared API examples below when changing layout. Do not append a second `PageHeader`, wrap a complete card in another card, or replace a working page with an incomplete excerpt. Public/token/auth routes retain their own lean shell. The homepage remains its existing one-screen `HeroSection`, with exactly two recruiting choices and the Agent Login utility.

## Visual priorities

Use the current authenticated `.galaxy-workspace` surface loaded by `SidebarLayout` and `src/styles/galaxy-workspace.css`. It supplies the shared typography/surface pass without forcing the authenticated shell into public funnels.

- Keep charcoal/black surfaces, red brand accents and bold italic headings. Use green for confirmed production/success, cyan for activity/information, amber for pace/waiting, and explicit words beside status colors.
- Real money figures can dominate financial dashboards. Show currency, ALP/premium basis, selected period, scope and paid-versus-estimated status beside them. Do not replace useful graphs with oversized unsupported numbers.
- Use `hsl(var(--chart-1))` through `hsl(var(--chart-5))` for existing charts and preserve actual axes, periods, denominators, negative values, zero values and missing values. No fake candles, arbitrary upward lines or decorative data requests.
- Keep regular labels and controls readable on a phone. Prefer 14px recurring labels, at least 12px secondary chart captions and 44px primary tap targets. Test a 332px viewport, large money strings, long names and light/dark modes.
- Keep one clear primary action. Put filters, selected periods and tabs in view controls, never behind an action overflow. Secondary mutations can use the existing secondary-action treatment.
- Use disclosure for optional explanations and diagnostics, not for required terms, active errors, permission messages or the source/period needed to understand a number.

## Existing primitives and their real APIs

| Primitive | Source | Supported API used here |
|---|---|---|
| `PageHeader` | `src/components/ui/page-header.tsx` | `title`, `subtitle`, `eyebrow`, `icon`, `tone`, `primaryAction`, `secondaryActions`, `viewControls`; legacy `actions` remains supported |
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | `src/components/ui/card.tsx` | Standard React HTML props and children; shared `galaxy-card`/heading classes |
| `GlassCard` | `src/components/ui/glass-card.tsx` | HTML props/children; `variant="default" | "strong" | "subtle"`, `hoverEffect` |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `src/components/ui/tabs.tsx` | Existing Radix controlled/uncontrolled tabs; preserve URL mode when the page currently uses one |
| `KPIStat` | `src/components/ui/kpi-stat.tsx` | Required `icon`, `label`, `value: string`, `detail`; optional `prominent`, `unit`, `accent`, `tone` |
| `GoalProgressRail` | `src/components/ui/kpi-stat.tsx` | `actual`, `target`, optional `paceFraction`, `label`; current implementation formats **ALP**, so use it only for ALP goals |
| `QueryState` / `describeQuery` | `src/components/ui/query-state.tsx` | Loading/error/empty/ready plus stale result and actual as-of time; `onRetry` remains explicit |
| `legacyRedirectTarget` | `src/lib/legacyRedirect.ts` | `(to, location, routeParams)`; encoded params, incoming query/hash, fixed target-query precedence |
| `PrivateAudioPlayer` | `src/components/calls/PrivateAudioPlayer.tsx` | `sourceKey`, `resolveSource`, optional `compact`, `playOnLoad`, `callId`, `moments`, `onTimeUpdate`; forwarded `PrivateAudioPlayerHandle.playFrom(seconds)` |

### Header with one action and visible filters

This is a pure layout component. The owning page passes its existing handlers and controls; no new query, schema or mutation is introduced.

```tsx
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export function WorklistHeader({
  title, subtitle, primaryAction, filters, onRefresh,
}: {
  title: string;
  subtitle: string;
  primaryAction: ReactNode;
  filters: ReactNode;
  onRefresh: () => void;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      primaryAction={primaryAction}
      secondaryActions={
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden className="h-4 w-4" /> Refresh
        </Button>
      }
      viewControls={filters}
    />
  );
}
```

### Large confirmed ALP without a missing-as-zero fallback

`alp`, `target`, `periodLabel` and `sourceDetail` below are **render props**, not proposed database columns. The owning page supplies its existing validated scope/period model. Do not call this for estimated commission, hires, streak days or a legacy premium measure. A presentation-hidden value hides the progress geometry too.

```tsx
import { DollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KPIStat, GoalProgressRail } from "@/components/ui/kpi-stat";

export function ConfirmedAlpPanel({
  alp, target, periodLabel, sourceDetail, presenting,
}: {
  alp: number | null;
  target: number | null;
  periodLabel: string;
  sourceDetail: string;
  presenting: boolean;
}) {
  const known = alp !== null && Number.isFinite(alp) && alp >= 0;
  const value = presenting ? "Hidden" : known
    ? new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD",
        minimumFractionDigits: Number.isInteger(alp) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(alp)
    : "Unavailable";

  return (
    <Card>
      <CardContent className="min-w-0 p-4 sm:p-6">
        <KPIStat
          icon={DollarSign}
          label={periodLabel}
          value={value}
          unit="ALP"
          detail={presenting ? "Presentation view" : sourceDetail}
          prominent
          accent
          tone="good"
        />
        {!presenting && known ? (
          <GoalProgressRail actual={alp} target={target} label="Saved ALP goal" />
        ) : null}
      </CardContent>
    </Card>
  );
}
```

An absent target stays unavailable in `GoalProgressRail`; do not invent a $20K target for a page that has no saved/fixed goal. Existing Target20k has its own fixed-goal contract. Keep local demo overrides visibly marked and scoped to the real account; never mutate production rows or the shared query cache to create a screenshot.

### Keep query truth at the component boundary

This wrapper accepts the existing query result and already-authorized children. It does not decide authorization or fetch a new table. Validate malformed responses in the query function before treating them as valid rows.

```tsx
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { QueryState, describeQuery } from "@/components/ui/query-state";

export function VerifiedListFrame({ query, label, children }: {
  query: UseQueryResult<unknown[], Error>;
  label: string;
  children: ReactNode;
}) {
  return (
    <QueryState
      {...describeQuery(query)}
      label={label}
      title="No matching records"
      asOf={query.dataUpdatedAt}
      onRetry={() => { void query.refetch(); }}
    >
      {children}
    </QueryState>
  );
}
```

Do not show a list-wide count as a full-agency total when the underlying query is paginated or capped. Preserve known caps such as gallery/history/triage windows. Failed refresh can retain the last confirmed rows with a stale label; first-load failure cannot masquerade as an empty list.

## Current private recording playback contract

The current local release routes the three recording families through exact-ID server signers. Each verifies the caller JWT, reads the existing authorization RPC with that same caller client, validates the complete returned identity/path receipt, and only then creates a service signer for one fixed bucket. Client input cannot choose a path, bucket, privacy variant or lifetime. All three declare `verify_jwt=true`, return `Cache-Control: no-store`, and issue 900-second links. This is source and focused-test evidence; it is not a claim that every deployed recording was played.

| Endpoint and request | Existing caller authorization | Fixed signing target | Response / unavailable behavior |
|---|---|---|---|
| `training-recording-url`, `{ recordingId }` | `training_recordings_list()`; exact text ID among the caller's published, privacy-filtered catalog | `training-recordings`, exact returned `audio_path` | `{ signedUrl, expiresInSeconds: 900 }`; absent/denied ID or malformed catalog never signs |
| `readymode-recording-url`, `{ callId }` | `call_audio_for({ p_call_ids: [internal UUID] })`; exactly one matching row | `readymode-audio`, server-selected `path` and `full`, `numbers_muted` or `client_data_removed` variant | `{ signedUrl, expiresInSeconds: 900, variant }`; a verified empty array yields `{ recording: null }`, without distinguishing unpublished from unauthorized copies |
| `lead-recording-url`, `{ recordingId }` | `lead_recordings_recent({ p_limit: 200 })`; exact authorized recording receipt | `call-recordings`, exact returned `callcenter/` path | `{ signedUrl, expiresInSeconds: 900 }`; absent/out-of-window/denied or malformed receipt never signs |

The shared path validator rejects literal and encoded traversal, escaped keys, absolute URLs, query/fragment characters and control characters. Literal `%` in an object key deliberately fails closed. The signers preserve existing RPC access rules and do not add table grants, public buckets or provider fallbacks. The ReadyMode signer preserves the RPC's existing copy selection; it does not independently add a transcript-redaction check.

The shared player scopes each instance to the real account and source, cleans up on account/source changes, and keeps an independent signed-URL key for duplicate instances. Window focus and reconnect do not replace a playing source. Expiry and a single automatic media-error renewal retain position; failed playback offers an explicit Play/Retry action. Restart resets position intentionally. A timestamp event is claimed once, and starting one recording pauses other recording players. Preserve these behaviors in any restyle; do not replace them with an unhandled `play()` call or unrestricted raw-provider link.

The lead review panel still lists newest **40** recordings; its server signer checks newest **200** authorized receipts to tolerate intervening uploads. This is a bounded review window, not a complete recording archive.

Two limitations remain explicit. MyLeads' `my_lead_detail` response has a provider recording URL but no stable internal call ID, so its external listen link is retained until that mapping is verified. The source also marks **ReadyMode: Review the Right Calls** and **Pipeline: Client to Posted Deal** as silent course clips; the explanation is currently in Read/Listen. A player reset cannot create a missing source audio track. Course-video and post-application onboarding behavior remain separate from call-recording playback.

Focused regression sources include `PrivateAudioPlayer.test.tsx`, `ClientCallHistory.test.tsx`, `CallPlaybackEntrypoints.test.tsx`, `trainingRecordingUrl.test.ts`, `readymodeRecordingUrl.test.ts` and the lead signer suite. Keep synthetic browser media checks separate from authenticated/live provider or stored-recording verification.

## Data, roles and actions that must survive

Keep the existing query/RPC/Edge contracts and server access rules. UI gates and sidebar visibility are not substitutes for RLS or server ownership checks. Resolve the real authenticated identity before privileged or personal data requests; role preview cannot grant access. Preserve account-scoped query keys, global cache reset behavior and pending-action view leases.

Preserve the semantic distinctions already present in the source:

| Fact | Must not be relabeled as |
|---|---|
| ALP / annual premium | Paid commission or guaranteed earnings |
| Direct / override / external estimated earnings | Cash already received |
| Recorded payment | Issued or active policy |
| Call disposition or imported book match | Carrier-confirmed active coverage |
| Course progress or self-report | State license or carrier appointment |
| MGN link opened / request delivered | Contract received or carrier approval |
| Planned content / approved draft | Provider-confirmed published post |
| Hires or streak days in plaque history | Premium dollars |
| Local demo override | Production record or earned outcome |

Use the existing secure audio/signing paths and recorder retries. Do not gate authorized private/muted playback only on raw provider access, disclose provider links to unauthorized roles, or log signed URLs. Keep all granted Sold Calls, Leads, Easy Resells, Training and Retention operations discoverable.

A redesign does not authorize messaging, campaigns, real imports, merges of agent identities, changes to compensation/grants, calendar invitations, provider submissions, secret rotation or publishing. Preserve those existing controls and test their behavior with synthetic/mocked evidence unless separately authorized.

## Consolidation procedure

1. Compare the exact source component, data window, roles, mutations, params/query mode and parent links.
2. A same-component, same-guard duplicate can use `LegacyWorkspaceRedirect` in App with the existing `legacyRedirectTarget` behavior. Keep the old URL; preserve query/hash/params.
3. A different data model or action set needs an explicit parity table first. Recruiting pipelines, licensing-student boards, provider progress, personal tasks, private owner tasks, client pipeline and policy-health views are not interchangeable by title.
4. Add the real contextual parent link before removing a primary shortcut. Keep Agent Duplicates, Strikes, carrier/import operations and granted call workflows until an equivalent authorized path is verified.
5. For a source filter, apply it to real rows and labels. The completed local Rewards merge lands at `/dashboard/my-plaques?source=reward`; a visual tab alone is not filtering.
6. Run focused behavioral and route-contract checks for the actual change. Update assertions to test the intended behavior rather than weakening them by dropping role, discovery or redirect coverage.

## Validation and receipt

Each page prompt lists its own acceptance criteria and existing tests located by source/name scan. Use actual pure view exports or synthetic component fixtures for browser layout checks; do not impersonate a live role or mutate real records to obtain a screenshot. Inspect 332px and desktop, light/dark, loading, first-load error, verified empty, stale refresh, account switch and denied access where relevant.

The guide coverage verifier checks every current `Route` declaration, all destination-specific aliases, anchors/files, exact source sample provenance, code-fence syntax and known shared API exports. This does **not** typecheck each in-place excerpt as a standalone module or exercise every signed-in page. Full app unit/type/build/CI and deployment receipts are separate. Record unresolved functional or authorization gaps explicitly rather than marking them complete through documentation.
