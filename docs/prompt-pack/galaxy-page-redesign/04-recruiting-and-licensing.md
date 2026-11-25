# Recruiting and licensing operations

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Recruiting worklist — `DashboardApplicants`
<a id="page-dashboard-applicants"></a>

**Decision:** Keep. **Source:** `src/pages/DashboardApplicants.tsx` (2639 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><DashboardApplicants /></ProtectedRoute>}` |
| `/dashboard/recruiting/hires` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><DashboardApplicants /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep one worklist focused on who needs the next recruiting action.

**Existing data/API calls:** from `agents`; from `applications`; from `interview_events`; invoke `interviews-pipeline`; rpc `mark_phone_bad`; invoke `send-couldnt-reach-email`; invoke `score-applicant`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useSoundEffects`, `@/components/dashboard/AgentNameLink`, `@/lib/utils`, `@/lib/priority`, `@/lib/nextBestAction`, `@/components/dashboard/ApplicantNotes`, `@/components/dashboard/InterviewRecorder`, `@/components/dashboard/LeadQualificationChat`, `@/components/dashboard/QuickAssignMenu`, `@/components/dashboard/LicenseProgressSelector`, `@/components/dashboard/StageMover`, `@/components/applicants/PromoteApplicantButton`, `@/components/agents/ReassignManagerButton`.

**Baseline / current state:** Canonical recruiting worklist. Classic view still contains exceptional operations; retain until those actions have parity.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardApplicants.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep one worklist focused on who needs the next recruiting action.
Decision: Keep. Routes: /dashboard/recruiting, /dashboard/recruiting/hires.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current work bucket → Candidate/contact context → One next action per row.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve RecruitingWorklist, RecruitSlaQueue, NoHireLeftBehind and existing classic-view recovery; keep role scope, filters, phone-bad marking and actual message/score handlers. /dashboard/recruiting/hires currently shares this page without proven hires-only semantics.
Acceptance: Filter counts and rows agree; hired versus new states are not conflated; failed reads and failed actions remain visible; no outreach is sent by a visual refactor.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `RecruitingWorklist` expression below is copied from `src/pages/DashboardApplicants.tsx:272`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<RecruitingWorklist />
```

**Page-specific validation**

- Filter counts and rows agree; hired versus new states are not conflated; failed reads and failed actions remain visible; no outreach is sent by a visual refactor.
- Verify the preserved source behavior: Preserve RecruitingWorklist, RecruitSlaQueue, NoHireLeftBehind and existing classic-view recovery; keep role scope, filters, phone-bad marking and actual message/score handlers. /dashboard/recruiting/hires currently shares this page without proven hires-only semantics.
- Existing focused checks to inspect: `src/tests/lib/hireMonitoringRecruitingIncome.test.ts`, `src/tests/lib/hiringLifecycleContract.test.ts`, `src/tests/lib/recruitingCommandCenter.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiting pipeline — `RecruitingPipeline`
<a id="page-recruiting-pipeline"></a>

**Decision:** Keep. **Source:** `src/pages/RecruitingPipeline.tsx` (635 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting/pipeline` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><RecruitingPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make stage movement and intent readable without multiplying competing boards.

**Existing data/API calls:** from `v_recruiting_pipeline`; rpc `rp_pipeline_action`

**Existing helpers/components:** `@/lib/personInitials`, `@/hooks/usePageTitle`, `@/hooks/useSoundEffects`, `@/components/recruiting/FilterChip`, `@/components/recruiting/GrowScoreboard`, `@/components/recruiting/RecruitingWorkspaceNav`, `@/components/recruiting/StatusPill`, `@/components/pipeline/worklist/worklistStatus`, `@/components/pipeline/worklist/worklistFormat`, `@/lib/recruitingQueues`, `@/lib/celebrate`, `@/lib/tones`, `@/lib/phone`, `@/lib/utils`.

**Baseline / current state:** Existing Recruiting workspace tab over its pipeline view/RPC; keep local tab, avoid another primary label.

**Copy-ready implementation prompt**

```text
Work only on src/pages/RecruitingPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make stage movement and intent readable without multiplying competing boards.
Decision: Keep. Routes: /dashboard/recruiting/pipeline.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current stage → Intent and Monday commitment → Existing pipeline actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep v_recruiting_pipeline and rp_pipeline_action, stage terminology, missing/unreadable dates and outcome semantics. Do not infer an attended or contracted state from a scheduled event.
Acceptance: Every action sends the existing RPC shape; board totals reconcile; failed stage change rolls back or remains explicit.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GrowScoreboard` expression below is copied from `src/pages/RecruitingPipeline.tsx:371`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GrowScoreboard
        label="Pipeline numbers"
        notice={isError ? (
          <span className="text-destructive">The pipeline did not load, so the numbers are hidden rather than shown as 0.</span>
        ) : null}
        tiles={[
          { label: "Expected Monday", value: unknown ? null : counts.expected, hint: "Prospects due to start", onSelect: () => openList("expected"), active: listOn("expected"), emphasis: true, tone: "gold", icon: <CalendarCheck /> },
          { label: "Showed", value: unknown ? null : counts.showed, hint: "Prospects who came", onSelect: () => openList("showed"), active: listOn("showed"), tone: "good", icon: <UserCheck /> },
          { label: "Onboarding", value: unknown ? null : counts.onboarding, hint: "Getting set up", onSelect: () => openList("onboarding"), active: listOn("onboarding"), tone: "royal", icon: <ClipboardList /> },
          { label: "Active agents", value: unknown ? null : counts.active, hint: "Writing business", onSelect: () => openList("active"), active: listOn("active"), tone: "good", icon: <BadgeCheck /> },
        ]}
      />
```

**Page-specific validation**

- Every action sends the existing RPC shape; board totals reconcile; failed stage change rolls back or remains explicit.
- Verify the preserved source behavior: Keep v_recruiting_pipeline and rp_pipeline_action, stage terminology, missing/unreadable dates and outcome semantics. Do not infer an attended or contracted state from a scheduled event.
- Existing focused checks to inspect: `src/tests/pages/RecruitingPipeline.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensed prospects — `LicensedInbox`
<a id="page-licensed-inbox"></a>

**Decision:** Keep. **Source:** `src/pages/LicensedInbox.tsx` (947 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting/licensed` | admin / va_manager / va; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowRoles={["va_manager", "va"]}><LicensedInbox /></ProtectedRoute>}` |

**Observed behavior and source contract**

Lead with the highest-priority licensed call queue and its actual contact state.

**Existing data/API calls:** rpc `licensed_prospects`; from `apex_toolkit_agents`; invoke `apex-outbox-dispatcher`; from `WP5_RELATION.licensedUnresolved as never`

**Existing helpers/components:** `@/components/onboarding/QuickAddAgentDialog`, `@/components/recruiting/RecruitingWorkspaceNav`, `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/wp5Relations`, `@/lib/dateUtils`, `@/lib/hireToOnboarding`, `@/lib/phone`.

**Baseline / current state:** Immediate licensed-prospect queue; local workspace nav deliberately limits to admin/VA staff.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LicensedInbox.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Lead with the highest-priority licensed call queue and its actual contact state.
Decision: Keep. Routes: /dashboard/recruiting/licensed.
Audience: admin / va_manager / va. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Call queue → Contact history/status → Explicit email/text composer.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep licensed_prospects, unresolved-identity evidence and apex-outbox-dispatcher. Toolkit profile linkage is not a license verification shortcut; composer approval remains explicit.
Acceptance: No hidden send occurs; failed dispatcher response stays unsent; unresolved identity and query failure cannot become empty success.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/LicensedInbox.tsx:900`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4">
        <p role="alert" className="text-sm text-muted-foreground">
          The &ldquo;Needs a decision&rdquo; list did not load, so nothing is shown as resolved.
        </p>
      </GlassCard>
```

**Page-specific validation**

- No hidden send occurs; failed dispatcher response stays unsent; unresolved identity and query failure cannot become empty success.
- Verify the preserved source behavior: Keep licensed_prospects, unresolved-identity evidence and apex-outbox-dispatcher. Toolkit profile linkage is not a license verification shortcut; composer approval remains explicit.
- Existing focused checks to inspect: `src/tests/lib/licensedInboxLanes.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Interviews — `Interviews`
<a id="page-interviews"></a>

**Decision:** Keep. **Source:** `src/pages/Interviews.tsx` (856 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting/interviews` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><Interviews /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make upcoming interviews and unbooked onboarding calls distinct actionable groups.

**Existing data/API calls:** invoke `interviews-pipeline`; from `assistant_share_tokens`; rpc `admin_enqueue_onboarding_call`

**Existing helpers/components:** `@/components/recruiting/RecruitingWorkspaceNav`, `@/components/recruiting/RecruitingCommandHero`, `@/components/applicants/PromoteApplicantButton`, `@/lib/phone`, `@/lib/instagram`, `@/lib/hireToOnboarding`, `@/components/hires/HireLaunchBoard`, `@/lib/onboardingCalls`.

**Baseline / current state:** Recruiter-accessible interview/hired views remain a permission-safe destination; do not redirect every recruiter to restricted New hires.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Interviews.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make upcoming interviews and unbooked onboarding calls distinct actionable groups.
Decision: Keep. Routes: /dashboard/recruiting/interviews.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Today/upcoming appointments → No-show or reschedule work → Licensed hires lacking onboarding calls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve interviews-pipeline, assistant token links, interview outcomes and admin_enqueue_onboarding_call. Booking, confirmed, completed and hired are different facts.
Acceptance: Date grouping is consistent; candidate actions target the right record; enqueue failure does not claim a booked call.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/Interviews.tsx:637`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button size="icon" variant="ghost" className="h-8 w-8 text-foreground hover:bg-white/10 hover:text-white" aria-label="Next priority candidate" onClick={() => setFocusIndex((safeFocusIndex + 1) % priorityPool.length)}><ArrowRight className="h-4 w-4" /></Button>
```

**Page-specific validation**

- Date grouping is consistent; candidate actions target the right record; enqueue failure does not claim a booked call.
- Verify the preserved source behavior: Preserve interviews-pipeline, assistant token links, interview outcomes and admin_enqueue_onboarding_call. Booking, confirmed, completed and hired are different facts.
- Existing focused checks to inspect: `src/tests/lib/interviewPipelineContract.test.ts`, `src/tests/lib/recruitingCommandCenter.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Interview follow-up — `InterviewRecovery`
<a id="page-interview-recovery"></a>

**Decision:** Consolidate conditionally under Interviews; preserve recovery actions. **Source:** `src/pages/InterviewRecovery.tsx` (1632 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting/follow-ups` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><InterviewRecovery /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep recovery candidates and the call agenda close to the current interview workflow.

**Existing data/API calls:** from `v_interview_pipeline`; from `v_prospect_review_queue`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/components/dashboard/ApplicationDetailSheet`, `@/components/recruiting/RecruitingWorkspaceNav`, `@/components/recruiting/RecruitingCommandHero`, `@/lib/phone`, `@/lib/interviewDisposition`.

**Baseline / current state:** Overlap with due/overdue worklist. Retain queue actions and specialist review until an action-by-action parity check supports a redirect.

**Copy-ready implementation prompt**

```text
Work only on src/pages/InterviewRecovery.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep recovery candidates and the call agenda close to the current interview workflow.
Decision: Consolidate conditionally under Interviews; preserve recovery actions. Routes: /dashboard/recruiting/follow-ups.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Overdue/start-soon queue → Candidate context → Call agenda and outcome.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_interview_pipeline and v_prospect_review_queue. Consolidate as an Interviews local view only after its catch-up counters and agenda/outcome actions have parity.
Acceptance: Empty queue differs from failure; timezone and overdue buckets are correct; each recovery action retains its record target.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/InterviewRecovery.tsx:1363`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4">
        <div className="space-y-2">
          {/* stable-key-allow:skeleton */}
          {[1, 2, 3, 4, 5].map((n) => <Skeleton key={n} className="h-[76px] w-full rounded-lg" />)}
        </div>
      </GlassCard>
```

**Page-specific validation**

- Empty queue differs from failure; timezone and overdue buckets are correct; each recovery action retains its record target.
- Verify the preserved source behavior: Retain v_interview_pipeline and v_prospect_review_queue. Consolidate as an Interviews local view only after its catch-up counters and agenda/outcome actions have parity.
- Existing focused checks to inspect: `src/tests/lib/recruitingCommandCenter.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiting links — `RecruitingLinks`
<a id="page-recruiting-links"></a>

**Decision:** Keep. **Source:** `src/pages/RecruitingLinks.tsx` (225 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiting-links` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><RecruitingLinks /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the correct owner-attributed recruiting link easy to find, copy and share manually.

**Existing data/API calls:** rpc `admin_recruiting_links`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/recruitLinks`.

**Baseline / current state:** Shareable recruiting attribution links. Local links already reach Grow, worklist and Invite links; retain tokens/referrals.

**Copy-ready implementation prompt**

```text
Work only on src/pages/RecruitingLinks.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the correct owner-attributed recruiting link easy to find, copy and share manually.
Decision: Keep. Routes: /dashboard/recruiting-links.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current role’s link → Manager/owner versus team list → Copy, QR or manual share.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep admin_recruiting_links and current role rules. Preserve attribution slugs and clipboard failure behavior; do not broaden directory access or send a message automatically.
Acceptance: Copy result must be actual success; copied URL opens the correct public funnel with the recruiter code; list and filters retain role scope.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/RecruitingLinks.tsx:82`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button
        size="sm"
        variant="ghost"
        className="h-8"
        aria-label={`Copy full apply link for ${name}`}
        onClick={() => void copyText(fullLink(slug), "Full link")}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
```

**Page-specific validation**

- Copy result must be actual success; copied URL opens the correct public funnel with the recruiter code; list and filters retain role scope.
- Verify the preserved source behavior: Keep admin_recruiting_links and current role rules. Preserve attribution slugs and clipboard failure behavior; do not broaden directory access or send a message automatically.
- Existing focused checks to inspect: `src/tests/pages/RecruitingLinks.test.tsx`, `src/tests/pages/recruitingLinksContract.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Import licensing progress — `XcelImport`
<a id="page-xcel-import"></a>

**Decision:** Keep. **Source:** `src/pages/admin/XcelImport.tsx` (611 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/import` | admin / manager / va_manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager"]}><XcelImport /></ProtectedRoute>}` |
| `/admin/xcel-import` | admin / manager / va_manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager"]}><XcelImport /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep licensing CSV preview and commit clearly separated.

**Existing data/API calls:** invoke `xcel-csv-ingest`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`.

**Baseline / current state:** Retained licensing/XCEL importer and Owner shortcut. A role-safe replacement entry in the unlicensed roster is not proven. Consumer import is separate.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/XcelImport.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep licensing CSV preview and commit clearly separated.
Decision: Keep. Routes: /dashboard/import, /admin/xcel-import.
Audience: admin / manager / va_manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: File parse result → Matched/invalid row preview → Explicit ingest result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain xcel-csv-ingest, email/NPN matching and the existing import contract. This is not consumer lead import; do not reuse its button or schemas for the sales book.
Acceptance: Malformed CSV, unmapped columns and rejected rows remain visible; no import runs before explicit commit; reported counts match the receipt.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/admin/XcelImport.tsx:336`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4">
          <div className="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="truncate">Parsing {fileName}…</span>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </GlassCard>
```

**Page-specific validation**

- Malformed CSV, unmapped columns and rejected rows remain visible; no import runs before explicit commit; reported counts match the receipt.
- Verify the preserved source behavior: Retain xcel-csv-ingest, email/NPN matching and the existing import contract. This is not consumer lead import; do not reuse its button or schemas for the sales book.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My applicants — `MyApplicants`
<a id="page-my-applicants"></a>

**Decision:** Keep. **Source:** `src/pages/admin/MyApplicants.tsx` (319 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/my-applicants` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><MyApplicants /></ProtectedRoute>}` |

**Observed behavior and source contract**

Present the current referrer’s applicants with one meaningful filter and next action.

**Existing data/API calls:** from `agents`; from `applications`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/phone`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/MyApplicants.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the current referrer’s applicants with one meaningful filter and next action.
Decision: Keep. Routes: /admin/my-applicants.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Own referred counts → Applicant stage → Existing add/referral link.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep current agent resolution and applications ownership filter. Preserve distinctions between uncontacted, prelicensing and licensed; do not show another user’s cached list.
Acceptance: Missing identity and fetch error stay unavailable; filtered count equals rows; canonical referral links retain attribution.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/admin/MyApplicants.tsx:170`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Your referral link</p>
                <code className="text-sm font-mono text-primary truncate block">{referralUrl}</code>
              </div>
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </CardContent>
          </Card>
```

**Page-specific validation**

- Missing identity and fetch error stay unavailable; filtered count equals rows; canonical referral links retain attribution.
- Verify the preserved source behavior: Keep current agent resolution and applications ownership filter. Preserve distinctions between uncontacted, prelicensing and licensed; do not show another user’s cached list.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Add a referral — `AddReferral`
<a id="page-add-referral"></a>

**Decision:** Keep. **Source:** `src/pages/admin/AddReferral.tsx` (205 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/add-referral` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><AddReferral /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing admin referral form short with validated ownership and a real save receipt.

**Existing data/API calls:** from `agents`; from `applications`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/constants`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/AddReferral.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing admin referral form short with validated ownership and a real save receipt.
Decision: Keep. Routes: /admin/add-referral.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Referral identity → State/licensing context → Explicit save.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain existing agent resolution and applications mutation. Do not merge with ReferralSubmit until its permission, ownership and invitation behavior are compared.
Acceptance: Required fields, invalid phone/state, failed insert and duplicate handling remain truthful; no auto-send is introduced.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Input` expression below is copied from `src/pages/admin/AddReferral.tsx:145`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  placeholder="(555) 123-4567"
                  required
                />
```

**Page-specific validation**

- Required fields, invalid phone/state, failed insert and duplicate handling remain truthful; no auto-send is introduced.
- Verify the preserved source behavior: Retain existing agent resolution and applications mutation. Do not merge with ReferralSubmit until its permission, ownership and invitation behavior are compared.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Invite an agent — `InviteLinksAdmin`
<a id="page-invite-links-admin"></a>

**Decision:** Keep. **Source:** `src/pages/admin/InviteLinks.tsx` (98 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/invite-links` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><InviteLinksAdmin /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the existing invitation workflow one clear form plus a trackable history.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/components/invitations/InviteAgentForm`, `@/components/invitations/InvitationsTable`, `@/components/invitations/MyLinkCard`.

**Baseline / current state:** Unique scoped hire/join link tool. Already linked by My Team/Grow; eligible for contextual placement with manager access intact.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/InviteLinks.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the existing invitation workflow one clear form plus a trackable history.
Decision: Keep. Routes: /admin/invite-links.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: My attributed link → Invite form → Invitation status/history.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve MyLinkCard, InviteAgentForm and InvitationsTable, including role scope and server token logic. Copying a link is not evidence an invitation was delivered or accepted.
Acceptance: Used/expired/pending statuses remain distinct; copied attribution and failure states work at mobile width.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `InviteAgentForm` expression below is copied from `src/pages/admin/InviteLinks.tsx:78`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<InviteAgentForm framed licenseHint="License status is always required. Pick one." />
```

**Page-specific validation**

- Used/expired/pending statuses remain distinct; copied attribution and failure states work at mobile width.
- Verify the preserved source behavior: Preserve MyLinkCard, InviteAgentForm and InvitationsTable, including role scope and server token logic. Copying a link is not evidence an invitation was delivered or accepted.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recover stalled applicants — `StaleRecovery`
<a id="page-stale-recovery"></a>

**Decision:** Keep. **Source:** `src/pages/StaleRecovery.tsx` (786 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/stale-recovery` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><StaleRecovery /></ProtectedRoute>}` |

**Observed behavior and source contract**

Put the actionable stale queue before the funnel explanation.

**Existing data/API calls:** from `v_stale_applicants`; from `v_application_conversion_funnel`; from `v_queue_stalled_applications`; from `applications`

**Existing helpers/components:** `@/lib/utils`, `@/lib/phone`.

**Baseline / current state:** Specific recovery queue and conversion evidence; retain as staff drilldown.

**Copy-ready implementation prompt**

```text
Work only on src/pages/StaleRecovery.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Put the actionable stale queue before the funnel explanation.
Decision: Keep. Routes: /dashboard/stale-recovery.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Stale/icy/cold queue → Hidden stalled work → Funnel snapshot.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_stale_applicants, v_queue_stalled_applications and funnel counts. Time since contact and time in stage are not the same; preserve record/source reasons.
Acceptance: Each age filter uses its existing field/window; empty and failed queues differ; updates do not silently remove unreconciled records.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/StaleRecovery.tsx:543`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Funnel snapshot</span>
          </h3>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          What the last seven days moved, and how many applicants are sitting open and stale right now.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Applied (7d)", value: funnel?.applied_7d ?? 0, tone: NEUTRAL },
            { label: "Manager Assigned (7d)", value: funnel?.assigned_7d ?? 0, tone: NEUTRAL },
            { label: "Contacted (7d)", value: funnel?.contacted_7d ?? 0, tone: GOOD },
            { label: "Open Stale", value: funnel?.stale_open_total ?? rows?.length ?? 0, tone: WARN },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3 sm:p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", s.tone)}>{s.value}</p>
            </div>
          ))}
        </div>
      </GlassCard>
```

**Page-specific validation**

- Each age filter uses its existing field/window; empty and failed queues differ; updates do not silently remove unreconciled records.
- Verify the preserved source behavior: Retain v_stale_applicants, v_queue_stalled_applications and funnel counts. Time since contact and time in stage are not the same; preserve record/source reasons.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Course progress — `XcelPipeline`
<a id="page-xcel-pipeline"></a>

**Decision:** Consolidate conditionally into licensing workspace after provider-state parity. **Source:** `src/pages/XcelPipeline.tsx` (237 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/xcel-pipeline` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><XcelPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep provider progress visible as evidence alongside the operational licensing queue.

**Existing data/API calls:** from `v_xcel_pipeline`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/phone`.

**Baseline / current state:** Another licensing-progress presentation. Keep source-specific fields until unified roster has proven parity.

**Copy-ready implementation prompt**

```text
Work only on src/pages/XcelPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep provider progress visible as evidence alongside the operational licensing queue.
Decision: Consolidate conditionally into licensing workspace after provider-state parity. Routes: /dashboard/xcel-pipeline.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Active/recent/stalled groups → Course progress → Candidate drill-down.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_xcel_pipeline and provider dates. A proposed merge into Pre-Licensing must preserve its stalled/never-started cohorts and not convert course progress into a license.
Acceptance: Unknown provider progress remains unknown; cohort counts reconcile; provider-failure state is not no students.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/XcelPipeline.tsx:97`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the Xcel pipeline" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Unknown provider progress remains unknown; cohort counts reconcile; provider-failure state is not no students.
- Verify the preserved source behavior: Retain v_xcel_pipeline and provider dates. A proposed merge into Pre-Licensing must preserve its stalled/never-started cohorts and not convert course progress into a license.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Team next steps — `ManagerNextStepBoard`
<a id="page-manager-next-step-board"></a>

**Decision:** Keep. **Source:** `src/pages/ManagerNextStepBoard.tsx` (171 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/team/next-step` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><ManagerNextStepBoard /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the manager’s next-step bottlenecks and linked people the primary view.

**Existing data/API calls:** from `v_next_step_manager_board`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ManagerNextStepBoard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the manager’s next-step bottlenecks and linked people the primary view.
Decision: Keep. Routes: /dashboard/team/next-step.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Stage counts → Stalled counts → Scoped people drill-down.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_next_step_manager_board, manager/downline scope and query-selected stage. Do not use agency-wide funnel totals as the manager’s own.
Acceptance: Selected-stage URL filters survive navigation; denied/error scope differs from empty; counts and drill-down agree.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/ManagerNextStepBoard.tsx:95`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="your downline board" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Selected-stage URL filters survive navigation; denied/error scope differs from empty; counts and drill-down agree.
- Verify the preserved source behavior: Retain v_next_step_manager_board, manager/downline scope and query-selected stage. Do not use agency-wide funnel totals as the manager’s own.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## New hires — `RecruitPipeline`
<a id="page-recruit-pipeline"></a>

**Decision:** Keep. **Source:** `src/pages/RecruitPipeline.tsx` (1082 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruits` | admin / manager / va_manager / va; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va"]}><RecruitPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the new-hire ladder, exceptions and next action visible without redundant boards.

**Existing data/API calls:** from `next_step_stages`; rpc `recruit_pipeline_list`; rpc `set_recruit_stage`; rpc `set_recruit_stage_bulk`; rpc `set_recruit_instagram`; rpc `set_recruit_state`

**Existing helpers/components:** `@/lib/personInitials`, `@/components/recruiting/FilterChip`, `@/components/recruiting/GrowScoreboard`, `@/components/recruiting/JourneyBar`, `@/components/recruiting/RecruitingWorkspaceNav`, `@/components/recruiting/StatusPill`, `@/components/dashboard/LicenseProgressSelector`, `@/components/pipeline/worklist/worklistFormat`, `@/lib/utils`, `@/lib/phone`, `@/lib/noLongerWithUs`, `@/lib/celebrate`, `@/lib/hireLadder`, `@/lib/recruitJourney`.

**Baseline / current state:** Hire-to-first-deal board with onboarding exceptions. Distinct from pre-hire call list.

**Copy-ready implementation prompt**

```text
Work only on src/pages/RecruitPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the new-hire ladder, exceptions and next action visible without redundant boards.
Decision: Keep. Routes: /dashboard/recruits.
Audience: admin / manager / va_manager / va. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Hire progression → Onboarding exceptions → Contact and deliberate stage action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain recruit_pipeline_list, stage and bulk-stage RPCs, Instagram/state edits and exact close/drop/inactivate semantics. Closing an applicant and ending an agent’s team access are not interchangeable.
Acceptance: Single/bulk changes retain confirmation and scope; failed actions do not look completed; URL-selected cohorts and exception counts reconcile.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `DropdownMenuItem` expression below is copied from `src/pages/RecruitPipeline.tsx:1051`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<DropdownMenuItem className="min-h-11 gap-2 text-destructive focus:text-destructive" onSelect={() => void removeAgent(r)}>
                                    <UserX className="h-4 w-4" aria-hidden="true" /> No longer with us
                                  </DropdownMenuItem>
```

**Page-specific validation**

- Single/bulk changes retain confirmation and scope; failed actions do not look completed; URL-selected cohorts and exception counts reconcile.
- Verify the preserved source behavior: Retain recruit_pipeline_list, stage and bulk-stage RPCs, Instagram/state edits and exact close/drop/inactivate semantics. Closing an applicant and ending an agent’s team access are not interchangeable.
- Existing focused checks to inspect: `src/tests/pages/RecruitPipeline.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Stuck applicants — `AdminStuckPool`
<a id="page-admin-stuck-pool"></a>

**Decision:** Internal. **Source:** `src/pages/AdminStuckPool.tsx` (239 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/next-step/stuck` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminStuckPool /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep this diagnostic queue focused on the person, stage and blocking evidence.

**Existing data/API calls:** from `v_next_step_stuck_pool`; from `next_step_messages`

**Existing helpers/components:** `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminStuckPool.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this diagnostic queue focused on the person, stage and blocking evidence.
Decision: Internal. Routes: /admin/next-step/stuck.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Stalled people → Current stage → Message/next-step evidence.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_next_step_stuck_pool and next_step_messages. A message failure or absent action must not be replaced with an invented progression percentage.
Acceptance: Search preserves count meaning; empty/error states differ; linked records retain their authorized destination.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AdminStuckPool.tsx:164`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the stuck pool" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Search preserves count meaning; empty/error states differ; linked records retain their authorized destination.
- Verify the preserved source behavior: Retain v_next_step_stuck_pool and next_step_messages. A message failure or absent action must not be replaced with an invented progression percentage.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Funnel health — `AdminFunnelHealth`
<a id="page-admin-funnel-health"></a>

**Decision:** Internal. **Source:** `src/pages/AdminFunnelHealth.tsx` (299 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/next-step/funnel-health` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminFunnelHealth /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make delivery failures and stage bottlenecks visible without treating operational messages as hires.

**Existing data/API calls:** from `v_next_step_funnel_health`; rpc `next_step_message_stats_24h`; from `next_step_messages`

**Existing helpers/components:** `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminFunnelHealth.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make delivery failures and stage bottlenecks visible without treating operational messages as hires.
Decision: Internal. Routes: /admin/next-step/funnel-health.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Stage totals and stalls → Sent/failed 24-hour messages → Evidence log.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep v_next_step_funnel_health, next_step_message_stats_24h and source logs. Preserve the actual rolling window and sent/failed definitions.
Acceptance: Message stats reconcile source status; no-data versus failed RPC remains explicit; diagnostic links do not bypass roles.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `KpiTile` expression below is copied from `src/pages/AdminFunnelHealth.tsx:133`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<KpiTile label="Msgs failed 24h" value={totals.msg_failed_24h} tone={totals.msg_failed_24h == null ? "neutral" : totals.msg_failed_24h > 5 ? "rose" : "amber"} />
```

**Page-specific validation**

- Message stats reconcile source status; no-data versus failed RPC remains explicit; diagnostic links do not bypass roles.
- Verify the preserved source behavior: Keep v_next_step_funnel_health, next_step_message_stats_24h and source logs. Preserve the actual rolling window and sent/failed definitions.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiting cohorts — `RecruitFunnel`
<a id="page-recruit-funnel"></a>

**Decision:** Keep. **Source:** `src/pages/admin/RecruitFunnel.tsx` (369 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/recruit-funnel` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><RecruitFunnel /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep cohort conversion and inflow trends comparable by the same audience and time window.

**Existing data/API calls:** from `v_recruit_funnel_cohort`; from `v_inflow_alert`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/recruitJourney`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/RecruitFunnel.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep cohort conversion and inflow trends comparable by the same audience and time window.
Decision: Keep. Routes: /admin/recruit-funnel.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Cohort selector → Applications per week → Conversion and inflow alerts.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_recruit_funnel_cohort/v_inflow_alert and licensed/pending/unlicensed distinctions. Do not compare unfinished cohorts as if their conversion windows are complete.
Acceptance: Filter and chart period agree; missing denominators do not produce a believable zero rate; all graphs use existing data.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/admin/RecruitFunnel.tsx:217`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState {...describeQuery(inflow)} label="the inflow alarm" onRetry={() => void inflow.refetch()} compact>
            {a ? (
              <div className="space-y-3 text-sm">
                <p>
                  Last 4 full weeks: <span className="font-semibold tabular-nums">{a.last_4wk_avg}</span> a week. The 12 weeks before:{" "}
                  <span className="tabular-nums">{a.trailing_12wk_avg}</span>
                  {a.ratio !== null ? <> ({Math.round(a.ratio * 100)}%)</> : null}. The 26 weeks before:{" "}
                  <span className="tabular-nums">{a.baseline_26wk_avg}</span>
                  {a.ratio_vs_26wk !== null ? <> ({Math.round(a.ratio_vs_26wk * 100)}%)</> : null}.
                </p>
                <div className="flex h-16 items-end gap-1" aria-label="Applications in each of the last 16 weeks">
                  {(a.weekly_last_16 ?? []).map((w) => (
                    <div
                      key={w.week}
                      title={`Week of ${w.week}: ${w.n}`}
                      className="flex-1 rounded-sm bg-primary/60"
                      style={{ height: `${Math.max(4, (w.n / maxWeek) * 100)}%` }}
                    />
                  ))}
                </div>
                {(a.channel_drops ?? []).length > 0 ? (
                  <p className="text-muted-foreground">
                    Fell by more than half:{" "}
                    {(a.channel_drops ?? []).map((c) => `${c.channel} (${c.last_4wk} in 4 weeks, was ${c.trailing_12wk_per_4wk})`).join(", ")}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </QueryState>
```

**Page-specific validation**

- Filter and chart period agree; missing denominators do not produce a believable zero rate; all graphs use existing data.
- Verify the preserved source behavior: Retain v_recruit_funnel_cohort/v_inflow_alert and licensed/pending/unlicensed distinctions. Do not compare unfinished cohorts as if their conversion windows are complete.
- Existing focused checks to inspect: `src/tests/pages/RecruitFunnel.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Onboarding email gaps — `AdminEmailGaps`
<a id="page-admin-email-gaps"></a>

**Decision:** Internal. **Source:** `src/pages/AdminEmailGaps.tsx` (241 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/email-gaps` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminEmailGaps /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show the exact queue gap and the explicit recovery action.

**Existing data/API calls:** from `v_agents_onboarding_status`; from `agent_onboarding_queue`; invoke `send-agent-onboarding-email`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useConfirm`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminEmailGaps.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show the exact queue gap and the explicit recovery action.
Decision: Internal. Routes: /admin/email-gaps.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Queued/sent/gap state → Agent identity → Manual recovery send.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep onboarding queue evidence, role gates and send-agent-onboarding-email. A missing email is different from an undelivered message; preserve confirmation before bulk sends.
Acceptance: No send on mount or refresh; eligible counts match action preview; errors and provider receipt stay visible.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/AdminEmailGaps.tsx:171`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button
            size="sm"
            className="gap-1.5"
            disabled={firingId === "__all__"}
            onClick={resendAllGaps}
          >
            {firingId === "__all__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send all gaps now
          </Button>
```

**Page-specific validation**

- No send on mount or refresh; eligible counts match action preview; errors and provider receipt stay visible.
- Verify the preserved source behavior: Keep onboarding queue evidence, role gates and send-agent-onboarding-email. A missing email is different from an undelivered message; preserve confirmation before bulk sends.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Policy help leads — `AdminPolicyLeads`
<a id="page-admin-policy-leads"></a>

**Decision:** Internal. **Source:** `src/pages/AdminPolicyLeads.tsx` (196 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/policy-leads` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminPolicyLeads /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep this lead source identifiable and focused on unworked contacts.

**Existing data/API calls:** rpc `phc_admin_lead_stats`; rpc `phc_admin_leads`

**Existing helpers/components:** `@/lib/phone`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminPolicyLeads.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this lead source identifiable and focused on unworked contacts.
Decision: Internal. Routes: /admin/policy-leads.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Total/today/unworked → Searchable lead rows → Existing contact action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain phc_admin_lead_stats and phc_admin_leads. Preserve source/campaign context and existing admin scope; do not merge into a differently authorized consumer pool without parity.
Acceptance: Stats and search scope stay labeled; unavailable stats are not zero; phone/email actions use the selected row.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AdminPolicyLeads.tsx:130`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="policy leads" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Stats and search scope stay labeled; unavailable stats are not zero; phone/email actions use the selected row.
- Verify the preserved source behavior: Retain phc_admin_lead_stats and phc_admin_leads. Preserve source/campaign context and existing admin scope; do not merge into a differently authorized consumer pool without parity.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## AgentLink identity gaps — `AdminMissingAlLink`
<a id="page-admin-missing-al-link"></a>

**Decision:** Internal. **Source:** `src/pages/AdminMissingAlLink.tsx` (160 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/missing-al-link` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminMissingAlLink /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make unmatched agent identities and explicit correction the sole job of this repair page.

**Existing data/API calls:** from `v_agents_missing_al_link`; rpc `set_agent_al_link`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminMissingAlLink.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make unmatched agent identities and explicit correction the sole job of this repair page.
Decision: Internal. Routes: /admin/missing-al-link.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Unlinked agents → Existing identity evidence → Confirmed link correction.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_agents_missing_al_link and set_agent_al_link. Do not guess a match from a similar name or silently rewrite historical ownership.
Acceptance: Invalid/duplicate identifiers are rejected by existing rules; failed RPC stays unresolved; scope remains admin-only.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AdminMissingAlLink.tsx:83`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="agents missing an AgentLink id" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Invalid/duplicate identifiers are rejected by existing rules; failed RPC stays unresolved; scope remains admin-only.
- Verify the preserved source behavior: Retain v_agents_missing_al_link and set_agent_al_link. Do not guess a match from a similar name or silently rewrite historical ownership.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Onboarding exceptions — `OnboardingLadder`
<a id="page-onboarding-ladder"></a>

**Decision:** Keep. **Source:** `src/pages/OnboardingLadder.tsx` (133 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/onboarding-ladder` | admin / manager / va_manager / va; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va"]}><OnboardingLadder /></ProtectedRoute>}` |

**Observed behavior and source contract**

Lead with real blockers and show licensed-but-inactive people as a separate recovery group.

**Existing data/API calls:** from `v_queue_licensed_inactive`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/dashboard/AgentNameLink`, `@/components/onboarding/OnboardingExceptionQueue`, `@/components/onboarding/useOnboardingExceptionFacts`, `@/lib/utils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/OnboardingLadder.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Lead with real blockers and show licensed-but-inactive people as a separate recovery group.
Decision: Keep. Routes: /dashboard/onboarding-ladder.
Audience: admin / manager / va_manager / va. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Exception queue → Current blocker → Licensed/inactive recovery.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep useOnboardingExceptionFacts and v_queue_licensed_inactive. A licensed person who went inactive is not the same as a current unlicensed hire.
Acceptance: Missing underlying evidence stays unknown; each exception points to the owning workflow; refresh errors remain visible.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `OnboardingExceptionQueue` expression below is copied from `src/pages/OnboardingLadder.tsx:89`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<OnboardingExceptionQueue rows={facts.data} isLoading={false} error={null} mode="full" />
```

**Page-specific validation**

- Missing underlying evidence stays unknown; each exception points to the owning workflow; refresh errors remain visible.
- Verify the preserved source behavior: Keep useOnboardingExceptionFacts and v_queue_licensed_inactive. A licensed person who went inactive is not the same as a current unlicensed hire.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing recovery — `RecoveryQueue`
<a id="page-recovery-queue"></a>

**Decision:** Keep. **Source:** `src/pages/admin/RecoveryQueue.tsx` (1726 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/recovery-queue` | admin / manager / va_manager / va; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va"]}><RecoveryQueue /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the next useful contact attempt clear for high-priority licensing prospects.

**Existing data/API calls:** from `agents`; from `v_hot_licensing_prospects`; rpc `unified_mark_contacted`; rpc `unified_set_license_progress`; rpc `unified_mark_phone_bad`; rpc `log_contact_attempt`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/dashboard/ApplicationDetailSheet`, `@/lib/utils`, `@/lib/concurrentMap`, `@/lib/phone`.

**Baseline / current state:** Prioritized hot licensing work queue. Keep contextual view and explicit staff roles.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/RecoveryQueue.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the next useful contact attempt clear for high-priority licensing prospects.
Decision: Keep. Routes: /admin/recovery-queue.
Audience: admin / manager / va_manager / va. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Licensing stage → Last contact and progress evidence → Explicit contact/update action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep unified contact/license-progress/phone-bad RPCs and log_contact_attempt. Manual progress is not provider verification; preserve manager assignment and source metadata.
Acceptance: Action receipts reconcile the row; failed update remains retryable; bad-phone state is distinct from no answer.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Checkbox` expression below is copied from `src/pages/admin/RecoveryQueue.tsx:1347`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Checkbox
                        checked={isSelected}
                        aria-label={`Select ${r.name}`}
                        className="h-4 w-4 border-white/20 data-[state=checked]:bg-teal-500 data-[state=checked]:text-slate-950"
                      />
```

**Page-specific validation**

- Action receipts reconcile the row; failed update remains retryable; bad-phone state is distinct from no answer.
- Verify the preserved source behavior: Keep unified contact/license-progress/phone-bad RPCs and log_contact_attempt. Manual progress is not provider verification; preserve manager assignment and source metadata.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Unlicensed queue — `UnlicensedAll`
<a id="page-unlicensed-all"></a>

**Decision:** Keep. **Source:** `src/pages/admin/UnlicensedAll.tsx` (1233 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/unlicensed-all` | admin / manager / va_manager / va; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va"]}><UnlicensedAll /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the unified unlicensed worklist readable without erasing source provenance.

**Existing data/API calls:** from `v_unlicensed_all`; from `v_xcel_person_progress`; from `user_roles`; from `profiles`; rpc `unified_assign_va`; rpc `unified_mark_contacted`; rpc `unified_set_license_progress`; rpc `log_contact_attempt`; rpc `unified_mark_phone_bad`; invoke `send-couldnt-reach-email`; rpc `promote_aged_lead_to_application`; from `applications`; from `table as any`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/concurrentMap`, `@/components/unlicensed/RecoveryBatchDrawer`, `@/components/unlicensed/SuppressionDialog`, `@/lib/phone`.

**Baseline / current state:** Full scoped unlicensed roster and VA assignment. Real parent for licensing history/recovery/import, not a new generic hub.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/UnlicensedAll.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the unified unlicensed worklist readable without erasing source provenance.
Decision: Keep. Routes: /admin/unlicensed-all.
Audience: admin / manager / va_manager / va. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Stage and assigned owner → XCEL evidence → Contact/update/promote actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain source-specific IDs, v_unlicensed_all/provider progress, VA assignment and promotion RPCs. Do not merge aged-lead and application IDs or turn a self-report into a verified license.
Acceptance: Every action targets the correct source entity; assignments stay authorized; empty/error states and source-specific update failures are explicit.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/admin/UnlicensedAll.tsx:605`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the unlicensed queue" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Every action targets the correct source entity; assignments stay authorized; empty/error states and source-specific update failures are explicit.
- Verify the preserved source behavior: Retain source-specific IDs, v_unlicensed_all/provider progress, VA assignment and promotion RPCs. Do not merge aged-lead and application IDs or turn a self-report into a verified license.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Seminar room — `SeminarControl`
<a id="page-seminar-control"></a>

**Decision:** Consolidate. **Source:** `src/pages/SeminarControl.tsx` (429 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/seminar` | admin / manager / active_presenter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowPresenters><SeminarControl /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep a presenter’s own registration funnel and follow-up roster together.

**Existing data/API calls:** from `agents`; from `v_kj_seminar_control`; from `seminar_registrations`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SeminarControl.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep a presenter’s own registration funnel and follow-up roster together.
Decision: Consolidate. Routes: /dashboard/seminar.
Audience: admin / manager / active_presenter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Room access → Attendance/payment/licensing funnel → Roster next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain presenter/admin/manager gate and Not your room branch. Attendance, paid purchase, licensing and contract stages are distinct; the duplicate URL may redirect without changing room access.
Acceptance: Unauthorized presenter cannot see another room; stage counts reconcile roster filters; missing provider evidence remains unknown.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/SeminarControl.tsx:177`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardContent className="p-6">Sign in to view seminar control.</CardContent>
        </Card>
```

**Page-specific validation**

- Unauthorized presenter cannot see another room; stage counts reconcile roster filters; missing provider evidence remains unknown.
- Verify the preserved source behavior: Retain presenter/admin/manager gate and Not your room branch. Attendance, paid purchase, licensing and contract stages are distinct; the duplicate URL may redirect without changing room access.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Referral pipeline — `ReferralPipeline`
<a id="page-referral-pipeline"></a>

**Decision:** Keep. **Source:** `src/pages/ReferralPipeline.tsx` (273 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/referrals` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><ReferralPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make referral lifecycle and its authorized next action clear.

**Existing data/API calls:** from `v_referral_pipeline`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Manager referral operations. Keep staff access distinct from personal referral status.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ReferralPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make referral lifecycle and its authorized next action clear.
Decision: Keep. Routes: /dashboard/referrals.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Referral stage → Referrer/contact context → Existing lifecycle action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep v_referral_pipeline, ownership and current mutation contract. A referral is not a hired producer or a paid referral reward until the corresponding evidence exists.
Acceptance: Filter counts reconcile; unauthorized mutation controls stay hidden; failures do not imply a stage advance.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/ReferralPipeline.tsx:179`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Referral pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center py-12 text-sm text-muted-foreground">
            No referrals yet. Agents can submit from{" "}
            <Link to="/dashboard/referrals/new" className="underline">/dashboard/referrals/new</Link>.
          </CardContent>
        </Card>
```

**Page-specific validation**

- Filter counts reconcile; unauthorized mutation controls stay hidden; failures do not imply a stage advance.
- Verify the preserved source behavior: Keep v_referral_pipeline, ownership and current mutation contract. A referral is not a hired producer or a paid referral reward until the corresponding evidence exists.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My referrals — `MyReferrals`
<a id="page-my-referrals"></a>

**Decision:** Keep. **Source:** `src/pages/MyReferrals.tsx` (215 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/referrals/mine` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyReferrals /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show a referrer the actual status of their own submissions and pending earning evidence.

**Existing data/API calls:** from `agents`; from `v_agent_referrals`; from `v_referral_earnings_pending`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Agent-owned referral status and pending earnings; linked back from submission and command palette.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyReferrals.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show a referrer the actual status of their own submissions and pending earning evidence.
Decision: Keep. Routes: /dashboard/referrals/mine.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Lifecycle groups → Own submitted people → Pending earning detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain exact agent resolution, v_agent_referrals and v_referral_earnings_pending. Pending is not paid; do not infer amounts for absent data.
Acceptance: Own identity and account-switch isolation hold; a failed earnings query cannot show $0 paid; submit/back links work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/MyReferrals.tsx:203`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardContent className="text-center py-12 text-sm text-muted-foreground">
            You haven't sent any referrals yet.
            <div className="mt-3">
              <Button asChild size="sm"><Link to="/dashboard/referrals/new">Submit your first</Link></Button>
            </div>
          </CardContent>
        </Card>
```

**Page-specific validation**

- Own identity and account-switch isolation hold; a failed earnings query cannot show $0 paid; submit/back links work.
- Verify the preserved source behavior: Retain exact agent resolution, v_agent_referrals and v_referral_earnings_pending. Pending is not paid; do not infer amounts for absent data.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Refer a recruit — `ReferralSubmit`
<a id="page-referral-submit"></a>

**Decision:** Keep. **Source:** `src/pages/ReferralSubmit.tsx` (368 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/referrals/new` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ReferralSubmit /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the current referral and invitation entry concise with an actual confirmation.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/celebrate`, `@/lib/constants`, `@/lib/utils`, `@/components/invitations/InviteAgentForm`, `@/components/invitations/InvitationsTable`, `@/components/invitations/MyLinkCard`.

**Baseline / current state:** Safe recruiting action for agents and agency owners without staff role. Do not replace with a denied staff worklist.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ReferralSubmit.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the current referral and invitation entry concise with an actual confirmation.
Decision: Keep. Routes: /dashboard/referrals/new.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Referral details → Attribution/invite path → Confirmed saved result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain existing form validation, MyLinkCard and InviteAgentForm distinctions. Do not replace the referral handler with a direct applications insert or automatic message.
Acceptance: Required state/contact fields and server errors remain; confirmation names only the record actually returned.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `InviteAgentForm` expression below is copied from `src/pages/ReferralSubmit.tsx:197`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<InviteAgentForm kind="join" framed quiet={callOpen} />
```

**Page-specific validation**

- Required state/contact fields and server errors remain; confirmation names only the record actually returned.
- Verify the preserved source behavior: Retain existing form validation, MyLinkCard and InviteAgentForm distinctions. Do not replace the referral handler with a direct applications insert or automatic message.
- Existing focused checks to inspect: `src/tests/pages/ReferralSubmit.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## High-value recruiting — `WhaleRecruiting`
<a id="page-whale-recruiting"></a>

**Decision:** Keep. **Source:** `src/pages/WhaleRecruiting.tsx` (378 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/whales` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><WhaleRecruiting /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show the existing ranked recruiting opportunities and why they are prioritized.

**Existing data/API calls:** from `applications`; from `v_builder_operating_dashboard`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/phone`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/WhaleRecruiting.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show the existing ranked recruiting opportunities and why they are prioritized.
Decision: Keep. Routes: /dashboard/whales.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Real ranked candidates → Builder context → Candidate follow-up.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve admin-only checks, applications and builder-dashboard data. Ranking is not predicted revenue; do not add unsupported income labels or scores.
Acceptance: No-active-records differs from fetch failure; ranking inputs remain inspectable and tied to existing source facts.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/WhaleRecruiting.tsx:183`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
        <CardHeader className="pb-3">
          {/* wave-76 audit fix: heat tiles collapsed into the title row. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CardTitle className="text-16">All whales · {ranked.length}</CardTitle>
            <div className="flex items-center gap-3 text-12 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${HEAT_DOT.hot}`} /> Hot <b className="text-foreground tabular-nums">{heatCounts.hot}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${HEAT_DOT.warm}`} /> Warm <b className="text-foreground tabular-nums">{heatCounts.warm}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${HEAT_DOT.cool}`} /> Cool <b className="text-foreground tabular-nums">{heatCounts.cool}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${HEAT_DOT.cold}`} /> Cold <b className="text-foreground tabular-nums">{heatCounts.cold}</b>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {whales.isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : ranked.length === 0 ? (
            /* 2026-06-15 v7.2 · Sam: "Use that technique across the entire website."
               Diagnostic empty-state. No client-side filter on this page, so we
               only report the fetched count + likely upstream causes when 0. */
            <div className="py-8 text-center space-y-3 max-w-md mx-auto">
              <Crown className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <h3 className="text-sm font-semibold">
                No active recruits fetched
              </h3>
              <p className="text-13 text-muted-foreground">
                Fetched <span className="font-bold text-foreground tabular-nums">{(whales.data ?? []).length.toLocaleString()}</span> applicant{(whales.data ?? []).length === 1 ? "" : "s"} from the database (last 50, active).
              </p>
              <div className="text-12 text-rose-600 dark:text-rose-400 text-left">
                Zero rows came back. Likely causes:
                <ul className="list-disc list-inside mt-2">
                  <li>Your session expired (try logging out + back in)</li>
                  <li>You lost admin grant — this view is admin-only (check user_roles)</li>
                  <li>Funnel intake is dark — no new applications hitting <span className="font-mono">applications</span> table</li>
                  <li>RLS policy regression on applications (check Supabase logs)</li>
                </ul>
                <p className="mt-2 italic">Hold the Standard.</p>
              </div>
            </div>
          ) : (
            ranked.map((w) => (
              <WhaleRow
                key={w.id}
                row={w}
                agent={agentMetrics.data?.get(w.assigned_agent_id ?? w.recruiter_id ?? "") ?? null}
              />
            ))
          )}
        </CardContent>
      </Card>
```

**Page-specific validation**

- No-active-records differs from fetch failure; ranking inputs remain inspectable and tied to existing source facts.
- Verify the preserved source behavior: Preserve admin-only checks, applications and builder-dashboard data. Ranking is not predicted revenue; do not add unsupported income labels or scores.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiter HQ — `RecruiterDashboard`
<a id="page-recruiter-dashboard"></a>

**Decision:** Consolidate conditionally after recruiter-role and action parity. **Source:** `src/pages/RecruiterDashboard.tsx` (1622 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruiter` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<RecruiterDashboard />}` |

**Observed behavior and source contract**

Keep recruiter-specific work and metrics while evaluating consolidation into the current Recruiting workspace.

**Existing data/API calls:** from `applications`; from `agents`; from `aged_leads`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useSoundEffects`, `@/hooks/use-mobile`, `@/components/dashboard/LicenseProgressSelector`, `@/components/callcenter/ResendLicensingButton`, `@/components/dashboard/QuickEmailMenu`, `@/components/dashboard/QuickAssignMenu`, `@/components/recruiter/ActivityTimeline`, `@/components/dashboard/InterviewScheduler`, `@/components/recruiter/LeadDetailSheet`, `@/components/recruiter/DormantBadge`, `@/components/dashboard/InterviewRecorder`, `@/lib/logLeadActivity`, `@/lib/edgeInvoke`.

**Baseline / current state:** Older recruiter-specific workstation; source has its own role gate. Preserve unique assignment/actions until migrated.

**Copy-ready implementation prompt**

```text
Work only on src/pages/RecruiterDashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep recruiter-specific work and metrics while evaluating consolidation into the current Recruiting workspace.
Decision: Consolidate conditionally after recruiter-role and action parity. Routes: /dashboard/recruiter.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Overdue work → Contact/license progression → Recruiter-owned pipeline.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain recruiter role scope, legacy applications/aged-lead distinctions and exact stage actions. Do not redirect to a destination that requires manager/admin access or loses these operations.
Acceptance: Contact/license rates use valid denominators; no lost row actions or unauthorized broadening in any proposed merge.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Collapsible` expression below is copied from `src/pages/RecruiterDashboard.tsx:316`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1">
          <BarChart3 className="h-3.5 w-3.5" />
          <span className="font-medium">Performance Metrics</span>
          {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-wrap gap-2 pt-2 pb-1">
          {pills.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5"
            >
              <p.icon className={cn("h-3 w-3", p.color)} />
              <span className="text-[11px] text-muted-foreground">{p.label}</span>
              <span className={cn("text-xs font-bold", p.color)}>{p.value}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
```

**Page-specific validation**

- Contact/license rates use valid denominators; no lost row actions or unauthorized broadening in any proposed merge.
- Verify the preserved source behavior: Retain recruiter role scope, legacy applications/aged-lead distinctions and exact stage actions. Do not redirect to a destination that requires manager/admin access or loses these operations.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruit pipeline — `AgentPipeline`
<a id="page-agent-pipeline"></a>

**Decision:** Consolidate conditionally; retain distinct actions until mapped. **Source:** `src/pages/AgentPipeline.tsx` (888 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/recruit-pipeline` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AgentPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Preserve this legacy personal recruiting workflow until its actions exist in the current workspace.

**Existing data/API calls:** from `agents`; from `applications`; invoke `discord-webhook-notify`; invoke `add-agent`; invoke `bulk-agent-message`; invoke `send-agent-portal-login`

**Existing helpers/components:** `@/hooks/useMountedRef`, `@/hooks/useAuth`, `@/lib/utils`, `@/components/pipeline/KanbanBoard`, `@/components/dashboard/InterviewScheduler`, `@/components/dashboard/ApplicationDetailSheet`, `@/components/dashboard/LicenseProgressSelector`, `@/components/dashboard/LastContactedBadge`, `@/components/dashboard/QuickEmailMenu`, `@/components/callcenter/ResendLicensingButton`, `@/hooks/useSoundEffects`, `@/lib/apexConfig`, `@/lib/phone`.

**Baseline / current state:** Older recruit board still linked from producer home and admits broader roles. Map agent referrals separately before consolidating with staff recruiting.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Preserve this legacy personal recruiting workflow until its actions exist in the current workspace.
Decision: Consolidate conditionally; retain distinct actions until mapped. Routes: /dashboard/recruit-pipeline.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Own recruits and risk → Selected person → Existing scheduling/hire/portal-link actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep personal ownership and actual add-agent, portal-link and bulk-message handlers. URL deduplication is separate from deleting this implementation; do not auto-send during migration.
Acceptance: Every old action has an exact destination before a page merge; failures remain explicit; canonical alias preserves query/hash.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentPipeline.tsx:71`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard
        className={cn(
          "p-4 cursor-pointer transition-all select-none",
          active && "ring-2 ring-primary shadow-lg shadow-primary/10"
        )}
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg bg-muted/70", active && "bg-primary/10")}>
            <Icon className={cn("h-5 w-5", color)} />
          </div>
          <div>
            <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
            <p className="text-xs text-muted-foreground leading-tight">{label}</p>
            {sub && <p className="text-[11px] text-muted-foreground/60">{sub}</p>}
          </div>
        </div>
      </GlassCard>
```

**Page-specific validation**

- Every old action has an exact destination before a page merge; failures remain explicit; canonical alias preserves query/hash.
- Verify the preserved source behavior: Keep personal ownership and actual add-agent, portal-link and bulk-message handlers. URL deduplication is separate from deleting this implementation; do not auto-send during migration.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Hiring pipeline — `HiringPipeline`
<a id="page-hiring-pipeline"></a>

**Decision:** Consolidate conditionally into Recruiting after stage/scope parity. **Source:** `src/pages/HiringPipeline.tsx` (999 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/hiring-pipeline` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><HiringPipeline /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the scoped application-stage board and filters understandable while reducing duplicate entry points.

**Existing data/API calls:** from `applications`; rpc `my_downline_agent_ids`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`, `@/lib/phone`.

**Baseline / current state:** Additional applications kanban with its own mutations. Consolidate entry point only after stage/mutation parity, not a blind redirect.

**Copy-ready implementation prompt**

```text
Work only on src/pages/HiringPipeline.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the scoped application-stage board and filters understandable while reducing duplicate entry points.
Decision: Consolidate conditionally into Recruiting after stage/scope parity. Routes: /dashboard/hiring-pipeline.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current stage → Assigned/downline scope → Existing export and detail actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain my_downline_agent_ids and existing application stage definitions. Do not equate contracted with hired, licensed or issued production.
Acceptance: Empty dataset versus filters hiding everything remains distinct; export matches current scope; proposed parent must admit the same roles.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/HiringPipeline.tsx:362`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the hiring pipeline" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Empty dataset versus filters hiding everything remains distinct; export matches current scope; proposed parent must admit the same roles.
- Verify the preserved source behavior: Retain my_downline_agent_ids and existing application stage definitions. Do not equate contracted with hired, licensed or issued production.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing management — `PrelicensingManager`
<a id="page-prelicensing-manager"></a>

**Decision:** Improve. **Source:** `src/pages/PrelicensingManager.tsx` (508 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/prelicensing` | admin and managers (page gates internally); wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><PrelicensingManager /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the manual applicant licensing workflow clear beside provider progress.

**Existing data/API calls:** from `agents`; from `applications`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`, `@/lib/phone`.

**Baseline / current state:** Admin/manager query is disabled for other authenticated roles despite broad route. Align route/message; avoid a false-empty producer experience.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PrelicensingManager.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the manual applicant licensing workflow clear beside provider progress.
Decision: Improve. Routes: /dashboard/prelicensing.
Audience: admin and managers (page gates internally). Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current stage → Responsible agent → Follow-up/export controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain applications/agent ownership and manual stage semantics. This page and PreLicensing provider reports have different source truth and cannot be silently substituted.
Acceptance: Manual versus provider evidence is labeled; scoped counts and export agree; failed query is not no students.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/PrelicensingManager.tsx:275`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the pre-licensing pipeline" error={error} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Manual versus provider evidence is labeled; scoped counts and export agree; failed query is not no students.
- Verify the preserved source behavior: Retain applications/agent ownership and manual stage semantics. This page and PreLicensing provider reports have different source truth and cannot be silently substituted.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Hiring routing — `HiringManagerAssignments`
<a id="page-hiring-manager-assignments"></a>

**Decision:** Keep. **Source:** `src/pages/HiringManagerAssignments.tsx` (421 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/hiring-routing` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><HiringManagerAssignments /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep each hiring category’s assignment rules and the deliberate assignment action visible.

**Existing data/API calls:** from `hiring_manager_assignments`; from `user_roles`; from `profiles`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useConfirm`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/HiringManagerAssignments.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep each hiring category’s assignment rules and the deliberate assignment action visible.
Decision: Keep. Routes: /dashboard/hiring-routing.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Unlicensed/licensed/transfer lanes → Current manager assignment → Add or change routing.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain hiring_manager_assignments, current role checks and confirmation behavior. Never route work to inactive/departed identities or manufacture a fallback manager.
Acceptance: Assignable options and row ownership are verified; removal/update errors remain visible; routing explanation matches source behavior.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/HiringManagerAssignments.tsx:213`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState
          status="error"
          label="hiring manager routing"
          error={assignmentsError}
          onRetry={() => void refetch()}
        />
```

**Page-specific validation**

- Assignable options and row ownership are verified; removal/update errors remain visible; routing explanation matches source behavior.
- Verify the preserved source behavior: Retain hiring_manager_assignments, current role checks and confirmation behavior. Never route work to inactive/departed identities or manufacture a fallback manager.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Applicant recovery — `OldApplicants`
<a id="page-old-applicants"></a>

**Decision:** Keep. **Source:** `src/pages/OldApplicants.tsx` (352 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/old-applicants/managers` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><OldApplicants kind="managers" /></ProtectedRoute>}` |
| `/dashboard/old-applicants/licensed-recruiters` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><OldApplicants kind="licensedRecruiters" /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep each recovery lane’s role-specific list and contact context.

**Existing data/API calls:** from `viewName`; from `agents`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/looseSupabase`, `@/lib/phone`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/OldApplicants.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep each recovery lane’s role-specific list and contact context.
Decision: Keep. Routes: /dashboard/old-applicants/managers, /dashboard/old-applicants/licensed-recruiters.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected recovery lane → Licensed signals → Search and contact work.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The managers and licensed-recruiters route variants select different views. Do not alias both to the same unfiltered dataset; retain their existing audience and view choice.
Acceptance: Both route modes query the correct view; on-page counts do not imply a full-table total; no cross-role cache leak.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/OldApplicants.tsx:339`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card className="border-border/60 bg-card/80">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
```

**Page-specific validation**

- Both route modes query the correct view; on-page counts do not imply a full-table total; no cross-role cache leak.
- Verify the preserved source behavior: The managers and licensed-recruiters route variants select different views. Do not alias both to the same unfiltered dataset; retain their existing audience and view choice.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Provider licensing progress — `PreLicensing`
<a id="page-pre-licensing"></a>

**Decision:** Keep. **Source:** `src/pages/PreLicensing.tsx` (586 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/pre-licensing` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><PreLicensing /></ProtectedRoute>}` |

**Observed behavior and source contract**

Give managers a clear view of recorded XCEL progress and the source’s last known state.

**Existing data/API calls:** from `xcel_pre_licensing_reports`; from `v_xcel_latest`; from `agents`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useMyDownline`, `@/hooks/usePageTitle`, `@/components/admin/XcelIngestDialog`, `@/components/prelicensing/XcelUnmatchedPanel`, `@/components/prelicensing/CourseProofReviewPanel`, `@/lib/phone`, `@/components/shared/TeamLookupError`.

**Baseline / current state:** XCEL report history differs from manual stage tracking; keep as licensing evidence drilldown.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PreLicensing.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Give managers a clear view of recorded XCEL progress and the source’s last known state.
Decision: Keep. Routes: /dashboard/pre-licensing.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Course completion cohorts → Provider progress/date → Scoped enrollee detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain xcel_pre_licensing_reports/v_xcel_latest, downline identity and ingest dialog role. Provider course completion is not state licensing or carrier contracting.
Acceptance: Missing provider progress remains absent; downline errors block broader fallback; import remains an explicit authorized action.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `TeamLookupError` expression below is copied from `src/pages/PreLicensing.tsx:278`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<TeamLookupError />
```

**Page-specific validation**

- Missing provider progress remains absent; downline errors block broader fallback; import remains an explicit authorized action.
- Verify the preserved source behavior: Retain xcel_pre_licensing_reports/v_xcel_latest, downline identity and ingest dialog role. Provider course completion is not state licensing or carrier contracting.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Unclaimed applicants — `UnclaimedLeads`
<a id="page-unclaimed-leads"></a>

**Decision:** Keep. **Source:** `src/pages/admin/UnclaimedLeads.tsx` (346 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/unclaimed` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><UnclaimedLeads /></ProtectedRoute>}` |

**Observed behavior and source contract**

Focus the recovery queue on unowned or unusably owned new applicants.

**Existing data/API calls:** from `applications`; from `agents`; rpc `admin_reassign_application_owner`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useConfirm`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/UnclaimedLeads.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Focus the recovery queue on unowned or unusably owned new applicants.
Decision: Keep. Routes: /dashboard/admin/unclaimed.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Oldest unworked records → Owner reason → Confirmed reassignment.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain admin_reassign_application_owner, reason/confirmation and inactive/departed owner checks. A reassignment changes ownership and must remain explicit.
Acceptance: No unauthenticated or preview mutation; failed reassignment leaves row unresolved; 72-hour and uncontacted counts match their filters.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `StatTile` expression below is copied from `src/pages/admin/UnclaimedLeads.tsx:191`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<StatTile label="Departed/inactive owner" value={stats.inactive_assignee} color="text-amber-300" />
```

**Page-specific validation**

- No unauthenticated or preview mutation; failed reassignment leaves row unresolved; 72-hour and uncontacted counts match their filters.
- Verify the preserved source behavior: Retain admin_reassign_application_owner, reason/confirmation and inactive/departed owner checks. A reassignment changes ownership and must remain explicit.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Manager overview — `ManagerDashboard`
<a id="page-manager-dashboard"></a>

**Decision:** Keep. **Source:** `src/pages/admin/ManagerDashboard.tsx` (339 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/manager` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><ManagerDashboard /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the manager-facing recruiting, hiring and producer summaries compact and source-labeled.

**Existing data/API calls:** from `applications`; from `agents`; from `v_recent_hires`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useAuth`, `@/hooks/useBusinessToday`, `@/lib/dashboardRecords`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/ManagerDashboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the manager-facing recruiting, hiring and producer summaries compact and source-labeled.
Decision: Keep. Routes: /dashboard/admin/manager.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Uncontacted/interview/contracting priorities → Recent hires → Top producer context.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain current manager scope, business date and source limits: last 50 applications/30 days, last 20 hires and top 10 producers. These are bounded windows, not complete lifetime totals.
Acceptance: Summary labels match each window; identity/name-map errors remain visible; linked lists retain the same manager scope.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/admin/ManagerDashboard.tsx:71`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the recruiting pipeline" error={pipelineErr} onRetry={() => void refetchPipeline()} />
```

**Page-specific validation**

- Summary labels match each window; identity/name-map errors remain visible; linked lists retain the same manager scope.
- Verify the preserved source behavior: Retain current manager scope, business date and source limits: last 50 applications/30 days, last 20 hires and top 10 producers. These are bounded windows, not complete lifetime totals.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing stages — `LicensingTracker`
<a id="page-licensing-tracker"></a>

**Decision:** Consolidate conditionally after licensing-student data/action parity. **Source:** `src/pages/admin/LicensingTracker.tsx` (288 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/licensing` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><LicensingTracker /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the licensing-student kanban and stalled queue until a unified workspace has mutation parity.

**Existing data/API calls:** from `v_licensing_kanban`; from `licensing_students`; from `v_licensing_stalled`

**Existing helpers/components:** `@/lib/utils`.

**Baseline / current state:** Another licensing kanban and stalled queue. Fold navigation into the existing roster with source/stage parity first.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/LicensingTracker.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the licensing-student kanban and stalled queue until a unified workspace has mutation parity.
Decision: Consolidate conditionally after licensing-student data/action parity. Routes: /dashboard/admin/licensing.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Student stage → Stalled students → Existing stage update.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_licensing_kanban, licensing_students and v_licensing_stalled. This is a different record model from applications and provider reports; do not overwrite it with a generic percentage.
Acceptance: Stage updates preserve existing contract; failed writes are explicit; consolidation requires mapped student IDs and history.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/admin/LicensingTracker.tsx:92`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
```

**Page-specific validation**

- Stage updates preserve existing contract; failed writes are explicit; consolidation requires mapped student IDs and history.
- Verify the preserved source behavior: Retain v_licensing_kanban, licensing_students and v_licensing_stalled. This is a different record model from applications and provider reports; do not overwrite it with a generic percentage.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
