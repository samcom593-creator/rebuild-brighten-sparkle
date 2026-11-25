# Public recruiting, account entry and applicant journeys

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Where winning agencies are built. — `Index`
<a id="page-index"></a>

**Decision:** Keep. **Source:** `src/pages/Index.tsx` (47 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/` | public; wrappers: public route | `{<Index />}` |

**Observed behavior and source contract**

Keep the public entry to one screen with the license question and two audience choices.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/useAuth`, `@/components/landing/HeroSection`, `@/lib/refSlug`.

**Baseline / current state:** Keep exact two recruiting choices plus Agent Login, aggressive coherent style and accessible flow.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Index.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the public entry to one screen with the license question and two audience choices.
Decision: Keep. Routes: /.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Brand and exact headline → Licensed / unlicensed choice → Compact Agent Login.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: The existing public recruiting href builder carries valid referral, paid source and UTM context. Do not reintroduce production graphs, proof metrics, a third recruiting path or below-fold clutter.
Acceptance: At 332px show exactly two recruiting CTAs plus one utility login; each choice reaches its own VSL and keeps attribution. Authenticated routing stays unchanged.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `HeroSection` expression below is copied from `src/pages/Index.tsx:40`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<HeroSection />
```

**Page-specific validation**

- At 332px show exactly two recruiting CTAs plus one utility login; each choice reaches its own VSL and keeps attribution. Authenticated routing stays unchanged.
- Verify the preserved source behavior: The existing public recruiting href builder carries valid referral, paid source and UTM context. Do not reintroduce production graphs, proof metrics, a third recruiting path or below-fold clutter.
- Existing focused checks to inspect: `src/tests/lib/todayProductionLandingElevation.test.ts`, `src/tests/pages/publicRecruitingHome.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Careers — `CareersIndex`
<a id="page-careers-index"></a>

**Decision:** Keep. **Source:** `src/pages/CareersIndex.tsx` (201 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/careers` | public; wrappers: QueryShell | `{<CareersIndex />}` |

**Observed behavior and source contract**

Make state selection and the next recruiting step the purpose of the careers directory.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/JsonLd`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CareersIndex.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make state selection and the next recruiting step the purpose of the careers directory.
Decision: Keep. Routes: /careers.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: State directory → Remote role expectations → One application CTA.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep state landing URLs and JSON-LD. Existing static earnings, time-to-license and rating statements are source copy, not verified performance data; verify or qualify them before highlighting.
Acceptance: Every displayed state resolves; keyboard navigation works; no new earnings or licensing promise appears.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/CareersIndex.tsx:130`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard key={s.label} variant="subtle" className="p-4 text-center">
              <s.icon className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.label}</p>
            </GlassCard>
```

**Page-specific validation**

- Every displayed state resolves; keyboard navigation works; no new earnings or licensing promise appears.
- Verify the preserved source behavior: Keep state landing URLs and JSON-LD. Existing static earnings, time-to-license and rating statements are source copy, not verified performance data; verify or qualify them before highlighting.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Careers by state — `StateCareerLanding`
<a id="page-state-career-landing"></a>

**Decision:** Keep. **Source:** `src/pages/StateCareerLanding.tsx` (318 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/careers/:state` | public; wrappers: QueryShell | `{<StateCareerLanding />}` |

**Observed behavior and source contract**

Give a state visitor the location context and a clean path into the existing recruiting funnel.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/JsonLd`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/StateCareerLanding.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Give a state visitor the location context and a clean path into the existing recruiting funnel.
Decision: Keep. Routes: /careers/:state.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: State name and requirements → Role expectations → Application CTA.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Resolve the existing state config and preserve the unknown-state fallback and structured data. A state-specific page must not imply a verified state fee or timeline absent from its source.
Acceptance: Valid and invalid state params work; referral/UTM values survive the CTA; headings and schema use the same state.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/StateCareerLanding.tsx:230`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard key={s.label} variant="subtle" className="p-4 text-center">
              <s.icon className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">{s.label}</p>
            </GlassCard>
```

**Page-specific validation**

- Valid and invalid state params work; referral/UTM values survive the CTA; headings and schema use the same state.
- Verify the preserved source behavior: Resolve the existing state config and preserve the unknown-state fallback and structured data. A state-specific page must not imply a verified state fee or timeline absent from its source.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Apply to Galaxy — `Apply`
<a id="page-apply"></a>

**Decision:** Keep. **Source:** `src/pages/Apply.tsx` (1714 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/apply` | public; wrappers: QueryShell | `{<Apply />}` |

**Observed behavior and source contract**

Reduce visual load around the existing application steps without changing qualification or submission logic.

**Existing data/API calls:** invoke `get-public-recruiters`; invoke `resolve-ref-slug`; invoke `submit-application`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/constants`, `@/lib/carrierOptions`, `@/lib/apexConfig`, `@/lib/analytics`, `@/pages/apply/QuickQualifyStep`, `@/pages/apply/ApplyRadixFields`, `@/lib/refSlug`, `@/lib/refLinkNotice`, `@/lib/attribution`, `@/lib/phone`, `@/lib/publicRecruitingFlow`.

**Baseline / current state:** Preserve licensed/unlicensed defaults, resumed answers, attribution, validation and actual submissions.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Apply.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Reduce visual load around the existing application steps without changing qualification or submission logic.
Decision: Keep. Routes: /apply.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current step and progress → Only the required fields → Clear validation and next action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep licensed/unlicensed defaults, resumed answers, recruiter resolution, attribution, schema validation and both submit-application paths. Never overwrite a saved licensing answer with a later marketing default.
Acceptance: Exercise both audiences, paid/referral inputs, resumed answers, mobile focus, validation errors and failed submissions without creating live applications.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ApplyCheckbox` expression below is copied from `src/pages/Apply.tsx:1317`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ApplyCheckbox
                          id="hasExperience"
                          checked={hasExperience}
                          onCheckedChange={(checked) => setValue("hasInsuranceExperience", checked === true)}
                        />
```

**Page-specific validation**

- Exercise both audiences, paid/referral inputs, resumed answers, mobile focus, validation errors and failed submissions without creating live applications.
- Verify the preserved source behavior: Keep licensed/unlicensed defaults, resumed answers, recruiter resolution, attribution, schema validation and both submit-application paths. Never overwrite a saved licensing answer with a later marketing default.
- Existing focused checks to inspect: `src/tests/components/RecruitLinkAttribution.test.tsx`, `src/tests/lib/getActiveManagersAuth.test.ts`, `src/tests/lib/todayProductionLandingElevation.test.ts`, `src/tests/lib/vslPlacement.test.ts`, `src/tests/pages/applyRecruitingDefaults.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Shared clips — `SharePage`
<a id="page-share-page"></a>

**Decision:** Internal. **Source:** `src/pages/SharePage.tsx` (107 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/share/:token` | intended token/link recipient; wrappers: QueryShell | `{<SharePage />}` |

**Observed behavior and source contract**

Make a token recipient able to identify and download the intended clip without exposing unrelated content.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/saveMedia`.

**Baseline / current state:** Token-scoped editor clip sharing must remain public to the intended recipient and outside primary navigation.

**Copy-ready implementation prompt**

```text
Work only on src/pages/SharePage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make a token recipient able to identify and download the intended clip without exposing unrelated content.
Decision: Internal. Routes: /share/:token.
Audience: intended token/link recipient. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Shared title → Clip preview → Download original.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve the existing token lookup and loading/expired/error distinctions. Do not convert token access to a public listing or copy signed URLs into logs.
Acceptance: Valid, expired, missing and denied token states remain distinct; download works on a narrow screen.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/SharePage.tsx:98`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button size="sm" variant="outline" disabled className="w-full">Link refreshing — try again in a minute</Button>
```

**Page-specific validation**

- Valid, expired, missing and denied token states remain distinct; download works on a narrow screen.
- Verify the preserved source behavior: Preserve the existing token lookup and loading/expired/error distinctions. Do not convert token access to a public listing or copy signed URLs into logs.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Application received — `ApplySuccess`
<a id="page-apply-success"></a>

**Decision:** Internal. **Source:** `src/pages/ApplySuccess.tsx` (21 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/apply/success` | public; wrappers: QueryShell | `{<ApplySuccess />}` |

**Observed behavior and source contract**

Keep the generic application confirmation as the existing result router and next-step surface.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/landing/ApplicationConfirmationV2`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApplySuccess.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the generic application confirmation as the existing result router and next-step surface.
Decision: Internal. Routes: /apply/success.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Receipt state → Audience-appropriate next step → Recovery link.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep ApplicationConfirmation and query-derived application context. A URL alone is not evidence that a new application was created.
Acceptance: Missing, valid and failed result data use the existing confirmation states; no duplicate submit or onboarding send occurs.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ApplicationConfirmation` expression below is copied from `src/pages/ApplySuccess.tsx:15`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ApplicationConfirmation
      applicationId={applicationId}
      showCalendly={false}
    />
```

**Page-specific validation**

- Missing, valid and failed result data use the existing confirmation states; no duplicate submit or onboarding send occurs.
- Verify the preserved source behavior: Keep ApplicationConfirmation and query-derived application context. A URL alone is not evidence that a new application was created.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensed next steps — `ApplySuccessLicensed`
<a id="page-apply-success-licensed"></a>

**Decision:** Internal. **Source:** `src/pages/ApplySuccessLicensed.tsx` (18 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/apply/success/licensed` | public; wrappers: QueryShell | `{<ApplySuccessLicensed />}` |

**Observed behavior and source contract**

Present the licensed result clearly using the same confirmation implementation.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/landing/ApplicationConfirmationV2`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApplySuccessLicensed.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the licensed result clearly using the same confirmation implementation.
Decision: Internal. Routes: /apply/success/licensed.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Confirmed application → Licensed next action → Return/recovery path.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep the licensed variant and query context passed to ApplicationConfirmation. Do not replace its account/session or booking behavior with a static success screen.
Acceptance: Licensed result retains its variant and handles missing application data; unlicensed onboarding is not substituted.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ApplicationConfirmation` expression below is copied from `src/pages/ApplySuccessLicensed.tsx:11`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ApplicationConfirmation
      applicationId={applicationId}
      forceLicenseStatus="licensed"
      showCalendly
    />
```

**Page-specific validation**

- Licensed result retains its variant and handles missing application data; unlicensed onboarding is not substituted.
- Verify the preserved source behavior: Keep the licensed variant and query context passed to ApplicationConfirmation. Do not replace its account/session or booking behavior with a static success screen.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing next steps — `ApplySuccessUnlicensed`
<a id="page-apply-success-unlicensed"></a>

**Decision:** Internal. **Source:** `src/pages/ApplySuccessUnlicensed.tsx` (18 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/apply/success/unlicensed` | public; wrappers: QueryShell | `{<ApplySuccessUnlicensed />}` |

**Observed behavior and source contract**

Present the unlicensed result and the verified licensing next action.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/landing/ApplicationConfirmationV2`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApplySuccessUnlicensed.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the unlicensed result and the verified licensing next action.
Decision: Internal. Routes: /apply/success/unlicensed.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Confirmed application → Licensing roadmap → Return/recovery path.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep the unlicensed variant and existing confirmation actions. Public prospect media and post-application onboarding media have separate contracts.
Acceptance: Unlicensed result opens the correct existing licensing step; no false purchase or course-completion status.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ApplicationConfirmation` expression below is copied from `src/pages/ApplySuccessUnlicensed.tsx:11`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ApplicationConfirmation
      applicationId={applicationId}
      forceLicenseStatus="unlicensed"
      showCalendly={false}
    />
```

**Page-specific validation**

- Unlicensed result opens the correct existing licensing step; no false purchase or course-completion status.
- Verify the preserved source behavior: Keep the unlicensed variant and existing confirmation actions. Public prospect media and post-application onboarding media have separate contracts.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Your licensing path — `UnlicensedOverview`
<a id="page-unlicensed-overview"></a>

**Decision:** Keep. **Source:** `src/pages/UnlicensedOverview.tsx` (131 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/unlicensed-overview` | public; wrappers: QueryShell | `{<UnlicensedOverview />}` |

**Observed behavior and source contract**

Turn the four-step overview into a concise ordered roadmap with a clear current next step.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/apexConfig`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/UnlicensedOverview.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Turn the four-step overview into a concise ordered roadmap with a clear current next step.
Decision: Keep. Routes: /unlicensed-overview.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Licensing walkthrough → Contracting after qualification → First activity steps.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep canonical LICENSING_VIDEO. The text must not promise a commission before licensing, contracting or an actual sale.
Acceptance: The canonical unlicensed video and licensing CTA are correct; links remain usable without a producer login.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Link` expression below is copied from `src/pages/UnlicensedOverview.tsx:116`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Link
            to="/get-licensed#licensing-video"
            className="mt-5 inline-block bg-teal-500 hover:bg-teal-400 transition-colors text-black font-bold text-base px-6 py-3 rounded-lg"
          >
            Watch the licensing walkthrough
          </Link>
```

**Page-specific validation**

- The canonical unlicensed video and licensing CTA are correct; links remain usable without a producer login.
- Verify the preserved source behavior: Keep canonical LICENSING_VIDEO. The text must not promise a commission before licensing, contracting or an actual sale.
- Existing focused checks to inspect: `src/tests/lib/onboardingVideoPlacement.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Application status — `ApplicationStatus`
<a id="page-application-status"></a>

**Decision:** Keep. **Source:** `src/pages/ApplicationStatus.tsx` (43 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/status/:applicationId` | public; wrappers: QueryShell | `{<ApplicationStatus />}` |

**Observed behavior and source contract**

Make the real current next step dominate the status page.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/landing/ApplicationConfirmationV2`, `@/components/next-step/NextStepCandidateCard`, `@/components/landing/ApplicantSelfReport`, `@/hooks/useApplicationStatus`.

**Baseline / current state:** Applicant status/next-step deep link must remain; do not redirect to a generic dashboard.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApplicationStatus.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the real current next step dominate the status page.
Decision: Keep. Routes: /status/:applicationId.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified current step → Applicant self-report → Confirmation detail.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve useApplicationStatus, the applicationId parameter and NextStepCandidateCard/ApplicantSelfReport. Do not show a completed step merely because a visitor opened the route.
Acceptance: Test invalid ID, denied/failed fetch, current next-step and self-report failure; retain token/account access rules.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `NextStepCandidateCard` expression below is copied from `src/pages/ApplicationStatus.tsx:23`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<NextStepCandidateCard applicationId={applicationId} />
```

**Page-specific validation**

- Test invalid ID, denied/failed fetch, current next-step and self-report failure; retain token/account access rules.
- Verify the preserved source behavior: Preserve useApplicationStatus, the applicationId parameter and NextStepCandidateCard/ApplicantSelfReport. Do not show a completed step merely because a visitor opened the route.
- Existing focused checks to inspect: `src/tests/hooks/useApplicationStatus.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Your next move — `Vsl`
<a id="page-vsl"></a>

**Decision:** Keep. **Source:** `src/pages/Vsl.tsx` (84 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/vsl` | public; wrappers: QueryShell | `{<Vsl />}` |

**Observed behavior and source contract**

Keep the audience choice attached to the matching video and one application CTA.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/analytics`, `@/lib/publicRecruitingFlow`, `@/lib/vslMedia`, `@/components/landing/recruiting-funnel.css`.

**Baseline / current state:** Frozen audience-specific video correction; do not modify in this audit.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Vsl.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the audience choice attached to the matching video and one application CTA.
Decision: Keep. Routes: /vsl.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Selected audience → Correct video and poster → Continue to application.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Use the established audience selector: producer overview for licensed-producer, licensing walkthrough for licensing-roadmap. Keep matching duration/schema/play telemetry, keyed media reset, referral/UTM context and no watch-time application gate.
Acceptance: Switch tracks while mounted and verify source/poster/schema/duration together; both CTAs preserve track and attribution.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Link` expression below is copied from `src/pages/Vsl.tsx:27`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Link to={buildPublicRecruitingHref("/", searchParams)} className="recruiting-wordmark" aria-label={`${BRAND.legalName} home`}>
          <Crown className="recruiting-wordmark-crown" aria-hidden="true" strokeWidth={1.5} />
          <span>{BRAND.legalName}</span>
        </Link>
```

**Page-specific validation**

- Switch tracks while mounted and verify source/poster/schema/duration together; both CTAs preserve track and attribution.
- Verify the preserved source behavior: Use the established audience selector: producer overview for licensed-producer, licensing walkthrough for licensing-roadmap. Keep matching duration/schema/play telemetry, keyed media reset, referral/UTM context and no watch-time application gate.
- Existing focused checks to inspect: `src/tests/lib/todayProductionLandingElevation.test.ts`, `src/tests/lib/vslPlacement.test.ts`, `src/tests/pages/publicRecruitingHome.test.tsx`, `src/tests/pages/publicRecruitingVsl.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Get licensed — `GetLicensed`
<a id="page-get-licensed"></a>

**Decision:** Keep. **Source:** `src/pages/GetLicensed.tsx` (689 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/get-licensed` | public; wrappers: QueryShell | `{<GetLicensed />}` |

**Observed behavior and source contract**

Show the licensing checklist and the relevant video before optional reference material.

**Existing data/API calls:** from `applications`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/apexConfig`, `@/lib/licensingMedia`, `@/lib/onboardingMedia`, `@/components/landing/StateLicensingCosts`.

**Baseline / current state:** Unlicensed roadmap and canonical licensing video. Preserve public licensing links, state context and application attribution.

**Copy-ready implementation prompt**

```text
Work only on src/pages/GetLicensed.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show the licensing checklist and the relevant video before optional reference material.
Decision: Keep. Routes: /get-licensed.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current licensing step → Canonical licensing walkthrough → Course/exam/fingerprint milestones.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep application context and existing status fields. Retain the distinction between licensing video and ONBOARDING_VIDEO; do not infer a purchase, exam pass or license from local navigation.
Acceptance: Unknown application, missing dates, finished and unfinished milestones remain truthful; external resources and mobile video controls work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `LicensingVideoPlayer` expression below is copied from `src/pages/GetLicensed.tsx:320`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<LicensingVideoPlayer onEnded={startOnboardingVideo} />
```

**Page-specific validation**

- Unknown application, missing dates, finished and unfinished milestones remain truthful; external resources and mobile video controls work.
- Verify the preserved source behavior: Keep application context and existing status fields. Retain the distinction between licensing video and ONBOARDING_VIDEO; do not infer a purchase, exam pass or license from local navigation.
- Existing focused checks to inspect: `src/tests/lib/onboardingVideoPlacement.test.ts`, `src/tests/lib/vslPlacement.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing resources — `ResourcesLicensing`
<a id="page-resources-licensing"></a>

**Decision:** Keep. **Source:** `src/pages/ResourcesLicensing.tsx` (593 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/resources/licensing` | public; wrappers: QueryShell | `{<ResourcesLicensing />}` |

**Observed behavior and source contract**

Group existing courses, PDFs and scripts into a readable resource library.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Licensing reference material has value apart from application. Preserve current content links and state-specific facts.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ResourcesLicensing.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Group existing courses, PDFs and scripts into a readable resource library.
Decision: Keep. Routes: /resources/licensing.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Required starting resources → Courses → PDFs and scripts.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep actual resource URLs and category labels. This reference library is not course completion evidence or a replacement for the operational licensing tracker.
Acceptance: Every source link remains accessible, long titles wrap, and the most important starting resource is visible at 332px.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/ResourcesLicensing.tsx:552`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6 md:p-8 mb-6">
          <SectionHeader
            icon={Award}
            title="Quick Links"
            count={QUICK_LINKS.length}
            subtitle="Direct jumps to production tools + admin surfaces."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {QUICK_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-4 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/40 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-sm">{link.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {link.subtitle}
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform" />
              </a>
            ))}
          </div>
        </GlassCard>
```

**Page-specific validation**

- Every source link remains accessible, long titles wrap, and the most important starting resource is visible at 332px.
- Verify the preserved source behavior: Keep actual resource URLs and category labels. This reference library is not course completion evidence or a replacement for the operational licensing tracker.
- Existing focused checks to inspect: `src/tests/components/CommandDashboardsCoherence.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Training directory — `TrainingIndex`
<a id="page-training-index"></a>

**Decision:** Consolidate conditionally: public orientation remains until guest-resource parity is proven. **Source:** `src/pages/TrainingIndex.tsx` (275 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/training` | public; wrappers: QueryShell | `{<TrainingIndex />}` |

**Observed behavior and source contract**

Reduce the public directory to a clear bridge into the authenticated Training workspace and public licensing resources.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Public training directory points at several compatibility URLs. Preserve public resources and align signed-in destinations with canonical Training.

**Copy-ready implementation prompt**

```text
Work only on src/pages/TrainingIndex.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Reduce the public directory to a clear bridge into the authenticated Training workspace and public licensing resources.
Decision: Consolidate conditionally: public orientation remains until guest-resource parity is proven. Routes: /training.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Start here → Training workspace → Licensing resources.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep public resources reachable to unlicensed applicants. Do not redirect the entire public page into an authenticated route without proving audience parity.
Acceptance: Logged-out users can still find licensing help; authenticated learners can reach their course, Call Lab and library.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/TrainingIndex.tsx:246`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6 md:p-8 border-2 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold mb-1">Not licensed yet?</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Start with the licensing track. We walk you through the costs
                before you buy, and through every step after.
              </p>
              <GradientButton asChild>
                <Link to="/get-licensed">
                  <GraduationCap className="h-4 w-4 mr-2" />
                  Get Licensed
                </Link>
              </GradientButton>
            </div>
          </div>
        </GlassCard>
```

**Page-specific validation**

- Logged-out users can still find licensing help; authenticated learners can reach their course, Call Lab and library.
- Verify the preserved source behavior: Keep public resources reachable to unlicensed applicants. Do not redirect the entire public page into an authenticated route without proving audience parity.
- Existing focused checks to inspect: `src/tests/lib/onboardingVideoPlacement.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent login — `Login`
<a id="page-login"></a>

**Decision:** Keep. **Source:** `src/pages/Login.tsx` (530 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/login` | public; wrappers: QueryShell | `{<Login />}` |

**Observed behavior and source contract**

Make the sign-in method and recoverable error the focus of the login page.

**Existing data/API calls:** from `user_roles`; from `agents`; invoke `send-password-reset`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useSoundEffects`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Login.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the sign-in method and recoverable error the focus of the login page.
Decision: Keep. Routes: /login.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Email/phone method → Credentials or OTP → Password recovery.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve existing auth handlers, return-location handling, role/account resolution and reset requests. Never show a sign-in success before a verified session.
Acceptance: Exercise email, phone, invalid OTP, reset failure and safe return routing; prevent duplicate submissions and keyboard focus loss.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GradientButton` expression below is copied from `src/pages/Login.tsx:442`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GradientButton type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </GradientButton>
```

**Page-specific validation**

- Exercise email, phone, invalid OTP, reset failure and safe return routing; prevent duplicate submissions and keyboard focus loss.
- Verify the preserved source behavior: Preserve existing auth handlers, return-location handling, role/account resolution and reset requests. Never show a sign-in success before a verified session.
- Existing focused checks to inspect: `src/tests/components/FirstLoginGuide.test.tsx`, `src/tests/lib/magicLoginSession.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Set a new password — `ResetPassword`
<a id="page-reset-password"></a>

**Decision:** Keep. **Source:** `src/pages/ResetPassword.tsx` (160 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/reset-password` | public; wrappers: QueryShell | `{<ResetPassword />}` |

**Observed behavior and source contract**

Provide one clear recovery form and a truthful completion state.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ResetPassword.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Provide one clear recovery form and a truthful completion state.
Decision: Keep. Routes: /reset-password.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: New password → Confirmed save → Return to login.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep recovery-session checks and existing password update logic. Do not log recovery tokens or display account details from a missing session.
Acceptance: Expired recovery and update failure stay actionable; success requires the actual auth response.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GradientButton` expression below is copied from `src/pages/ResetPassword.tsx:149`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GradientButton type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Update password
              </GradientButton>
```

**Page-specific validation**

- Expired recovery and update failure stay actionable; success requires the actual auth response.
- Verify the preserved source behavior: Keep recovery-session checks and existing password update logic. Do not log recovery tokens or display account details from a missing session.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Create your account — `Signup`
<a id="page-signup"></a>

**Decision:** Keep. **Source:** `src/pages/Signup.tsx` (312 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/signup` | public; wrappers: QueryShell | `{<Signup />}` |

**Observed behavior and source contract**

Keep invited-manager signup focused on validating the invite before collecting credentials.

**Existing data/API calls:** invoke `validate-signup-token`; invoke `manager-signup`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Signup.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep invited-manager signup focused on validating the invite before collecting credentials.
Decision: Keep. Routes: /signup.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Invite validation → Account details → Create account.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain validate-signup-token and manager-signup; invalid or expired invites cannot fall back to unrestricted signup.
Acceptance: Invalid/expired invite, duplicate account, submission error and successful receipt remain distinct.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/Signup.tsx:179`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-8 text-center">
            <ShieldAlert className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <h1 className="text-2xl font-bold mb-2">Invalid Invite Link</h1>
            <p className="text-muted-foreground mb-6">
              This invite link is invalid, expired, or has already been used.
              Please contact your administrator for a new invite.
            </p>
            <GradientButton asChild className="w-full">
              <Link to="/login">
                Go to Login
              </Link>
            </GradientButton>
          </GlassCard>
```

**Page-specific validation**

- Invalid/expired invite, duplicate account, submission error and successful receipt remain distinct.
- Verify the preserved source behavior: Retain validate-signup-token and manager-signup; invalid or expired invites cannot fall back to unrestricted signup.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Join Galaxy — `Join`
<a id="page-join"></a>

**Decision:** Keep. **Source:** `src/pages/Join.tsx` (141 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/join` | public; wrappers: QueryShell | `{<Join />}` |

**Observed behavior and source contract**

Keep the existing account join flow short and consistent with the login surface.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Join.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing account join flow short and consistent with the login surface.
Decision: Keep. Routes: /join.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Account credentials → Existing-account path → Verified next step.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain current auth calls and navigation. Do not add role selection or infer producer/manager authority from a form value.
Acceptance: Existing user and new user flows show actual errors; no navigation before a successful session or existing receipt.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GradientButton` expression below is copied from `src/pages/Join.tsx:127`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GradientButton type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
              {loading ? "Signing in…" : "Continue"}
            </GradientButton>
```

**Page-specific validation**

- Existing user and new user flows show actual errors; no navigation before a successful session or existing receipt.
- Verify the preserved source behavior: Retain current auth calls and navigation. Do not add role selection or infer producer/manager authority from a form value.
- Existing focused checks to inspect: `src/tests/lib/onboardingVideoPlacement.test.ts`, `src/tests/pages/ContractJoin.test.tsx`, `src/tests/pages/JoinLink.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Activate your offer — `HireLink`
<a id="page-hire-link"></a>

**Decision:** Internal. **Source:** `src/pages/HireLink.tsx` (641 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/hire/:token` | intended token/link recipient; wrappers: QueryShell | `{<HireLink />}` |

**Observed behavior and source contract**

Present a validated hire offer and its activation form without distracting dashboard controls.

**Existing data/API calls:** rpc `get_invite_token_prefill`; invoke `consume-invite-token`

**Existing helpers/components:** `@/lib/phone`, `@/lib/invitationState`, `@/hooks/usePageTitle`, `@/lib/constants`, `@/lib/magicLoginSession`, `@/components/onboarding/PostSubmitOnboardingVideo`.

**Baseline / current state:** Issued invite-token workflow. Keep token, prefill and hire behavior.

**Copy-ready implementation prompt**

```text
Work only on src/pages/HireLink.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present a validated hire offer and its activation form without distracting dashboard controls.
Decision: Internal. Routes: /hire/:token.
Audience: intended token/link recipient. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Offer validation → Required profile details → Activation receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep invite prefill, consume-invite-token, already-activated resume, invalid-token handling and post-submit onboarding. A retry must not create a second identity.
Acceptance: Test invalid, used, expired and valid invite branches; preserve offered role and post-submit media.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ActivatedLinkResume` expression below is copied from `src/pages/HireLink.tsx:259`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ActivatedLinkResume token={token} />
```

**Page-specific validation**

- Test invalid, used, expired and valid invite branches; preserve offered role and post-submit media.
- Verify the preserved source behavior: Keep invite prefill, consume-invite-token, already-activated resume, invalid-token handling and post-submit onboarding. A retry must not create a second identity.
- Existing focused checks to inspect: `src/tests/components/AgentCloudParity.test.tsx`, `src/tests/lib/invitationLifecycleContract.test.ts`, `src/tests/lib/magicLoginSession.test.ts`, `src/tests/lib/onboardingVideoPlacement.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Join your team — `JoinLink`
<a id="page-join-link"></a>

**Decision:** Internal. **Source:** `src/pages/JoinLink.tsx` (411 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/join/:token` | intended token/link recipient; wrappers: QueryShell | `{<JoinLink />}` |

**Observed behavior and source contract**

Make token validation and joining the intended team explicit.

**Existing data/API calls:** rpc `get_invite_token_prefill`; invoke `consume-invite-token`

**Existing helpers/components:** `@/lib/phone`, `@/lib/invitationState`, `@/hooks/usePageTitle`.

**Baseline / current state:** Issued hire/join-token workflow; distinct from marketing Apply.

**Copy-ready implementation prompt**

```text
Work only on src/pages/JoinLink.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make token validation and joining the intended team explicit.
Decision: Internal. Routes: /join/:token.
Audience: intended token/link recipient. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified invitation → Applicant details → Join receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep get_invite_token_prefill and consume-invite-token. Do not let a visitor substitute recruiter/team identifiers or bypass the token contract.
Acceptance: Used and invalid tokens remain blocked; successful joins retain intended ownership and licensing answers.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `InviteTokenInvalid` expression below is copied from `src/pages/JoinLink.tsx:215`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<InviteTokenInvalid reason="wrong_kind_use_hire" />
```

**Page-specific validation**

- Used and invalid tokens remain blocked; successful joins retain intended ownership and licensing answers.
- Verify the preserved source behavior: Keep get_invite_token_prefill and consume-invite-token. Do not let a visitor substitute recruiter/team identifiers or bypass the token contract.
- Existing focused checks to inspect: `src/tests/lib/onboardingVideoPlacement.test.ts`, `src/tests/pages/JoinLink.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Join this team — `ContractJoin`
<a id="page-contract-join"></a>

**Decision:** Internal. **Source:** `src/pages/ContractJoin.tsx` (180 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/contract/:slug` | intended token/link recipient; wrappers: QueryShell | `{<ContractJoin />}` |

**Observed behavior and source contract**

Make the verified manager/team context and contracting details easy to complete.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/phone`, `@/lib/contractingDownlines`.

**Baseline / current state:** Scoped contracting invitation; preserve slug attribution and existing contracting flow.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ContractJoin.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the verified manager/team context and contracting details easy to complete.
Decision: Internal. Routes: /contract/:slug.
Audience: intended token/link recipient. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Resolved invite → Contracting details → Submitted receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep existing slug resolution, ContractJoinForm and invalid/failed resolution states. Avoid treating a fetch failure as an invalid link or silently choosing another manager.
Acceptance: Valid, unknown and temporarily unavailable slugs are distinct; email typo help and validation remain.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ContractJoinForm` expression below is copied from `src/pages/ContractJoin.tsx:30`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ContractJoinForm key={slug} slug={slug} />
```

**Page-specific validation**

- Valid, unknown and temporarily unavailable slugs are distinct; email typo help and validation remain.
- Verify the preserved source behavior: Keep existing slug resolution, ContractJoinForm and invalid/failed resolution states. Avoid treating a fetch failure as an invalid link or silently choosing another manager.
- Existing focused checks to inspect: `src/tests/pages/ContractJoin.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Create agent account — `AgentSignup`
<a id="page-agent-signup"></a>

**Decision:** Internal. **Source:** `src/pages/AgentSignup.tsx` (334 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent-signup` | public; wrappers: QueryShell | `{<AgentSignup />}` |

**Observed behavior and source contract**

Keep the manager invitation and account form together while removing decorative repetition.

**Existing data/API calls:** from `manager_invite_links`; from `agents`; from `profiles`; invoke `agent-signup`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Invited producer signup differs from public recruiting application; keep authorization and invite context.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentSignup.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the manager invitation and account form together while removing decorative repetition.
Decision: Internal. Routes: /agent-signup.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Invitation validity → Agent identity → Secure account creation.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve manager_invite_links validation and agent-signup. Existing profile/agent checks must run before success; no client-selected manager overwrite.
Acceptance: Invalid invite, existing identity and failed signup remain explicit; no duplicate account creation on retry.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentSignup.tsx:199`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-8 text-center">
            <ShieldAlert className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <h1 className="text-2xl font-bold mb-2">Invalid Invite Link</h1>
            <p className="text-muted-foreground mb-6">
              This invite link is invalid or has been deactivated.
              Please contact your manager for a new invite link.
            </p>
            <GradientButton asChild className="w-full">
              <Link to="/login">
                Go to Login
              </Link>
            </GradientButton>
          </GlassCard>
```

**Page-specific validation**

- Invalid invite, existing identity and failed signup remain explicit; no duplicate account creation on retry.
- Verify the preserved source behavior: Preserve manager_invite_links validation and agent-signup. Existing profile/agent checks must run before success; no client-selected manager overwrite.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Email preferences — `Unsubscribe`
<a id="page-unsubscribe"></a>

**Decision:** Internal. **Source:** `src/pages/Unsubscribe.tsx` (117 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/unsubscribe` | public; wrappers: QueryShell | `{<Unsubscribe />}` |

**Observed behavior and source contract**

Make unsubscribe intent, request status and retry unambiguous.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Unsubscribe.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make unsubscribe intent, request status and retry unambiguous.
Decision: Internal. Routes: /unsubscribe.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Subscription context → Explicit unsubscribe action → Confirmed result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep the existing token/query contract and confirmation behavior. Do not announce unsubscribed merely from a query parameter or trigger a send.
Acceptance: Invalid link, pending request, confirmed unsubscribe and failure render separately.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `p` expression below is copied from `src/pages/Unsubscribe.tsx:90`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<p className="mt-3 text-muted-foreground">
            Email{" "}
            <a className="underline" href={`mailto:${MANUAL_ADDRESS}?subject=STOP`}>{MANUAL_ADDRESS}</a>{" "}
            with the word STOP and we will remove {masked} by hand.
          </p>
```

**Page-specific validation**

- Invalid link, pending request, confirmed unsubscribe and failure render separately.
- Verify the preserved source behavior: Keep the existing token/query contract and confirmation behavior. Do not announce unsubscribed merely from a query parameter or trigger a send.
- Existing focused checks to inspect: `src/tests/pages/Unsubscribe.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Activate your account — `ClaimAccount`
<a id="page-claim-account"></a>

**Decision:** Internal. **Source:** `src/pages/ClaimAccount.tsx` (242 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/claim` | public; wrappers: QueryShell | `{<ClaimAccount />}` |
| `/activate` | public; wrappers: QueryShell | `{<ClaimAccount />}` |

**Observed behavior and source contract**

Let an existing agent claim the intended account through the existing verification form.

**Existing data/API calls:** invoke `claim-account`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ClaimAccount.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Let an existing agent claim the intended account through the existing verification form.
Decision: Internal. Routes: /claim, /activate.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Existing-agent verification → Credentials → Activation result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep claim-account and required identity fields. Both /claim and /activate currently share this implementation; preserve query/hash if later canonicalized.
Acceptance: Incorrect identity, existing claim and server rejection remain actionable without leaking another account.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/ClaimAccount.tsx:130`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="w-full max-w-md p-8 text-center">
          <CheckCircle2 className="h-14 w-14 mx-auto mb-4 text-emerald-500" />
          <h1 className="text-2xl font-bold mb-2">You're in, {done.split(" ")[0]}.</h1>
          <p className="text-muted-foreground">
            Your login is attached to your existing {BRAND.shortName} record. Taking you to your dashboard…
          </p>
        </GlassCard>
```

**Page-specific validation**

- Incorrect identity, existing claim and server rejection remain actionable without leaking another account.
- Verify the preserved source behavior: Keep claim-account and required identity fields. Both /claim and /activate currently share this implementation; preserve query/hash if later canonicalized.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Daily numbers login — `AgentNumbersLogin`
<a id="page-agent-numbers-login"></a>

**Decision:** Keep. **Source:** `src/pages/AgentNumbersLogin.tsx` (661 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent-login` | public; wrappers: QueryShell | `{<AgentNumbersLogin />}` |

**Observed behavior and source contract**

Keep the specialized numbers sign-in flow recognizable while sharing the coherent auth styling.

**Existing data/API calls:** from `user_roles`; invoke `check-email-status`; from `agents`; invoke `setup-agent-password`; invoke `send-password-reset`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/analytics`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentNumbersLogin.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the specialized numbers sign-in flow recognizable while sharing the coherent auth styling.
Decision: Keep. Routes: /agent-login.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Email status → Password or recovery → Daily numbers destination.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve check-email-status, setup-agent-password, reset flow and current role routing. Do not merge into /login until setup/recovery parity is verified.
Acceptance: Test existing-password, first-password, reset, invalid email and session routing branches.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/AgentNumbersLogin.tsx:627`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 text-accent-foreground mb-4">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Check Your Email</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  We've sent a password reset link to <strong>{email}</strong>. Click the link to set a new password.
                </p>
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Sign In
                </Button>
              </GlassCard>
```

**Page-specific validation**

- Test existing-password, first-password, reset, invalid email and session routing branches.
- Verify the preserved source behavior: Preserve check-email-status, setup-agent-password, reset flow and current role routing. Do not merge into /login until setup/recovery parity is verified.
- Existing focused checks to inspect: `src/tests/lib/agentOnboardingRoadmap.test.ts`, `src/tests/lib/invitationLifecycleContract.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent profile — `PublicAgentLanding`
<a id="page-public-agent-landing"></a>

**Decision:** Keep. **Source:** `src/pages/PublicAgentLanding.tsx` (168 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent/:userId` | public; wrappers: QueryShell | `{<PublicAgentLanding />}` |

**Observed behavior and source contract**

Make a public agent card trustworthy, readable and useful for contact.

**Existing data/API calls:** from `profiles`; from `agents`

**Existing helpers/components:** React and existing local/static content.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PublicAgentLanding.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make a public agent card trustworthy, readable and useful for contact.
Decision: Keep. Routes: /agent/:userId.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified name and profile → Authorized contact channels → Agency identity.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Read only the existing public profile fields. Missing photos/contact details stay absent; never add private CRM data, invented ratings or unverified licensing claims.
Acceptance: Unknown user, denied response and incomplete profile are distinct; contact links use the recorded public values.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `a` expression below is copied from `src/pages/PublicAgentLanding.tsx:134`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<a href={`tel:${profile.phone}`} className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500 text-white font-bold text-15 hover:bg-emerald-600 transition-all shadow-lg">
              <Phone className="h-5 w-5" />
              <span>Call {profile.phone}</span>
            </a>
```

**Page-specific validation**

- Unknown user, denied response and incomplete profile are distinct; contact links use the recorded public values.
- Verify the preserved source behavior: Read only the existing public profile fields. Missing photos/contact details stay absent; never add private CRM data, invented ratings or unverified licensing claims.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Open your account — `MagicLogin`
<a id="page-magic-login"></a>

**Decision:** Internal. **Source:** `src/pages/MagicLogin.tsx` (354 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/magic-login` | public; wrappers: QueryShell | `{<MagicLogin />}` |

**Observed behavior and source contract**

Keep magic-link verification and recovery states explicit with minimal visual noise.

**Existing data/API calls:** from `user_roles`; invoke `verify-magic-link`; invoke `send-password-reset`

**Existing helpers/components:** `@/lib/homeForRoles`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/MagicLogin.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep magic-link verification and recovery states explicit with minimal visual noise.
Decision: Internal. Routes: /magic-login.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verifying link → Signing in → Actionable recovery.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain verify-magic-link, existing session handling and reset path. Never store or display the link token in diagnostic copy.
Acceptance: Expired, consumed, malformed and valid links do not loop or show false success.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/MagicLogin.tsx:321`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button
                    variant="ghost"
                    onClick={() => setShowResendForm(true)}
                    className="w-full text-muted-foreground"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send Me a Fresh Link
                  </Button>
```

**Page-specific validation**

- Expired, consumed, malformed and valid links do not loop or show false success.
- Verify the preserved source behavior: Retain verify-magic-link, existing session handling and reset path. Never store or display the link token in diagnostic copy.
- Existing focused checks to inspect: `src/tests/lib/magicLoginSession.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Choose your call — `ScheduleCall`
<a id="page-schedule-call"></a>

**Decision:** Keep. **Source:** `src/pages/ScheduleCall.tsx` (237 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/schedule-call` | public; wrappers: QueryShell | `{<ScheduleCall />}` |

**Observed behavior and source contract**

Expose the existing qualification branch and appropriate scheduling destination clearly.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/CalendlyEmbed`, `@/hooks/usePageTitle`, `@/lib/apexConfig`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ScheduleCall.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Expose the existing qualification branch and appropriate scheduling destination clearly.
Decision: Keep. Routes: /schedule-call.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: License question → Eligible call type → Booking or licensing next step.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep licensed/leader qualification and existing Calendly destinations. Unlicensed visitors must retain their licensing path; do not manufacture calendar availability.
Acceptance: Every qualification branch reaches its existing destination and fallback link; mobile embed remains usable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CalendlyEmbed` expression below is copied from `src/pages/ScheduleCall.tsx:165`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CalendlyEmbed url={calendlyUrl} className="rounded-md" />
```

**Page-specific validation**

- Every qualification branch reaches its existing destination and fallback link; mobile embed remains usable.
- Verify the preserved source behavior: Keep licensed/leader qualification and existing Calendly destinations. Unlicensed visitors must retain their licensing path; do not manufacture calendar availability.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Interview intake — `AssistantInterviewForm`
<a id="page-assistant-interview-form"></a>

**Decision:** Internal. **Source:** `src/pages/AssistantInterviewForm.tsx` (506 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/assistant/interviews` | intended token/link recipient; wrappers: QueryShell | `{<AssistantInterviewForm />}` |

**Observed behavior and source contract**

Make this token-authorized assistant intake a focused operational form.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/instagram`.

**Baseline / current state:** Token-checked assistant intake is intentionally outside login. Preserve token flow; do not promote in public nav.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AssistantInterviewForm.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make this token-authorized assistant intake a focused operational form.
Decision: Internal. Routes: /assistant/interviews.
Audience: intended token/link recipient. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Token validity → Interview details → Explicit submit result.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve token validation, call-type options, required identity fields and current handler. Do not broaden this public token surface into an unrestricted admin form.
Acceptance: Unavailable versus inactive token states differ; required fields and failed submission remain visible.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `PageHeader` expression below is copied from `src/pages/AssistantInterviewForm.tsx:291`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<PageHeader
          eyebrow="Galaxy Financial"
          eyebrowIcon={<Calendar className="h-4 w-4" />}
          title="Interview intake"
          subtitle={tokenLabel}
          accent="emerald"
        />
```

**Page-specific validation**

- Unavailable versus inactive token states differ; required fields and failed submission remain visible.
- Verify the preserved source behavior: Preserve token validation, call-type options, required identity fields and current handler. Do not broaden this public token surface into an unrestricted admin form.
- Existing focused checks to inspect: `src/tests/lib/assistantInterviewIntakeContract.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Approval pending — `PendingApproval`
<a id="page-pending-approval"></a>

**Decision:** Internal. **Source:** `src/pages/PendingApproval.tsx` (83 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/pending-approval` | public; wrappers: QueryShell | `{<PendingApproval />}` |

**Observed behavior and source contract**

Explain the actual waiting state and provide a safe exit or support path.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/PendingApproval.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Explain the actual waiting state and provide a safe exit or support path.
Decision: Internal. Routes: /pending-approval.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current approval state → Next permitted action → Sign out.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep current auth/session routing and sign-out behavior. Do not add a countdown, expected approval time or self-approval action.
Acceptance: A pending account cannot reach protected dashboards through the page; sign out and valid return links work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/PendingApproval.tsx:36`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-8 text-center">
          <div className="mb-6">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Clock className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Account Pending Approval</h1>
            <p className="text-muted-foreground">
              Your account has been created and is awaiting admin verification.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/50 border border-border mb-6">
            <div className="flex items-center gap-3 text-left">
              <Mail className="h-5 w-5 text-primary flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                You'll receive an email notification once your account has been approved by an administrator.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This usually takes 24-48 hours during business days.
            </p>

            <div className="flex flex-col gap-2">
              <GradientButton asChild className="w-full">
                <Link to="/">
                  Back to Home
                </Link>
              </GradientButton>

              <Button
                variant="ghost"
                onClick={handleSignOut}
                className="text-muted-foreground"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </GlassCard>
```

**Page-specific validation**

- A pending account cannot reach protected dashboards through the page; sign out and valid return links work.
- Verify the preserved source behavior: Keep current auth/session routing and sign-out behavior. Do not add a countdown, expected approval time or self-approval action.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Privacy policy — `Privacy`
<a id="page-privacy"></a>

**Decision:** Keep. **Source:** `src/pages/Privacy.tsx` (104 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/privacy` | public; wrappers: QueryShell | `{<Privacy />}` |

**Observed behavior and source contract**

Improve reading structure without changing legal meaning or hiding sections.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/Footer`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Privacy.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Improve reading structure without changing legal meaning or hiding sections.
Decision: Keep. Routes: /privacy.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Readable section index → Existing policy text → Agency contact.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve the complete existing policy and public accessibility. Content corrections require a verified legal source; styling is not authorization to invent policy terms.
Acceptance: All sections remain reachable and legible in both themes; public aliases remain outside authenticated shell.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/Privacy.tsx:67`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement appropriate technical and organizational measures to protect your personal
                information against unauthorized access, alteration, disclosure, or destruction.
                This includes encryption of data in transit and at rest.
              </p>
            </GlassCard>
```

**Page-specific validation**

- All sections remain reachable and legible in both themes; public aliases remain outside authenticated shell.
- Verify the preserved source behavior: Preserve the complete existing policy and public accessibility. Content corrections require a verified legal source; styling is not authorization to invent policy terms.
- Existing focused checks to inspect: `src/tests/lib/trainingCenterPrivacy.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Terms of service — `Terms`
<a id="page-terms"></a>

**Decision:** Keep. **Source:** `src/pages/Terms.tsx` (128 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/terms` | public; wrappers: QueryShell | `{<Terms />}` |

**Observed behavior and source contract**

Make the existing terms easy to scan and navigate without rewriting obligations.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/Footer`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Terms.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the existing terms easy to scan and navigate without rewriting obligations.
Decision: Keep. Routes: /terms.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Readable section index → Existing terms → Related legal links.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep licensing, contractor relationship, conduct and other supplied terms intact. Do not convert aspirational marketing copy into a contractual promise.
Acceptance: All original clauses remain present and accessible at mobile width; no authentication wall.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/Terms.tsx:37`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using the APEX Financial website and services, you agree to be bound
                by these Terms of Service. If you do not agree to these terms, please do not use our services.
              </p>
            </GlassCard>
```

**Page-specific validation**

- All original clauses remain present and accessible at mobile width; no authentication wall.
- Verify the preserved source behavior: Keep licensing, contractor relationship, conduct and other supplied terms intact. Do not convert aspirational marketing copy into a contractual promise.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Disclosures — `Disclosures`
<a id="page-disclosures"></a>

**Decision:** Keep. **Source:** `src/pages/Disclosures.tsx` (133 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/disclosures` | public; wrappers: QueryShell | `{<Disclosures />}` |

**Observed behavior and source contract**

Keep income and relationship disclosures readable beside the brand design.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/components/landing/Footer`, `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Disclosures.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep income and relationship disclosures readable beside the brand design.
Decision: Keep. Routes: /disclosures.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Income disclosure → Contractor/licensing context → Carrier relationships.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve existing disclosures and caution around earnings. Do not add performance statistics, regulatory endorsements or guaranteed outcomes.
Acceptance: No disclosure is collapsed by default in a way that blocks reading; legal navigation works.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/Disclosures.tsx:85`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-6">
              <h2 className="text-xl font-semibold mb-3 text-primary">Carrier Relationships</h2>
              <p className="text-muted-foreground leading-relaxed">
                APEX Financial works with multiple insurance carriers. Product availability, commission
                rates, and underwriting requirements vary by carrier and are subject to change without notice.
                Carrier appointments are subject to carrier approval and may require additional certifications
                or training.
              </p>
            </GlassCard>
```

**Page-specific validation**

- No disclosure is collapsed by default in a way that blocks reading; legal navigation works.
- Verify the preserved source behavior: Preserve existing disclosures and caution around earnings. Do not add performance statistics, regulatory endorsements or guaranteed outcomes.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Install Galaxy — `Install`
<a id="page-install"></a>

**Decision:** Keep. **Source:** `src/pages/Install.tsx` (279 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/install` | public; wrappers: QueryShell | `{<Install />}` |

**Observed behavior and source contract**

Present the current install or account access step for the visitor’s platform.

**Existing data/API calls:** invoke `simple-login`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Install.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Present the current install or account access step for the visitor’s platform.
Decision: Keep. Routes: /install.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Install availability → Platform instructions → Existing sign-in step.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep install detection and simple-login behavior; do not report installation merely because the instruction button was clicked.
Acceptance: Supported prompt, unsupported browser, already-installed and sign-in-error states work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/Install.tsx:242`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button onClick={handleInstall} variant="outline" className="w-full gap-2">
                <Download className="w-4 h-4" />
                Add to Home Screen
              </Button>
```

**Page-specific validation**

- Supported prompt, unsupported browser, already-installed and sign-in-error states work.
- Verify the preserved source behavior: Keep install detection and simple-login behavior; do not report installation merely because the instruction button was clicked.
- Existing focused checks to inspect: `src/tests/lib/mobileAppContract.test.ts`, `src/tests/lib/serviceWorkerFirstInstall.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Galaxy links — `LinksPage`
<a id="page-links-page"></a>

**Decision:** Keep. **Source:** `src/pages/LinksPage.tsx` (257 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/links` | public; wrappers: QueryShell | `{<LinksPage />}` |

**Observed behavior and source contract**

Make the link directory and optional waitlist form clear without creating a second marketing homepage.

**Existing data/API calls:** from `elite_circle_waitlist`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LinksPage.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the link directory and optional waitlist form clear without creating a second marketing homepage.
Decision: Keep. Routes: /links.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Primary recruiting link → Existing social/contact links → Explicit waitlist signup.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve elite_circle_waitlist submission and receipt behavior. Keep user-facing form validation and consent; no automatic social sends.
Acceptance: Every existing destination resolves; closing/reopening the waitlist and failed/successful submission states work.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GradientButton` expression below is copied from `src/pages/LinksPage.tsx:236`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GradientButton onClick={handleSubmit} disabled={isSubmitting} className="w-full">
                        {isSubmitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Joining...</> : <>Join the Waitlist <Sparkles className="h-4 w-4 ml-2" /></>}
                      </GradientButton>
```

**Page-specific validation**

- Every existing destination resolves; closing/reopening the waitlist and failed/successful submission states work.
- Verify the preserved source behavior: Preserve elite_circle_waitlist submission and receipt behavior. Keep user-facing form validation and consent; no automatic social sends.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Leads and dialer — `LeadsLanding`
<a id="page-leads-landing"></a>

**Decision:** Keep. **Source:** `src/pages/LeadsLanding.tsx` (293 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/leads` | public; wrappers: QueryShell | `{<LeadsLanding />}` |
| `/get-leads` | public; wrappers: QueryShell | `{<LeadsLanding />}` |
| `/dialer` | public; wrappers: QueryShell | `{<LeadsLanding />}` |

**Observed behavior and source contract**

Align the existing lead/dialer marketing page with the shared visual system and a clear application action.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/LeadsLanding.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Align the existing lead/dialer marketing page with the shared visual system and a clear application action.
Decision: Keep. Routes: /leads, /get-leads, /dialer.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Offer and eligibility → Existing platform demo anchor → Application CTA.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: All three current URLs use the same implementation. Static $10K-oriented copy and lead-delivery claims are not verified earnings or inventory; qualify or validate them rather than making them hero metrics.
Acceptance: The demo anchor lands in real content; CTA preserves recruiting context; no fabricated inventory, testimonials or income proof.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/LeadsLanding.tsx:161`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card key={faq.q} className="bg-slate-700/50 border-slate-600">
                <CardHeader>
                  <CardTitle className="text-lg text-foreground">{faq.q}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-600 dark:text-slate-300">{faq.a}</p>
                </CardContent>
              </Card>
```

**Page-specific validation**

- The demo anchor lands in real content; CTA preserves recruiting context; no fabricated inventory, testimonials or income proof.
- Verify the preserved source behavior: All three current URLs use the same implementation. Static $10K-oriented copy and lead-delivery claims are not verified earnings or inventory; qualify or validate them rather than making them hero metrics.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Contact Galaxy — `Contact`
<a id="page-contact"></a>

**Decision:** Keep. **Source:** `src/pages/Contact.tsx` (87 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/contact` | public; wrappers: QueryShell | `{<Contact />}` |

**Observed behavior and source contract**

Make the existing contact channels and booking route easy to select.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Contact.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the existing contact channels and booking route easy to select.
Decision: Keep. Routes: /contact.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Book a call → Email → Phone/contact details.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep actual recorded contact destinations and the distinction between booking and direct contact. Do not add a contact form with an invented endpoint.
Acceptance: Link protocols and booking target work; labels and hit areas are usable at 332px.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/Contact.tsx:23`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="border-slate-200 dark:border-border/60 bg-white dark:bg-card/70 p-5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-teal-500/15 text-teal-300">
              <Calendar className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">Book a Call</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Best for recruiting questions, licensing help, or next-step guidance.
            </p>
            <Button asChild className="mt-5 w-full bg-teal-500 hover:bg-teal-400 text-slate-950">
              <Link to="/schedule-call">Schedule a Call</Link>
            </Button>
          </GlassCard>
```

**Page-specific validation**

- Link protocols and booking target work; labels and hit areas are usable at 332px.
- Verify the preserved source behavior: Keep actual recorded contact destinations and the distinction between booking and direct contact. Do not add a contact form with an invented endpoint.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Lead storefront — `Storefront`
<a id="page-storefront"></a>

**Decision:** Keep. **Source:** `src/pages/Storefront.tsx` (143 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/storefront` | public; wrappers: QueryShell | `{<Storefront />}` |

**Observed behavior and source contract**

Make the current SKU choice and payment state unambiguous.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Storefront.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the current SKU choice and payment state unambiguous.
Decision: Keep. Routes: /storefront.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Actual product/SKU → Existing price and terms → Checkout or receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve storefront price-parity sources and payment links. A success query flag is not independent proof that funds settled; retain the current server/provider receipt boundary.
Acceptance: SKU/price/checkout parity guards remain; no misleading zero price, purchase count or fabricated payment success.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/Storefront.tsx:99`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card key={s.name} className="border-slate-200 dark:border-border bg-white dark:bg-card/60 hover:border-emerald-500/50 transition-colors">
                  <CardHeader>
                    <h2 className="text-xl font-bold text-foreground">{s.name}</h2>
                    <div className="text-2xl font-extrabold text-emerald-400 pt-1">{s.price}</div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-5">{s.blurb}</p>
                    <Button asChild className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="gap-2">
                        Subscribe <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
```

**Page-specific validation**

- SKU/price/checkout parity guards remain; no misleading zero price, purchase count or fabricated payment success.
- Verify the preserved source behavior: Preserve storefront price-parity sources and payment links. A success query flag is not independent proof that funds settled; retain the current server/provider receipt boundary.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Data deletion request — `DataDeletion`
<a id="page-data-deletion"></a>

**Decision:** Keep. **Source:** `src/pages/DataDeletion.tsx` (123 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/data-deletion` | public; wrappers: QueryShell | `{<DataDeletion />}` |
| `/delete-my-data` | public; wrappers: QueryShell | `{<DataDeletion />}` |

**Observed behavior and source contract**

Keep one minimal request form with an honest receipt and failure state.

**Existing data/API calls:** from `data_deletion_requests`

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Required user data request workflow; preserve public reachability.

**Copy-ready implementation prompt**

```text
Work only on src/pages/DataDeletion.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep one minimal request form with an honest receipt and failure state.
Decision: Keep. Routes: /data-deletion, /delete-my-data.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Request identity → Optional context → Confirmed request receipt.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve data_deletion_requests and validation. Submitted means a request was recorded, not that all data was deleted.
Acceptance: Failed insert does not show Request received; duplicate alias retains access and context.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Button` expression below is copied from `src/pages/DataDeletion.tsx:105`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Button type="submit" className="w-full gap-2" size="lg" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Submit deletion request
            </Button>
```

**Page-specific validation**

- Failed insert does not show Request received; duplicate alias retains access and context.
- Verify the preserved source behavior: Preserve data_deletion_requests and validation. Submitted means a request was recorded, not that all data was deleted.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Licensing check-in — `ApplicantCheckin`
<a id="page-applicant-checkin"></a>

**Decision:** Keep. **Source:** `src/pages/ApplicantCheckin.tsx` (379 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/checkin` | public; wrappers: QueryShell | `{<ApplicantCheckin />}` |
| `/daily-checkin` | public; wrappers: QueryShell | `{<ApplicantCheckin />}` |

**Observed behavior and source contract**

Make the applicant’s current licensing update easy to enter and verify.

**Existing data/API calls:** invoke `applicant-checkin`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/apexConfig`.

**Baseline / current state:** Candidate progress self-report; preserve issued links and licensing state.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApplicantCheckin.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the applicant’s current licensing update easy to enter and verify.
Decision: Keep. Routes: /checkin, /daily-checkin.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Valid application link → Licensing progress → Confirmed update.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep applicant-checkin validation, query application ID and milestone fields. Self-reported status must remain distinct from provider-verified license or course data.
Acceptance: Missing/invalid ID, malformed fields, failure and successful update are distinct; query survives any alias.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `GlassCard` expression below is copied from `src/pages/ApplicantCheckin.tsx:247`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<GlassCard className="p-4 h-full text-center">
                    <h3 className="font-semibold mb-1">Need Help?</h3>
                    <p className="text-sm text-muted-foreground">Book a licensing help call if you feel stuck.</p>
                  </GlassCard>
```

**Page-specific validation**

- Missing/invalid ID, malformed fields, failure and successful update are distinct; query survives any alias.
- Verify the preserved source behavior: Keep applicant-checkin validation, query application ID and milestone fields. Self-reported status must remain distinct from provider-verified license or course data.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Your onboarding path — `AgentFlow`
<a id="page-agent-flow"></a>

**Decision:** Consolidate conditionally into orientation; do not replace live status. **Source:** `src/pages/AgentFlow.tsx` (75 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/agent-flow` | public; wrappers: QueryShell | `{<AgentFlow />}` |

**Observed behavior and source contract**

Use the static flow only as orientation beside the real next-step surfaces.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/lib/utils`, `@/hooks/usePageTitle`.

**Baseline / current state:** Static duplicate onboarding diagram has no next-step links and generic timeline/paperwork claims. Reuse verified roadmap and audience-specific CTA.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentFlow.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Use the static flow only as orientation beside the real next-step surfaces.
Decision: Consolidate conditionally into orientation; do not replace live status. Routes: /agent-flow.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Licensed versus unlicensed path → Ordered steps → Link to actual status.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Do not display static timeline nodes as completed work. Consider folding this explanation into Getting Started only after public/authenticated audience parity is proven.
Acceptance: No step falsely appears completed; existing licensing and training destinations remain.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `FlowTimeline` expression below is copied from `src/pages/AgentFlow.tsx:70`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<FlowTimeline steps={unlicensedSteps} title="Unlicensed Agent Path" accent="text-amber-400" />
```

**Page-specific validation**

- No step falsely appears completed; existing licensing and training destinations remain.
- Verify the preserved source behavior: Do not display static timeline nodes as completed work. Consider folding this explanation into Getting Started only after public/authenticated audience parity is proven.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Recruiting short link — `RecruitingShortLink`
<a id="page-recruiting-short-link"></a>

**Decision:** Internal. **Source:** `src/components/RecruitingShortLink.tsx` (47 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/r/:code` | public; wrappers: QueryShell | `{<RecruitingShortLink />}` |

**Observed behavior and source contract**

Keep this route as a public attribution-preserving redirect, with no intermediary UI.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/lib/recruitingShortLink`.

**Baseline / current state:** Distinct routed workflow. Retain the current role boundary; no source-proven replacement in this review.

**Copy-ready implementation prompt**

```text
Work only on src/components/RecruitingShortLink.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep this route as a public attribution-preserving redirect, with no intermediary UI.
Decision: Internal. Routes: /r/:code.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Path recruiter code → Carried campaign query → Apply destination.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Use carriedQuery and shortLinkFallbackTarget. The path code wins over a competing query ref; preserve hash and other campaign fields, and do not revive the removed tap beacon.
Acceptance: Test mixed-case/encoded code, competing ref, UTM/hash and empty fallback; no login wall or nonexistent network call.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Navigate` expression below is copied from `src/components/RecruitingShortLink.tsx:39`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Navigate
      to={`/apply?ref=${encodeURIComponent(slug)}${carriedQuery(location.search)}${location.hash}`}
      replace
    />
```

**Page-specific validation**

- Test mixed-case/encoded code, competing ref, UTM/hash and empty fallback; no login wall or nonexistent network call.
- Verify the preserved source behavior: Use carriedQuery and shortLinkFallbackTarget. The path code wins over a competing query ref; preserve hash and other campaign fields, and do not revive the removed tap beacon.
- Existing focused checks to inspect: `src/tests/components/RecruitLinkAttribution.test.tsx`, `src/tests/components/RecruitingShortLink.test.tsx`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Page not found — `NotFound`
<a id="page-not-found"></a>

**Decision:** Keep. **Source:** `src/pages/NotFound.tsx` (101 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `*` | public; wrappers: public route | `{<NotFound />}` |

**Observed behavior and source contract**

Offer a few valid recovery destinations instead of a dead end.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** React and existing local/static content.

**Baseline / current state:** Keep meaningful recovery destinations; source literal scan found no unmatched route targets.

**Copy-ready implementation prompt**

```text
Work only on src/pages/NotFound.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Offer a few valid recovery destinations instead of a dead end.
Decision: Keep. Routes: *.
Audience: public. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Clear missing-page state → Apply or Dashboard → Licensing help.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep location-aware not-found handling without displaying sensitive query values. Do not redirect unknown URLs silently to a success page.
Acceptance: Unknown paths display 404 content; recovery links are valid for their public or signed-in purpose.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Link` expression below is copied from `src/pages/NotFound.tsx:78`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Link
              key={s.to}
              to={s.to}
              className="group flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/40 transition-colors"
            >
              <div>
                <div className="text-xs text-muted-foreground">{s.kicker}</div>
                <div className="font-semibold text-foreground">{s.label}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </Link>
```

**Page-specific validation**

- Unknown paths display 404 content; recovery links are valid for their public or signed-in purpose.
- Verify the preserved source behavior: Keep location-aware not-found handling without displaying sensitive query values. Do not redirect unknown URLs silently to a success page.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
