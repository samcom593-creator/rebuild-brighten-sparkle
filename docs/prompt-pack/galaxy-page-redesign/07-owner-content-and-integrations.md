# Owner systems, content and integrations

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Carrier command — `CarrierCommand`
<a id="page-carrier-command"></a>

**Decision:** Keep. **Source:** `src/pages/CarrierCommand.tsx` (406 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/carrier-command` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><CarrierCommand /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the owner’s carrier reconciliation and unmatched-writing-agent work prominent.

**Existing data/API calls:** rpc `carrier_command`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/dateUtils`.

**Baseline / current state:** Retained owner-only carrier reconciliation shortcut. No verified equivalent parent route/role flow replaces it; preserve carrier portal truth and reconciliation records.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CarrierCommand.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the owner’s carrier reconciliation and unmatched-writing-agent work prominent.
Decision: Keep. Routes: /dashboard/carrier-command.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Carrier discrepancy → Live policy evidence → Unmatched identity queue.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain carrier_command and owner gate. Carrier portal facts, local mirror facts and unmatched identities must remain distinct; do not claim everything reconciles on missing/error data.
Acceptance: Mismatch and unknown states remain visible; row totals use the same scoped source; no reconciliation or mutation is triggered by styling.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/CarrierCommand.tsx:178`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-5 text-sm text-muted-foreground">No carrier snapshot yet. The next scheduled pull will fill this in.</GlassCard>
```

**Page-specific validation**

- Mismatch and unknown states remain visible; row totals use the same scoped source; no reconciliation or mutation is triggered by styling.
- Verify the preserved source behavior: Retain carrier_command and owner gate. Carrier portal facts, local mirror facts and unmatched identities must remain distinct; do not claim everything reconciles on missing/error data.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Legacy command center — `DashboardCommandCenter`
<a id="page-dashboard-command-center"></a>

**Decision:** Internal. **Source:** `src/pages/DashboardCommandCenter.tsx` (1297 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>}` |
| `/dashboard/legacy` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><DashboardCommandCenter /></ProtectedRoute>}` |

**Observed behavior and source contract**

Retain specialist administrative operations while reducing duplicate dashboard entry points.

**Existing data/API calls:** invoke `get-active-managers`; from `agents`; rpc `get_agent_production_stats`; from `user_roles`; from `lead_payment_tracking`; from `profiles`; invoke `send-agent-portal-login`; invoke `generate-magic-link`; from `deals`

**Existing helpers/components:** `@/components/hires/HireStageControl`, `@/hooks/useAuth`, `@/components/admin/AgentProfileEditor`, `@/components/admin/QuickFilters`, `@/components/admin/RecognitionQueue`, `@/components/admin/DuplicateMergeTool`, `@/components/ErrorBoundary`, `@/components/dashboard/ProductionAnalyticsCard`, `@/components/admin/CourseProgressPanel`, `@/components/dashboard/StatCardPopup`, `@/components/dashboard/InviteTeamModal`, `@/components/dashboard/DeactivateAgentDialog`, `@/components/dashboard/TeamHierarchyManager`, `@/components/dashboard/AdminManagerInvites`.

**Baseline / current state:** Older admin operations surface remains the mobile Admin destination and Cmd+K entry. Inventory unique actions before retiring it.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardCommandCenter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Retain specialist administrative operations while reducing duplicate dashboard entry points.
Decision: Internal. Routes: /dashboard/admin, /dashboard/legacy.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Operational exception → Scoped roster/production → Explicit recovery/admin action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep existing real-admin checks, in-flight guard, portal/magic-link actions and financial status distinctions. /dashboard/admin and /dashboard/legacy share this source but should not become a broad new default home.
Acceptance: Error and access states remain; actions and hidden-card preferences are preserved; no generated login links or live sends during QA.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/DashboardCommandCenter.tsx:602`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Admin Access Required</h2>
            <p className="text-muted-foreground">This command center is only accessible to administrators.</p>
          </Card>
```

**Page-specific validation**

- Error and access states remain; actions and hidden-card preferences are preserved; no generated login links or live sends during QA.
- Verify the preserved source behavior: Keep existing real-admin checks, in-flight guard, portal/magic-link actions and financial status distinctions. /dashboard/admin and /dashboard/legacy share this source but should not become a broad new default home.
- Existing focused checks to inspect: `src/tests/components/CommandDashboardsCoherence.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Operating control — `ApexControl`
<a id="page-apex-control"></a>

**Decision:** Internal. **Source:** `src/pages/ApexControl.tsx` (432 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/apex-control` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><ApexControl /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep this internal operating-reference page concise and separate from business performance.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/lib/utils`, `@/components/admin/DemoModeCard`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApexControl.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this internal operating-reference page concise and separate from business performance.
Decision: Internal. Routes: /dashboard/apex-control.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current system lanes → Existing operating guidance → Relevant specialist links.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep DemoModeCard and internal guidance. Tool/assistant availability and release instructions in static copy are not proof that a provider actually ran or a deployment occurred.
Acceptance: Each linked workflow is real and authorized; local demo controls remain clearly marked; no fictitious automation status.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Surface` expression below is copied from `src/pages/ApexControl.tsx:338`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Surface key={lane.title}>
              <lane.icon className="h-5 w-5 text-emerald-300" />
              <h3 className="mt-3 text-base font-bold">{lane.title}</h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">{lane.state}</p>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{lane.goodFor}</p>
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">{lane.whenCapped}</p>
            </Surface>
```

**Page-specific validation**

- Each linked workflow is real and authorized; local demo controls remain clearly marked; no fictitious automation status.
- Verify the preserved source behavior: Keep DemoModeCard and internal guidance. Tool/assistant availability and release instructions in static copy are not proof that a provider actually ran or a deployment occurred.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Launch board — `LaunchBoard`
<a id="page-launch-board"></a>

**Decision:** Keep. **Source:** `src/pages/LaunchBoard.tsx` (1229 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/launch-board` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute, ContentAccessGate | `{<ProtectedRoute requireAdmin><SamOnlyRoute><ContentAccessGate><LaunchBoard /></ContentAccessGate></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the next content action clear across ideas, queue, planning and receipts.

**Existing data/API calls:** from `content_clips`; from `content_shares`; from `content_cards`; from `v_testimonial_classifier_health`

**Existing helpers/components:** `@/lib/externalHref`, `@/hooks/useConfirm`, `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/components/content/AccountsAnalytics`, `@/components/content/FilmNextPanel`, `@/components/content/FilmingPackSheet`, `@/components/content/WinnersPanel`, `@/components/content/LaunchBoardList`, `@/components/content/WeekPlan`, `@/lib/contentPicks`, `@/lib/contentProjects`, `@/lib/contentWinners`, `@/lib/contentWorkflow`.

**Baseline / current state:** Owner-gated content workflow now includes Social media approvals -> /dashboard/admin/social-media-bot, allowing that duplicate primary shortcut to be removed without removing approvals/manual publishing.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LaunchBoard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the next content action clear across ideas, queue, planning and receipts.
Decision: Keep. Routes: /dashboard/launch-board.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current lane and content card → Real asset/approval state → Explicit plan or confirmed published receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep usePosts/useInsights, content queue tab, share tokens and manual-confirmation rules. Copy/download is not publication, a planned time is not scheduled provider delivery, and published requires a live URL/evidence.
Acceptance: Owner access and query tabs work; Social media approvals stays discoverable; no auto-publish is introduced; failed writes remain actionable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `LaunchPlanner` expression below is copied from `src/pages/LaunchBoard.tsx:832`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<LaunchPlanner />
```

**Page-specific validation**

- Owner access and query tabs work; Social media approvals stays discoverable; no auto-publish is introduced; failed writes remain actionable.
- Verify the preserved source behavior: Keep usePosts/useInsights, content queue tab, share tokens and manual-confirmation rules. Copy/download is not publication, a planned time is not scheduled provider delivery, and published requires a live URL/evidence.
- Existing focused checks to inspect: `src/tests/lib/launchBoardPick.test.ts`, `src/tests/pages/LaunchBoard.test.tsx`, `src/tests/pages/launchBoardContract.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Money inbox — `MoneyInbox`
<a id="page-money-inbox"></a>

**Decision:** Keep. **Source:** `src/pages/MoneyInbox.tsx` (601 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/money-inbox` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><MoneyInbox /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep private conversations prioritized by real thread state and actionable context.

**Existing data/API calls:** from `money_inbox_threads`; from `money_inbox_sources`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/phone`, `@/lib/samOnly`, `@/lib/moneyInbox`, `@/lib/externalHref`.

**Baseline / current state:** Private money/opportunity inbox; preserve owner-only server access and direct daily discovery.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MoneyInbox.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep private conversations prioritized by real thread state and actionable context.
Decision: Keep. Routes: /dashboard/money-inbox.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Open thread queue → Channel/source state → Explicit reply composer.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain owner-only access, money_inbox_threads/sources and existing reply handler. Do not mix agency recruiting triage with personal conversations or manufacture a connected channel.
Acceptance: Account change hides prior messages; source errors and disconnected channels are explicit; reply sends only after the existing deliberate action.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ThreadCard` expression below is copied from `src/pages/MoneyInbox.tsx:579`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ThreadCard key={row.id} row={row} act={act} />
```

**Page-specific validation**

- Account change hides prior messages; source errors and disconnected channels are explicit; reply sends only after the existing deliberate action.
- Verify the preserved source behavior: Retain owner-only access, money_inbox_threads/sources and existing reply handler. Do not mix agency recruiting triage with personal conversations or manufacture a connected channel.
- Existing focused checks to inspect: `src/tests/pages/MoneyInbox.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Offers — `OffersPage`
<a id="page-offers-page"></a>

**Decision:** Internal. **Source:** `src/pages/OffersPage.tsx` (21 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/offers` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><OffersPage /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing offer directory as a clear catalog of real available choices.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/dashboard/OffersTiles`.

**Baseline / current state:** Admin catalog over OffersTiles; preserve real checkout behavior and do not promote stale literal SKU counts.

**Copy-ready implementation prompt**

```text
Work only on src/pages/OffersPage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing offer directory as a clear catalog of real available choices.
Decision: Internal. Routes: /dashboard/offers.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current offers → Terms/context → Existing destination.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain OffersTiles and underlying offer data/links. Do not invent prices, commissions, inventory or checkout endpoints.
Acceptance: Every tile opens its configured destination; unavailable data does not turn into a zero-price offer.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `OffersTiles` expression below is copied from `src/pages/OffersPage.tsx:17`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<OffersTiles />
```

**Page-specific validation**

- Every tile opens its configured destination; unavailable data does not turn into a zero-price offer.
- Verify the preserved source behavior: Retain OffersTiles and underlying offer data/links. Do not invent prices, commissions, inventory or checkout endpoints.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Social performance — `SocialDashboard`
<a id="page-social-dashboard"></a>

**Decision:** Keep. **Source:** `src/pages/SocialDashboard.tsx` (320 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/social` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><SocialDashboard /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show actual provider/manual snapshots and their age, with clean comparable trends.

**Existing data/API calls:** from `v_social_latest`; from `social_snapshots`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Historical platform growth graphs are distinct analytical evidence. Keep as brand report drilldown.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SocialDashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show actual provider/manual snapshots and their age, with clean comparable trends.
Decision: Keep. Routes: /dashboard/social.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected platform → Snapshot date and provenance → Existing metric trend.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_social_latest/social_snapshots. Manual snapshots and provider metrics are not interchangeable; a missing snapshot stays unavailable rather than showing zero growth.
Acceptance: Platform tabs keep their own periods/units; add-snapshot is explicit; charts never extrapolate unearned gains.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/SocialDashboard.tsx:99`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card className="bg-white dark:bg-card border-rose-500/30">
          <CardContent className="p-4 text-12 text-rose-700 dark:text-rose-300">
            <span className="font-semibold">Couldn't load social snapshots:</span>{" "}
            {(snapshots.error as any)?.message?.slice(0, 80) ?? "unknown error"}
          </CardContent>
        </Card>
```

**Page-specific validation**

- Platform tabs keep their own periods/units; add-snapshot is explicit; charts never extrapolate unearned gains.
- Verify the preserved source behavior: Retain v_social_latest/social_snapshots. Manual snapshots and provider metrics are not interchangeable; a missing snapshot stays unavailable rather than showing zero growth.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Automations — `AutomationHub`
<a id="page-automation-hub"></a>

**Decision:** Internal. **Source:** `src/pages/AutomationHub.tsx` (198 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/automation` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AutomationHub /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show configured automations and the explicit controls that already exist.

**Existing data/API calls:** from `automation_settings`; invoke `fnName`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useAuth`, `@/components/admin/CronJobsPanel`.

**Baseline / current state:** Operational automation controls and schedules; retain inside System, not a second daily hub.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AutomationHub.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show configured automations and the explicit controls that already exist.
Decision: Internal. Routes: /dashboard/automation.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Automation state → Last known evidence → Deliberate run/config action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain automation_settings and existing function mappings/roles. Enabled is not proof of recent successful execution; do not call functions while merely opening the page.
Acceptance: Unknown, disabled, failed and healthy states remain distinct; manual run waits for a real receipt.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Collapsible` expression below is copied from `src/pages/AutomationHub.tsx:108`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Collapsible open={cronOpen} onOpenChange={setCronOpen}>
          <div className="bg-card border border-border rounded-md">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-muted/30 rounded-md transition-colors">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm" style={{ fontFamily: "'Hanken Grotesk', sans-serif" }}>Cron Jobs</span>
                <span className="text-xs text-muted-foreground">— scheduled tasks running on the database</span>
              </div>
              <ChevronDown className={cn("h-4 w-4 transition-base", cronOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="p-4 pt-0">
              <CronJobsPanel />
            </CollapsibleContent>
          </div>
        </Collapsible>
```

**Page-specific validation**

- Unknown, disabled, failed and healthy states remain distinct; manual run waits for a real receipt.
- Verify the preserved source behavior: Retain automation_settings and existing function mappings/roles. Enabled is not proof of recent successful execution; do not call functions while merely opening the page.
- Existing focused checks to inspect: `src/tests/components/CommandDashboardsCoherence.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Integration access — `BotToken`
<a id="page-bot-token"></a>

**Decision:** Consolidate discovery under Integrations only after rotation/copy parity. **Source:** `src/pages/BotToken.tsx` (171 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/bot-token` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BotToken /></ProtectedRoute>}` |
| `/dashboard/bot-token` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BotToken /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep credential management an isolated explicit administrative task.

**Existing data/API calls:** from `system_settings`; rpc `admin_configure_integration`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BotToken.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep credential management an isolated explicit administrative task.
Decision: Consolidate discovery under Integrations only after rotation/copy parity. Routes: /bot-token, /dashboard/bot-token.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Credential availability → Deliberate copy → Confirmed rotation.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain admin_configure_integration and admin access. Never embed live tokens in documentation, screenshots or logs; rotation invalidates existing clients and must remain explicit.
Acceptance: Denied/missing/error states are distinct; copy feedback is accurate; no token generation or disclosure occurs on mount.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/BotToken.tsx:80`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6 max-w-md text-center">
          <p className="text-sm text-muted-foreground">Admin access required.</p>
        </GlassCard>
```

**Page-specific validation**

- Denied/missing/error states are distinct; copy feedback is accurate; no token generation or disclosure occurs on mount.
- Verify the preserved source behavior: Retain admin_configure_integration and admin access. Never embed live tokens in documentation, screenshots or logs; rotation invalidates existing clients and must remain explicit.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Instagram inbox — `InstagramInbox`
<a id="page-instagram-inbox"></a>

**Decision:** Keep. **Source:** `src/pages/InstagramInbox.tsx` (476 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/inbox/instagram` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><InstagramInbox /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep owner conversation triage and automation pause context clear.

**Existing data/API calls:** rpc `fn_ig_dashboard`; rpc `fn_ig_automation_pause_status`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useConfirm`, `@/components/recruiting/GrowScoreboard`, `@/lib/instagram`, `@/lib/phone`, `@/lib/celebrate`, `@/lib/utils`, `@/components/instagram/igActions`, `@/components/instagram/igCopy`, `@/components/instagram/igFormat`, `@/components/instagram/igRowLogic`, `@/components/instagram/igScore`, `@/components/instagram/IgCompose`, `@/components/instagram/IgHealthAlert`.

**Baseline / current state:** Owner-private DM queue. Do not expose it through a generic team social hub.

**Copy-ready implementation prompt**

```text
Work only on src/pages/InstagramInbox.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep owner conversation triage and automation pause context clear.
Decision: Keep. Routes: /dashboard/inbox/instagram.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Thread/next-action queue → Booking/contact context → Actual pause state.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain fn_ig_dashboard, fn_ig_automation_pause_status, owner gate and explicit existing actions. An automation pause indicator is not proof that every external provider is disconnected.
Acceptance: Failed dashboard/pause reads stay unknown; query filters and selected thread remain scoped; no message sent during layout changes.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `EmptyState` expression below is copied from `src/pages/InstagramInbox.tsx:306`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<EmptyState
          variant="warning"
          icon={<AlertTriangle className="h-7 w-7" />}
          title={EMPTY.couldntLoad}
          description={<>{EMPTY.couldntLoadHint}{(query.error as Error | null)?.message ? <span className="mt-1 block text-sm">{String((query.error as Error).message)}</span> : null}</>}
          actions={<Button className="h-11" onClick={() => query.refetch()}>{BUTTON.tryAgain}</Button>}
        />
```

**Page-specific validation**

- Failed dashboard/pause reads stay unknown; query filters and selected thread remain scoped; no message sent during layout changes.
- Verify the preserved source behavior: Retain fn_ig_dashboard, fn_ig_automation_pause_status, owner gate and explicit existing actions. An automation pause indicator is not proof that every external provider is disconnected.
- Existing focused checks to inspect: `src/tests/pages/InstagramInbox.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## History sync — `AgentLinkSync`
<a id="page-agent-link-sync"></a>

**Decision:** Internal. **Source:** `src/pages/AgentLinkSync.tsx` (231 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agentlink-sync` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AgentLinkSync /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep historical import health and its deliberate operator action separate from current carrier truth.

**Existing data/API calls:** from `agentlink_sync_log`; from `system_settings`; from `agents`; invoke `agentlink-cookie-sync`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentLinkSync.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep historical import health and its deliberate operator action separate from current carrier truth.
Decision: Internal. Routes: /dashboard/agentlink-sync.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Last sync receipt → Historical import scope → Explicit connection/sync controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain agentlink-cookie-sync, role gates and sync logs. Do not publish cookie values or present AgentLink mirror history as live carrier verification; duplicate URL may preserve context through a redirect.
Acceptance: Failed/stale logs remain visible; no sync or secret readback is triggered by styling or synthetic QA.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentLinkSync.tsx:143`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4 space-y-3">
        <div className="text-sm font-semibold">1 · Grab the cookie</div>
        <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
          <li>Open <a href="https://agentlink.insuracloud.ai/" target="_blank" rel="noopener noreferrer" className="text-primary underline">agentlink.insuracloud.ai</a> (signed in)</li>
          <li>DevTools (<span className="font-mono">⌘⌥I</span>/<span className="font-mono">F12</span>) → <b>Application</b> → <b>Cookies</b> → select all → copy</li>
          <li>Or: Network tab → any request → <i>Copy as cURL</i> → grab the <span className="font-mono">Cookie:</span> header</li>
        </ol>
      </GlassCard>
```

**Page-specific validation**

- Failed/stale logs remain visible; no sync or secret readback is triggered by styling or synthetic QA.
- Verify the preserved source behavior: Retain agentlink-cookie-sync, role gates and sync logs. Do not publish cookie values or present AgentLink mirror history as live carrier verification; duplicate URL may preserve context through a redirect.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## History vault — `AgentLinkVault`
<a id="page-agent-link-vault"></a>

**Decision:** Internal. **Source:** `src/pages/AgentLinkVault.tsx` (594 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agentlink-vault` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AgentLinkVault /></ProtectedRoute>}` |

**Observed behavior and source contract**

Preserve the forensic policy/client/contract history with clear provenance and feed errors.

**Existing data/API calls:** from `v_agentlink_book_scoped`; from `agentlink_clients`; from `agentlink_contracts`; from `agentlink_agents`; from `carriers`; from `v_agentlink_book_truth`; from `agentlink_raw_exports`; from `agentlink_binary_docs`; from `atob(b64)`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentLinkVault.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Preserve the forensic policy/client/contract history with clear provenance and feed errors.
Decision: Internal. Routes: /dashboard/agentlink-vault.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected historical dataset → Source/freshness → Record detail/export.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain scoped book truth, raw export/document handling and current auth gates. Live-book, excluded/dead and mirrored records remain separate; do not replace a feed failure with an empty table.
Acceptance: Every tab keeps its current scope and error panel; raw/document access remains authorized and no credential data is copied into examples.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `VaultFeedError` expression below is copied from `src/pages/AgentLinkVault.tsx:389`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<VaultFeedError label="Contracts" onRetry={() => refetch()} />
```

**Page-specific validation**

- Every tab keeps its current scope and error panel; raw/document access remains authorized and no credential data is copied into examples.
- Verify the preserved source behavior: Retain scoped book truth, raw export/document handling and current auth gates. Live-book, excluded/dead and mirrored records remain separate; do not replace a feed failure with an empty table.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Integration setup — `Setup`
<a id="page-setup"></a>

**Decision:** Consolidate conditionally under Integrations/System after control parity. **Source:** `src/pages/admin/Setup.tsx` (221 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/setup` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><Setup /></ProtectedRoute>}` |
| `/dashboard/setup` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><Setup /></ProtectedRoute>}` |

**Observed behavior and source contract**

Reduce duplicated setup navigation only after the current configuration and repair controls have an exact home.

**Existing data/API calls:** from `system_settings`; from `agentlink_sync_log`; from `commission_ledger`; rpc `count_unscheduled_agents`; from `agents`; from `agent_carrier_comp`; from `deals`; from `job_runs`; from `agentlink_alerts`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/Setup.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Reduce duplicated setup navigation only after the current configuration and repair controls have an exact home.
Decision: Consolidate conditionally under Integrations/System after control parity. Routes: /setup, /dashboard/setup.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Integration configuration state → Existing health evidence → Explicit setup/repair action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep current system settings, sync logs and operational repair behavior. Secrets must remain out of prompts/logs, and a configuration value is not proof of working delivery.
Acceptance: Each moved control keeps role and confirmation; failed save/run is not healthy; no live reset/sync/send during redesign.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/admin/Setup.tsx:154`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6 text-center">
          <Shield className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm">Admins only.</p>
        </GlassCard>
```

**Page-specific validation**

- Each moved control keeps role and confirmation; failed save/run is not healthy; no live reset/sync/send during redesign.
- Verify the preserved source behavior: Keep current system settings, sync logs and operational repair behavior. Secrets must remain out of prompts/logs, and a configuration value is not proof of working delivery.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Automation health — `AutomationHealth`
<a id="page-automation-health"></a>

**Decision:** Internal. **Source:** `src/pages/AutomationHealth.tsx` (431 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/automation-health` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AutomationHealth /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make broken, stale and never-run jobs immediately distinguishable.

**Existing data/API calls:** rpc `get_cron_jobs_with_status`; from `automation_run_log`; invoke `meta.fn`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Cron/job diagnostics; preserve actual run/error history and owner access.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AutomationHealth.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make broken, stale and never-run jobs immediately distinguishable.
Decision: Internal. Routes: /dashboard/automation-health.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Broken/stale jobs → Last run evidence → Explicit authorized retry.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain get_cron_jobs_with_status, automation_run_log and function mappings. A scheduled job is not a successful execution; preserve never-run state.
Acceptance: Healthy status requires the existing evidence rule; manual retry never runs on mount; logs and failure details remain readable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AutomationHealth.tsx:396`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the automation run log" error={runsErr} onRetry={() => void refetchRuns()} />
```

**Page-specific validation**

- Healthy status requires the existing evidence rule; manual retry never runs on mount; logs and failure details remain readable.
- Verify the preserved source behavior: Retain get_cron_jobs_with_status, automation_run_log and function mappings. A scheduled job is not a successful execution; preserve never-run state.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Instagram subscriptions — `InstagramAutomation`
<a id="page-instagram-automation"></a>

**Decision:** Keep. **Source:** `src/pages/InstagramAutomation.tsx` (218 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/instagram-automation` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><InstagramAutomation /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep actual agent subscription status and authorized controls clear.

**Existing data/API calls:** from `instagram_subscriptions`; from `agents`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/InstagramAutomation.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep actual agent subscription status and authorized controls clear.
Decision: Keep. Routes: /dashboard/instagram-automation.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Subscription roster → Active/paused state → Explicit change.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain instagram_subscriptions and current auth/agent checks. Subscription status does not prove paid revenue or external automation execution.
Acceptance: Failed status update remains unchanged/error; totals reconcile selected rows; no account can change another subscription without existing authorization.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/InstagramAutomation.tsx:160`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="space-y-3 p-6" role="alert">
            <p className="font-medium">Subscriptions could not be loaded</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button type="button" variant="outline" onClick={() => void fetchSubscriptions()}>Retry subscriptions</Button>
          </GlassCard>
```

**Page-specific validation**

- Failed status update remains unchanged/error; totals reconcile selected rows; no account can change another subscription without existing authorization.
- Verify the preserved source behavior: Retain instagram_subscriptions and current auth/agent checks. Subscription status does not prove paid revenue or external automation execution.
- Existing focused checks to inspect: `src/tests/pages/InstagramAutomation.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## System health — `SystemHealth`
<a id="page-system-health"></a>

**Decision:** Keep. **Source:** `src/pages/SystemHealth.tsx` (511 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/system-health` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><SystemHealth /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Prioritize verified data-quality exceptions and actual check receipts.

**Existing data/API calls:** from `system_health_logs`; from `v_data_quality_dashboard`; invoke `system-health-check`

**Existing helpers/components:** `@/components/system/OwnerSystemPanel`, `@/hooks/useAuth`, `@/lib/samOnly`, `@/lib/utils`, `@/components/system-health/ObservabilityPanels`.

**Baseline / current state:** Monitoring and owner integrations/subscriptions are useful. Keep a single System primary entry; specialist tools remain contextual.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SystemHealth.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Prioritize verified data-quality exceptions and actual check receipts.
Decision: Keep. Routes: /dashboard/system-health.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current defects → Evidence and owning workflow → Explicit check/refresh.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain owner gating, system_health_logs and v_data_quality_dashboard. Auto-fixed is a logged outcome, not a visual badge to infer; failures must not read as everything healthy.
Acceptance: Unreachable feeds stay unknown; run-check waits for real receipt; diagnostic links retain access and no hidden repair occurs.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `OwnerSystemPanel` expression below is copied from `src/pages/SystemHealth.tsx:229`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<OwnerSystemPanel />
```

**Page-specific validation**

- Unreachable feeds stay unknown; run-check waits for real receipt; diagnostic links retain access and no hidden repair occurs.
- Verify the preserved source behavior: Retain owner gating, system_health_logs and v_data_quality_dashboard. Auto-fixed is a logged outcome, not a visual badge to infer; failures must not read as everything healthy.
- Existing focused checks to inspect: `src/tests/components/CommandDashboardsCoherence.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Email delivery — `EmailDeliveryLog`
<a id="page-email-delivery-log"></a>

**Decision:** Internal. **Source:** `src/pages/EmailDeliveryLog.tsx` (367 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/email-log` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><EmailDeliveryLog /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make queued, sent, delivered, bounced and failed events distinguishable with relevant recovery.

**Existing data/API calls:** from `email_delivery_log`; from `plaque_awards`; invoke `send-plaque-recognition`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/EmailDeliveryLog.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make queued, sent, delivered, bounced and failed events distinguishable with relevant recovery.
Decision: Internal. Routes: /dashboard/email-log.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Delivery status → Recipient/award context → Explicit permitted retry.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain email_delivery_log and send-plaque-recognition rules. Sent is not delivered; a retry is an actual external send requiring deliberate existing action.
Acceptance: Filters/counts match statuses; missing provider receipts stay unknown; no send on refresh or render.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/EmailDeliveryLog.tsx:284`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No email logs match this filter.
          </CardContent>
        </Card>
```

**Page-specific validation**

- Filters/counts match statuses; missing provider receipts stay unknown; no send on refresh or render.
- Verify the preserved source behavior: Retain email_delivery_log and send-plaque-recognition rules. Sent is not delivered; a retry is an actual external send requiring deliberate existing action.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Compensation tiers — `CompTiersSettings`
<a id="page-comp-tiers-settings"></a>

**Decision:** Internal. **Source:** `src/pages/admin/CompTiersSettings.tsx` (149 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/comp-tiers` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CompTiersSettings /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the actual agent tier and authorized change easy to review.

**Existing data/API calls:** from `v_agents_full`; from `user_roles`; from `agents`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/CompTiersSettings.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the actual agent tier and authorized change easy to review.
Decision: Internal. Routes: /dashboard/comp-tiers.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Agent and current tier → Existing percentage → Explicit change result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_agents_full, roles and agents update contract. Do not confuse contract level, advance rate, override spread and cash paid, or introduce an unverified schedule.
Acceptance: Only authorized edits appear; invalid percentages are rejected; failed update is not reflected as saved.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/admin/CompTiersSettings.tsx:96`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="comp tiers" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Only authorized edits appear; invalid percentages are rejected; failed update is not reflected as saved.
- Verify the preserved source behavior: Retain v_agents_full, roles and agents update contract. Do not confuse contract level, advance rate, override spread and cash paid, or introduce an unverified schedule.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Integrations — `IntegrationsSettings`
<a id="page-integrations-settings"></a>

**Decision:** Internal. **Source:** `src/pages/admin/IntegrationsSettings.tsx` (644 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/integrations` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><IntegrationsSettings /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make configured integrations, credential state and deliberate tests clear without a generic tool dump.

**Existing data/API calls:** from `system_settings`; rpc `admin_configure_integration`; invoke `discord-webhook-notify`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/IntegrationsSettings.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make configured integrations, credential state and deliberate tests clear without a generic tool dump.
Decision: Internal. Routes: /dashboard/integrations.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Connection/configuration state → Explicit safe copy/edit → Existing test action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain admin_configure_integration and integration-specific handlers. Never include live tokens/webhooks in guide examples, screenshots or logs; a saved secret is not proof of a successful connection.
Acceptance: Denied/read/save/test failures remain separate; rotation/test actions are never automatic; migrated setup controls retain all protections.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/admin/IntegrationsSettings.tsx:538`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState
              compact
              status="error"
              label="the Discord webhook"
              error={webhookError}
              onRetry={() => void refetch()}
            />
```

**Page-specific validation**

- Denied/read/save/test failures remain separate; rotation/test actions are never automatic; migrated setup controls retain all protections.
- Verify the preserved source behavior: Retain admin_configure_integration and integration-specific handlers. Never include live tokens/webhooks in guide examples, screenshots or logs; a saved secret is not proof of a successful connection.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Content workspace — `ContentWheel`
<a id="page-content-wheel"></a>

**Decision:** Keep. **Source:** `src/pages/ContentWheel.tsx` (65 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/contentwheel` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><ContentWheel /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the query-selected creative modules discoverable without duplicating Launch Board publishing controls.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/contentwheel/ContentWheelSubNav`, `@/components/contentwheel/DashboardModule`, `@/components/contentwheel/IdeationRolodexModule`, `@/components/contentwheel/HookLabModule`, `@/components/contentwheel/modules`.

**Baseline / current state:** Existing ideation/hook modules use live schema; already reached from Content Command. Keep working modules only.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ContentWheel.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the query-selected creative modules discoverable without duplicating Launch Board publishing controls.
Decision: Keep. Routes: /admin/contentwheel.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected module → Idea/hook evidence → Existing workflow handoff.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain ContentWheelSubNav and module selection. Ideation, hook work and publishing receipts are different workflows; no generated draft should appear already published.
Acceptance: Deep-linked modules preserve query; each module remains usable at mobile width; any future merge needs module/action parity.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ContentWheelSubNav` expression below is copied from `src/pages/ContentWheel.tsx:49`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ContentWheelSubNav active={active} onSelect={selectModule} />
```

**Page-specific validation**

- Deep-linked modules preserve query; each module remains usable at mobile width; any future merge needs module/action parity.
- Verify the preserved source behavior: Retain ContentWheelSubNav and module selection. Ideation, hook work and publishing receipts are different workflows; no generated draft should appear already published.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Content operations — `ContentCommand`
<a id="page-content-command"></a>

**Decision:** Consolidate conditionally under Launch Board after draft/source-health parity. **Source:** `src/pages/admin/ContentCommand.tsx` (944 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/content-command` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><ContentCommand /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep drafting/source-health work contextual to Launch Board while preserving its actual operations.

**Existing data/API calls:** from `v_culture_feed`; from `social_bot_drafts`; from `v_smb_cw_bridge`; from `social_bot_runs`; from `social_bot_inbound`; from `cw_ideas`; from `cw_hooks`; from `cw_demand_mines`; from `cw_outliers`; from `cw_posts`

**Existing helpers/components:** `@/lib/utils`.

**Baseline / current state:** Overlapping legacy content queue/ideation; map approval states and unique research before retirement.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/ContentCommand.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep drafting/source-health work contextual to Launch Board while preserving its actual operations.
Decision: Consolidate conditionally under Launch Board after draft/source-health parity. Routes: /dashboard/admin/content-command.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Next post recommendation → Draft stage → Source/bridge health.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain social_bot_drafts, culture/ContentWheel bridge and source records. A recommendation or approved draft is not a posted item; do not merge by deleting provenance.
Acceptance: Draft transitions and source failures stay explicit; exact actions must exist in Launch Board before replacing this route.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/admin/ContentCommand.tsx:767`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
      <CardContent className="p-4">
        <div className={cn("text-3xl font-bold tabular-nums", tone)}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
```

**Page-specific validation**

- Draft transitions and source failures stay explicit; exact actions must exist in Launch Board before replacing this route.
- Verify the preserved source behavior: Retain social_bot_drafts, culture/ContentWheel bridge and source records. A recommendation or approved draft is not a posted item; do not merge by deleting provenance.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Social command — `SocialCommandCenter`
<a id="page-social-command-center"></a>

**Decision:** Keep. **Source:** `src/pages/SocialCommandCenter.tsx` (507 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/social-command` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><SocialCommandCenter /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep cross-channel operating lanes and call-list handoffs focused on real work.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useSoundEffects`, `@/hooks/useSoldCallKeys`, `@/components/recruiting/GrowScoreboard`, `@/lib/celebrate`, `@/lib/dateUtils`, `@/lib/tones`, `@/lib/utils`, `@/lib/socialCommand`.

**Baseline / current state:** Granted team social inbox/lane monitoring differs from owner content. Preserve its direct grant-gated access.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SocialCommandCenter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep cross-channel operating lanes and call-list handoffs focused on real work.
Decision: Keep. Routes: /dashboard/social-command.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Lane health → Open buckets/call lists → Platform trend.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain existing command-center data helpers and granted-call permission hook. Do not broaden call access or turn message volume into revenue.
Acceptance: Bucket totals match rows; failed lane data stays unavailable; access differences are preserved through parent links.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GrowScoreboard` expression below is copied from `src/pages/SocialCommandCenter.tsx:114`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GrowScoreboard
        label="Message numbers"
        className="mb-3"
        notice={q.isError ? (
          <>
            <span className="text-destructive">The command center did not load, so the numbers are hidden rather than shown as 0.</span>
            <Button variant="outline" className="h-11 shrink-0" onClick={() => void q.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Try again
            </Button>
          </>
        ) : q.isLoading ? (
          <span>Loading the messages. Each number shows a dash until it arrives.</span>
        ) : null}
        tiles={TILE_BUCKETS.map(({ bucket: b, icon }) => ({
          label: BUCKET_LABEL[b],
          value: unknown ? null : counts[b],
          hint: BUCKET_HINT[b],
          onSelect: () => pickBucket(b),
          active: bucket === b,
          emphasis: b === "hot",
          tone: inboxBucketTone(b),
          icon,
        }))}
      />
```

**Page-specific validation**

- Bucket totals match rows; failed lane data stays unavailable; access differences are preserved through parent links.
- Verify the preserved source behavior: Retain existing command-center data helpers and granted-call permission hook. Do not broaden call access or turn message volume into revenue.
- Existing focused checks to inspect: `src/tests/pages/SocialCommandCenter.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Dialer integration — `ReadyModeIntegration`
<a id="page-ready-mode-integration"></a>

**Decision:** Internal. **Source:** `src/pages/ReadyModeIntegration.tsx` (740 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/readymode` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><ReadyModeIntegration /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make dialer ingestion health and unresolved mapping work clear for administrators.

**Existing data/API calls:** from `system_settings`; from `v_readymode_today`; from `v_readymode_agent_today`; from `readymode_dialer_calls`; from `readymode_sync_log`; from `v_readymode_ingest_health`; from `v_dormant_dialer_seats`; from `v_strike_summary`; invoke `readymode-sync`

**Existing helpers/components:** `@/lib/looseSupabase`, `@/hooks/usePageTitle`, `@/components/calls/CallAudioPlayer`.

**Baseline / current state:** Current local release replaces the raw-provider Listen link with CallAudioPlayer using the internal call ID even when recording_url is absent. The shared player resolves its authorized copy through readymode-recording-url.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ReadyModeIntegration.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make dialer ingestion health and unresolved mapping work clear for administrators.
Decision: Internal. Routes: /dashboard/readymode.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Ingest freshness → Calls/seats and mapping gaps → Explicit sync or credential control.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain all ReadyMode source views, logs and readymode-sync. Recorded calls, sold-call evidence and issued policies are distinct. CallAudioPlayer uses the internal c.id and readymode-recording-url; a missing raw recording_url must not hide an authorized private copy. Never log credentials or signed media URLs.
Acceptance: Missing credentials, failed sync and stale ingest are not healthy; missing provider URL still offers the internal-ID player; rejected/no-copy/expired media stays explicit; no real call or sync is initiated by redesign.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CallAudioPlayer` expression below is copied from `src/pages/ReadyModeIntegration.tsx:644`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CallAudioPlayer callId={c.id} compact />
```

**Page-specific validation**

- Missing credentials, failed sync and stale ingest are not healthy; missing provider URL still offers the internal-ID player; rejected/no-copy/expired media stays explicit; no real call or sync is initiated by redesign.
- Verify the preserved source behavior: Retain all ReadyMode source views, logs and readymode-sync. Recorded calls, sold-call evidence and issued policies are distinct. CallAudioPlayer uses the internal c.id and readymode-recording-url; a missing raw recording_url must not hide an authorized private copy. Never log credentials or signed media URLs.
- Existing focused checks to inspect: `src/tests/components/CallPlaybackEntrypoints.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Performance goals — `PerformanceBot`
<a id="page-performance-bot"></a>

**Decision:** Keep. **Source:** `src/pages/admin/PerformanceBot.tsx` (274 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/performance-bot` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><PerformanceBot /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the current production pace and goal gaps readable from Reports.

**Existing data/API calls:** rpc `perf_bot_summary`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/dateUtils`, `@/lib/leadTypes`, `@/lib/tones`, `@/lib/utils`.

**Baseline / current state:** Goal/pace/lead-yield page retained; Reports now provides a Performance goals action. Primary shortcut removed after that parent link was added.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/PerformanceBot.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the current production pace and goal gaps readable from Reports.
Decision: Keep. Routes: /dashboard/admin/performance-bot.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Actual goal versus result → Production cohort → Highest-value next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain perf_bot_summary and current time/unit definitions. Licensed/no-deal and unlicensed cohorts differ; do not invent goals or imply projection is earned income.
Acceptance: Reports parent link stays present; goal math and periods agree; missing/failed summary does not show zero achieved.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Section` expression below is copied from `src/pages/admin/PerformanceBot.tsx:151`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Section id="pb-find" title="What the bot found" note={s.last_run ? `Last run ${formatTimeAgo(s.last_run.ran_at)}${s.last_run.ok ? "" : ", and it failed: " + (s.last_run.error ?? "no reason recorded")}. It runs daily at 8:30 AM Arizona time and pushes the top three to your phone${s.alerts_on ? "" : " (pushes are off)"}.` : "The bot has not run yet. It runs daily at 8:30 AM Arizona time."}>
            {s.findings.length === 0 ? (
              <p className="rounded-xl border border-border/60 bg-card p-3 text-[15px] text-muted-foreground">No findings yet. They appear after the first run.</p>
            ) : (
              <ul className="space-y-2">
                {s.findings.map((f, i) => (
                  <li key={`${f.kind}-${i}`} className="flex items-start gap-2 rounded-xl border border-border/60 bg-card p-3">
                    <TonePill tone={SEV[f.severity] ?? "slate"}>{f.severity === "high" ? "Big" : f.severity === "warn" ? "Watch" : "Note"}</TonePill>
                    <p className="text-[15px]">{f.headline}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
```

**Page-specific validation**

- Reports parent link stays present; goal math and periods agree; missing/failed summary does not show zero achieved.
- Verify the preserved source behavior: Retain perf_bot_summary and current time/unit definitions. Licensed/no-deal and unlicensed cohorts differ; do not invent goals or imply projection is earned income.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Brand command — `BrandCommand`
<a id="page-brand-command"></a>

**Decision:** Keep. **Source:** `src/pages/admin/BrandCommand.tsx` (546 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/brand-command` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BrandCommand /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the owner/admin brand scorecard and actual funnel evidence prominent.

**Existing data/API calls:** rpc `brand_command_summary`; from `brand_metrics_daily`; from `content_posts`; from `keyword_dm_log`; from `social_bot_blockers`; from `content_cards`; from `system_settings`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/tones`, `@/lib/utils`, `@/components/brand/BrandGrowthPanels`, `@/lib/brand`.

**Baseline / current state:** Retained Owner shortcut. My Day has a contextual link, but removing the shared admin entry could change role discoverability; parity has not been proven.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/BrandCommand.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the owner/admin brand scorecard and actual funnel evidence prominent.
Decision: Keep. Routes: /dashboard/admin/brand-command.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected day/review mode → Real platform metrics → Funnel and blocker work.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain brand_command_summary, manual daily metrics and source evidence. Views that day and total followers are different units/time bases; planned content is not posted.
Acceptance: Query review mode survives; metric entry stays explicit and attributed; no unsupported growth totals or auto-posting.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PageHeader` expression below is copied from `src/pages/admin/BrandCommand.tsx:216`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PageHeader
        eyebrow="Owner"
        icon={<Crown />}
        tone="gold"
        title={review ? "Weekly review" : "Brand Command"}
        subtitle={review ? "This week against last, account against account, then the two rules." : "Condition the man. Build the income. Every lane against its weekly target."}
        primaryAction={<Button className="h-11" onClick={() => setEntryOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Log a number</Button>}
        secondaryActions={
          <>
            <Button variant="outline" className="h-11" onClick={toggleReview}>{review ? "Back to the dashboard" : "Weekly review"}</Button>
            <Button variant="outline" className="h-11" onClick={refresh} aria-label="Refresh the numbers"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
          </>
        }
      />
```

**Page-specific validation**

- Query review mode survives; metric entry stays explicit and attributed; no unsupported growth totals or auto-posting.
- Verify the preserved source behavior: Retain brand_command_summary, manual daily metrics and source evidence. Views that day and total followers are different units/time bases; planned content is not posted.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Social approvals — `SocialMediaCenter`
<a id="page-social-media-center"></a>

**Decision:** Keep. **Source:** `src/pages/admin/SocialMediaCenter.tsx` (505 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/social-media-bot` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><SocialMediaCenter /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Make media readiness, approval and provider receipt the clear publishing sequence.

**Existing data/API calls:** from `social_bot_drafts`; from `social_bot_inbound`; from `social_bot_blockers`; from `system_settings`; invoke `postiz-bridge`; rpc `approve_social_draft`; from `content_cards`; from `keyword_dm_log`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/samOnly`, `@/lib/utils`, `@/lib/externalHref`, `@/lib/brand`, `@/lib/socialCenter`.

**Baseline / current state:** Specialist approvals/publish-receipt page retained and reached by the Launch Board local action. Existing review/publish semantics remain; cleanup invokes no sends/posts.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/SocialMediaCenter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make media readiness, approval and provider receipt the clear publishing sequence.
Decision: Keep. Routes: /dashboard/admin/social-media-bot.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Pending draft and media → Approval/blocker → Explicit publish receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain owner gating, approve_social_draft, postiz-bridge and content-card evidence. Approval is not publication; missing preview and failed provider response stay visible.
Acceptance: Reachable from Launch Board; no post on mount; success requires actual existing receipt; queue/filters stay account-scoped.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `TonePill` expression below is copied from `src/pages/admin/SocialMediaCenter.tsx:464`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<TonePill tone={KEYWORD_BY_KEY[r.keyword].tone}>{r.keyword}</TonePill>
```

**Page-specific validation**

- Reachable from Launch Board; no post on mount; success requires actual existing receipt; queue/filters stay account-scoped.
- Verify the preserved source behavior: Retain owner gating, approve_social_draft, postiz-bridge and content-card evidence. Approval is not publication; missing preview and failed provider response stay visible.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Telegram operations — `TelegramBot`
<a id="page-telegram-bot"></a>

**Decision:** Internal. **Source:** `src/pages/admin/TelegramBot.tsx` (1024 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/telegram-bot` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><TelegramBot /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep bot health, escalations and scheduled work understandable without exposing private user details unnecessarily.

**Existing data/API calls:** from `v_telegram_dashboard`; from `v_telegram_funnel`; from `v_telegram_stuck_users`; from `telegram_escalations`; from `telegram_groups`; from `telegram_templates`; from `telegram_faq`; from `telegram_scheduled_messages`; from `telegram_users`; from `system_settings`

**Existing helpers/components:** `@/hooks/useConfirm`, `@/lib/telegramGroups`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/TelegramBot.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep bot health, escalations and scheduled work understandable without exposing private user details unnecessarily.
Decision: Internal. Routes: /dashboard/admin/telegram-bot.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Health/proof status → Funnel and stuck users → Explicit templates/scheduled-message controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain dashboard/funnel views, templates, FAQ, groups and escalation operations. DAU/WAU and stages retain their existing windows; configured schedules are not delivered messages.
Acceptance: Error states cannot appear healthy; admin actions stay deliberate; no mass send or schedule modification occurs during visual QA.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `HealthLine` expression below is copied from `src/pages/admin/TelegramBot.tsx:358`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<HealthLine label="Manager Alerts group registered" status={groups?.some((g) => g.type === "manager_alerts") ? "ok" : "warn"} hint={groups?.some((g) => g.type === "manager_alerts") ? "✓" : "no manager_alerts group yet — escalations have no audience"} />
```

**Page-specific validation**

- Error states cannot appear healthy; admin actions stay deliberate; no mass send or schedule modification occurs during visual QA.
- Verify the preserved source behavior: Retain dashboard/funnel views, templates, FAQ, groups and escalation operations. DAU/WAU and stages retain their existing windows; configured schedules are not delivered messages.
- Existing focused checks to inspect: `src/tests/pages/AdminAutomationEmptyStates.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
