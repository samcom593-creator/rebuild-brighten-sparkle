# Settings, support and messages

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Help and support — `HelpCenter`
<a id="page-help-center"></a>

**Decision:** Consolidate duplicate discovery into Help while retaining support and query tabs. **Source:** `src/pages/HelpCenter.tsx` (263 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/nova` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><HelpCenter /></ProtectedRoute>}` |
| `/dashboard/help` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><HelpCenter /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make support and searchable help the clear account-menu destination.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/support/SupportDesk`.

**Baseline / current state:** Same implementation is mounted at the proposed canonical URL. Preserve query/hash/record IDs, inbound links and role behavior; no feature deletion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/HelpCenter.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make support and searchable help the clear account-menu destination.
Decision: Consolidate duplicate discovery into Help while retaining support and query tabs. Routes: /dashboard/nova, /dashboard/help.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Support desk → Searchable help → Accurate workflow links.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain query-selected desk tab and SupportDesk. Canonical finance help distinguishes recorded payment from issued policy; do not hide the support path behind an unrelated assistant-only screen.
Acceptance: Support link opens the correct tab; FAQ search and live support errors remain useful; old /dashboard/nova entry preserves intended context.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `SupportDesk` expression below is copied from `src/pages/HelpCenter.tsx:157`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<SupportDesk />
```

**Page-specific validation**

- Support link opens the correct tab; FAQ search and live support errors remain useful; old /dashboard/nova entry preserves intended context.
- Verify the preserved source behavior: Retain query-selected desk tab and SupportDesk. Canonical finance help distinguishes recorded payment from issued policy; do not hide the support path behind an unrelated assistant-only screen.
- Existing focused checks to inspect: `src/tests/lib/contractingProfileEmail.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Settings — `Settings`
<a id="page-settings"></a>

**Decision:** Keep. **Source:** `src/pages/Settings.tsx` (280 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/settings` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Settings />}` |
| `/dashboard/settings/agency` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><Settings /></ProtectedRoute>}` |
| `/dashboard/settings/notifications` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Settings />}` |
| `/dashboard/settings/security` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Settings />}` |
| `/dashboard/settings/billing` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><Settings /></ProtectedRoute>}` |
| `/dashboard/settings/nova-pro` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<Settings />}` |

**Observed behavior and source contract**

Keep one account entry with clear local role-filtered sections.

**Existing data/API calls:** rpc `get_my_agency_branding`; rpc `save_my_agency_branding`; from `notification_prefs`; invoke `ai-assistant`

**Existing helpers/components:** `@/components/dashboard/CalendarSyncSection`, `@/components/dashboard/IPhoneShortcutsSection`, `@/components/dashboard/ProfileSettings`, `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/assistantProbe`, `@/lib/notificationPrefsState`, `@/lib/settingsTabs`, `@/lib/utils`.

**Baseline / current state:** One account-menu Settings entry now leads to existing local role-filtered tabs. Existing agency/notification/security/billing/assistant URLs remain real tab variants, not discarded features.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Settings.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep one account entry with clear local role-filtered sections.
Decision: Keep. Routes: /dashboard/settings, /dashboard/settings/agency, /dashboard/settings/notifications, /dashboard/settings/security, /dashboard/settings/billing, /dashboard/settings/nova-pro.
Audience: authenticated; admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current settings section → Minimal editable fields → Confirmed save state.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain pathname-based agency/notifications/security/billing/assistant modes and role-filtered sections. Preserve branding and notification persistence; do not discard a section merely because its primary sidebar link was removed.
Acceptance: Every tab deep link opens its correct authorized view; unsaved/error state is explicit; account switch cannot reuse prior settings.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/Settings.tsx:146`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="notification preferences" error="Not signed in." />
```

**Page-specific validation**

- Every tab deep link opens its correct authorized view; unsaved/error state is explicit; account switch cannot reuse prior settings.
- Verify the preserved source behavior: Retain pathname-based agency/notifications/security/billing/assistant modes and role-filtered sections. Preserve branding and notification persistence; do not discard a section merely because its primary sidebar link was removed.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/components/EthosConsumerSettings.test.tsx`, `src/tests/components/SettingsTabs.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Deleted lead history — `DeletedLeadsVault`
<a id="page-deleted-leads-vault"></a>

**Decision:** Keep. **Source:** `src/pages/DeletedLeadsVault.tsx` (402 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/settings/deleted-leads` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><DeletedLeadsVault /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep deleted records and any existing recovery action separate from active work.

**Existing data/API calls:** from `deleted_leads`; from `applications`; from `aged_leads`

**Existing helpers/components:** `@/hooks/useSoundEffects`, `@/lib/utils`, `@/hooks/useAuth`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DeletedLeadsVault.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep deleted records and any existing recovery action separate from active work.
Decision: Keep. Routes: /dashboard/settings/deleted-leads.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Deleted source and date → Search/filter → Explicit authorized recovery.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain deleted_leads and source-specific application/aged-lead handling. A restored record must return to the correct model/owner; do not silently combine IDs or erase history.
Acceptance: Missing/denied/error states differ; selected source and recovery target are correct; no restore or hard delete during redesign.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/DeletedLeadsVault.tsx:232`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">Warning</p>
            <p className="text-sm text-muted-foreground">
              Permanently deleting leads cannot be undone. Restored leads will be returned to their original table.
            </p>
          </div>
        </div>
      </GlassCard>
```

**Page-specific validation**

- Missing/denied/error states differ; selected source and recovery target are correct; no restore or hard delete during redesign.
- Verify the preserved source behavior: Retain deleted_leads and source-specific application/aged-lead handling. A restored record must return to the correct model/owner; do not silently combine IDs or erase history.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiting triage — `SamInbox`
<a id="page-sam-inbox"></a>

**Decision:** Consolidate conditionally under Recruiting after triage-action parity. **Source:** `src/pages/SamInbox.tsx` (235 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-inbox` | real authenticated admin outside role preview; applicant triage; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><SamInbox /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep this admin applicant triage queue recognizable and distinct from private conversations.

**Existing data/API calls:** from `v_sam_inbox`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/hooks/useRolePreview`, `@/lib/phone`.

**Baseline / current state:** Renamed Recruiting triage, with authenticated-admin/outside-preview admission, viewer-keyed validated reads, explicit error/retry state and honest 120-row labels. This is applicant triage, not private conversations; retain until recruiting parent has action parity.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SamInbox.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this admin applicant triage queue recognizable and distinct from private conversations.
Decision: Consolidate conditionally under Recruiting after triage-action parity. Routes: /dashboard/my-inbox.
Audience: real authenticated admin outside role preview; applicant triage. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Paid/contact/staleness bucket → Applicant context → Existing next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Baseline uses real-admin/outside-preview admission, viewer-keyed validated v_sam_inbox reads and an honest 120-row window. Do not add Sam-only DM gating to this agency triage page.
Acceptance: Malformed or failed response is unavailable; counts say loaded window; any future merge into Recruiting preserves these buckets and actions.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/SamInbox.tsx:115`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="empty" title="Recruiting triage is unavailable in this view" body="Use your admin account outside role preview." />
```

**Page-specific validation**

- Malformed or failed response is unavailable; counts say loaded window; any future merge into Recruiting preserves these buckets and actions.
- Verify the preserved source behavior: Baseline uses real-admin/outside-preview admission, viewer-keyed validated v_sam_inbox reads and an honest 120-row window. Do not add Sam-only DM gating to this agency triage page.
- Existing focused checks to inspect: `src/tests/pages/SamInbox.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My notifications — `MyNotifications`
<a id="page-my-notifications"></a>

**Decision:** Keep. **Source:** `src/pages/MyNotifications.tsx` (130 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/notifications/mine` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyNotifications /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the current account’s own notification history readable and clearly scoped.

**Existing data/API calls:** from `notifications`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/notificationFilters`.

**Baseline / current state:** Personal notifications already reached by bell and Cmd+K. Keep outside primary sidebar.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyNotifications.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the current account’s own notification history readable and clearly scoped.
Decision: Keep. Routes: /dashboard/notifications/mine.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Unread/recent items → Recorded event detail → Existing mark/read or destination.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain notifications query and current auth scope. Do not replace it with admin delivery logs or fabricate delivered/read states.
Acceptance: Account switch clears prior items; read failure is not no notifications; links target the intended authorized record.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/MyNotifications.tsx:80`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardContent className="text-center py-16 text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-3 opacity-50" />
            No notifications yet.
          </CardContent>
        </Card>
```

**Page-specific validation**

- Account switch clears prior items; read failure is not no notifications; links target the intended authorized record.
- Verify the preserved source behavior: Retain notifications query and current auth scope. Do not replace it with admin delivery logs or fabricate delivered/read states.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Message operations — `NotificationHub`
<a id="page-notification-hub"></a>

**Decision:** Consolidate conditionally with Inbox operations after channel/action parity. **Source:** `src/pages/NotificationHub.tsx` (1646 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/notifications` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><NotificationHub /></ProtectedRoute>}` |

**Observed behavior and source contract**

Reduce sender duplication only after every existing channel and delivery control is mapped.

**Existing data/API calls:** invoke `send-notification`; invoke `send-sms-auto-detect`; invoke `send-outreach-email`; from `applications`; from `aged_leads`; invoke `send-push-optin-email`; from `notification_log`; invoke `send-push-notification`; invoke `send-seminar-invite-blast`; invoke `send-batch-blast`; from `v_notification_log_with_role`

**Existing helpers/components:** `@/lib/edgeInvoke`, `@/lib/carrierOptions`, `@/hooks/useSoundEffects`, `@/lib/utils`, `@/lib/notificationFilters`, `@/lib/phone`.

**Baseline / current state:** Admin notification history/actions overlap Inbox, but preserve delivery/filter/export parity before merging.

**Copy-ready implementation prompt**

```text
Work only on src/pages/NotificationHub.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Reduce sender duplication only after every existing channel and delivery control is mapped.
Decision: Consolidate conditionally with Inbox operations after channel/action parity. Routes: /dashboard/notifications.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Explicit channel/audience → Draft/preview and confirmation → Actual send progress/receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve existing SMS/email/push/batch handlers, opt-in constraints, resume behavior and delivery logs. This is a write-heavy operation, not the personal notification inbox; visual cleanup cannot authorize or auto-resume a live blast.
Acceptance: No send on render/QA; audience preview and counts reconcile; cancellation/retry/resume cannot duplicate deliveries; any merge retains all channel-specific protections.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Table` expression below is copied from `src/pages/NotificationHub.tsx:1605`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Push</TableHead>
                    <TableHead className="text-right">SMS</TableHead>
                    <TableHead className="text-right">Email</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blastHistory.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No blast history yet</TableCell></TableRow>
                  ) : blastHistory.map(day => (
                    <TableRow
                      key={day.date}
                      className="cursor-pointer hover:bg-muted/50 transition"
                      onClick={() => {
                        setActiveTab("logs");
                        setSearch("");
                        setChannelFilter("all");
                        setStatusFilter("all");
                        toast.info(`Switched to log view for recent activity`);
                      }}
                    >
                      <TableCell className="font-medium text-sm">{format(new Date(day.date + "T12:00:00"), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-right text-sm">{day.push || "—"}</TableCell>
                      <TableCell className="text-right text-sm">{day.sms || "—"}</TableCell>
                      <TableCell className="text-right text-sm">{day.email || "—"}</TableCell>
                      <TableCell className="text-right text-sm font-bold">{day.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
```

**Page-specific validation**

- No send on render/QA; audience preview and counts reconcile; cancellation/retry/resume cannot duplicate deliveries; any merge retains all channel-specific protections.
- Verify the preserved source behavior: Preserve existing SMS/email/push/batch handlers, opt-in constraints, resume behavior and delivery logs. This is a write-heavy operation, not the personal notification inbox; visual cleanup cannot authorize or auto-resume a live blast.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Message inbox — `InboxPage`
<a id="page-inbox-page"></a>

**Decision:** Keep. **Source:** `src/pages/InboxPage.tsx` (886 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/inbox` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><InboxPage /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep message review distinct from deliberate outbound and destructive log actions.

**Existing data/API calls:** from `notification_log`; from `email_tracking`; invoke `send-notification`; invoke `send-outreach-email`; invoke `send-sms-auto-detect`; from `table`; invoke `fn`

**Existing helpers/components:** `@/lib/utils`, `@/hooks/useConfirm`, `@/lib/phone`.

**Baseline / current state:** Admin operational inbox/delivery evidence. Keep separate from private owner Money Inbox and Instagram.

**Copy-ready implementation prompt**

```text
Work only on src/pages/InboxPage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep message review distinct from deliberate outbound and destructive log actions.
Decision: Keep. Routes: /dashboard/inbox.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Filtered message history → Selected message detail → Explicit send/export/delete controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain notification/email logs, existing channel handlers and hard-delete confirmations. Do not treat logs as delivered proof unless status says so; deleting history is not unsending.
Acceptance: Selection/export match current filters; hard delete requires existing confirmation; failed send/delete stays visible and no action runs during layout work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PageHeader` expression below is copied from `src/pages/InboxPage.tsx:449`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PageHeader
        accent="blue"
        eyebrow="Admin · Inbox"
        eyebrowIcon={<Mail className="h-3 w-3" />}
        title="Inbox"
        subtitle="Every push, SMS, auto-SMS, and email response from your team and clients in one stream."
        actions={
          <>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setBlastResult(null); setBlastOpen(true); }}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Megaphone className="mr-2 h-4 w-4" /> Push out to all
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchMessages()} disabled={loading}>
              <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />
```

**Page-specific validation**

- Selection/export match current filters; hard delete requires existing confirmation; failed send/delete stays visible and no action runs during layout work.
- Verify the preserved source behavior: Retain notification/email logs, existing channel handlers and hard-delete confirmations. Do not treat logs as delivered proof unless status says so; deleting history is not unsending.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
