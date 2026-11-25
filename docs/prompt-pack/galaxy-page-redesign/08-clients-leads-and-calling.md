# Clients, leads and calling

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Book health — `BookOfBusiness`
<a id="page-book-of-business"></a>

**Decision:** Keep distinct retention workflow; consolidate discovery only after exact parity. **Source:** `src/pages/BookOfBusiness.tsx` (3018 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/retention` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><BookOfBusiness /></ProtectedRoute>}` |
| `/dashboard/book-of-business` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><BookOfBusiness /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep retention, chargeback and historical policy evidence distinct from the current sales pipeline.

**Existing data/API calls:** from `agents`; rpc `my_downline_agent_ids`; from `v_agentlink_book_truth`; from `v_book_status_segments`; from `v_chargeback_watch`; from `v_book_persistency`; from `v_book_concentration`; from `agentlink_deals_snapshot`; from `agentlink_carriers`; from `ethos_book_policies`; from `carriers`; from `deals`; from `agentlink_clients`; from `application_contact_log`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`, `@/components/dashboard/AgentNameLink`, `@/components/dashboard/BookAuditPanel`.

**Baseline / current state:** Same BookOfBusiness implementation without a pathname-selected retention view. Keep policy-health graphs/workflow and improve naming; not equivalent to MyDeals.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BookOfBusiness.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep retention, chargeback and historical policy evidence distinct from the current sales pipeline.
Decision: Keep distinct retention workflow; consolidate discovery only after exact parity. Routes: /dashboard/retention, /dashboard/book-of-business.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Book/status health → Persistency and carrier concentration → Recovery/review records.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain full scoped historical sources, chargeback/persistency/concentration graphs and existing review-queue actions. Finances policies and My Pipeline do not replace these retention workflows.
Acceptance: Historical versus live-carrier evidence stays labeled; errors are not zero premium; all existing graphs and policy drill-downs survive any contextual merge.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `BookAuditPanel` expression below is copied from `src/pages/BookOfBusiness.tsx:1361`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<BookAuditPanel />
```

**Page-specific validation**

- Historical versus live-carrier evidence stays labeled; errors are not zero premium; all existing graphs and policy drill-downs survive any contextual merge.
- Verify the preserved source behavior: Retain full scoped historical sources, chargeback/persistency/concentration graphs and existing review-queue actions. Finances policies and My Pipeline do not replace these retention workflows.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Aged recruiting leads — `DashboardAgedLeads`
<a id="page-dashboard-aged-leads"></a>

**Decision:** Keep. **Source:** `src/pages/DashboardAgedLeads.tsx` (1352 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/aged-leads` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<DashboardAgedLeads />}` |

**Observed behavior and source contract**

Keep assignment, contact work and protective states clear in this legacy lead queue.

**Existing data/API calls:** from `agents`; from `user_roles`; from `profiles`; from `aged_leads`; from `banned_prospects`; from `deleted_leads`; invoke `dedupe-aged-leads`; invoke `notify-lead-assigned`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`, `@/components/dashboard/CallModeInterface`, `@/components/dashboard/AgedLeadImporter`, `@/components/dashboard/AnimatedNumber`, `@/components/callcenter/ResendLicensingButton`, `@/hooks/useSoundEffects`, `@/components/dashboard/QuickAssignMenu`, `@/components/recruiter/LeadDetailSheet`, `@/lib/phone`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardAgedLeads.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep assignment, contact work and protective states clear in this legacy lead queue.
Decision: Keep. Routes: /dashboard/aged-leads.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current assigned work → Source/owner and stage → Explicit assign/contact/delete actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain aged_leads, banned-prospect and deleted-lead handling, existing dedupe/assignment notifications and roles. These are recruiting records, not the new consumer import pool.
Acceptance: No-leads versus filters-hiding-results differs; assignment scope stays authorized; banned/deleted records cannot silently return to active work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/DashboardAgedLeads.tsx:730`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard variant="subtle" className="p-3.5">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg ", stat.gradient)}>
                  <stat.icon className="h-4 w-4 text-foreground/80" />
                </div>
                <div>
                  <AnimatedNumber value={stat.value} className="text-xl font-bold" />
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </GlassCard>
```

**Page-specific validation**

- No-leads versus filters-hiding-results differs; assignment scope stays authorized; banned/deleted records cannot silently return to active work.
- Verify the preserved source behavior: Retain aged_leads, banned-prospect and deleted-lead handling, existing dedupe/assignment notifications and roles. These are recruiting records, not the new consumer import pool.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Client detail — `ClientDetail`
<a id="page-client-detail"></a>

**Decision:** Keep. **Source:** `src/pages/ClientDetail.tsx` (359 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/clients/:clientId` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ClientDetail /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the current client’s next action, contact context and policy history easy to read.

**Existing data/API calls:** from `agentlink_clients`; from `client_pipeline_overrides`; from `agentlink_beneficiaries`; from `v_production_unified`; from `client_pipeline_activity`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/components/clients/ClientCallWorkspace`, `@/components/clients/ClientCallHistory`, `@/components/clients/SoldCallPanel`, `@/components/deals/SubmitDealDialog`, `@/lib/utils`, `@/lib/phone`, `@/lib/clientPipelineView`.

**Baseline / current state:** Current local release exposes the server-authorized private-copy lookup independently of raw-provider text permissions, and the sold-call timestamp targets shared playback. Raw transcript restrictions remain in place.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ClientDetail.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the current client’s next action, contact context and policy history easy to read.
Decision: Keep. Routes: /dashboard/clients/:clientId.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Client identity and next action → Contact/call activity → Policies and beneficiaries.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain clientId, navigation return context, client_pipeline_overrides/activity and authorized beneficiary/production data. Pipeline stage is an operational override, not issued-policy status. ClientCallHistory keeps raw transcript restrictions while checking ReadyMode source_id through the authorized private player independently of raw_provider_access. SoldCallPanel uses its call_id and private seek events, not provider-link presence.
Acceptance: Missing/denied client and errors differ; mutation receipt controls stage changes; raw text/URLs stay hidden; authorized private-copy lookup is still available; account changes remove old players; a timestamp with duplicate same-call players triggers only one playback.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ClientCallHistory` expression below is copied from `src/pages/ClientDetail.tsx:331`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ClientCallHistory key={clientId} clientId={clientId!} />
```

**Page-specific validation**

- Missing/denied client and errors differ; mutation receipt controls stage changes; raw text/URLs stay hidden; authorized private-copy lookup is still available; account changes remove old players; a timestamp with duplicate same-call players triggers only one playback.
- Verify the preserved source behavior: Retain clientId, navigation return context, client_pipeline_overrides/activity and authorized beneficiary/production data. Pipeline stage is an operational override, not issued-policy status. ClientCallHistory keeps raw transcript restrictions while checking ReadyMode source_id through the authorized private player independently of raw_provider_access. SoldCallPanel uses its call_id and private seek events, not provider-link presence.
- Existing focused checks to inspect: `src/tests/lib/clientFastCallPipeline.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Buy leads — `PurchaseLeads`
<a id="page-purchase-leads"></a>

**Decision:** Keep. **Source:** `src/pages/PurchaseLeads.tsx` (490 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/purchase-leads` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<PurchaseLeads />}` |

**Observed behavior and source contract**

Make real package choice, quantity and checkout terms clear.

**Existing data/API calls:** from `agents`; invoke `create-lead-checkout`; from `system_settings`; from `lead_counter`

**Existing helpers/components:** `@/components/dashboard/LeadPaymentTracker`, `@/components/dashboard/FreeLeadsStatusCard`, `@/hooks/useAuth`, `@/hooks/useSoundEffects`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PurchaseLeads.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make real package choice, quantity and checkout terms clear.
Decision: Keep. Routes: /purchase-leads.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Actual package/price → Quantity and eligibility → Existing checkout.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain create-lead-checkout, agent identity, lead_counter and the current storefront price contract. A countdown or package description is not verified live availability or future sales.
Acceptance: Price/quantity validate before checkout; failed provider session does not show paid; any inventory or urgency claim has real evidence.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/PurchaseLeads.tsx:267`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card className="border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-amber-200">Login required</p>
                <p className="text-sm text-muted-foreground">
                  Lead purchases must be attached to your agent profile before Stripe checkout starts.
                </p>
              </div>
              <Button asChild>
                <Link to="/login">Log in</Link>
              </Button>
            </div>
          </Card>
```

**Page-specific validation**

- Price/quantity validate before checkout; failed provider session does not show paid; any inventory or urgency claim has real evidence.
- Verify the preserved source behavior: Retain create-lead-checkout, agent identity, lead_counter and the current storefront price contract. A countdown or package description is not verified live availability or future sales.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Call center — `CallCenter`
<a id="page-call-center"></a>

**Decision:** Keep. **Source:** `src/pages/CallCenter.tsx` (2037 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/call-center` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallCenter /></ProtectedRoute>}` |

**Observed behavior and source contract**

Prioritize the current callable record, disposition and saved next step.

**Existing data/API calls:** from `aged_leads`; from `applications`; invoke `send-post-call-followup`; rpc `log_contact_attempt`; rpc `unified_mark_phone_bad`; invoke `send-licensing-instructions`; invoke `notify-hire-announcement`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useAgentIdentity`, `@/lib/queryState`, `@/lib/callCenterQueue`, `@/hooks/useSoundEffects`, `@/components/dashboard/ContractedModal`, `@/components/dashboard/ConfettiCelebration`, `@/components/callcenter/HireConfirmModal`, `@/components/dashboard/InterviewScheduler`, `@/components/dashboard/ApplicationDetailSheet`, `@/lib/nextBestAction`, `@/lib/priority`, `@/lib/phone`, `@/lib/utils`.

**Baseline / current state:** Daily calling workflow used by producers and VAs. Preserve recording and queue operations.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallCenter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Prioritize the current callable record, disposition and saved next step.
Decision: Keep. Routes: /dashboard/call-center.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current contact → Call/recording state → Disposition and next record.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain access checks, agent resolution, queue filters, closed-record controls, recorder behavior, contact logging and explicit follow-up/hire actions. Do not initiate calls/messages or lose notes during visual changes.
Acceptance: Denied mic/recording/save failures are actionable; pending notes cannot silently disappear; queue advancement follows actual saved outcomes.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/CallCenter.tsx:282`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState
        status="error"
        label="your agent record"
        error={`${access.identityError} You can still dial under your staff role; hires and contracts need the record.`}
        onRetry={onRetry}
        compact
      />
```

**Page-specific validation**

- Denied mic/recording/save failures are actionable; pending notes cannot silently disappear; queue advancement follows actual saved outcomes.
- Verify the preserved source behavior: Retain access checks, agent resolution, queue filters, closed-record controls, recorder behavior, contact logging and explicit follow-up/hire actions. Do not initiate calls/messages or lose notes during visual changes.
- Existing focused checks to inspect: `src/tests/lib/callCenterQueue.test.ts`, `src/tests/lib/contactLogChannelWrites.test.ts`, `src/tests/pages/callCenterSession.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Calls today — `CallsTodayCockpit`
<a id="page-calls-today-cockpit"></a>

**Decision:** Keep. **Source:** `src/pages/CallsTodayCockpit.tsx` (399 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/calls-today` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallsTodayCockpit /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show the current call agenda and overdue/tomorrow context without duplicating the calendar.

**Existing data/API calls:** from `interview_events`

**Existing helpers/components:** `@/lib/phone`, `@/hooks/usePageTitle`.

**Baseline / current state:** Focused scheduled-call cockpit; keep contextual access from Calendar and preserve provider/event metadata.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallsTodayCockpit.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show the current call agenda and overdue/tomorrow context without duplicating the calendar.
Decision: Keep. Routes: /dashboard/calls-today.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Today’s calls → Overdue or tomorrow work → Existing call/detail action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain interview_events and date grouping. An appointment is not an attended interview or completed sale; preserve cancellation and source-state meaning.
Acceptance: Phoenix/current business date rules remain; no-data and failed fetch differ; call/detail links retain the intended record.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CallsTodayHero` expression below is copied from `src/pages/CallsTodayCockpit.tsx:141`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CallsTodayHero calls={callsQ.data ?? []} todayCalls={grouped.today} />
```

**Page-specific validation**

- Phoenix/current business date rules remain; no-data and failed fetch differ; call/detail links retain the intended record.
- Verify the preserved source behavior: Retain interview_events and date grouping. An appointment is not an attended interview or completed sale; preserve cancellation and source-state meaning.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My pipeline — `ClientPipeline`
<a id="page-client-pipeline"></a>

**Decision:** Keep. **Source:** `src/pages/ClientPipeline.tsx` (829 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agent-pipeline` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ClientPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the client next-action list and fast-call workflow prominent.

**Existing data/API calls:** from `agentlink_clients`; from `client_pipeline_overrides`; from `agents`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useAgentIdentity`, `@/hooks/useSoldCallKeys`, `@/hooks/usePageTitle`, `@/components/recruiting/GrowScoreboard`, `@/lib/phone`, `@/lib/personInitials`, `@/lib/tones`, `@/lib/utils`, `@/lib/clientPipelineView`.

**Baseline / current state:** Canonical consumer next-action/call workflow retained. Duplicate URLs redirect here. Existing admin Import now opens /dashboard/consumer-import, not the licensing/XCEL importer.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ClientPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the client next-action list and fast-call workflow prominent.
Decision: Keep. Routes: /dashboard/agent-pipeline.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Next client → Stage/follow-up filters → Start call and save outcome.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve whole-book loading, agent identity and overrides, manager scope, URL filters and private call evidence. Existing Import consumers correctly points to /dashboard/consumer-import; licensing import stays separate.
Acceptance: Full filtered totals match rows; account changes isolate caches; client-call entry keeps notes and authorized recording controls.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `UpNextClient` expression below is copied from `src/pages/ClientPipeline.tsx:359`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<UpNextClient
          key={upNext.id}
          className="order-2 sm:order-6"
          client={upNext}
          now={now}
          owner={ownerOf(upNext)}
          soldCall={soldCall(upNext)}
          backState={backState}
          onOpen={() => openClient(upNext.id)}
        />
```

**Page-specific validation**

- Full filtered totals match rows; account changes isolate caches; client-call entry keeps notes and authorized recording controls.
- Verify the preserved source behavior: Preserve whole-book loading, agent identity and overrides, manager scope, URL filters and private call evidence. Existing Import consumers correctly points to /dashboard/consumer-import; licensing import stays separate.
- Existing focused checks to inspect: `src/tests/lib/clientFastCallPipeline.test.ts`, `src/tests/pages/ClientPipeline.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Calendar — `CalendarPage`
<a id="page-calendar-page"></a>

**Decision:** Keep. **Source:** `src/pages/CalendarPage.tsx` (1304 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/calendar` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<CalendarPage />}` |

**Observed behavior and source contract**

Make the selected period, appointment conflicts and next event readable.

**Existing data/API calls:** from `applications`; rpc `calendar_window_counts`; from `profiles`; from `calendar_events`; invoke `schedule-auto-populate`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useBusinessToday`, `@/components/dashboard/InterviewScheduler`, `@/lib/utils`, `@/hooks/useSoundEffects`, `@/components/calendar/AgendaList`, `@/components/calendar/ProviderHealthPanel`, `@/components/calendar/TimeZoneSelect`, `@/components/calendar/ConflictNotice`, `@/components/calendar/InterviewEventDialogs`, `@/components/calendar/calendarPrefs`, `@/components/calendar/calendarApi`, `@/lib/calendarAgenda`, `@/lib/calendarTime`.

**Baseline / current state:** Canonical scheduling surface. Sidebar duplicates are intentional role fallbacks, already de-duplicated for owner.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CalendarPage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the selected period, appointment conflicts and next event readable.
Decision: Keep. Routes: /dashboard/calendar.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Period/date controls → Existing event sources → Explicit create/edit/cancel.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain calendar_window_counts, current event-source labels, owner conflicts and scheduled-event mutations. Do not collapse interviews, onboarding and manual appointments into one unsupported status.
Acceptance: Views share counts/window; account changes clear prior events; cancellation/creation failure stays explicit; no automatic calendar invite is added.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/CalendarPage.tsx:1265`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" compact label="lead search" error={search.error} onRetry={() => void runSearch(searchQuery)} />
```

**Page-specific validation**

- Views share counts/window; account changes clear prior events; cancellation/creation failure stays explicit; no automatic calendar invite is added.
- Verify the preserved source behavior: Retain calendar_window_counts, current event-source labels, owner conflicts and scheduled-event mutations. Do not collapse interviews, onboarding and manual appointments into one unsupported status.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/lib/calendarInView.test.ts`, `src/tests/lib/calendarOneEventContract.test.ts`, `src/tests/pages/calendarPageTruth.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Planning calendar — `AdminCalendar`
<a id="page-admin-calendar"></a>

**Decision:** Internal. **Source:** `src/pages/AdminCalendar.tsx` (821 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/planner` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminCalendar /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the owner/admin time-block planner and schedule scan distinct from customer appointments.

**Existing data/API calls:** from `recurring_calendar_blocks`; from `admin_calendar_blocks`; invoke `parse-schedule-image`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useSoundEffects`, `@/lib/utils`, `@/hooks/use-mobile`.

**Baseline / current state:** Admin recurring schedule blocks differ from agent calendar. Keep contextual admin access; do not combine data scopes.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminCalendar.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the owner/admin time-block planner and schedule scan distinct from customer appointments.
Decision: Internal. Routes: /dashboard/planner.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Time blocks and recurrence → Edit/drag controls → Reviewed scan import.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain recurring/admin blocks, drag/drop semantics and parse-schedule-image. Parsed suggestions require review; they are not automatically authoritative calendar events.
Acceptance: Timezone/duration and recurring edits remain correct; failed parse/save is explicit; no imported block is committed solely by rendering a preview.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/AdminCalendar.tsx:161`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onToggle} title="Toggle complete">
            <Check className={cn("h-3.5 w-3.5", block.completed ? "text-emerald-400" : "text-muted-foreground")} />
          </Button>
```

**Page-specific validation**

- Timezone/duration and recurring edits remain correct; failed parse/save is explicit; no imported block is committed solely by rendering a preview.
- Verify the preserved source behavior: Retain recurring/admin blocks, drag/drop semantics and parse-schedule-image. Parsed suggestions require review; they are not automatically authoritative calendar events.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Client messaging tools — `ClientMarketing`
<a id="page-client-marketing"></a>

**Decision:** Keep. **Source:** `src/pages/ClientMarketing.tsx` (324 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/client-marketing` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ClientMarketing /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep client copy templates easy to use while preserving the separate authorized recruiting panel.

**Existing data/API calls:** from `applications`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/hooks/useRolePreview`, `@/lib/utils`.

**Baseline / current state:** Client copy templates remain available. Recruiting Funnels mounts and queries only for an authorized recruiting role outside preview; viewer/access-key scoping prevents cross-role cached funnel content.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ClientMarketing.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep client copy templates easy to use while preserving the separate authorized recruiting panel.
Decision: Keep. Routes: /dashboard/client-marketing.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Client lifecycle template → Copy-ready text → Authorized recruiting context only.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Baseline gates Recruiting Funnels by real recruiting access outside preview and scopes its query by viewer/access. Copying a template is not sending; keep recipient data out of logs.
Acceptance: Unauthorized users never mount/query recruiting data; clipboard failure is honest; template categories and canonical pipeline link remain.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `MarketingTabs` expression below is copied from `src/pages/ClientMarketing.tsx:230`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<MarketingTabs view="clients" canUseFunnels={canUseFunnels} onChange={value => { if (value === "clients" || canUseFunnels) setView(value); }} />
```

**Page-specific validation**

- Unauthorized users never mount/query recruiting data; clipboard failure is honest; template categories and canonical pipeline link remain.
- Verify the preserved source behavior: Baseline gates Recruiting Funnels by real recruiting access outside preview and scopes its query by viewer/access. Copying a template is not sending; keep recipient data out of logs.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/pages/ClientMarketing.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Calling card — `CallingCards`
<a id="page-calling-cards"></a>

**Decision:** Consolidate discovery into Producer Profile; keep card/share tool. **Source:** `src/pages/CallingCards.tsx` (228 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/calling-cards` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallingCards /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the agent’s profile-based share card as a useful Profile sub-workflow.

**Existing data/API calls:** from `profiles`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`.

**Baseline / current state:** Profile-derived share tools can be contextual profile actions. Preserve public link/QR/share behavior.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallingCards.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the agent’s profile-based share card as a useful Profile sub-workflow.
Decision: Consolidate discovery into Producer Profile; keep card/share tool. Routes: /dashboard/calling-cards.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Actual profile identity → Selected card style → Copy, QR or manual share.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain real profile values and current share destinations. Do not invent licensing credentials, ratings or contact details; moving discovery under Profile must keep export/share parity.
Acceptance: Missing photo/contact fields stay absent; copied URL is correct; manual sharing and mobile layout work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/CallingCards.tsx:155`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button onClick={copyLink} className="w-full" variant="outline">
              {copied ? <><Check className="h-3.5 w-3.5 mr-2" /> Copied!</> : <><Copy className="h-3.5 w-3.5 mr-2" /> Copy Link</>}
            </Button>
```

**Page-specific validation**

- Missing photo/contact fields stay absent; copied URL is correct; manual sharing and mobile layout work.
- Verify the preserved source behavior: Retain real profile values and current share destinations. Do not invent licensing credentials, ratings or contact details; moving discovery under Profile must keep export/share parity.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My public page — `MyLandingPage`
<a id="page-my-landing-page"></a>

**Decision:** Consolidate discovery into Producer Profile; retain preview/share workflow. **Source:** `src/pages/MyLandingPage.tsx` (260 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/landing-page` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyLandingPage /></ProtectedRoute>}` |

**Observed behavior and source contract**

Give the agent a truthful preview and a clear path to edit the underlying profile.

**Existing data/API calls:** from `profiles`; from `agents`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`.

**Baseline / current state:** Profile-derived landing preview belongs beside calling card/share links, not another primary page.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyLandingPage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Give the agent a truthful preview and a clear path to edit the underlying profile.
Decision: Consolidate discovery into Producer Profile; retain preview/share workflow. Routes: /dashboard/landing-page.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Public profile preview → Profile edit link → Copy/open public URL.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain profiles/agents source and current public route. Preview does not publish a new page or change profile data automatically.
Acceptance: Current account’s URL and identity match; missing fields stay explicit; copy feedback is actual success.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/MyLandingPage.tsx:244`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
            <CardContent className="p-4">
              <h3 className="text-13 font-bold mb-2 flex items-center gap-1.5"><Share2 className="h-3.5 w-3.5 text-emerald-500" /> Share Tips</h3>
              <ul className="text-12 text-foreground/80 space-y-1.5">
                <li>• Pin the URL in your IG bio</li>
                <li>• Drop it in your email signature</li>
                <li>• QR code on physical biz cards (Calling Cards page)</li>
                <li>• DM the link instead of asking for phone numbers</li>
              </ul>
            </CardContent>
          </Card>
```

**Page-specific validation**

- Current account’s URL and identity match; missing fields stay explicit; copy feedback is actual success.
- Verify the preserved source behavior: Retain profiles/agents source and current public route. Preview does not publish a new page or change profile data automatically.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Coverage needs — `NeedsAnalysis`
<a id="page-needs-analysis"></a>

**Decision:** Keep. **Source:** `src/pages/NeedsAnalysis.tsx` (200 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/needs-analysis` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><NeedsAnalysis /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing client-input calculator clear about assumptions and units.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Real DIME calculator has distinct client-call value. Keep contextual access; no need for primary sidebar.

**Copy-ready implementation prompt**

```text
Work only on src/pages/NeedsAnalysis.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing client-input calculator clear about assumptions and units.
Decision: Keep. Routes: /dashboard/needs-analysis.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Client-entered inputs → Calculated coverage need → Reset or manual share.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain actual formulas and editable assumptions. This is an illustrative needs calculation, not underwriting approval, a carrier quote or guaranteed recommendation.
Acceptance: Zero, missing, negative and very large input handling is correct; currency/years units stay visible; no fabricated client data is prefilled.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Input` expression below is copied from `src/pages/NeedsAnalysis.tsx:84`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Input
        type="text" inputMode="decimal"
        value={val}
        onChange={(e: any) => set(e.target.value)}
        placeholder="0"
      />
```

**Page-specific validation**

- Zero, missing, negative and very large input handling is correct; currency/years units stay visible; no fabricated client data is prefilled.
- Verify the preserved source behavior: Retain actual formulas and editable assumptions. This is an illustrative needs calculation, not underwriting approval, a carrier quote or guaranteed recommendation.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Illustrative quote tool — `Quoter`
<a id="page-quoter"></a>

**Decision:** Legacy illustration; do not promote as an authoritative quote engine. **Source:** `src/pages/Quoter.tsx` (277 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/quoter` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Quoter /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep this legacy rate illustration explicitly labeled until a verified carrier quoting integration exists.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Illustrative hard-coded rate table, not a carrier rate engine. Keep out of daily selling nav; retain only clearly labeled training reference until verified rates exist.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Quoter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this legacy rate illustration explicitly labeled until a verified carrier quoting integration exists.
Decision: Legacy illustration; do not promote as an authoritative quote engine. Routes: /dashboard/quoter.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Input assumptions → Illustrative result → Clear source/limitations.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The source has hard-coded tables. Do not label these as live rates, guaranteed premiums or a bindable offer; preserve current formulas only as an illustration pending authoritative verification.
Acceptance: Age/product/amount combinations and invalid inputs are tested; units/assumptions remain visible and no invented carrier API is introduced.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/Quoter.tsx:240`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent className="p-8 text-center text-13 text-muted-foreground">
          <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Age {age} is outside our rate bands. Adjust between 18–89 to pull a quote — most Galaxy closes sit 50–75.
        </CardContent></Card>
```

**Page-specific validation**

- Age/product/amount combinations and invalid inputs are tested; units/assumptions remain visible and no invented carrier API is introduced.
- Verify the preserved source behavior: The source has hard-coded tables. Do not label these as live rates, guaranteed premiums or a bindable offer; preserve current formulas only as an illustration pending authoritative verification.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Bulk deal import — `BulkDeals`
<a id="page-bulk-deals"></a>

**Decision:** Keep. **Source:** `src/pages/BulkDeals.tsx` (254 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/bulk-deals` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><BulkDeals /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep parse, match and commit stages explicit for authorized bulk production entry.

**Existing data/API calls:** from `agents`; from `carriers`; from `deals`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BulkDeals.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep parse, match and commit stages explicit for authorized bulk production entry.
Decision: Keep. Routes: /dashboard/bulk-deals.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Raw input and parse result → Agent/carrier matches → Explicit commit receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain existing agents/carriers/deals matching and canonical posted_at semantics. Do not guess identities or convert unmatched rows into successful production.
Acceptance: Invalid/unmatched/duplicate rows remain visible; no insert before commit; receipt counts match persisted outcomes.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/BulkDeals.tsx:186`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4 space-y-3">
        <label className="text-sm font-medium">Paste raw deal text</label>
        <Textarea value={raw} onChange={e => setRaw(e.target.value)} rows={16}
          className="font-mono text-xs"
          placeholder="Agent / Carrier / Product / Policy#—$Monthly $Annual Eff-Date Sub-Date / CLIENT"/>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onParse} variant="outline" size="sm">Parse</Button>
          <Button onClick={insertAll} size="sm" disabled={loading || parsed.length === 0}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <DollarSign className="h-3.5 w-3.5 mr-1.5" />}
            Insert {parsed.length} deal{parsed.length === 1 ? "" : "s"}
          </Button>
          {parsed.length > 0 && (
            <>
              <Badge variant="outline" className="ml-2">Monthly ${totalMonthly.toFixed(2)}</Badge>
              <Badge variant="outline">ALP ${totalAnnual.toLocaleString()}</Badge>
            </>
          )}
        </div>
      </GlassCard>
```

**Page-specific validation**

- Invalid/unmatched/duplicate rows remain visible; no insert before commit; receipt counts match persisted outcomes.
- Verify the preserved source behavior: Retain existing agents/carriers/deals matching and canonical posted_at semantics. Do not guess identities or convert unmatched rows into successful production.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Book reconciliation — `BookReconciliation`
<a id="page-book-reconciliation"></a>

**Decision:** Keep. **Source:** `src/pages/BookReconciliation.tsx` (651 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/book-quality` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><BookReconciliation /></ProtectedRoute>}` |

**Observed behavior and source contract**

Put verified mismatches and unsupported writes ahead of headline estimates.

**Existing data/API calls:** from `v_carrier_book_summary`; from `v_carrier_book_recon`; from `v_lapsed_recovery`; from `v_duplicate_policies`; from `v_ghost_deals`; from `v_falloff_watch`; from `v_agent_quality_score`; from `v_carrier_money_leak`; rpc `carrier_command`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/admin/CarrierPasteDialog`.

**Baseline / current state:** Distinct reconciliation and recovery work. Preserve carrier comparisons, discrepancy graphs and embedded Book Flips.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BookReconciliation.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Put verified mismatches and unsupported writes ahead of headline estimates.
Decision: Keep. Routes: /dashboard/book-quality.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Live premium/evidence gaps → Ghost/duplicate/falloff records → Carrier/source review.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain carrier book/recovery/quality views and carrier_command evidence. Estimated lost commission is not realized loss or recovered money; imports/paste remain explicit.
Acceptance: Unknown source remains unknown; each metric drills into the matching queue; no automatic repair or unsafe carrier write occurs.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `BigStat` expression below is copied from `src/pages/BookReconciliation.tsx:290`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<BigStat
          icon={Banknote}
          label="Live premium tracked"
          value={fmtUsd(s?.live_premium, true)}
          sub={`${fmtNum(s?.total_policies)} policies across ${fmtNum(s?.distinct_carriers)} carriers`}
          color="text-emerald-500 dark:text-emerald-400"
          loading={summary.isLoading}
        />
```

**Page-specific validation**

- Unknown source remains unknown; each metric drills into the matching queue; no automatic repair or unsafe carrier write occurs.
- Verify the preserved source behavior: Retain carrier book/recovery/quality views and carrier_command evidence. Estimated lost commission is not realized loss or recovered money; imports/paste remain explicit.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Book opportunities — `BookFlips`
<a id="page-book-flips"></a>

**Decision:** Keep. **Source:** `src/pages/BookFlips.tsx` (723 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/books` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><BookFlips /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the worklist grounded in policy and call evidence with a clear next action.

**Existing data/API calls:** from `v_book_flip_worklist`; from `v_book_flip_carrier_counts`; rpc `book_flip_set`

**Existing helpers/components:** `@/lib/dateUtils`, `@/lib/phone`, `@/lib/utils`, `@/lib/bookFlips`, `@/components/clients/SoldCallPanel`, `@/hooks/useSoldCallKeys`, `@/hooks/useResellEvidence`, `@/lib/clientFacts`, `@/components/books/FlipActions`, `@/components/resells/Evidence`, `@/lib/easyResells`, `@/lib/resellEvidence`, `@/lib/tones`, `@/lib/celebrate`.

**Baseline / current state:** Real recoverable-policy worklist already embedded in reconciliation; standalone URL supports Easy Resells deep links.

**Copy-ready implementation prompt**

```text
Work only on src/pages/BookFlips.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the worklist grounded in policy and call evidence with a clear next action.
Decision: Keep. Routes: /dashboard/books.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Eligible policy work → Carrier and evidence filters → Explicit outcome.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_book_flip_worklist/counts, book_flip_set and granted-call/resell evidence. A lead match or sold call is not proof of an active policy or suitability for replacement.
Acceptance: Permission gates and evidence labels remain; count filters reconcile; failed outcome does not remove the row as complete.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `EvidenceBoard` expression below is copied from `src/pages/BookFlips.tsx:389`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<EvidenceBoard
        counts={rows.isSuccess ? tileCounts : null}
        active={proof}
        onSelect={setProof}
        notice={boardNotice}
        hidden={seesSoldCalls ? undefined : new Set<EvidenceKey>(["ssn_bank"])}
      />
```

**Page-specific validation**

- Permission gates and evidence labels remain; count filters reconcile; failed outcome does not remove the row as complete.
- Verify the preserved source behavior: Retain v_book_flip_worklist/counts, book_flip_set and granted-call/resell evidence. A lead match or sold call is not proof of an active policy or suitability for replacement.
- Existing focused checks to inspect: `src/tests/pages/bookFlips.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Sold calls — `SoldCalls`
<a id="page-sold-calls"></a>

**Decision:** Keep. **Source:** `src/pages/SoldCalls.tsx` (671 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/sold-calls` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><SoldCalls /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep authorized call packets, policy match evidence and next action together.

**Existing data/API calls:** from `v_sold_calls_queue`; from `v_sold_call_packets`; from `v_sold_call_book_match`; rpc `booking_packets_sensitive_all`

**Existing helpers/components:** `@/lib/looseSupabase`, `@/hooks/useAuth`, `@/hooks/useSoldCallKeys`, `@/components/soldcalls/CallAccessManager`, `@/hooks/usePageTitle`, `@/lib/phone`, `@/lib/soldCallPacket`, `@/components/soldcalls/FixNumber`, `@/lib/utils`, `@/lib/clientFacts`, `@/components/soldcalls/ResellWork`, `@/lib/resellSignals`, `@/components/soldcalls/ObjectionCallList`, `@/components/calls/CallAudioPlayer`.

**Baseline / current state:** Granted call operations and review. Keep directly discoverable; preserve separate private/raw-media permissions.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SoldCalls.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep authorized call packets, policy match evidence and next action together.
Decision: Keep. Routes: /dashboard/sold-calls.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Recording/packet readiness → Client/policy evidence → Existing review or follow-up.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve granted-call access, sensitive packet RPC, raw-provider restrictions and secure audio player. The ReadyMode signer returns only the path/variant selected by caller-bound call_audio_for; an empty result means no copy available to that viewer, without distinguishing missing publication from denied access. A pending packet or call disposition is not an issued policy.
Acceptance: Private/muted copies remain server-authorized; denied/expired playback is actionable; unknown packet fields do not become fabricated values; do not add a raw-provider fallback after a signing denial.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CallAudioPlayer` expression below is copied from `src/pages/SoldCalls.tsx:547`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CallAudioPlayer callId={row.call_id} compact moments={momentsFrom((row as unknown as { key_moments?: unknown }).key_moments)} />
```

**Page-specific validation**

- Private/muted copies remain server-authorized; denied/expired playback is actionable; unknown packet fields do not become fabricated values; do not add a raw-provider fallback after a signing denial.
- Verify the preserved source behavior: Preserve granted-call access, sensitive packet RPC, raw-provider restrictions and secure audio player. The ReadyMode signer returns only the path/variant selected by caller-bound call_audio_for; an empty result means no copy available to that viewer, without distinguishing missing publication from denied access. A pending packet or call disposition is not an issued policy.
- Existing focused checks to inspect: `src/tests/pages/soldCalls.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Resell opportunities — `EasyResells`
<a id="page-easy-resells"></a>

**Decision:** Keep. **Source:** `src/pages/EasyResells.tsx` (427 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/easy-resells` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><EasyResells /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show evidence-backed follow-up opportunities without overstating eligibility.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useSoldCallKeys`, `@/hooks/useResellEvidence`, `@/components/books/FlipActions`, `@/components/deals/SubmitDealDialog`, `@/components/resells/Evidence`, `@/hooks/useBookClientDetails`, `@/lib/phone`, `@/lib/clientFacts`, `@/lib/bookFlips`, `@/lib/celebrate`, `@/lib/utils`, `@/components/calls/CallAudioPlayer`, `@/lib/tones`.

**Baseline / current state:** Granted ranked recovery workflow; retain direct access and the source records behind rankings.

**Copy-ready implementation prompt**

```text
Work only on src/pages/EasyResells.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show evidence-backed follow-up opportunities without overstating eligibility.
Decision: Keep. Routes: /dashboard/easy-resells.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Existing opportunity cohort → Policy/call evidence → Explicit next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain useCanViewSoldCalls/useResellEvidence and current update contract. Do not add implied approval, policy replacement advice or invented conversion/earnings metrics.
Acceptance: Missing evidence and denied access remain explicit; filters match list counts; action receipt controls removal or status change.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `EvidenceBoard` expression below is copied from `src/pages/EasyResells.tsx:140`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<EvidenceBoard
        counts={q.isSuccess ? tileCounts : null}
        active={proof}
        onSelect={(k) => { setProof(k); setShown(PAGE); }}
        notice={boardNotice}
      />
```

**Page-specific validation**

- Missing evidence and denied access remain explicit; filters match list counts; action receipt controls removal or status change.
- Verify the preserved source behavior: Retain useCanViewSoldCalls/useResellEvidence and current update contract. Do not add implied approval, policy replacement advice or invented conversion/earnings metrics.
- Existing focused checks to inspect: `src/tests/pages/easyResells.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Call training — `CallTraining`
<a id="page-call-training"></a>

**Decision:** Keep. **Source:** `src/pages/CallTraining.tsx` (368 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/call-training` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><CallTraining /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make authorized training calls, personal calls and review work easy to choose.

**Existing data/API calls:** from `v_call_training`; from `v_call_training_agents`

**Existing helpers/components:** `@/lib/looseSupabase`, `@/hooks/useAuth`, `@/hooks/useSoldCallKeys`, `@/hooks/usePageTitle`, `@/components/calls/CallAudioPlayer`, `@/components/calltraining/TrainingLibrary`, `@/components/calltraining/AgentCoachingCard`, `@/components/calltraining/CallReviewBoard`, `@/components/calls/CallClientPanel`, `@/components/calltraining/GradeBreakdown`, `@/lib/callAudio`, `@/lib/utils`, `@/lib/readymodeDispositions`, `@/components/calltraining/DialerActivityCard`.

**Baseline / current state:** Granted coaching operations are distinct from the general Training library. Keep direct access and matching grants.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallTraining.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make authorized training calls, personal calls and review work easy to choose.
Decision: Keep. Routes: /dashboard/call-training.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Training library or my calls → Actual review/coaching state → Secure playback and feedback.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain call grants, v_call_training/agents, TrainingLibrary and review/digest flows. Training media is not unrestricted provider audio; preserve private/muted copies and unknown review states. Shared call playback requests only internal callId; the server chooses full, numbers_muted or client_data_removed under existing RPC rules.
Acceptance: Denied playback, expired URL, missing transcript and failed review remain actionable; focus/reconnect does not restart audio; retry preserves position; tab/account scopes do not leak another account’s calls.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CallAudioPlayer` expression below is copied from `src/pages/CallTraining.tsx:295`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CallAudioPlayer callId={r.call_id} moments={[...moments.map((m) => ({ t: m.t, label: m.objection })), ...momentsFrom(r.key_quotes)]} />
```

**Page-specific validation**

- Denied playback, expired URL, missing transcript and failed review remain actionable; focus/reconnect does not restart audio; retry preserves position; tab/account scopes do not leak another account’s calls.
- Verify the preserved source behavior: Retain call grants, v_call_training/agents, TrainingLibrary and review/digest flows. Training media is not unrestricted provider audio; preserve private/muted copies and unknown review states. Shared call playback requests only internal callId; the server chooses full, numbers_muted or client_data_removed under existing RPC rules.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My lead pack — `MyLeads`
<a id="page-my-leads"></a>

**Decision:** Keep. **Source:** `src/pages/MyLeads.tsx` (678 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-leads` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyLeads /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the current lead, lawful calling availability and saved outcome the focus.

**Existing data/API calls:** rpc `my_lead_detail`; rpc `lead_item_add_recording`; rpc `my_lead_to_pipeline`; rpc `lead_bundle_item_log`; rpc `my_lead_source_history`; rpc `lead_bundle_followup_set`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/dashboard/LeadStatePrompt`, `@/lib/phone`, `@/lib/readymodeDispositions`, `@/lib/leadBundles`, `@/lib/leadDialTap`, `@/lib/leadManagerFilters`, `@/lib/myLeads`, `@/lib/utils`, `@/components/callcenter/CallCenterVoiceRecorder`.

**Baseline / current state:** The provider URL-only listen link is retained because my_lead_detail does not return a stable internal call ID. This source limitation is separate from the shared player repair; no server mapping is guessed and recorder capture/attachment changes are not claimed by this playback release.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyLeads.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the current lead, lawful calling availability and saved outcome the focus.
Decision: Keep. Routes: /dashboard/my-leads.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current eligible lead → Call/recording notes → Confirmed result and next lead.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain my_lead_detail, capture/upload/recording attachment, log, history, follow-up and pipeline-transfer RPCs. An upload alone is not an attachment receipt. Current call_recording detail exposes a provider URL without a stable internal callId, so that existing external listen link remains a known limitation; never guess a callId or call it repaired by the shared player.
Acceptance: Calling-hours/hold states block inappropriate actions; failed attachment must remain recoverable and cannot report a false save; advancing requires actual saved outcome. Replacing the provider link requires a separately verified server ID mapping and permissions.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CallCenterVoiceRecorder` expression below is copied from `src/pages/MyLeads.tsx:576`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CallCenterVoiceRecorder key={cur.item_id} {...recorderProps(cur.item_id)} className="rounded-lg border border-border/60 p-3" />
```

**Page-specific validation**

- Calling-hours/hold states block inappropriate actions; failed attachment must remain recoverable and cannot report a false save; advancing requires actual saved outcome. Replacing the provider link requires a separately verified server ID mapping and permissions.
- Verify the preserved source behavior: Retain my_lead_detail, capture/upload/recording attachment, log, history, follow-up and pipeline-transfer RPCs. An upload alone is not an attachment receipt. Current call_recording detail exposes a provider URL without a stable internal callId, so that existing external listen link remains a known limitation; never guess a callId or call it repaired by the shared player.
- Existing focused checks to inspect: `src/tests/lib/leadCallingHours.test.ts`, `src/tests/lib/leadDialTap.test.ts`, `src/tests/lib/leadPhoneReadymode.test.ts`, `src/tests/pages/myLeadsDialTap.test.tsx`, `src/tests/pages/myLeadsRecordingPipeline.test.tsx`, `src/tests/pages/myLeadsWorkList.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Lead operations — `LeadManager`
<a id="page-lead-manager"></a>

**Decision:** Consolidate duplicate URL; retain the lead operations workflow. **Source:** `src/pages/LeadManager.tsx` (1447 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/lead-manager` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><LeadManager /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep pool meaning, inventory controls and authorized allocation work clear.

**Existing data/API calls:** invoke `lead-recording-url`

**Existing helpers/components:** `@/components/calls/PrivateAudioPlayer`, `@/hooks/useAuth`, `@/lib/utils`, `@/lib/leadBundles`, `@/lib/leadManagerFilters`, `@/lib/dateUtils`.

**Baseline / current state:** Current local release replaces browser bucket signing with lead-recording-url plus the shared player. The UI list remains newest 40; the server signing allowlist reads newest 200 authorized receipts. This is not an unlimited historical recording catalog.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LeadManager.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep pool meaning, inventory controls and authorized allocation work clear.
Decision: Consolidate duplicate URL; retain the lead operations workflow. Routes: /dashboard/lead-manager.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected source pool → Protected holds and filters → Previewed assignment/review.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain source-specific pool APIs, roster checks, preview/commit distinction and protected do-not-call/current-client/review holds. Imported ownership and dialer sale signals do not prove an active policy. The recordings panel lists newest 40 caller-authorized receipts; lead-recording-url rechecks newest 200 through caller-bound lead_recordings_recent and signs only the exact returned callcenter/ path in call-recordings for recordingId.
Acceptance: Pool/state/age/campaign filters feed the actual preview; no assignment without explicit commit; all granted call operations remain. Missing/out-of-window/denied receipt is unavailable, not a guessed path; signing, playback error and account switch retain the shared player behavior.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PrivateAudioPlayer` expression below is copied from `src/pages/LeadManager.tsx:1358`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PrivateAudioPlayer sourceKey={`lead:${r.id}`} resolveSource={async () => {
                  const { data, error } = await supabase.functions.invoke("lead-recording-url", { body: { recordingId: r.id } });
                  if (error || !data || typeof data.signedUrl !== "string" || typeof data.expiresInSeconds !== "number") throw new Error("Recording access could not be verified.");
                  return { signedUrl: data.signedUrl, expiresInSeconds: data.expiresInSeconds };
                }} playOnLoad />
```

**Page-specific validation**

- Pool/state/age/campaign filters feed the actual preview; no assignment without explicit commit; all granted call operations remain. Missing/out-of-window/denied receipt is unavailable, not a guessed path; signing, playback error and account switch retain the shared player behavior.
- Verify the preserved source behavior: Retain source-specific pool APIs, roster checks, preview/commit distinction and protected do-not-call/current-client/review holds. Imported ownership and dialer sale signals do not prove an active policy. The recordings panel lists newest 40 caller-authorized receipts; lead-recording-url rechecks newest 200 through caller-bound lead_recordings_recent and signs only the exact returned callcenter/ path in call-recordings for recordingId.
- Existing focused checks to inspect: `src/tests/pages/leadManagerPools.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Consumer intake — `ConsumerLeadImport`
<a id="page-consumer-lead-import"></a>

**Decision:** Keep. **Source:** `src/pages/ConsumerLeadImport.tsx` (125 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/consumer-import` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><ConsumerLeadImport /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep consumer source meaning, parse preview and import receipt explicit.

**Existing data/API calls:** rpc `consumer_import_history`; rpc `consumer_import_review`; rpc `consumer_lead_import`

**Existing helpers/components:** `@/hooks/useAuth`, `@/components/leads/EthosConsumerCampaignPanel`, `@/lib/consumerLeadImport`.

**Baseline / current state:** Real consumer CSV review/import path. Keep reachable from the lead workflow; no imports executed by this audit.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ConsumerLeadImport.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep consumer source meaning, parse preview and import receipt explicit.
Decision: Keep. Routes: /dashboard/consumer-import.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Source/type mapping → Valid/held/rejected rows → Explicit import and receipt history.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain consumer_import_history/review/lead_import and current owner/role checks. This is distinct from licensing/XCEL import; source facts do not imply verified policy or permission to call.
Acceptance: History/review errors are not empty receipts; rejected rows stay visible; no live import or reassignment occurs in visual QA.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ConsumerImportWorkspace` expression below is copied from `src/pages/ConsumerLeadImport.tsx:21`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ConsumerImportWorkspace key={user.id} userId={user.id} />
```

**Page-specific validation**

- History/review errors are not empty receipts; rejected rows stay visible; no live import or reassignment occurs in visual QA.
- Verify the preserved source behavior: Retain consumer_import_history/review/lead_import and current owner/role checks. This is distinct from licensing/XCEL import; source facts do not imply verified policy or permission to call.
- Existing focused checks to inspect: `src/tests/pages/ConsumerLeadImport.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
