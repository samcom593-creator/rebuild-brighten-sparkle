# Production, finance and daily work

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Log daily numbers — `LogNumbers`
<a id="page-log-numbers"></a>

**Decision:** Internal. **Source:** `src/pages/LogNumbers.tsx` (580 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/apex-daily-numbers` | admin; wrappers: QueryShell | `{<ProtectedRoute requireAdmin><LogNumbers /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing activity/production entry focused on a verified agent and the selected day.

**Existing data/API calls:** invoke `log-production`; invoke `notify-production-submitted`

**Existing helpers/components:** `@/lib/dateUtils`, `@/hooks/useSoundEffects`, `@/lib/utils`, `@/components/dashboard/ConfettiCelebration`, `@/components/dashboard/BubbleStatInput`.

**Baseline / current state:** Admin daily-number entry. Keep protected and compatible with existing login routing.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LogNumbers.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing activity/production entry focused on a verified agent and the selected day.
Decision: Internal. Routes: /apex-daily-numbers.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Resolved profile → Required activity values → Confirmed submission.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain log-production and its validation/idempotency path. Activity counts, ALP and commission are different units; notification success must not substitute for production persistence.
Acceptance: Missing profile and failed writes remain errors; the visible receipt reflects the saved date/values; no duplicate live notification is triggered by styling.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `BubbleStatInput` expression below is copied from `src/pages/LogNumbers.tsx:417`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<BubbleStatInput
                            key={field.key}
                            label={field.label}
                            emoji={field.emoji}
                            value={productionData[field.key as keyof typeof productionData]}
                            onChange={(val) => setProductionData(prev => ({
                              ...prev,
                              [field.key]: val
                            }))}
                            step={field.step}
                            delay={index * 0.03}
                          />
```

**Page-specific validation**

- Missing profile and failed writes remain errors; the visible receipt reflects the saved date/values; no duplicate live notification is triggered by styling.
- Verify the preserved source behavior: Retain log-production and its validation/idempotency path. Activity counts, ALP and commission are different units; notification success must not substitute for production persistence.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Production command — `Dashboard`
<a id="page-dashboard"></a>

**Decision:** Keep. **Source:** `src/pages/Dashboard.tsx` (1134 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Dashboard />}` |

**Observed behavior and source contract**

Let the active role’s real production and next actions dominate the dashboard.

**Existing data/API calls:** from `applications`; from `v_my_applications`; from `deals`; from `daily_production`; from `agents`; from `interview_events`; from `seminar_registrations`; from `lead_purchase_requests`; from `lead_purchases`; rpc `sync_health_summary`; from `system_settings`; from `lead_counter`; from `system_health_logs`; from `v_agentlink_book_truth`; invoke `system-health-check`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/ensureCurrentAgentRecord`, `@/lib/dashboardCurrentAgent`, `@/hooks/useAuth`, `@/hooks/useMyDownline`, `@/hooks/useRolePreview`, `@/lib/dateUtils`, `@/lib/dealTruth`, `@/lib/metricTruth`, `@/lib/utils`, `@/components/dashboard/ReferralLinkCard`, `@/components/dashboard/AgentCloudHome`, `@/components/dashboard/ScopedProductionScoreboard`, `@/components/dashboard/DealCarrierStatusCard`.

**Baseline / current state:** Canonical role-aware home. Preserve production, goals, conversion charts, hierarchy and honest error/empty states.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Dashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Let the active role’s real production and next actions dominate the dashboard.
Decision: Keep. Routes: /dashboard.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected-scope production → Saved goals and pace → Highest-value next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve role home selection, scoped hierarchy, dates, estimated-earnings distinctions, present-mode label and geometry hiding, and visibly marked local demo overrides. Do not add decorative requests, fake activity or unsigned role-wide totals.
Acceptance: Check agent, manager, agency owner and real admin scopes; missing/error/stale data is not zero; 332px cards and large all-time amounts do not overflow.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `LazyPanel` expression below is copied from `src/pages/Dashboard.tsx:849`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<LazyPanel minHeight="h-32"><UnclaimedLeadsCommandCard /></LazyPanel>
```

**Page-specific validation**

- Check agent, manager, agency owner and real admin scopes; missing/error/stale data is not zero; 332px cards and large all-time amounts do not overflow.
- Verify the preserved source behavior: Preserve role home selection, scoped hierarchy, dates, estimated-earnings distinctions, present-mode label and geometry hiding, and visibly marked local demo overrides. Do not add decorative requests, fake activity or unsigned role-wide totals.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/components/CommandDashboardsCoherence.test.tsx`, `src/tests/components/ScopedProductionScoreboard.test.tsx`, `src/tests/components/teamOverviewAttendance.test.tsx`, `src/tests/lib/accountModeRouting.test.ts`, `src/tests/lib/appRoutingContract.test.ts`, `src/tests/lib/freeLeadsDashboardContract.test.ts`, `src/tests/lib/hireMonitoringRecruitingIncome.test.ts`, `src/tests/lib/hiringLifecycleContract.test.ts`, `src/tests/lib/homeDashboard.tz.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My book — `MyDeals`
<a id="page-my-deals"></a>

**Decision:** Keep. **Source:** `src/pages/MyDeals.tsx` (1064 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/production` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyDeals /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the full policy book useful for finding the next eligible client action.

**Existing data/API calls:** from `v_book_of_business`; rpc `book_of_business_counts`; rpc `book_state_summary`; rpc `lead_state_yield`; from `v_book_row_call_summary`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useAgentIdentity`, `@/hooks/useFullBookReader`, `@/hooks/useResolvedDownline`, `@/components/deals/SubmitDealDialog`, `@/components/clients/SoldCallPanel`, `@/components/clients/ClientContactLine`, `@/components/books/BookRowWork`, `@/components/books/BookRowCallsPanel`, `@/components/books/BookStandingBoard`, `@/components/books/LeadStatesPanel`, `@/lib/readymodeDispositions`, `@/lib/looseSupabase`, `@/lib/clientFacts`.

**Baseline / current state:** Current joined policy book. Retain table, policy state, client details, lead yield and production graphs.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyDeals.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the full policy book useful for finding the next eligible client action.
Decision: Keep. Routes: /dashboard/production.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Scoped book totals → State/status/work filters → Policy and call detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve full-book reader and downline permissions, server counts, pagination and call/transcript authorization. Issued/active statuses and lead-match sales evidence must remain distinct.
Acceptance: Totals and opened lists share the same filters; granted call operations stay available; denied/missing private recordings remain explicit.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/MyDeals.tsx:865`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState {...describeQuery(countQuery)} label="policy count" compact onRetry={() => void countQuery.refetch()}>
                    <span>{exactCount} {policiesWord(countQuery.data ?? 0)}</span>
                  </QueryState>
```

**Page-specific validation**

- Totals and opened lists share the same filters; granted call operations stay available; denied/missing private recordings remain explicit.
- Verify the preserved source behavior: Preserve full-book reader and downline permissions, server counts, pagination and call/transcript authorization. Issued/active statuses and lead-match sales evidence must remain distinct.
- Existing focused checks to inspect: `src/tests/lib/productionBook.test.ts`, `src/tests/pages/myDealsProduction.test.tsx`, `src/tests/pages/myDealsStates.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Reports — `BusinessAnalytics`
<a id="page-business-analytics"></a>

**Decision:** Keep. **Source:** `src/pages/BusinessAnalytics.tsx` (908 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/analytics` | real authenticated admin outside role preview; agency aggregates; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BusinessAnalytics /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep real agency analytics in a readable executive hierarchy.

**Existing data/API calls:** from `v_business_analytics_summary`; from `v_business_analytics_carriers`; from `v_business_analytics_insights`; from `v_sales_challenges`; from `v_trophy_cabinet`; from `v_agents_needs_attention`; from `v_agents_learn_from`; from `v_inactive_agents_summary`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/hooks/useRolePreview`, `@/components/AccessDeniedPanel`, `@/components/dashboard/PlatformPulsePanel`, `@/components/dashboard/DialerSeatsPanel`.

**Baseline / current state:** Admin-only route and page gate now match the agency aggregate SQL. Viewer-keyed content/query caches and contextual Performance goals link are present. Keep all graphs; manager reporting requires a separately verified scoped contract.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BusinessAnalytics.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep real agency analytics in a readable executive hierarchy.
Decision: Keep. Routes: /dashboard/analytics.
Audience: real authenticated admin outside role preview; agency aggregates. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Performance snapshot → Carrier and production trends → Coaching and system follow-up.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The baseline route/page is real-admin-only outside preview. Preserve viewer-scoped caches, unknown/stale states and Performance goals link; a manager-safe report requires a separate proven scoped contract.
Acceptance: Verify aggregate access stays admin-only and each error panel retains retry; chart values and detail links match their source period.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PlatformPulsePanel` expression below is copied from `src/pages/BusinessAnalytics.tsx:351`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PlatformPulsePanel viewerId={viewerId} />
```

**Page-specific validation**

- Verify aggregate access stays admin-only and each error panel retains retry; chart values and detail links match their source period.
- Verify the preserved source behavior: The baseline route/page is real-admin-only outside preview. Preserve viewer-scoped caches, unknown/stale states and Performance goals link; a manager-safe report requires a separate proven scoped contract.
- Existing focused checks to inspect: `src/tests/pages/BusinessAnalytics.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agencies — `Agencies`
<a id="page-agencies"></a>

**Decision:** Keep. **Source:** `src/pages/Agencies.tsx` (246 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agencies` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><Agencies /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make agency comparisons and drill-downs clear for the selected period.

**Existing data/API calls:** from `v_imo_by_agency`; rpc `agency_roster_production`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Agencies.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make agency comparisons and drill-downs clear for the selected period.
Decision: Keep. Routes: /dashboard/agencies.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Period selector → Agency production and headcount → Roster detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep v_imo_by_agency and agency_roster_production semantics. Do not combine periods or substitute total hierarchy production for a direct leg.
Acceptance: MTD, last month and 30-day labels match query windows; list/summary counts reconcile; unavailable values remain unavailable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Table` expression below is copied from `src/pages/Agencies.tsx:192`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producer</TableHead>
                      <TableHead className="text-right">Policies</TableHead>
                      <TableHead className="text-right">AP</TableHead>
                      <TableHead>Last sale</TableHead>
                      <TableHead className="text-right">Comp</TableHead>
                      <TableHead>Reports through</TableHead>
                      <TableHead>Login</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {producers.length === 0 && !gap && (
                      <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No production in this window.</TableCell></TableRow>
                    )}
                    {producers.map((r) => (
                      <TableRow key={r.agent_id ?? `${name}:${r.agent_name}`}>
                        <TableCell className="font-medium text-foreground">{r.agent_name ?? "Unnamed producer"}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.policies}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(r.ap))}</TableCell>
                        <TableCell className="text-muted-foreground">{r.last_sale ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.contract_pct != null ? `${r.contract_pct}%` : <span className="text-muted-foreground">unknown</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.first_hop_name ?? "—"}</TableCell>
                        <TableCell>
                          {r.has_login
                            ? <Badge variant="outline" className="border-border text-[11px] text-muted-foreground">has login</Badge>
                            : <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[11px] text-amber-300">never logs in</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {gap && (
                      <TableRow key={`${name}:gap`} className="bg-muted/30">
                        <TableCell className="text-sm text-muted-foreground">{gap.agent_name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{gap.policies}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{money(Number(gap.ap))}</TableCell>
                        <TableCell className="text-muted-foreground">{gap.last_sale ?? "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
```

**Page-specific validation**

- MTD, last month and 30-day labels match query windows; list/summary counts reconcile; unavailable values remain unavailable.
- Verify the preserved source behavior: Keep v_imo_by_agency and agency_roster_production semantics. Do not combine periods or substitute total hierarchy production for a direct leg.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Builder board — `BuildersDashboard`
<a id="page-builders-dashboard"></a>

**Decision:** Keep. **Source:** `src/pages/BuildersDashboard.tsx` (1048 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/builders` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BuildersDashboard mode="builders" /></ProtectedRoute>}` |
| `/dashboard/builders/:builderId` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BuildersDashboard mode="builders" /></ProtectedRoute>}` |
| `/dashboard/agency-owners` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><BuildersDashboard mode="agencyOwners" /></ProtectedRoute>}` |

**Observed behavior and source contract**

Prioritize builder rankings and the next call list over repeated KPI cards.

**Existing data/API calls:** from `v_builder_operating_dashboard`; from `agents`; from `applications`; from `lead_payment_tracking`

**Existing helpers/components:** `@/components/hires/HireStageControl`, `@/hooks/usePageTitle`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BuildersDashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Prioritize builder rankings and the next call list over repeated KPI cards.
Decision: Keep. Routes: /dashboard/builders, /dashboard/builders/:builderId, /dashboard/agency-owners.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Builder ranking → Stuck recruiting work → Selected builder/agency leg.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain builderId detail and agency-owner route modes, actual manager/owner roles and production/recruiting source distinctions. Preserve routing, notes and contact actions.
Acceptance: Root, builder-detail and agency-owner paths retain their intended mode; ranking ties and unknown metrics are honest.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `MetricCard` expression below is copied from `src/pages/BuildersDashboard.tsx:664`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<MetricCard label="Month growth" value={fastestGrowing && new Date().getDate() > 7 ? fmtPct(fastestGrowing.growth_rate) : "Building"} sub={new Date().getDate() > 7 ? (fastestGrowing?.builder_name ?? "Needs production history") : "Month just started"} icon={TrendingUp} />
```

**Page-specific validation**

- Root, builder-detail and agency-owner paths retain their intended mode; ranking ties and unknown metrics are honest.
- Verify the preserved source behavior: Retain builderId detail and agency-owner route modes, actual manager/owner roles and production/recruiting source distinctions. Preserve routing, notes and contact actions.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Today — `DashboardToday`
<a id="page-dashboard-today"></a>

**Decision:** Improve. **Source:** `src/pages/DashboardToday.tsx` (479 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/today` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><DashboardToday /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the current account’s few ranked priorities and upcoming work the first screen.

**Existing data/API calls:** from `today_tasks`; from `v_upcoming_calls`; from `v_production_unified`; from `social_bot_drafts`; from `social_bot_blockers`; from `v_cfo_snapshot`

**Existing helpers/components:** `@/hooks/useAgentIdentity`, `@/hooks/useFullBookReader`, `@/hooks/useBusinessToday`, `@/hooks/usePageTitle`, `@/lib/calendarTime`, `@/lib/todayTasks`, `@/lib/utils`.

**Baseline / current state:** Useful personal priorities and meetings. Keep separate from owner-private routine; consolidate its navigation into the authorized My Tasks flow.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardToday.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the current account’s few ranked priorities and upcoming work the first screen.
Decision: Improve. Routes: /dashboard/today.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Now priority → Upcoming calls → Production/finance blockers.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep useBusinessToday, agent identity errors and task ranking. today_tasks is a different workflow from agent_tasks/My Tasks; do not merge data or duplicate the same task in several sections.
Acceptance: One task appears once, date buckets stay Phoenix-based, ambiguous identity blocks reads, and account switching cannot show prior cached data.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/DashboardToday.tsx:102`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState
        status="empty"
        compact={compact}
        title="More than one agent record matches this login"
        body={`${identity.candidates.length} records match. Ask an admin to merge them. Nothing is shown until then.`}
      />
```

**Page-specific validation**

- One task appears once, date buckets stay Phoenix-based, ambiguous identity blocks reads, and account switching cannot show prior cached data.
- Verify the preserved source behavior: Keep useBusinessToday, agent identity errors and task ranking. today_tasks is a different workflow from agent_tasks/My Tasks; do not merge data or duplicate the same task in several sections.
- Existing focused checks to inspect: `src/tests/pages/dashboardToday.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Producer trends — `AdminProducerTrends`
<a id="page-admin-producer-trends"></a>

**Decision:** Keep. **Source:** `src/pages/AdminProducerTrends.tsx` (1690 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/producer-trends` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminProducerTrends /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep a focused risk-and-recovery board reachable from Reports or Team context.

**Existing data/API calls:** from `v_producer_trend_alert`; from `v_new_hires_activation`; from `v_agent_weekly_production`; from `v_manager_scorecard`; from `agents`; from `agent_notes`

**Existing helpers/components:** `@/components/dashboard/AgentNameLink`, `@/lib/utils`, `@/lib/nextBestAction`, `@/lib/priority`, `@/components/producers/ProducerDetailsDrawer`.

**Baseline / current state:** Distinct coaching trends, activation and weekly history. Keep as a drilldown; do not replace graphs with a general dashboard link.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminProducerTrends.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep a focused risk-and-recovery board reachable from Reports or Team context.
Decision: Keep. Routes: /dashboard/producer-trends.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Critical/drop/watch queue → Manager scorecard → Never activated agents.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain trend source periods, activation distinctions, notes and reviewed/recovered markers. Canonicalizing the duplicate URL must not remove the specialist queue.
Acceptance: Filters reconcile manager summaries and rows; notes require actual success; unknown history is not a zero-production verdict.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ProducerAlertCard` expression below is copied from `src/pages/AdminProducerTrends.tsx:819`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ProducerAlertCard
            tone="rose"
            icon={
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            }
            eyebrow="3-Week Drop Alert"
            title={`${kpiCounts.dropping_3w} producer${kpiCounts.dropping_3w === 1 ? "" : "s"} dropped ALP 3 weeks in a row`}
            body="Same slide Daniel had. Nobody caught it. Reach out today."
            cta="Review Producers"
            onCta={() => setKpi("dropping_3w")}
          />
```

**Page-specific validation**

- Filters reconcile manager summaries and rows; notes require actual success; unknown history is not a zero-production verdict.
- Verify the preserved source behavior: Retain trend source periods, activation distinctions, notes and reviewed/recovered markers. Canonicalizing the duplicate URL must not remove the specialist queue.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent command — `AgentCommandDashboard`
<a id="page-agent-command-dashboard"></a>

**Decision:** Improve; conditional consolidation only after role-branch parity. **Source:** `src/pages/AgentCommandDashboard.tsx` (5048 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent-portal` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AgentCommandDashboard /></ProtectedRoute>}` |
| `/agent-dashboard` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AgentCommandDashboard /></ProtectedRoute>}` |

**Observed behavior and source contract**

Clarify each role branch before consolidating this large alternate dashboard.

**Existing data/API calls:** from `agents`; from `v_agent_command_center`; from `daily_production`; from `agent_lifetime_production`; from `agent_goals`; from `deals`; from `v_ceo_command_center`; from `v_active_agents_skool`; from `v_production_unified`; from `agentlink_deals_snapshot`; from `v_recent_hires`; from `applications`; rpc `apex_dashboard_summary`; from `v_cfo_snapshot`; from `agentlink_carriers`; from `culture_events`; from `commission_ledger`; from `v_hot_licensing_prospects`; from `v_unlicensed_all`; from `v_chargebacks_30d`; from `v_producer_trend_alert`; from `v_licensing_stage_counts`; from `v_next_step_funnel_health`; from `v_manager_hierarchy_mtd`; from `qe_commission_schedules`; from `aged_leads`

**Existing helpers/components:** `@/components/dashboard/ImoByAgency`, `@/components/hires/HireStageControl`, `@/lib/ensureCurrentAgentRecord`, `@/hooks/useAuth`, `@/components/dashboard/GoalTrackerCard`, `@/hooks/usePageTitle`, `@/lib/nextBestAction`, `@/lib/priority`, `@/components/dashboard/NextStepCard`, `@/components/onboarding/ApplicantHome`, `@/components/dashboard/AgentPeerAndChargebackCards`, `@/components/dashboard/LapsesDrilldownModal`, `@/components/dashboard/RecentActivationsPanel`, `@/components/dashboard/ManagerPostCounter`.

**Baseline / current state:** Still renders the producer home as well as old portal URLs; do not delete this implementation. Reduce alternate entry URLs only after role parity.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentCommandDashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Clarify each role branch before consolidating this large alternate dashboard.
Decision: Improve; conditional consolidation only after role-branch parity. Routes: /agent-portal, /agent-dashboard.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Role-appropriate production → Actionable recruiting or policy work → Canonical Finances shortcut.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The source has distinct agency, producer and applicant branches and many legacy data readers. Do not replace it wholesale with /dashboard until each branch’s data, actions and permissions are compared; preserve accurate finance/payment wording.
Acceptance: Each supported role retains its primary action and true source units; alternative routes do not introduce a second contradictory production total.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `FirstLoginGuide` expression below is copied from `src/pages/AgentCommandDashboard.tsx:362`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<FirstLoginGuide agentId={agentId} />
```

**Page-specific validation**

- Each supported role retains its primary action and true source units; alternative routes do not introduce a second contradictory production total.
- Verify the preserved source behavior: The source has distinct agency, producer and applicant branches and many legacy data readers. Do not replace it wholesale with /dashboard until each branch’s data, actions and permissions are compared; preserve accurate finance/payment wording.
- Existing focused checks to inspect: `src/tests/components/CommandDashboardsCoherence.test.tsx`, `src/tests/lib/agentOnboardingRoadmap.test.ts`, `src/tests/lib/freeLeadsDashboardContract.test.ts`, `src/tests/lib/linkInBioDashboardContract.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Legacy agent portal — `AgentPortal`
<a id="page-agent-portal"></a>

**Decision:** Legacy. **Source:** `src/pages/AgentPortal.tsx` (818 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent-portal/legacy` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<AgentPortal />}` |

**Observed behavior and source contract**

Preserve historical access while making the current workspace the clear continuation.

**Existing data/API calls:** from `agents`; from `deals`; from `daily_production`

**Existing helpers/components:** `@/hooks/useMountedRef`, `@/components/layout/MobileBottomNav`, `@/components/dashboard/ProductionEntry`, `@/components/dashboard/LeaderboardTabs`, `@/components/dashboard/PersonalStatsCard`, `@/components/dashboard/ProductionHistoryChart`, `@/components/dashboard/ReferralLeaderboard`, `@/components/dashboard/TeamGoalsTracker`, `@/components/dashboard/IncomeGoalTracker`, `@/components/dashboard/PerformanceDashboardSection`, `@/components/dashboard/WeeklyBadges`, `@/components/dashboard/YearPerformanceCard`, `@/components/dashboard/AccountLinkForm`, `@/components/dashboard/AgentRankBadge`.

**Baseline / current state:** Explicit legacy portal. Preserve existing bookmarks while steering to the canonical role-aware home.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentPortal.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Preserve historical access while making the current workspace the clear continuation.
Decision: Legacy. Routes: /agent-portal/legacy.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current-workspace link → Existing activity/production detail → Account linking recovery.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep existing agent identity and historical reads until current Dashboard covers account-linking, logging and onboarding recovery. Do not delete the legacy route based on navigation absence.
Acceptance: Unknown/missing identity remains actionable; the canonical link preserves useful query context; no duplicate data-entry workflow is silently added.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `AccountLinkForm` expression below is copied from `src/pages/AgentPortal.tsx:463`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<AccountLinkForm user={user} profile={profile} onSuccess={() => window.location.reload()} onLogout={handleLogout} />
```

**Page-specific validation**

- Unknown/missing identity remains actionable; the canonical link preserves useful query context; no duplicate data-entry workflow is silently added.
- Verify the preserved source behavior: Keep existing agent identity and historical reads until current Dashboard covers account-linking, logging and onboarding recovery. Do not delete the legacy route based on navigation absence.
- Existing focused checks to inspect: `src/tests/lib/agentOnboardingRoadmap.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Daily numbers — `Numbers`
<a id="page-numbers"></a>

**Decision:** Keep. **Source:** `src/pages/Numbers.tsx` (196 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/numbers` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Numbers />}` |

**Observed behavior and source contract**

Put the existing compact production entry and current result together.

**Existing data/API calls:** from `agents`; from `profiles`; from `deals`

**Existing helpers/components:** `@/components/dashboard/CompactProductionEntry`, `@/components/dashboard/CompactLeaderboard`, `@/components/dashboard/AgentRankBadge`, `@/hooks/useAuth`, `@/lib/dateUtils`, `@/lib/metricTruth`, `@/lib/dealTruth`.

**Baseline / current state:** Producer daily entry is in the mobile bar. Preserve submission behavior and distinguish it from reporting-only production charts.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Numbers.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Put the existing compact production entry and current result together.
Decision: Keep. Routes: /numbers.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Resolved agent → Production entry → Current compact leaderboard.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep CompactProductionEntry and CompactLeaderboard, existing profile/photo behavior and deal persistence. Do not infer an agent from a display name or use unrelated totals as the entry result.
Acceptance: Missing agent shows its actual recovery state; failed save does not advance or celebrate; large values fit on mobile.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CompactProductionEntry` expression below is copied from `src/pages/Numbers.tsx:144`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CompactProductionEntry
          agentId={agentId}
          agentName={agentName}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
```

**Page-specific validation**

- Missing agent shows its actual recovery state; failed save does not advance or celebrate; large values fit on mobile.
- Verify the preserved source behavior: Keep CompactProductionEntry and CompactLeaderboard, existing profile/photo behavior and deal persistence. Do not infer an agent from a display name or use unrelated totals as the entry result.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My day — `MyDay`
<a id="page-my-day"></a>

**Decision:** Improve. **Source:** `src/pages/MyDay.tsx` (605 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-day` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><MyDay /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep Sam’s personal routine as a clear checklist with trustworthy sync state.

**Existing data/API calls:** from `day_plan_checks`; rpc `day_plan_ensure_seeded`; from `day_plan_tasks`

**Existing helpers/components:** `@/lib/contentWeek`, `@/lib/utils`, `@/components/myday/MyDayWins`, `@/components/myday/MyDayTodoist`, `@/components/myday/PrelicensingCheck`, `@/hooks/useSamPrivateAccess`, `@/lib/privateTasks`, `@/lib/myDayStorage`, `@/components/contracting-review/ContractingReviewBanner`.

**Baseline / current state:** Owner-gated private routine with per-user storage keys and pinned task requests. Queue persistence, read validation, stale/unavailable checks and embedded widget isolation passed focused tests and source review. Backing private-task server policy proof remains separate.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyDay.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep Sam’s personal routine as a clear checklist with trustworthy sync state.
Decision: Improve. Routes: /dashboard/my-day.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Today’s current block → Verified completion → Optional wins and licensing follow-up.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Baseline fixes include owner gating, per-user browser keys, durable queue readback, pinned requests, child leases and explicit stale/unavailable checkmarks. Keep these; styling must not hide sync failure or re-adopt unowned old caches.
Acceptance: Storage denial leaves the check unchanged; malformed queue stays paused; failed checks never look like zero done; account/preview changes stop pending gated actions.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `MyDayWins` expression below is copied from `src/pages/MyDay.tsx:443`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<MyDayWins />
```

**Page-specific validation**

- Storage denial leaves the check unchanged; malformed queue stays paused; failed checks never look like zero done; account/preview changes stop pending gated actions.
- Verify the preserved source behavior: Baseline fixes include owner gating, per-user browser keys, durable queue readback, pinned requests, child leases and explicit stale/unavailable checkmarks. Keep these; styling must not hide sync failure or re-adopt unowned old caches.
- Existing focused checks to inspect: `src/tests/pages/privateTaskPages.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Finances — `Finances`
<a id="page-finances"></a>

**Decision:** Keep. **Source:** `src/pages/Finances.tsx` (886 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/finances` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Finances /></ProtectedRoute>}` |

**Observed behavior and source contract**

Present the current user’s policy commissions, recorded payment evidence and rates with clean large figures.

**Existing data/API calls:** The following direct calls belong to Management/reconciliation: rpc `finances_overview`; from `v_cfo_snapshot`; from `v_cfo_dup_charge_watch`; from `v_cfo_ica_paid_stuck`; from `v_cfo_agent_activation_watch`; from `commission_ledger`; from `cfo_approval_requests`. The personal Issue & pay branch embeds MyCommissions and CommissionOverview/CommissionCharts/CommissionPolicyLedger from src/components/finances/CommissionWorkspace.tsx; do not reuse an admin estimate as a personal paid figure.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/hooks/useRolePreview`, `@/pages/MyCommissions`, `@/components/finances/PersonalPolicyBook`, `@/components/dashboard/ImoByAgency`, `@/components/deals/SubmitDealDialog`, `@/lib/utils`.

**Baseline / current state:** Current local source has Issue & pay, Policy book and real-admin-only Management. Paid commission uses recorded ledger payment dates/status, issued-and-paid premium remains unavailable without receipts, and estimates/coverage stay separately labeled.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Finances.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the current user’s policy commissions, recorded payment evidence and rates with clean large figures.
Decision: Keep. Routes: /dashboard/finances.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Issue & pay → Policy book → Management only for authorized real admins.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep canonical /dashboard/finances and FinanceWorkspaceView with embedded MyCommissions. CommissionOverview shows Issued & paid AP as Unavailable without verified premium-payment receipts. Commission paid YTD uses commission_ledger status=paid and valid actual_paid_date through today; pending commissions refer to open deals and clawbacks are recorded entries. The monthly chart uses payment dates; status charts count ledger/production rows, not dollars. These records are not bank-cash verification. Policy coverage/status/effective dates and admin Management estimates stay separate.
Acceptance: Personal cards/charts reconcile ledger status and actual_paid_date, preserving YTD and selected month; missing premium-payment evidence stays Unavailable; Policy book and Management keep distinct source/role contracts; payout/contract percentages and overrides retain their exact meaning.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `FinanceWorkspaceView` expression below is copied from `src/pages/Finances.tsx:875`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<FinanceWorkspaceView tab={activeTab} onTabChange={setTab} canManage={canManage}>
      {!user || isLoading ? <QueryState status="loading" label="your finances" /> : activeTab === "management" && canManage ? (
        <FinanceManagement key={user.id} viewerId={user.id} />
      ) : activeTab === "policies" ? (
        <PersonalPolicyBook key={user.id} onViewPayments={() => setTab("personal")} />
      ) : (
        <MyCommissions key={user.id} embedded />
      )}
    </FinanceWorkspaceView>
```

**Page-specific validation**

- Personal cards/charts reconcile ledger status and actual_paid_date, preserving YTD and selected month; missing premium-payment evidence stays Unavailable; Policy book and Management keep distinct source/role contracts; payout/contract percentages and overrides retain their exact meaning.
- Verify the preserved source behavior: Keep canonical /dashboard/finances and FinanceWorkspaceView with embedded MyCommissions. CommissionOverview shows Issued & paid AP as Unavailable without verified premium-payment receipts. Commission paid YTD uses commission_ledger status=paid and valid actual_paid_date through today; pending commissions refer to open deals and clawbacks are recorded entries. The monthly chart uses payment dates; status charts count ledger/production rows, not dollars. These records are not bank-cash verification. Policy coverage/status/effective dates and admin Management estimates stay separate.
- Existing focused checks to inspect: `src/tests/financeTruth.test.ts`, `src/tests/pages/Finances.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Live production board — `BoardLive`
<a id="page-board-live"></a>

**Decision:** Keep. **Source:** `src/pages/BoardLive.tsx` (200 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/board` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><BoardLive /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep a presentation-oriented leaderboard that exposes only the authorized board scope.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/useBrand`, `@/hooks/useTeamBoard`, `@/lib/leaderboardBoard`, `@/lib/tones`, `@/lib/utils`.

**Baseline / current state:** Dedicated board/presentation surface. Retain truthful live data and privacy/present-mode behavior.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BoardLive.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep a presentation-oriented leaderboard that exposes only the authorized board scope.
Decision: Keep. Routes: /board.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Board period → Ranked real production → Clear freshness/error state.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain useTeamBoard, brand and query parameters. Do not add a made-up live ticker, fake upward movement or a broader public data source.
Acceptance: Period and hierarchy match the board hook; stale/error does not become a zero board; names and numbers fit presentation/mobile modes.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CountUp` expression below is copied from `src/pages/BoardLive.tsx:75`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CountUp value={totalEstimate} format={formatTileMoney} />
```

**Page-specific validation**

- Period and hierarchy match the board hook; stale/error does not become a zero board; names and numbers fit presentation/mobile modes.
- Verify the preserved source behavior: Retain useTeamBoard, brand and query parameters. Do not add a made-up live ticker, fake upward movement or a broader public data source.
- Existing focused checks to inspect: `src/tests/lib/hireMonitoringRecruitingIncome.test.ts`, `src/tests/lib/leaderboardLinksSlackHubs.test.ts`, `src/tests/pages/BoardLive.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My tasks — `MyTasks`
<a id="page-my-tasks"></a>

**Decision:** Keep. **Source:** `src/pages/MyTasks.tsx` (103 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-tasks` | authenticated real account outside preview; owned usable agent identity required; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyTasks /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep personal task entry and completion fast without mixing in Sam’s private system.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useRolePreview`, `@/lib/utils`, `@/lib/myTasks`.

**Baseline / current state:** New personal task page derives owned active/unmerged agent identity through current_agent_id, scopes reads and completion, and creates through an authenticated ownership-stamping Edge endpoint. Final task/privacy correction receipts are tracked separately below.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyTasks.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep personal task entry and completion fast without mixing in Sam’s private system.
Decision: Keep. Routes: /dashboard/my-tasks.
Audience: authenticated real account outside preview; owned usable agent identity required. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Open tasks → Add one next action → Completed history.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep derived usable owner identity, personal-task-create, field restrictions, pinned tokens, per-account keys, response validation and confirmation of updated rows. The 200-row fetch limit is a loaded window, not all-time task volume.
Acceptance: Test missing/merged/inactive owner, null/malformed read, failed creation/completion and account switch; no caller can submit another owner ID.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `MyTasksList` expression below is copied from `src/pages/MyTasks.tsx:31`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<MyTasksList key={`${userId}:${owner.data.agentId}`} owner={owner.data} />
```

**Page-specific validation**

- Test missing/merged/inactive owner, null/malformed read, failed creation/completion and account switch; no caller can submit another owner ID.
- Verify the preserved source behavior: Keep derived usable owner identity, personal-task-create, field restrictions, pinned tokens, per-account keys, response validation and confirmation of updated rows. The 200-row fetch limit is a loaded window, not all-time task volume.
- Existing focused checks to inspect: `src/tests/pages/MyTasks.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Lead payments — `LeadPayments`
<a id="page-lead-payments"></a>

**Decision:** Keep. **Source:** `src/pages/LeadPayments.tsx` (578 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/lead-payments` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><LeadPayments /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the manual payment ledger and its confirmation status easy to reconcile.

**Existing data/API calls:** from `agents`; from `lead_payment_tracking`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/looseSupabase`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LeadPayments.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the manual payment ledger and its confirmation status easy to reconcile.
Decision: Keep. Routes: /dashboard/lead-payments.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Confirmed versus pending/waived → Payment ledger → Explicit add/update action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep lead_payment_tracking values and recorded payment status. A manual entry is not proof of a provider settlement; do not sum waived/free records as cash received.
Acceptance: Filtered totals reconcile displayed rows; add/update failures stay visible; payer identity and amount validation remain.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `SummaryCard` expression below is copied from `src/pages/LeadPayments.tsx:345`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<SummaryCard icon={DollarSign} label="Confirmed Venmo" value={money(summary.total)} sub={`${summary.confirmed} confirmed payments`} />
```

**Page-specific validation**

- Filtered totals reconcile displayed rows; add/update failures stay visible; payer identity and amount validation remain.
- Verify the preserved source behavior: Keep lead_payment_tracking values and recorded payment status. A manual entry is not proof of a provider settlement; do not sum waived/free records as cash received.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Owner HQ — `SamHQ`
<a id="page-sam-h-q"></a>

**Decision:** Internal. **Source:** `src/pages/admin/SamHQ.tsx` (804 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/sam` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><SamHQ /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Reduce the private owner dashboard to ranked tasks and current operating exceptions.

**Existing data/API calls:** from `sam_daily_tasks`; from `v_sam_week_tasks`; from `v_recent_hires`; from `social_bot_drafts`; from `telegram_groups`; from `applications`; from `v_unclaimed_new_apps`; from `v_carrier_premium_data_gap`; from `v_carrier_reconciliation`; from `system_settings`; from `telegram_scheduled_messages`; from `telegram_users`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useConfirm`, `@/lib/telegramGroups`, `@/hooks/useSamPrivateAccess`, `@/lib/privateTasks`.

**Baseline / current state:** Owner-gated task/content/operations aggregate with viewer-keyed requests. Preserve specialist actions and private records; backing sam_daily_tasks server-policy verification remains separate.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/SamHQ.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Reduce the private owner dashboard to ranked tasks and current operating exceptions.
Decision: Internal. Routes: /dashboard/admin/sam.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Must/should/could today → This week and shipped work → Relevant content/contracting exceptions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep Sam-only gate, viewer-keyed pinned requests and existing task/content actions. sam_daily_tasks backing policy proof remains a separate security item; a styled frontend is not its fix.
Acceptance: Owner denial, query errors, pending mutation on account change and truthful shipped states remain covered; no automatic send or post is introduced.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/admin/SamHQ.tsx:166`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent role="alert" className="p-6 text-sm text-destructive">Your HQ tasks could not be loaded. Refresh to retry.</CardContent></Card>
```

**Page-specific validation**

- Owner denial, query errors, pending mutation on account change and truthful shipped states remain covered; no automatic send or post is introduced.
- Verify the preserved source behavior: Keep Sam-only gate, viewer-keyed pinned requests and existing task/content actions. sam_daily_tasks backing policy proof remains a separate security item; a styled frontend is not its fix.
- Existing focused checks to inspect: `src/tests/pages/privateTaskPages.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Owner todo — `SamTodo`
<a id="page-sam-todo"></a>

**Decision:** Improve. **Source:** `src/pages/SamTodo.tsx` (224 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/sam-todo` | owner verified by server; wrappers: AuthenticatedShell, QueryShell, SamOnlyRoute | `{<ProtectedRoute requireAdmin><SamOnlyRoute><SamTodo /></SamOnlyRoute></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the private aggregate task queue simple with clear due context and explicit actions.

**Existing data/API calls:** rpc `sam_todo_list`; rpc `sam_todo_dismiss`; rpc `sam_todo_snooze`

**Existing helpers/components:** `@/hooks/useSamPrivateAccess`, `@/lib/privateTasks`.

**Baseline / current state:** Owner-gated keyed task list with pinned mutation tokens. Source SQL for the older RPCs is admin-only rather than Sam-only; live metadata and any database correction require separate proof.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SamTodo.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the private aggregate task queue simple with clear due context and explicit actions.
Decision: Improve. Routes: /dashboard/sam-todo.
Audience: owner verified by server. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Pending work → Source/due context → Snooze or dismiss.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain sam_todo_list/dismiss/snooze and owner-session/view checks. Preserve links back to source records; dismiss is not the same as completing an underlying business record.
Acceptance: Denied owner and RPC errors do not render an empty-success list; pending actions stop after account/view change.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/SamTodo.tsx:206`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                if (!longPressFired.current) dismiss.mutate(row);
              }}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
```

**Page-specific validation**

- Denied owner and RPC errors do not render an empty-success list; pending actions stop after account/view change.
- Verify the preserved source behavior: Retain sam_todo_list/dismiss/snooze and owner-session/view checks. Preserve links back to source records; dismiss is not the same as completing an underlying business record.
- Existing focused checks to inspect: `src/tests/pages/privateTaskPages.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Commission recovery — `CommissionRecovery`
<a id="page-commission-recovery"></a>

**Decision:** Keep. **Source:** `src/pages/admin/CommissionRecovery.tsx` (265 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/commission-recovery` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CommissionRecovery /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make policy recovery work actionable without implying the money is already paid.

**Existing data/API calls:** from `v_commission_recovery_by_agent`; from `v_commission_recovery_status`

**Existing helpers/components:** React and existing local/static content.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/CommissionRecovery.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make policy recovery work actionable without implying the money is already paid.
Decision: Keep. Routes: /dashboard/admin/commission-recovery.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Policies to recover → Per-agent follow-up queue → Missing-policy evidence.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_commission_recovery_by_agent/status and actual outreach status. Not emailed, emailed and responded are work states, not commission receipts.
Acceptance: Summary counts match their record scope; unknown policy/commission facts remain explicit; no outreach is sent during layout work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Metric` expression below is copied from `src/pages/admin/CommissionRecovery.tsx:157`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Metric label="Policies to recover" value={totals.total} tone="text-rose-300" />
```

**Page-specific validation**

- Summary counts match their record scope; unknown policy/commission facts remain explicit; no outreach is sent during layout work.
- Verify the preserved source behavior: Retain v_commission_recovery_by_agent/status and actual outreach status. Not emailed, emailed and responded are work states, not commission receipts.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Embedded Issue & pay — MyCommissions and CommissionWorkspace
<a id="embedded-issue-and-pay"></a>

**Owner route:** `/dashboard/finances`, personal tab. This is central implementation work even though MyCommissions no longer has a separate page route. Sources: `src/pages/MyCommissions.tsx`, `src/components/finances/CommissionWorkspace.tsx`, `src/lib/commissionLedger.ts`.

```text
Improve the personal Issue & pay surface inside Finances without using admin Management estimates. Keep existing identity/RLS completeness handling, ledger reconciliation, account keys and QueryState gates.
Prioritize recorded commission paid YTD, pending open-deal commission and recorded clawbacks, then payment-date trend and policy/ledger detail. Status charts are row counts. Preserve exact payout-rate and estimate-source labels, selected year/month and original record details.
Issued & paid AP stays Unavailable until a verified premium-payment source exists. A policy status/effective date or paid commission record is not proof of an issued-and-paid premium amount or bank cash. Exclude undated/future-dated paid entries from the paid total using the existing helper.
Use CommissionOverview, CommissionCharts and CommissionPolicyLedger with their actual existing props. Charts mount only for complete ledger visibility; a merged identity with restricted ledger access must not show an apparent zero or combine an inaccessible ledger with another record’s production.
Retain rate/estimate/matching detail in the existing disclosure. Test paid dates, future/undated entries, open versus closed pending deals, clawbacks, restricted identity, failed reads, account switch, and selected policy detail using synthetic records.
```

**Existing guarded render seam** from `src/pages/MyCommissions.tsx:373`. Keep it inside the existing outer `gate ?? (...)` branch. All variables and imports remain in MyCommissions; this is not a new query model.

```tsx
<QueryState {...describeQuery({ ...ledger, isEmpty: false })} label="the commission ledger" onRetry={retryAll} asOf={ledger.dataUpdatedAt}>
            {visibility === "restricted" && <p className="mb-4 text-sm text-amber-800 dark:text-amber-300">
              This login reaches {mergedRecordName} through a merge. That record&apos;s commission ledger is visible only to its own login. Ask an admin to relink this login.
            </p>}
            <div className="space-y-5">
              <CommissionOverview ledgerRows={ledgerRows ?? []} todayKey={todayKey} hiddenLabel={ledgerHiddenText} />
              <QueryState status={sectionStatus} onRetry={retryAll} label="the commission ledger"
                title={visibility === "restricted" ? "Nothing to show for this login" : "No commission rows yet"}
                body={visibility === "restricted" ? "No posted production is on file for this agent record, and its commission ledger is not visible to this login." : "No ledger rows and no posted production are on file for this agent record."}>
                <div className="space-y-5">
                  <InlineReadNotice label="production estimates" read={estimates} onRetry={() => void estimates.refetch()} />
                  <InlineReadNotice label="your contract rate" read={contract} onRetry={() => void contract.refetch()} />
                  {visibility === "complete" && <CommissionCharts ledgerRows={ledgerRows ?? []} rows={reconciled.rows} todayKey={todayKey} />}
                  <CommissionPolicyLedger key={`${user?.id}:${agentId}`} rows={reconciled.rows} todayKey={todayKey} ledgerHiddenText={ledgerHiddenText} hasProduction={production !== null} />
                  <details className="rounded-xl border border-border bg-card p-4 sm:p-5">
                    <summary className="cursor-pointer text-base font-bold">Rates, estimates &amp; record matching</summary>
                    <div className="mt-4 space-y-4 text-sm text-muted-foreground">
                      <p>Ledger rows use their recorded payout rate. Contract estimates are separate amounts and are never added to paid cash. A source status or an effective date does not prove an issue date or a premium payment.</p>
                      {production === null && <p>Production estimates could not load, so this list holds ledger rows only and nothing is paired.</p>}
                      {rateVerdict === "not_on_file" && <p>Your contract rate is not on file, so estimate amounts are not shown.</p>}
                      {rateVerdict === "unknown" && <p>Your contract rate could not be verified, so estimate amounts are hidden until it loads.</p>}
                      <p>{countParts.join(" · ")}</p>
                      <p className="font-semibold text-foreground">Posted-production contract estimate: {estimateTotalText}</p>
                      <QueryState {...describeQuery(commissionTypes)} label="commission estimates" onRetry={() => void commissionTypes.refetch()} asOf={commissionTypes.dataUpdatedAt}>
                        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tiles.map(tile => <div key={tile.id} className="rounded-lg border border-border p-4">
                          <dt className="font-semibold text-foreground">{tile.label}</dt><dd className="galaxy-stat mt-2 text-2xl font-black tabular-nums text-foreground">{tile.figure.kind === "amount" ? money(tile.figure.amount) : tile.figure.text}</dd><dd className="mt-2">{tile.detail}</dd>
                        </div>)}</dl>
                      </QueryState>
                    </div>
                  </details>
                </div>
              </QueryState>
            </div>
          </QueryState>
```
