# Team and contracting

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## My team — `DashboardCRM`
<a id="page-dashboard-c-r-m"></a>

**Decision:** Keep. **Source:** `src/pages/DashboardCRM.tsx` (394 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/team` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><DashboardCRM /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing four-number roster and matching work lists as the primary people workspace.

**Existing data/API calls:** from `v_agent_canonical_map`; rpc `crm_agent_roster`; rpc `crm_agent_sales_pulse`; rpc `crm_agent_contacts`; rpc `crm_agent_free_leads_status`; rpc `crm_agents_export`; from `agents`; from `applications`; invoke `send-agent-portal-login`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useAgentIdentity`, `@/hooks/useBusinessToday`, `@/hooks/usePageTitle`, `@/hooks/useTeamWorkspace`, `@/hooks/useTeamFacts`, `@/hooks/usePortalLoginSender`, `@/lib/teamRoster`, `@/lib/productionMetrics`, `@/lib/teamList`, `@/lib/tones`, `@/lib/utils`, `@/components/dashboard/ApplicationDetailSheet`, `@/components/dashboard/DeactivateAgentDialog`.

**Baseline / current state:** Canonical team roster with contracting view, roster health and scoped profile actions.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardCRM.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing four-number roster and matching work lists as the primary people workspace.
Decision: Keep. Routes: /dashboard/team.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Four reconciled roster counts → Current team list → Attendance/contracting context.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain crm_agent_roster/sales_pulse/contacts/free_leads_status/export, canonical identity mapping and Team workspace modes. Placeholder and inactive rows stay in their proper lists; preserve granted actions.
Acceptance: Each number opens the exact corresponding list and sums reconcile; export matches scope; failed identity lookup cannot broaden to all.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `DropdownMenuItem` expression below is copied from `src/pages/DashboardCRM.tsx:258`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<DropdownMenuItem className="min-h-11" disabled={portalLogins.sending} onClick={() => portalLogins.send()}>
            <Mail className="mr-2 h-4 w-4" aria-hidden /> {portalLogins.sending ? "Sending..." : "Send portal logins (all)"}
          </DropdownMenuItem>
```

**Page-specific validation**

- Each number opens the exact corresponding list and sums reconcile; export matches scope; failed identity lookup cannot broaden to all.
- Verify the preserved source behavior: Retain crm_agent_roster/sales_pulse/contacts/free_leads_status/export, canonical identity mapping and Team workspace modes. Placeholder and inactive rows stay in their proper lists; preserve granted actions.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/components/teamOverviewAttendance.test.tsx`, `src/tests/lib/p0RepairPacket.test.ts`, `src/tests/lib/todayProductionLandingElevation.test.ts`, `src/tests/lib/vaTeamAccessContract.test.ts`, `src/tests/lib/vantageProductionGap.test.ts`, `src/tests/pages/DashboardCRM.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Call sheet — `EthosCallSheet`
<a id="page-ethos-call-sheet"></a>

**Decision:** Keep. **Source:** `src/pages/EthosCallSheet.tsx` (835 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/ethos-call-sheet` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><EthosCallSheet /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the imported hierarchy call list and recorded call outcomes clear.

**Existing data/API calls:** rpc `ethos_call_sheet`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/dateUtils`, `@/lib/phone`, `@/lib/ethosCallSheet`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/EthosCallSheet.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the imported hierarchy call list and recorded call outcomes clear.
Decision: Keep. Routes: /dashboard/ethos-call-sheet.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Import provenance → Search/team filter → Next contact and outcome.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain ethos_call_sheet and existing export-file parsing/row identity. Imported hierarchy information is not automatically current contracting or issued production.
Acceptance: Import is deliberate; row counts match parse/receipt; call outcome attaches to the intended person and errors remain visible.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `EmptyState` expression below is copied from `src/pages/EthosCallSheet.tsx:449`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<EmptyState
            icon={<PhoneCall className="h-7 w-7" />}
            variant="default"
            title="Nobody in this list"
            description="Nothing matches this list and search. Pick another list above to keep going."
          />
```

**Page-specific validation**

- Import is deliberate; row counts match parse/receipt; call outcome attaches to the intended person and errors remain visible.
- Verify the preserved source behavior: Retain ethos_call_sheet and existing export-file parsing/row identity. Imported hierarchy information is not automatically current contracting or issued production.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Contracting — `CarrierContracts`
<a id="page-carrier-contracts"></a>

**Decision:** Keep. **Source:** `src/pages/CarrierContracts.tsx` (290 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/contracting` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CarrierContracts /></ProtectedRoute>}` |
| `/dashboard/contracting/carriers` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CarrierContracts /></ProtectedRoute>}` |
| `/dashboard/contracting/history` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CarrierContracts /></ProtectedRoute>}` |
| `/dashboard/contracting/documents` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><CarrierContracts /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make current MGN submissions and received-contract evidence distinct from historical review.

**Existing data/API calls:** from `carriers`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/contractingLinks`, `@/components/contracting/ContractingIntakeAdmin`, `@/components/contracting/ContractingRequestsBoard`, `@/components/contracting-review/ContractingReviewWorkspace`, `@/hooks/useContractRecords`, `@/lib/externalHref`.

**Baseline / current state:** Current local source defaults to MGN handoff plus the submissions board. Agent receipts are a separate current view; directory, intake history and historical review remain explicit reference paths. The old requests URL is now a preserving admin-gated alias.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CarrierContracts.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make current MGN submissions and received-contract evidence distinct from historical review.
Decision: Keep. Routes: /dashboard/contracting, /dashboard/contracting/carriers, /dashboard/contracting/history, /dashboard/contracting/documents.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: MGN handoff and current submissions → Agent receipts and issued writing numbers → Directory and historical reference.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The default is the MGN handoff plus ContractingRequestsBoard. The requests alias redirects to that submissions view with its admin wrapper retained. ?view=receipts opens the current receipt tracker; ?view=legacy opens HistoricalContractingReviewWorkspace; /history is intake history, /documents is issued writing numbers, and /carriers is the configured directory reference. Preserve useContractSummary/useContractRows and all role restrictions. Opening MGN, delivering a request, receiving a contract and carrier approval are separate facts.
Acceptance: Each deep link opens its exact current/reference mode; request delivery never becomes carrier approval; directory and historical carrier counts do not define the current lineup; writing-number errors remain explicit.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ContractingRequestsBoard` expression below is copied from `src/pages/CarrierContracts.tsx:129`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ContractingRequestsBoard />
```

**Page-specific validation**

- Each deep link opens its exact current/reference mode; request delivery never becomes carrier approval; directory and historical carrier counts do not define the current lineup; writing-number errors remain explicit.
- Verify the preserved source behavior: The default is the MGN handoff plus ContractingRequestsBoard. The requests alias redirects to that submissions view with its admin wrapper retained. ?view=receipts opens the current receipt tracker; ?view=legacy opens HistoricalContractingReviewWorkspace; /history is intake history, /documents is issued writing numbers, and /carriers is the configured directory reference. Preserve useContractSummary/useContractRows and all role restrictions. Opening MGN, delivering a request, receiving a contract and carrier approval are separate facts.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/lib/contractingProfileEmail.test.ts`, `src/tests/pages/CarrierContracts.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Contracting profile — `ContractingProfile`
<a id="page-contracting-profile"></a>

**Decision:** Keep. **Source:** `src/pages/ContractingProfile.tsx` (199 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/contracting-profile` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ContractingProfile /></ProtectedRoute>}` |

**Observed behavior and source contract**

Focus the agent on completing the real required profile and carrier details.

**Existing data/API calls:** rpc `get_my_contracting_profile`; rpc `record_contracting_link_open`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/contractReview`.

**Baseline / current state:** Caller-owned contracting form is a real email/deep-link endpoint. Preserve exact route and receipt semantics.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ContractingProfile.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Focus the agent on completing the real required profile and carrier details.
Decision: Keep. Routes: /dashboard/contracting-profile.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified current profile → Missing required fields → Confirmed save/next link.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain get_my_contracting_profile, existing save handlers and record_contracting_link_open semantics. Opening a link is not contract submission, approval or appointment.
Acceptance: Failed profile load does not show a blank editable success form; validation and save receipts remain; no private fields leak across accounts.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CarrierDetails` expression below is copied from `src/pages/ContractingProfile.tsx:144`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CarrierDetails mine={mine.data} onSaved={() => void qc.invalidateQueries({ queryKey: ["my-contracting-profile"] })} />
```

**Page-specific validation**

- Failed profile load does not show a blank editable success form; validation and save receipts remain; no private fields leak across accounts.
- Verify the preserved source behavior: Retain get_my_contracting_profile, existing save handlers and record_contracting_link_open semantics. Opening a link is not contract submission, approval or appointment.
- Existing focused checks to inspect: `src/tests/lib/contractingProfileEmail.test.ts`, `src/tests/pages/contractingProfile.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Grow my team — `ContractingDownlines`
<a id="page-contracting-downlines"></a>

**Decision:** Keep. **Source:** `src/pages/ContractingDownlines.tsx` (395 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/grow` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ContractingDownlines /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep recruit and hire/contract entry paths distinct inside one team-growth page.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/components/invitations/invitationApi`, `@/lib/recruitLinks`, `@/lib/phone`, `@/lib/utils`, `@/lib/contractingDownlines`.

**Baseline / current state:** Scoped hire/contracting submissions and team board. Distinct from owner carrier administration.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ContractingDownlines.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep recruit and hire/contract entry paths distinct inside one team-growth page.
Decision: Keep. Routes: /dashboard/grow.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Recruiting link → Contracting join link → Authorized downline/pay-tier controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve useMyRecruitingLink, actual contracting links and pay-tier rules, including a required reason for reducing a level. A percent shown here is not a paid commission receipt.
Acceptance: Each copied link keeps the correct owner; level-change permission/confirmation remains; duplicate URL can redirect without losing query/hash.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `EmailTypoHint` expression below is copied from `src/pages/ContractingDownlines.tsx:381`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<EmailTypoHint value={edit.email} onAccept={(n) => setEdit((s) => ({ ...s, email: n }))} />
```

**Page-specific validation**

- Each copied link keeps the correct owner; level-change permission/confirmation remains; duplicate URL can redirect without losing query/hash.
- Verify the preserved source behavior: Preserve useMyRecruitingLink, actual contracting links and pay-tier rules, including a required reason for reducing a level. A percent shown here is not a paid commission receipt.
- Existing focused checks to inspect: `src/tests/pages/ContractingDownlines.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Assistant team — `VaManagerPortal`
<a id="page-va-manager-portal"></a>

**Decision:** Keep. **Source:** `src/pages/VaManagerPortal.tsx` (564 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/va-team` | admin / va_manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowRoles={["va_manager"]}><VaManagerPortal /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make staff-account status and the manager’s queue clear without exposing broad account administration.

**Existing data/API calls:** invoke `create-va-account`; invoke `set-va-account`

**Existing helpers/components:** `@/lib/personInitials`, `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/hooks/useConfirm`, `@/hooks/useSoundEffects`, `@/lib/utils`, `@/lib/celebrate`, `@/lib/tones`, `@/components/pipeline/worklist/worklistFormat`, `@/components/pipeline/worklist/RecruitSlaQueue`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/VaManagerPortal.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make staff-account status and the manager’s queue clear without exposing broad account administration.
Decision: Keep. Routes: /va-team.
Audience: admin / va_manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Assistant accounts → Active/disabled status → Create or change account explicitly.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep create-va-account/set-va-account, role scope and existing confirmation. Staff login authority must come from server checks, not client role labels.
Acceptance: Unauthorized users cannot create/change staff; failed account action is not active success; current queue remains separate from account counts.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `RecruitSlaQueue` expression below is copied from `src/pages/VaManagerPortal.tsx:351`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<RecruitSlaQueue mineOnly title="My queue" />
```

**Page-specific validation**

- Unauthorized users cannot create/change staff; failed account action is not active success; current queue remains separate from account counts.
- Verify the preserved source behavior: Keep create-va-account/set-va-account, role scope and existing confirmation. Staff login authority must come from server checks, not client role labels.
- Existing focused checks to inspect: `src/tests/pages/VaManagerPortal.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent duplicates — `AgentDuplicates`
<a id="page-agent-duplicates"></a>

**Decision:** Keep. **Source:** `src/pages/admin/AgentDuplicates.tsx` (301 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/admin/agent-duplicates` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AgentDuplicates /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep duplicate resolution as an evidence-led administrative workflow.

**Existing data/API calls:** from `v_agent_duplicate_candidates`; rpc `merge_agent_into_canonical`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useConfirm`, `@/lib/agentDuplicateWinner`.

**Baseline / current state:** Required primary admin identity-merge destination. CRM does not replace its adjudication action.

**Copy-ready implementation prompt**

```text
Work only on src/pages/admin/AgentDuplicates.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep duplicate resolution as an evidence-led administrative workflow.
Decision: Keep. Routes: /admin/agent-duplicates.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Candidate groups → Canonical identity evidence → Explicit merge preview/confirmation.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_agent_duplicate_candidates and merge_agent_into_canonical. Never auto-merge by name, discard history or hide this required Owner operation during navigation cleanup.
Acceptance: Conflict, denied merge and server failure remain visible; preview identifies retained identity; no merge runs during review/visual QA.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/admin/AgentDuplicates.tsx:182`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardContent className="flex items-center gap-3 py-8">
            <ShieldCheck className="h-6 w-6 text-emerald-500" />
            <div>
              <p className="font-medium">No unresolved duplicates.</p>
              <p className="text-sm text-muted-foreground">
                Every agent identity maps to exactly one row. Nothing to adjudicate.
              </p>
            </div>
          </CardContent>
        </Card>
```

**Page-specific validation**

- Conflict, denied merge and server failure remain visible; preview identifies retained identity; no merge runs during review/visual QA.
- Verify the preserved source behavior: Retain v_agent_duplicate_candidates and merge_agent_into_canonical. Never auto-merge by name, discard history or hide this required Owner operation during navigation cleanup.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Accounts — `DashboardAccounts`
<a id="page-dashboard-accounts"></a>

**Decision:** Keep. **Source:** `src/pages/DashboardAccounts.tsx` (986 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/accounts` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><DashboardAccounts /></ProtectedRoute>}` |

**Observed behavior and source contract**

Separate account lookup from sensitive account actions and keep role information clear.

**Existing data/API calls:** from `v_agents_full`; from `user_roles`; from `agents`; rpc `staff_existing_auth_user_ids`; from `profiles`; invoke `send-password-reset`; invoke `generate-magic-link`

**Existing helpers/components:** `@/lib/looseSupabase`, `@/components/hires/HireStageControl`, `@/hooks/useAuth`, `@/hooks/useSoundEffects`, `@/lib/utils`, `@/hooks/useConfirm`.

**Baseline / current state:** Auth/account administration has capabilities beyond roster display. Keep protected drilldown.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DashboardAccounts.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Separate account lookup from sensitive account actions and keep role information clear.
Decision: Keep. Routes: /dashboard/accounts.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Account roster/search → Profile and role state → Explicit authorized recovery/admin actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve v_agents_full, existing staff identity checks, role editing, reset and magic-link handling. Do not show secrets or generate recovery links on mount.
Acceptance: No-account and search-empty states differ; reset/change failures stay explicit; inactive/departed identity cannot regain routing by a UI shortcut.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `DropdownMenu` expression below is copied from `src/pages/DashboardAccounts.tsx:544`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${account.name}`} className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleEditAccount(account)}>
          <Edit className="mr-2 h-4 w-4" />
          Edit Account
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReachableEmail(account)}
          onClick={async () => {
            try {
              const { error } = await supabase.functions.invoke("send-password-reset", {
                body: { email: account.email, type: "reset" },
              });
              if (error) throw error;
              playSound("success");
              toast.success(`Password reset email sent to ${account.email}`);
            } catch (err: unknown) {
              playSound("error");
              toast.error(errorMessage(err, "Failed to send password reset"));
            }
          }}
        >
          <Key className="mr-2 h-4 w-4" />
          Send Password Reset
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasReachableEmail(account)}
          onClick={async () => {
            try {
              const { error } = await supabase.functions.invoke("generate-magic-link", {
                body: { email: account.email, destination: "portal" },
              });
              if (error) throw error;
              playSound("success");
              toast.success(`Magic login link sent to ${account.email}`);
            } catch (err: unknown) {
              playSound("error");
              toast.error(errorMessage(err, "Failed to send login link"));
            }
          }}
        >
          <Link2 className="mr-2 h-4 w-4" />
          Send Magic Login Link
        </DropdownMenuItem>
        {account.hasAgentRecord && <DropdownMenuSeparator />}
        {account.hasAgentRecord && (account.status === "active" ? (
          <DropdownMenuItem onClick={() => handleToggleStatus(account)} className="text-destructive focus:text-destructive">
            <UserX className="mr-2 h-4 w-4" />
            Deactivate Account
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => handleToggleStatus(account)} className="text-emerald-500 focus:text-emerald-500">
            <UserCheck className="mr-2 h-4 w-4" />
            Reactivate Account
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
```

**Page-specific validation**

- No-account and search-empty states differ; reset/change failures stay explicit; inactive/departed identity cannot regain routing by a UI shortcut.
- Verify the preserved source behavior: Preserve v_agents_full, existing staff identity checks, role editing, reset and magic-link handling. Do not show secrets or generate recovery links on mount.
- Existing focused checks to inspect: `src/tests/lib/inviteAccountLifecycle.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Producer recovery — `ProducerReactivation`
<a id="page-producer-reactivation"></a>

**Decision:** Keep. **Source:** `src/pages/ProducerReactivation.tsx` (350 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/reactivation` | admin / manager; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers><ProducerReactivation /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make dormant producers and the reason to contact them the primary queue.

**Existing data/API calls:** from `v_producer_reactivation`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/phone`.

**Baseline / current state:** Distinct producer recovery queue; keep as a team drilldown with manager scope.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ProducerReactivation.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make dormant producers and the reason to contact them the primary queue.
Decision: Keep. Routes: /dashboard/reactivation.
Audience: admin / manager. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Dormancy cohort → Previous production context → Call list.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_producer_reactivation and hot/warm win-back distinctions. Past production is not forecast recoverable revenue; do not add a fictional recovery amount.
Acceptance: Cohort summary matches rows; missing history is explicit; contact actions preserve the selected identity.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Kpi` expression below is copied from `src/pages/ProducerReactivation.tsx:154`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Kpi
            label="Monthly ALP if all returned"
            value={usd(recoverable)}
            icon={RefreshCw}
            tone="emerald"
          />
```

**Page-specific validation**

- Cohort summary matches rows; missing history is explicit; contact actions preserve the selected identity.
- Verify the preserved source behavior: Retain v_producer_reactivation and hot/warm win-back distinctions. Past production is not forecast recoverable revenue; do not add a fictional recovery amount.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Producer profile — `ProducerProfile`
<a id="page-producer-profile"></a>

**Decision:** Keep. **Source:** `src/pages/ProducerProfile.tsx` (959 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/profile` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ProducerProfile /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the verified person, production history and authorized profile edits in a clear hierarchy.

**Existing data/API calls:** rpc `producer_profile_detail`; from `profiles`; from `agents`; from `v_production_comp_truth`; from `applications`; from `onboarding_modules`; from `onboarding_progress`

**Existing helpers/components:** `@/components/profile/AgentDocuments`, `@/components/profile/AccountRoleControl`, `@/components/profile/AgentLicensingEditor`, `@/components/hires/HireStageControl`, `@/hooks/usePageTitle`, `@/components/contracting/ContractingReadinessCard`, `@/components/contracting/ContractingStanding`, `@/lib/utils`, `@/hooks/useAuth`, `@/lib/phone`.

**Baseline / current state:** Preserve own/authorized producer details, comp percentage, contracts, documents and training progress.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ProducerProfile.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the verified person, production history and authorized profile edits in a clear hierarchy.
Decision: Keep. Routes: /dashboard/profile.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Identity and current standing → Monthly production and carrier mix → Recent deals and permitted edits.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain producer_profile_detail and v_production_comp_truth, query-selected profile and not-on-file handling. Do not mix another profile’s application or training context into the current page.
Acceptance: Unknown profile versus failed read differs; charts and recent deals share scope; failed edits and account switches cannot leak stale data.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `NotOnFile` expression below is copied from `src/pages/ProducerProfile.tsx:412`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<NotOnFile label="no agents beneath this producer" />
```

**Page-specific validation**

- Unknown profile versus failed read differs; charts and recent deals share scope; failed edits and account switches cannot leak stale data.
- Verify the preserved source behavior: Retain producer_profile_detail and v_production_comp_truth, query-selected profile and not-on-file handling. Do not mix another profile’s application or training context into the current page.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Team transfers — `TransferRequests`
<a id="page-transfer-requests"></a>

**Decision:** Keep. **Source:** `src/pages/TransferRequests.tsx` (345 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/transfers` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><TransferRequests /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep pending requests and decided history distinct with clear consent and reason.

**Existing data/API calls:** from `agents`; from `v_transfer_requests`; from `transfer_requests`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/dateUtils`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/TransferRequests.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep pending requests and decided history distinct with clear consent and reason.
Decision: Keep. Routes: /dashboard/transfers.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Pending requests → Request details/reason → Decided history.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain v_transfer_requests and transfer_requests semantics, actual owner/manager gates and confirmation. A request is not an approved manager change.
Acceptance: Failed submission/decision cannot look transferred; history remains immutable except existing authorized actions.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/TransferRequests.tsx:321`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent className="p-6 text-center text-13 text-muted-foreground">No decisions yet. History will fill as approvals come in.</CardContent></Card>
```

**Page-specific validation**

- Failed submission/decision cannot look transferred; history remains immutable except existing authorized actions.
- Verify the preserved source behavior: Retain v_transfer_requests and transfer_requests semantics, actual owner/manager gates and confirmation. A request is not an approved manager change.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent detail — `AgentDetail`
<a id="page-agent-detail"></a>

**Decision:** Consolidate duplicate URL now; page merge only after Producer Profile parity. **Source:** `src/pages/AgentDetail.tsx` (221 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agent/:id` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AgentDetail /></ProtectedRoute>}` |

**Observed behavior and source contract**

Preserve legacy agent/deal/ledger detail while evaluating a future merge into Producer Profile.

**Existing data/API calls:** from `agents`; from `deals`; from `commission_ledger`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`, `@/lib/formatEnumLabel`, `@/lib/dateUtils`, `@/lib/dealTruth`.

**Baseline / current state:** Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentDetail.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Preserve legacy agent/deal/ledger detail while evaluating a future merge into Producer Profile.
Decision: Consolidate duplicate URL now; page merge only after Producer Profile parity. Routes: /dashboard/agent/:id.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Agent identity → Recorded deals → Existing commission ledger context.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The two ID routes share this source and can canonicalize with encoded :id. Replacing the implementation requires parity with ProducerProfile fields, scopes and ledger detail; do not assume similar titles prove parity.
Acceptance: Both URLs select the same ID with query/hash retained; missing agent and failed ledger stay explicit.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentDetail.tsx:174`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4"><div className="text-xs text-muted-foreground">Pending commissions</div><div className="text-xl font-bold tabular-nums text-emerald-400">${pendingComm.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div></GlassCard>
```

**Page-specific validation**

- Both URLs select the same ID with query/hash retained; missing agent and failed ledger stay explicit.
- Verify the preserved source behavior: The two ID routes share this source and can canonicalize with encoded :id. Replacing the implementation requires parity with ProducerProfile fields, scopes and ledger detail; do not assume similar titles prove parity.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Team progression — `AgentPipelineSimple`
<a id="page-agent-pipeline-simple"></a>

**Decision:** Consolidate conditionally into Team/Transfers after action parity. **Source:** `src/pages/AgentPipelineSimple.tsx` (428 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/pipeline-simple` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<AgentPipelineSimple />}` |

**Observed behavior and source contract**

Keep this legacy progression and manager-switch workflow until the current Team page owns every action.

**Existing data/API calls:** from `agents`; from `deals`; invoke `send-notification`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/dateUtils`, `@/lib/dealTruth`.

**Baseline / current state:** Legacy agent roster/manager-switch board despite client-pipeline subtitle. Retain manager reassignment/request actions until CRM has parity; not a client pipeline replacement.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentPipelineSimple.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this legacy progression and manager-switch workflow until the current Team page owns every action.
Decision: Consolidate conditionally into Team/Transfers after action parity. Routes: /dashboard/pipeline-simple.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Agent stage → Current manager → Explicit switch request.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain existing agents/deals and notification-backed manager switch request. A notification is not an approved transfer; do not silently reparent an agent.
Acceptance: Stage metrics remain scoped; failed request is not transferred; keep a valid parent link before removing a shortcut.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentPipelineSimple.tsx:244`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-primary" /> Pending Manager Switch Requests
              </div>
              <div className="space-y-2">
                {switchRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                    <div>
                      <p className="text-sm font-medium text-foreground">{req.agentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {req.currentManager} → {req.requestedManager}
                      </p>
                      <p className="text-xs text-muted-foreground italic">"{req.reason}"</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="text-emerald-400" onClick={() => approveSwitch(req)}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-400" onClick={() => declineSwitch(req.id)}>
                        <XCircle className="h-3 w-3 mr-1" /> Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
```

**Page-specific validation**

- Stage metrics remain scoped; failed request is not transferred; keep a valid parent link before removing a shortcut.
- Verify the preserved source behavior: Retain existing agents/deals and notification-backed manager switch request. A notification is not an approved transfer; do not silently reparent an agent.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Board access — `AdminBoardAccess`
<a id="page-admin-board-access"></a>

**Decision:** Internal. **Source:** `src/pages/AdminBoardAccess.tsx` (168 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/admin/board-access` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminBoardAccess /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make board grants an explicit administrative permissions task.

**Existing data/API calls:** from `user_roles`; from `profiles`; from `manager_board_grants`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminBoardAccess.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make board grants an explicit administrative permissions task.
Decision: Internal. Routes: /dashboard/admin/board-access.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified manager → Current grant matrix → Confirmed grant change.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain manager_board_grants and role identity. UI visibility is not backend authorization; do not add client-controlled grants or treat a failed update as saved.
Acceptance: Only authorized admin can change grants; error/loading does not render unchecked false-denial values; switching accounts clears prior grant state.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AdminBoardAccess.tsx:117`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the managers list" error={managersError} onRetry={() => void refetch()} />
```

**Page-specific validation**

- Only authorized admin can change grants; error/loading does not render unchecked false-denial values; switching accounts clears prior grant state.
- Verify the preserved source behavior: Retain manager_board_grants and role identity. UI visibility is not backend authorization; do not add client-controlled grants or treat a failed update as saved.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent management — `AgentManagement`
<a id="page-agent-management"></a>

**Decision:** Consolidate conditionally into My Team after administrative action parity. **Source:** `src/pages/AgentManagement.tsx` (799 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/agent-management` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AgentManagement /></ProtectedRoute>}` |

**Observed behavior and source contract**

Move duplicated roster discovery toward My Team while preserving its remaining administrative actions.

**Existing data/API calls:** from `agents`; from `user_roles`; from `deals`; invoke `bulk-agent-message`; invoke `send-agent-nudge`

**Existing helpers/components:** `@/components/hires/HireStageControl`, `@/hooks/useAuth`, `@/hooks/useMyDownline`, `@/components/dashboard/AgentQuickEditDialog`, `@/hooks/usePortalLoginSender`, `@/lib/dateUtils`, `@/lib/dealTruth`, `@/lib/phone`, `@/components/shared/TeamLookupError`.

**Baseline / current state:** Older management surface overlaps CRM; retain role changes and destructive actions until explicitly migrated.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentManagement.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Move duplicated roster discovery toward My Team while preserving its remaining administrative actions.
Decision: Consolidate conditionally into My Team after administrative action parity. Routes: /dashboard/agent-management.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Scoped roster and stage → Existing account/contact actions → Explicit bulk action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain downline/role constraints and actual bulk-message, nudge and portal-login handlers until equivalent actions exist in Team. The existing CRM pointer is not proof that every action migrated.
Acceptance: Downline lookup failure cannot fall back to all; bulk selection and action preview match authorized rows; no live sends during redesign.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `TeamLookupError` expression below is copied from `src/pages/AgentManagement.tsx:330`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<TeamLookupError />
```

**Page-specific validation**

- Downline lookup failure cannot fall back to all; bulk selection and action preview match authorized rows; no live sends during redesign.
- Verify the preserved source behavior: Retain downline/role constraints and actual bulk-message, nudge and portal-login handlers until equivalent actions exist in Team. The existing CRM pointer is not proof that every action migrated.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Inactive agent recovery — `InactiveAgents`
<a id="page-inactive-agents"></a>

**Decision:** Improve. **Source:** `src/pages/InactiveAgents.tsx` (646 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/inactive-agents` | admin and managers (page gates internally); wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><InactiveAgents /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the recovery queue focused on severity, evidence and permitted next action.

**Existing data/API calls:** from `inactive_agent_queue`; from `agents`; from `applications`; from `deals`; invoke `detect-inactive-agents`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useConfirm`, `@/lib/phone`.

**Baseline / current state:** Source is admin/manager gated internally; align the broad route with its intended audience and retain recovery data.

**Copy-ready implementation prompt**

```text
Work only on src/pages/InactiveAgents.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the recovery queue focused on severity, evidence and permitted next action.
Decision: Improve. Routes: /dashboard/inactive-agents.
Audience: admin and managers (page gates internally). Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Warning/critical/abandoned queue → Last known activity → Existing recovery action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain inactive_agent_queue and detect-inactive-agents with scope and confirmation. A detection job is an explicit operational action, not an automatic page-load repair.
Acceptance: No-access, failed detection and empty queue differ; departed agents remain historical and do not regain routing or access.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/InactiveAgents.tsx:330`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="the recovery queue" error={entriesQuery.error} onRetry={() => void entriesQuery.refetch()} />
```

**Page-specific validation**

- No-access, failed detection and empty queue differ; departed agents remain historical and do not regain routing or access.
- Verify the preserved source behavior: Retain inactive_agent_queue and detect-inactive-agents with scope and confirmation. A detection job is an explicit operational action, not an automatic page-load repair.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
