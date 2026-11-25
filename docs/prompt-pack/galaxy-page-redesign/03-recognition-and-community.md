# Recognition and community

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Make the win loud. — `WinPostStudio`
<a id="page-win-post-studio"></a>

**Decision:** Keep. **Source:** `src/pages/WinPostStudio.tsx` (556 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/awards` | admin; wrappers: QueryShell | `{<ProtectedRoute requireAdmin><WinPostStudio /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the strongest earned production cards and manual copy/export workflow easy to use.

**Existing data/API calls:** rpc `win_post_feed`; rpc `win_post_queue_board`; rpc `win_post_queue_decide`

**Existing helpers/components:** `@/components/awards/AwardCopyActions`, `@/hooks/useAuth`, `@/lib/winPostCard`, `@/components/awards/awards.css`.

**Baseline / current state:** Admin content creation/queue uses current wins. Keep manual export/share and actual renderer.

**Copy-ready implementation prompt**

```text
Work only on src/pages/WinPostStudio.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the strongest earned production cards and manual copy/export workflow easy to use.
Decision: Keep. Routes: /awards.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified win window → Selected award and exact facts → Copy caption, copy stats, save/share PNG.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Baseline has typed presentation, account-owned selection/copy state, malformed-response validation and clipboard fallback. Keep source-specific milestone windows, no double-counting win/trophy ALP, manual publishing and exact renderer dimensions.
Acceptance: Clipboard success is shown only after success; failure leaves selectable text; account switch clears prior text; unknown values and different milestone windows stay honest.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `WinPostCardPreview` expression below is copied from `src/pages/WinPostStudio.tsx:439`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<WinPostCardPreview
              key={`${user?.id}-${winPostKey(item)}`}
              item={item}
              onOpen={() => setSelected(item)}
            />
```

**Page-specific validation**

- Clipboard success is shown only after success; failure leaves selectable text; account switch clears prior text; unknown values and different milestone windows stay honest.
- Verify the preserved source behavior: Baseline has typed presentation, account-owned selection/copy state, malformed-response validation and clipboard fallback. Keep source-specific milestone windows, no double-counting win/trophy ALP, manual publishing and exact renderer dimensions.
- Existing focused checks to inspect: `src/tests/pages/WinPostStudio.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Legacy award archive — `AwardGraphics`
<a id="page-award-graphics"></a>

**Decision:** Legacy. **Source:** `src/pages/AwardGraphics.tsx` (569 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/awards/legacy` | admin; wrappers: QueryShell | `{<ProtectedRoute requireAdmin><AwardGraphics /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the older generated-art archive available without presenting it as the new award renderer.

**Existing data/API calls:** from `award-graphics`; from `award_batches`; invoke `generate-award-graphics`

**Existing helpers/components:** `@/lib/utils`, `@/components/awards/AwardProfilesPanel`.

**Baseline / current state:** Historical graphics generator explicitly linked as legacy. Preserve old art/batches; do not label it the new renderer.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AwardGraphics.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the older generated-art archive available without presenting it as the new award renderer.
Decision: Legacy. Routes: /awards/legacy.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Archive period → Existing batch artwork → Explicit manual generation/export.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep award_batches and generate-award-graphics behavior while current /awards owns the new recognition kit. Label historical artwork and preserve generation confirmation/eligibility.
Acceptance: Old images remain labeled original/legacy; generating is never triggered by opening or restyling the page; missing files show errors.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `AwardProfilesPanel` expression below is copied from `src/pages/AwardGraphics.tsx:269`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<AwardProfilesPanel />
```

**Page-specific validation**

- Old images remain labeled original/legacy; generating is never triggered by opening or restyling the page; missing files show errors.
- Verify the preserved source behavior: Keep award_batches and generate-award-graphics behavior while current /awards owns the new recognition kit. Label historical artwork and preserve generation confirmation/eligibility.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Shared milestone — `PlaqueShare`
<a id="page-plaque-share"></a>

**Decision:** Keep. **Source:** `src/pages/PlaqueShare.tsx` (276 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/plaque/:slug` | public; wrappers: QueryShell | `{<PlaqueShare />}` |

**Observed behavior and source contract**

Present the publicly shared recorded milestone and manual share controls clearly.

**Existing data/API calls:** from `plaque_awards`; from `agents`; from `v_profile_directory`

**Existing helpers/components:** `@/components/awards/plaqueAwardPresentation`.

**Baseline / current state:** Public share_slug endpoint retained. Visible facts and manual-share captions now use recorded metric/date units; stored images are labeled original artwork. No automatic publishing.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PlaqueShare.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the publicly shared recorded milestone and manual share controls clearly.
Decision: Keep. Routes: /plaque/:slug.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Recipient and award → Typed recorded value/date → Download or manual share.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep share_slug access, recorded-unit/date presenter and original-art labeling. Hires, streak days, premium and premium increase cannot become interchangeable dollar totals.
Acceptance: Unknown slug, absent amount, hiring count, monthly date bucket and share fallback all remain truthful.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/PlaqueShare.tsx:234`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button onClick={downloadPng} className="col-span-2 md:col-span-1">
            <Download className="h-4 w-4 mr-2" /> Download
          </Button>
```

**Page-specific validation**

- Unknown slug, absent amount, hiring count, monthly date bucket and share fallback all remain truthful.
- Verify the preserved source behavior: Keep share_slug access, recorded-unit/date presenter and original-art labeling. Hires, streak days, premium and premium increase cannot become interchangeable dollar totals.
- Existing focused checks to inspect: `src/tests/pages/legacyAwardMetrics.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Announcements — `Announcements`
<a id="page-announcements"></a>

**Decision:** Keep. **Source:** `src/pages/Announcements.tsx` (455 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/community` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Announcements /></ProtectedRoute>}` |

**Observed behavior and source contract**

Separate current agency announcements from the live culture feed.

**Existing data/API calls:** from `announcements`; from `v_culture_feed`

**Existing helpers/components:** `@/lib/looseSupabase`, `@/lib/utils`, `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/lib/dateUtils`, `@/components/deals/SubmitDealDialog`.

**Baseline / current state:** Community announcements remain distinct from work queues; keep contextual discovery.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Announcements.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Separate current agency announcements from the live culture feed.
Decision: Keep. Routes: /dashboard/community.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Pinned/current notices → Readable feed → Authorized announcement creation.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep announcements and v_culture_feed, role-gated creation and SubmitDealDialog. Do not merge announcement publishing with personal chat or auto-send notices.
Acceptance: Pinned ordering, expired/empty/error states and create failure are distinct; regular agents cannot see admin mutation controls.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/Announcements.tsx:217`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">New announcement</span>
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Anything published here sits at the top of every agent's feed until it is deactivated.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                placeholder="Title…"
                aria-label="Announcement title"
                className="h-10 sm:h-9"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <Textarea
                placeholder="Announcement body…"
                aria-label="Announcement body"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={4}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex min-h-10 items-center gap-2 text-xs font-medium text-foreground sm:min-h-9">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
                    checked={form.pinned}
                    onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                  />
                  Pin to top
                </label>
                <select
                  aria-label="Announcement priority"
                  className="h-10 rounded-sm border border-border bg-background px-2 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:h-9"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 flex-1 sm:h-9 sm:flex-none"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-10 flex-1 sm:h-9 sm:flex-none"
                    disabled={!form.title.trim() || !form.body.trim() || postAnnouncement.isPending}
                    onClick={() => postAnnouncement.mutate()}
                  >
                    <Send className="mr-1.5 h-4 w-4" />
                    Publish
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
```

**Page-specific validation**

- Pinned ordering, expired/empty/error states and create failure are distinct; regular agents cannot see admin mutation controls.
- Verify the preserved source behavior: Keep announcements and v_culture_feed, role-gated creation and SubmitDealDialog. Do not merge announcement publishing with personal chat or auto-send notices.
- Existing focused checks to inspect: `src/tests/components/AnnouncementsHeaderActions.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Challenges — `Challenges`
<a id="page-challenges"></a>

**Decision:** Improve. **Source:** `src/pages/Challenges.tsx` (192 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/challenges` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Challenges /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make verified challenge progress clear while treating reward claims as an unresolved evidence boundary.

**Existing data/API calls:** from `apex_challenges`; from `apex_challenge_unlocks`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`.

**Baseline / current state:** Catalog claims wallet credits while its own admin copy says unlock engine is next phase. Verify live evaluator/ledger before presenting earned benefits.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Challenges.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make verified challenge progress clear while treating reward claims as an unresolved evidence boundary.
Decision: Improve. Routes: /dashboard/challenges.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current challenge → Progress and eligibility → Actual unlock evidence.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep apex_challenges and apex_challenge_unlocks. Source wallet-credit descriptions are not proof that money was earned or paid; verify the evaluator/ledger before promoting reward amounts.
Acceptance: Unknown progress or missing unlock is not complete; no check-in/streak points or fictional gains are added.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ChallengeCard` expression below is copied from `src/pages/Challenges.tsx:132`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ChallengeCard key={c.id} challenge={c} unlocked={unlockedSet.has(c.id)} />
```

**Page-specific validation**

- Unknown progress or missing unlock is not complete; no check-in/streak points or fictional gains are added.
- Verify the preserved source behavior: Keep apex_challenges and apex_challenge_unlocks. Source wallet-credit descriptions are not proof that money was earned or paid; verify the evaluator/ledger before promoting reward amounts.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Milestones earned — `AwardsGallery`
<a id="page-awards-gallery"></a>

**Decision:** Keep. **Source:** `src/pages/AwardsGallery.tsx` (742 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/awards` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AwardsGallery /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep recorded recognition as a bold gallery with easy copying and original artwork access.

**Existing data/API calls:** from `plaque_awards`; from `agents`; invoke `send-plaque-batch`; invoke `render-all-plaques`; invoke `request-agent-photos`; from `public`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useBusinessToday`, `@/lib/utils`, `@/components/awards/AwardCopyActions`, `@/components/awards/plaqueAwardPresentation`, `@/components/awards/awards.css`.

**Baseline / current state:** New recorded-award wall/copy controls with typed metrics. Preserve primary Wins & Awards link.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AwardsGallery.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep recorded recognition as a bold gallery with easy copying and original artwork access.
Decision: Keep. Routes: /dashboard/awards.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Filtered milestone cards → Typed award facts → Copy/export and authorized edit controls.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve 500-row loaded cap, real-user query keys, selection ownership, filters, unknown premium, separate count units and manual email/render actions. Do not label old stored PNGs as the new renderer.
Acceptance: Count-versus-premium cases, monthly buckets, failed clipboard fallback, stale reads, account switch and admin-only controls remain covered.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PlaqueFace` expression below is copied from `src/pages/AwardsGallery.tsx:644`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PlaqueFace row={selectedAward} />
```

**Page-specific validation**

- Count-versus-premium cases, monthly buckets, failed clipboard fallback, stale reads, account switch and admin-only controls remain covered.
- Verify the preserved source behavior: Preserve 500-row loaded cap, real-user query keys, selection ownership, filters, unknown premium, separate count units and manual email/render actions. Do not label old stored PNGs as the new renderer.
- Existing focused checks to inspect: `src/tests/pages/AwardsGallery.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Hall of fame — `HallOfFame`
<a id="page-hall-of-fame"></a>

**Decision:** Keep. **Source:** `src/pages/HallOfFame.tsx` (676 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/hall-of-fame` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><HallOfFame /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep historical recognition rankings based on actual plaque counts.

**Existing data/API calls:** from `plaque_awards`; from `agents`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/useBusinessToday`, `@/lib/dashboardRecords`, `@/components/awards/plaqueAwardPresentation`, `@/lib/utils`.

**Baseline / current state:** Mixed-amount dollar totals removed. Full-history plaque-count standings and distinct milestone-type counts remain; cards/details use recorded hires, days, ALP, premium/increase or unknown-unit labels.

**Copy-ready implementation prompt**

```text
Work only on src/pages/HallOfFame.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep historical recognition rankings based on actual plaque counts.
Decision: Keep. Routes: /dashboard/hall-of-fame.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Top honorees by plaque count → Milestone-type breadth → Historical wall and detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Baseline removed mixed-unit money totals and added the shared metric/date presenter. Preserve full-history count standings, bounded wall reads, stable ties and error-before-empty behavior.
Acceptance: Mixed hires/days/premium fixtures cannot produce a dollar total; missing names/amounts remain honest; query filters and detail agree.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `StatTile` expression below is copied from `src/pages/HallOfFame.tsx:219`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<StatTile icon={Award} label="Milestone types" value={stats?.milestoneTypes ?? 0} loading={!stats} color="text-emerald-500 dark:text-emerald-400" />
```

**Page-specific validation**

- Mixed hires/days/premium fixtures cannot produce a dollar total; missing names/amounts remain honest; query filters and detail agree.
- Verify the preserved source behavior: Baseline removed mixed-unit money totals and added the shared metric/date presenter. Preserve full-history count standings, bounded wall reads, stable ties and error-before-empty behavior.
- Existing focused checks to inspect: `src/tests/pages/legacyAwardMetrics.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Team chat — `TeamChat`
<a id="page-team-chat"></a>

**Decision:** Legacy. **Source:** `src/pages/TeamChat.tsx` (159 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/team-chat` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><TeamChat /></ProtectedRoute>}` |

**Observed behavior and source contract**

Preserve the existing conversation with a compact readable composer and clear delivery result.

**Existing data/API calls:** from `team_chat_messages`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/utils`.

**Baseline / current state:** Mobile nav source marks this deprecated. Do not delete history; confirm active usage before redirecting or retiring writes.

**Copy-ready implementation prompt**

```text
Work only on src/pages/TeamChat.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Preserve the existing conversation with a compact readable composer and clear delivery result.
Decision: Legacy. Routes: /dashboard/team-chat.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Conversation → Sender/time context → Compose and send.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep team_chat_messages, existing realtime and auth rules. A route alias is safe only with the same access; do not merge message history into announcements or trigger outbound messages.
Acceptance: Account switch and denied read do not expose cached conversation; failed send stays unsent and does not duplicate a message on retry.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/TeamChat.tsx:96`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <Users className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Chat's quiet. Say hi.</p>
            </div>
          ) : messages.map((m, i) => {
            const mine = m.user_id === user?.id;
            const grouped = groupedByUser(i);
            return (
              <div key={m.id} className={cn("flex gap-2 max-w-full", mine && "flex-row-reverse")}>
                <div className="w-9 shrink-0">
                  {!grouped && (
                    m.author_avatar
                      ? <img src={m.author_avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                      : <div className="h-9 w-9 rounded-full bg-white dark:bg-card flex items-center justify-center text-xs font-bold text-white">
                          {m.author_name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                  )}
                </div>
                <div className={cn("flex flex-col max-w-[70%]", mine && "items-end")}>
                  {!grouped && (
                    <div className={cn("text-[11px] text-muted-foreground mb-0.5 px-2", mine && "text-right")}>
                      <span className="font-semibold text-foreground/80">{m.author_name}</span>
                      <span className="ml-1.5">{formatDistanceToNowStrict(new Date(m.created_at), { addSuffix: true })}</span>
                    </div>
                  )}
                  <div className={cn(
                    "px-3.5 py-2 rounded-md text-sm leading-relaxed break-words bounce-in",
                    mine
                      ? "bg-white dark:bg-card text-gray-950 rounded-br-md"
                      : "bg-muted/40 text-foreground rounded-bl-md",
                  )}>
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-border/40 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Drop in the team chat…"
            className="h-10"
          />
          <Button onClick={send} disabled={sending || !input.trim()} className="gap-1.5 h-10">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </GlassCard>
```

**Page-specific validation**

- Account switch and denied read do not expose cached conversation; failed send stays unsent and does not duplicate a message on retry.
- Verify the preserved source behavior: Keep team_chat_messages, existing realtime and auth rules. A route alias is safe only with the same access; do not merge message history into announcements or trigger outbound messages.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Leaderboard — `Leaderboard`
<a id="page-leaderboard"></a>

**Decision:** Keep. **Source:** `src/pages/Leaderboard.tsx` (585 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/leaderboard` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Leaderboard /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make real production, recruiting and referral rankings readable and competitive.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/recruiting/GrowScoreboard`, `@/hooks/useAuth`, `@/hooks/useBusinessToday`, `@/hooks/useProductionRealtime`, `@/hooks/useTeamBoard`, `@/hooks/useRecruitingBoard`, `@/lib/celebrate`, `@/lib/dateUtils`, `@/lib/personInitials`, `@/lib/tones`, `@/lib/utils`, `@/lib/leaderboardBoard`.

**Baseline / current state:** Keep production/recruiting/referral rankings and date filters. Existing links already connect Awards and Hall of Fame.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Leaderboard.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make real production, recruiting and referral rankings readable and competitive.
Decision: Keep. Routes: /dashboard/leaderboard.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected board and period → Ranked rows → Existing cheer and detail actions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep useTeamBoard/useRecruitingBoard, business dates, query-selected boards, tie semantics, true units and cheer deduplication. Preserve hierarchy and no simulated live gains.
Acceptance: Each board/tab and URL query produces the same ranking as its hook; empty/error/stale states and long names/amounts work at 332px.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/Leaderboard.tsx:294`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState {...describeQuery(query)} label="the leaderboard" onRetry={() => void query.refetch()} asOf={query.dataUpdatedAt}>
      {board ? <SalesBoardBody board={board} window={window} when={when} todayKey={todayKey} pendingKey={pendingKey} onCheer={onCheer} /> : null}
    </QueryState>
```

**Page-specific validation**

- Each board/tab and URL query produces the same ranking as its hook; empty/error/stale states and long names/amounts work at 332px.
- Verify the preserved source behavior: Keep useTeamBoard/useRecruitingBoard, business dates, query-selected boards, tie semantics, true units and cheer deduplication. Preserve hierarchy and no simulated live gains.
- Existing focused checks to inspect: `src/tests/components/ScopedProductionScoreboard.test.tsx`, `src/tests/lib/hireMonitoringRecruitingIncome.test.ts`, `src/tests/lib/leaderboardLinksSlackHubs.test.ts`, `src/tests/pages/Leaderboard.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My recognition history — `MyPlaques`
<a id="page-my-plaques"></a>

**Decision:** Keep — canonical recorded award/reward history; reward-source merge implemented locally. **Source:** `src/pages/MyPlaques.tsx` (330 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-plaques` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyPlaques /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the combined reward/plaque history the honest personal archive.

**Existing data/API calls:** from `agents`; from `agentlink_rewards`; from `plaque_awards`

**Existing helpers/components:** `@/hooks/useAuth`, `@/components/plaque/Plaque`, `@/components/awards/plaqueAwardPresentation`, `@/lib/utils`, `@/hooks/usePageTitle`, `@/components/awards/AwardCopyActions`.

**Baseline / current state:** Canonical combined award/reward history with applied source filters; both former Rewards URLs now redirect directly here.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyPlaques.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the combined reward/plaque history the honest personal archive.
Decision: Keep — canonical recorded award/reward history; reward-source merge implemented locally. Routes: /dashboard/my-plaques.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Mine versus authorized all → Reward/plaque source → Typed facts and original art.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep exact own identity before reads, user/scope keys, malformed-response rejection, recorded-unit/month presenter and the labeled historical plaque limit. A reward-only source filter must apply to the actual rows, not only the tab style.
Acceptance: Missing identity never falls back to all; source and scope filters reconcile; failed reads differ from verified empty; share/copy uses recorded facts.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Plaque` expression below is copied from `src/pages/MyPlaques.tsx:271`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Plaque
                    agentName={c.agentName}
                    achievement={c.achievement}
                    date={c.date}
                    period={c.period}
                    rank={c.rank}
                    subtitle={c.subtitle}
                    watermark={c.source === "plaque" ? "MILESTONE" : undefined}
                    avatarUrl={c.avatarUrl}
                    width={640} height={800}
                  />
```

**Page-specific validation**

- Missing identity never falls back to all; source and scope filters reconcile; failed reads differ from verified empty; share/copy uses recorded facts.
- Verify the preserved source behavior: Keep exact own identity before reads, user/scope keys, malformed-response rejection, recorded-unit/month presenter and the labeled historical plaque limit. A reward-only source filter must apply to the actual rows, not only the tab style.
- Existing focused checks to inspect: `src/tests/pages/legacyAwardMetrics.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Strike administration — `AdminStrikes`
<a id="page-admin-strikes"></a>

**Decision:** Keep. **Source:** `src/pages/AdminStrikes.tsx` (915 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/strikes` | admin; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin><AdminStrikes /></ProtectedRoute>}` |

**Observed behavior and source contract**

Prioritize current discipline work and supporting evidence without losing severity trends.

**Existing data/API calls:** from `v_agent_strikes`; from `v_strike_summary`; from `v_strike_trend`; rpc `resolve_strike`; rpc `void_strike`; from `strike_templates`; rpc `issue_strike`

**Existing helpers/components:** React and existing local/static content.

**Baseline / current state:** Required primary admin conduct workflow and trend evidence. Keep issue/resolve/void and agent visibility.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AdminStrikes.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Prioritize current discipline work and supporting evidence without losing severity trends.
Decision: Keep. Routes: /dashboard/strikes.
Audience: admin. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Active severity summary → Agent queue and history → Explicit issue/resolve/void.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve v_agent_strikes/summary/trend, templates and RPC semantics. Resolved and voided records are distinct; mutation controls remain authorized and deliberate.
Acceptance: Required reasons/evidence remain; failed RPC cannot look resolved; charts reflect actual status filters.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/AdminStrikes.tsx:304`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState compact status="error" label="the strike summary" error={summaryQuery.error} onRetry={() => void summaryQuery.refetch()} className="py-6" />
```

**Page-specific validation**

- Required reasons/evidence remain; failed RPC cannot look resolved; charts reflect actual status filters.
- Verify the preserved source behavior: Preserve v_agent_strikes/summary/trend, templates and RPC semantics. Resolved and voided records are distinct; mutation controls remain authorized and deliberate.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## My standing — `MyStrikes`
<a id="page-my-strikes"></a>

**Decision:** Keep. **Source:** `src/pages/MyStrikes.tsx` (294 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/my-strikes` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><MyStrikes /></ProtectedRoute>}` |

**Observed behavior and source contract**

Give the current agent a clear explanation of their own recorded standing and allowed response.

**Existing data/API calls:** from `agents`; from `v_agent_strikes`; rpc `acknowledge_strike`

**Existing helpers/components:** `@/hooks/useAuth`.

**Baseline / current state:** Own conduct records and acknowledgement; do not expose admin management controls.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MyStrikes.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Give the current agent a clear explanation of their own recorded standing and allowed response.
Decision: Keep. Routes: /dashboard/my-strikes.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current standing → Active and past records → Acknowledge or contact action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep exact agent resolution, own strike query and acknowledge_strike. No hidden or failed read may display a clean-standing success.
Acceptance: Unknown identity and failed reads stay unavailable; acknowledgement receipt controls UI; no access to another agent’s record.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `QueryState` expression below is copied from `src/pages/MyStrikes.tsx:136`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<QueryState status="error" label="your strikes" error={strikesQuery.error} onRetry={() => void strikesQuery.refetch()} />
```

**Page-specific validation**

- Unknown identity and failed reads stay unavailable; acknowledgement receipt controls UI; no access to another agent’s record.
- Verify the preserved source behavior: Keep exact agent resolution, own strike query and acknowledge_strike. No hidden or failed read may display a clean-standing success.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
