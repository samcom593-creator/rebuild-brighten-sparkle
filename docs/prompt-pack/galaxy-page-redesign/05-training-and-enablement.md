# Training and enablement

Read [the shared contract](00-shared-contract.md) before using a prompt. These prompts preserve existing data and permissions while improving structure and visual consistency. The source snapshot is local and does not certify live production behavior.

## Training entry — `ApexTrainingEntry`
<a id="page-apex-training-entry"></a>

**Decision:** Keep. **Source:** `src/pages/ApexTrainingEntry.tsx` (17 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><ApexTrainingEntry /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the existing account-aware entry decision and make its destination clear.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/useAuth`, `@/pages/ApexCareerToolkit`, `@/lib/trainingRoutes`.

**Baseline / current state:** Staff training entry intentionally shows lifecycle toolkit; ordinary agents are redirected to learning home. Preserve that split.

**Copy-ready implementation prompt**

```text
Work only on src/pages/ApexTrainingEntry.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the existing account-aware entry decision and make its destination clear.
Decision: Keep. Routes: /dashboard/training.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified account state → Appropriate toolkit or library → Loading/recovery state.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain useAuth and the current ApexCareerToolkit versus library redirect. Do not make authenticated course resources public to simplify navigation.
Acceptance: Loading does not briefly render the wrong branch; all supported accounts reach their existing training destination.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `ApexCareerToolkit` expression below is copied from `src/pages/ApexTrainingEntry.tsx:13`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<ApexCareerToolkit />
```

**Page-specific validation**

- Loading does not briefly render the wrong branch; all supported accounts reach their existing training destination.
- Verify the preserved source behavior: Retain useAuth and the current ApexCareerToolkit versus library redirect. Do not make authenticated course resources public to simplify navigation.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Training — `TrainingHub`
<a id="page-training-hub"></a>

**Decision:** Keep. **Source:** `src/pages/TrainingHub.tsx` (588 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/library` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><TrainingHub /></ProtectedRoute>}` |

**Observed behavior and source contract**

Use the existing hub as the single learning entry without losing course, call practice or resource access.

**Existing data/API calls:** from `hub_course_progress`; rpc `call_training_library`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/components/training/TrainingWorkspaceNav`, `@/components/training/TrainingLeaderPanel`, `@/lib/utils`, `@/lib/trainingRoutes`, `@/lib/apexResourcesHub`, `@/components/training/TopCallsTab`, `@/components/training/TrainingJourney`, `@/components/training/ObjectionsTab`, `@/components/training/TrainingRecordings`.

**Baseline / current state:** Current local release validates and account-scopes the recorded-training catalog, signs exact recording IDs through training-recording-url, and shares bounded retry/position-preserving playback. Existing call-training variants use the separate ReadyMode signer.

**Copy-ready implementation prompt**

```text
Work only on src/pages/TrainingHub.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Use the existing hub as the single learning entry without losing course, call practice or resource access.
Decision: Keep. Routes: /dashboard/training/library.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Start here → Courses and progress → Recordings and resources.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve useHubData, hub_course_progress, call_training_library and query-selected library filters. Start here must retain Field Course and Practice a call. Recorded training uses the account-scoped training_recordings_list catalog and training-recording-url with recordingId only; private ReadyMode calls use readymode-recording-url. Both preserve server authorization and the shared player recovery contract.
Acceptance: Course/Call Lab links remain visible; unknown progress is not zero complete; malformed/denied recording stays unavailable; account changes clear active media; interrupted playback resumes after bounded renewal without focus/reconnect resets; resource filters and tabs work at 332px.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `TrainingRecordings` expression below is copied from `src/pages/TrainingHub.tsx:316`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<TrainingRecordings />
```

**Page-specific validation**

- Course/Call Lab links remain visible; unknown progress is not zero complete; malformed/denied recording stays unavailable; account changes clear active media; interrupted playback resumes after bounded renewal without focus/reconnect resets; resource filters and tabs work at 332px.
- Verify the preserved source behavior: Preserve useHubData, hub_course_progress, call_training_library and query-selected library filters. Start here must retain Field Course and Practice a call. Recorded training uses the account-scoped training_recordings_list catalog and training-recording-url with recordingId only; private ReadyMode calls use readymode-recording-url. Both preserve server authorization and the shared player recovery contract.
- Existing focused checks to inspect: `src/tests/callLabWiring.test.ts`, `src/tests/lib/trainingCenterPrivacy.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Course lesson — `TrainingHubCourse`
<a id="page-training-hub-course"></a>

**Decision:** Keep. **Source:** `src/pages/TrainingHubCourse.tsx` (571 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/library/course/:courseId` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><TrainingHubCourse /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the current lesson, progress and next action the first screen.

**Existing data/API calls:** from `hub_course_progress`; from `agents`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/hooks/useAuth`, `@/components/course/CourseQuiz`, `@/components/training/TrainingWorkspaceNav`, `@/hooks/useOnboardingCourse`, `@/lib/utils`, `@/lib/trainingRoutes`, `@/lib/apexResourcesHub`.

**Baseline / current state:** Course detail and progress are not duplicate overview content. Preserve course IDs and shareable deep links.

**Copy-ready implementation prompt**

```text
Work only on src/pages/TrainingHubCourse.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the current lesson, progress and next action the first screen.
Decision: Keep. Routes: /dashboard/training/library/course/:courseId.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Current lesson → Actual completion and quiz → Next/back lesson.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep courseId, useHubData, hub_course_progress and existing quiz/write contract. Only a confirmed server result may mark progress; do not infer completion from opening a lesson.
Acceptance: Bad course ID, failed lesson load, quiz failure and failed completion show their real states; retry does not double-record progress.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `HubQuiz` expression below is copied from `src/pages/TrainingHubCourse.tsx:285`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<HubQuiz
            key={activeItem.id}
            item={activeItem}
            savedAttempts={
              (progressRows ?? []).find((p) => p.item_id === activeItem.id)?.attempts ?? 0
            }
            onResult={(score, passed) =>
              markItem.mutateAsync({ item: activeItem, score, passed })
            }
          />
```

**Page-specific validation**

- Bad course ID, failed lesson load, quiz failure and failed completion show their real states; retry does not double-record progress.
- Verify the preserved source behavior: Keep courseId, useHubData, hub_course_progress and existing quiz/write contract. Only a confirmed server result may mark progress; do not infer completion from opening a lesson.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Field course — `CourseCatalog`
<a id="page-course-catalog"></a>

**Decision:** Keep. **Source:** `src/pages/CourseCatalog.tsx` (602 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/sales-course` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CourseCatalog /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the two-phase training path and current enrollment state visible.

**Existing data/API calls:** from `agents`; from `applications`; invoke `self-enroll-course`

**Existing helpers/components:** `@/lib/like-escape`, `@/components/course/CourseQuiz`, `@/components/course/CourseTranscript`, `@/components/course/CourseVideoPlayer`, `@/components/training/TrainingWorkspaceNav`, `@/hooks/useAuth`, `@/hooks/useOnboardingCourse`, `@/hooks/useSoundEffects`, `@/lib/trainingRoutes`, `@/lib/utils`.

**Baseline / current state:** Current source declares two silent clips and explains them in Read/Listen. The native player is not forced muted, and module/chapter remount keys already exist. The recording repair does not replace silent source media or claim to generate a missing audio track.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CourseCatalog.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the two-phase training path and current enrollment state visible.
Decision: Keep. Routes: /dashboard/training/sales-course.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Required phase → Lesson progression → Existing enrollment or continue action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve useOnboardingCourse, agent/application identity, self-enroll-course and actual release eligibility. Do not equate local checkboxes with field release. Existing lesson/chapter keys intentionally reset different media; the source marks ReadyMode: Review the Right Calls and Pipeline: Client to Posted Deal as silent clips, with the explanation in Read/Listen. Resetting a player cannot create an absent audio track.
Acceptance: Missing modules are unavailable rather than a completed empty course; enrollment failure stays explicit; progression and unlock rules remain. Preserve media_has_audio and transcript narration; surface the silent-source explanation in Watch before claiming audio recovery for those clips.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `CourseVideoPlayer` expression below is copied from `src/pages/CourseCatalog.tsx:472`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<CourseVideoPlayer
                    videoUrl={currentModule.video_url}
                    videoParts={currentModule.video_parts}
                    posterUrl={currentModule.poster_url}
                    title={currentModule.title}
                    onProgressUpdate={(percent) => updateVideoProgress(currentModule.id, percent)}
                    watchedPercent={currentProgress?.video_watched_percent || 0}
                    onVideoComplete={() => undefined}
                    playbackRate={playbackRate}
                    onPlaybackRateChange={setPlaybackRate}
                  />
```

**Page-specific validation**

- Missing modules are unavailable rather than a completed empty course; enrollment failure stays explicit; progression and unlock rules remain. Preserve media_has_audio and transcript narration; surface the silent-source explanation in Watch before claiming audio recovery for those clips.
- Verify the preserved source behavior: Preserve useOnboardingCourse, agent/application identity, self-enroll-course and actual release eligibility. Do not equate local checkboxes with field release. Existing lesson/chapter keys intentionally reset different media; the source marks ReadyMode: Review the Right Calls and Pipeline: Client to Posted Deal as silent clips, with the explanation in Read/Listen. Resetting a player cannot create an absent audio track.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Training progress — `CourseProgress`
<a id="page-course-progress"></a>

**Decision:** Keep. **Source:** `src/pages/CourseProgress.tsx` (822 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/progress` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><CourseProgress /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep staff monitoring focused on stalled learners and verified completion.

**Existing data/API calls:** from `onboarding_modules`; rpc `my_course_progress`; invoke `send-course-reminder`; from `agents`; from `onboarding_progress`

**Existing helpers/components:** `@/components/hires/HireStageControl`, `@/lib/utils`, `@/components/dashboard/AddToCourseButton`, `@/components/dashboard/AddAgentToCourseDialog`, `@/components/admin/CourseContentViewer`, `@/components/training/TrainingWorkspaceNav`, `@/lib/trainingRoutes`.

**Baseline / current state:** Staff training progress remains under Training workspace navigation; preserve role gates.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CourseProgress.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep staff monitoring focused on stalled learners and verified completion.
Decision: Keep. Routes: /dashboard/training/progress.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Completion/stall summary → Learner progress → Explicit reminder or course action.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain my_course_progress, onboarding modules/progress and authorized add/remove/reminder behavior. Sending a reminder is distinct from advancing a lesson.
Acceptance: Scope and list counts reconcile; reminder/removal failure is not success; no messages are sent merely by viewing or redesigning the page.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `AddAgentToCourseDialog` expression below is copied from `src/pages/CourseProgress.tsx:455`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<AddAgentToCourseDialog onSuccess={() => refetch()} />
```

**Page-specific validation**

- Scope and list counts reconcile; reminder/removal failure is not success; no messages are sent merely by viewing or redesigning the page.
- Verify the preserved source behavior: Retain my_course_progress, onboarding modules/progress and authorized add/remove/reminder behavior. Sending a reminder is distinct from advancing a lesson.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Course content — `CourseContent`
<a id="page-course-content"></a>

**Decision:** Internal. **Source:** `src/pages/CourseContent.tsx` (433 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/content` | admin / manager / va_manager / va / recruiter; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><CourseContent /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make authorized curriculum inspection easy without competing with the learner course view.

**Existing data/API calls:** from `agents`; from `applications`; from `onboarding_modules`; from `onboarding_questions`

**Existing helpers/components:** `@/lib/like-escape`, `@/hooks/useAuth`, `@/lib/utils`, `@/components/training/TrainingWorkspaceNav`.

**Baseline / current state:** Content administration; keep staff navigation and mutations, never expose it as an ordinary learner task.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CourseContent.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make authorized curriculum inspection easy without competing with the learner course view.
Decision: Internal. Routes: /dashboard/training/content.
Audience: admin / manager / va_manager / va / recruiter. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Module sequence → Lesson material → Questions and return link.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep onboarding_modules/questions, enrollment/account checks and staff route constraints. This is a curriculum view, not evidence that the viewer completed the course.
Acceptance: Missing modules and fetch errors remain distinct; staff-only content stays scoped; back-to-course preserves the proper destination.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `TrainingWorkspaceNav` expression below is copied from `src/pages/CourseContent.tsx:156`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<TrainingWorkspaceNav />
```

**Page-specific validation**

- Missing modules and fetch errors remain distinct; staff-only content stays scoped; back-to-course preserves the proper destination.
- Verify the preserved source behavior: Keep onboarding_modules/questions, enrollment/account checks and staff route constraints. This is a curriculum view, not evidence that the viewer completed the course.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Annuity training — `AnnuityTraining`
<a id="page-annuity-training"></a>

**Decision:** Keep. **Source:** `src/pages/AnnuityTraining.tsx` (268 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/training/annuities` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AnnuityTraining /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the existing educational modules readable inside the Training workspace.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/components/training/TrainingWorkspaceNav`.

**Baseline / current state:** Specialist training already linked from Start here; retain content without a separate primary entry.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AnnuityTraining.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the existing educational modules readable inside the Training workspace.
Decision: Keep. Routes: /dashboard/training/annuities.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Module list → Current module → Suitability and source caveats.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain education content and TrainingWorkspaceNav. Hard-coded commission percentages, surrender windows, suitability and guarantee claims need authoritative review before promotion; they are not live carrier rates or individual advice.
Acceptance: Canonical/alias paths keep access; local completion, if retained, is labeled as local reading rather than compliance certification; long module text remains readable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/AnnuityTraining.tsx:230`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="h-5 w-5 text-amber-500" />
                <h2 className="text-16 font-bold">{sec.title}</h2>
              </div>
              <div className="text-13 text-foreground/85 leading-relaxed whitespace-pre-line mb-5">
                {sec.body}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border">
                <Button
                  variant="outline" size="sm" disabled={idx === 0}
                  onClick={() => setActive(MODULES[Math.max(0, idx - 1)].key)}
                >
                  ← Previous
                </Button>
                <Button
                  variant={completed.has(sec.key) ? "outline" : "default"}
                  size="sm"
                  onClick={() => setCompleted((s) => new Set(s).add(sec.key))}
                >
                  {completed.has(sec.key) ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Marked Read</> : "Mark as Read"}
                </Button>
                <Button
                  size="sm" disabled={idx === MODULES.length - 1}
                  onClick={() => setActive(MODULES[Math.min(MODULES.length - 1, idx + 1)].key)}
                >
                  Next →
                </Button>
              </div>
            </CardContent>
          </Card>
```

**Page-specific validation**

- Canonical/alias paths keep access; local completion, if retained, is labeled as local reading rather than compliance certification; long module text remains readable.
- Verify the preserved source behavior: Retain education content and TrainingWorkspaceNav. Hard-coded commission percentages, surrender windows, suitability and guarantee claims need authoritative review before promotion; they are not live carrier rates or individual advice.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Call Lab — `CallLab`
<a id="page-call-lab"></a>

**Decision:** Keep. **Source:** `src/pages/CallLab.tsx` (137 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/call-lab` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallLab /></ProtectedRoute>}` |

**Observed behavior and source contract**

Let an agent choose a real scenario, verify the microphone and resume prior practice.

**Existing data/API calls:** from `call_lab_scenarios`; from `call_lab_sessions`

**Existing helpers/components:** `@/hooks/useAuth`, `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/callLab/audio`, `@/lib/callLab/stt`, `@/lib/callLab/format`.

**Baseline / current state:** Practice a call already links here from TrainingJourney; retain live session/report subroutes.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallLab.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Let an agent choose a real scenario, verify the microphone and resume prior practice.
Decision: Keep. Routes: /dashboard/call-lab.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Scenario and mode → Microphone readiness → Recent sessions.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain scenarios/sessions, MicCheck and mode selection. Practice is separate from a customer call; no fabricated scores or completed sessions.
Acceptance: Training Start here discovers this route; mic denial is actionable; valid selection starts the existing session flow and recent records remain scoped.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `MicCheck` expression below is copied from `src/pages/CallLab.tsx:56`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<MicCheck onDemo={() => { const s = scenarios.data?.find((x) => x.id === DEMO_SCENARIO_ID); if (s) void start(s, "demo"); else toast.error("The demo scenario is not loaded yet."); }} demoReady={Boolean(scenarios.data?.some((x) => x.id === DEMO_SCENARIO_ID)) && starting === null} />
```

**Page-specific validation**

- Training Start here discovers this route; mic denial is actionable; valid selection starts the existing session flow and recent records remain scoped.
- Verify the preserved source behavior: Retain scenarios/sessions, MicCheck and mode selection. Practice is separate from a customer call; no fabricated scores or completed sessions.
- Existing focused checks to inspect: `src/tests/callLabWiring.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Practice call — `CallLabLive`
<a id="page-call-lab-live"></a>

**Decision:** Keep. **Source:** `src/pages/CallLabLive.tsx` (148 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/call-lab/live/:id` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallLabLive /></ProtectedRoute>}` |

**Observed behavior and source contract**

Keep the active session controls, script and conversation readable without interrupting capture.

**Existing data/API calls:** from `call_lab_sessions`; from `call_lab_events`; from `sales_scripts`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/callLab/stt`, `@/lib/utils`, `@/lib/callLab/useCallLabSession`, `@/lib/callLab/events`, `@/lib/callLab/format`, `@/components/callLab/SignalCore`, `@/components/callLab/Transcript`.

**Baseline / current state:** Session detail; keep session ID and recording/runtime state.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallLabLive.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Keep the active session controls, script and conversation readable without interrupting capture.
Decision: Keep. Routes: /dashboard/call-lab/live/:id.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Live session state → Mic/session controls → Script and transcript.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Preserve useCallLabSession, session ID, events and sales-script source. Do not reset media on decorative re-renders, broaden session access or let stale sessions append to a new one.
Acceptance: Mic permission, reconnect, mute/stop and session-change behavior remain; no fabricated transcript or score appears.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Cockpit` expression below is copied from `src/pages/CallLabLive.tsx:37`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Cockpit key={id} row={session.data.row} recovered={session.data.recovered} />
```

**Page-specific validation**

- Mic permission, reconnect, mute/stop and session-change behavior remain; no fabricated transcript or score appears.
- Verify the preserved source behavior: Preserve useCallLabSession, session ID, events and sales-script source. Do not reset media on decorative re-renders, broaden session access or let stale sessions append to a new one.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Call review — `CallLabReport`
<a id="page-call-lab-report"></a>

**Decision:** Keep. **Source:** `src/pages/CallLabReport.tsx` (185 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/call-lab/report/:id` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><CallLabReport /></ProtectedRoute>}` |

**Observed behavior and source contract**

Lead with the strongest behavior, the first fix and evidence from the actual practice session.

**Existing data/API calls:** from `call_lab_sessions`; from `call_lab_events`; invoke `call-lab-evaluate`

**Existing helpers/components:** `@/hooks/usePageTitle`, `@/lib/utils`, `@/lib/callLab/events`, `@/lib/callLab/format`, `@/components/callLab/Transcript`.

**Baseline / current state:** Practice report and feedback; keep history and source-specific score semantics.

**Copy-ready implementation prompt**

```text
Work only on src/pages/CallLabReport.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Lead with the strongest behavior, the first fix and evidence from the actual practice session.
Decision: Keep. Routes: /dashboard/call-lab/report/:id.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Score availability → Strongest and first fix → Objection/pace/transcript evidence.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain session/events and call-lab-evaluate. Not scored yet is a real state; do not invent talk ratio, filler counts or coaching before evaluation completes.
Acceptance: Unscored, failed evaluation and completed report remain distinct; rerun is explicit and does not duplicate a session.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Report` expression below is copied from `src/pages/CallLabReport.tsx:55`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Report row={row} sc={sc} events={events} />
```

**Page-specific validation**

- Unscored, failed evaluation and completed report remain distinct; rerun is explicit and does not duplicate a session.
- Verify the preserved source behavior: Retain session/events and call-lab-evaluate. Not scored yet is a real state; do not invent talk ratio, filler counts or coaching before evaluation completes.
- Existing focused checks to inspect: `src/tests/callLabWiring.test.ts`.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Sales scripts — `Scripts`
<a id="page-scripts"></a>

**Decision:** Consolidate entry point into Training; keep the script reader and unlock rules. **Source:** `src/pages/Scripts.tsx` (282 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/scripts` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><Scripts /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make approved scripts searchable and reachable from Training and the call workflow.

**Existing data/API calls:** from `sales_scripts`

**Existing helpers/components:** `@/hooks/useScriptsUnlocked`, `@/lib/utils`, `@/hooks/usePageTitle`.

**Baseline / current state:** Keep unique sales_scripts content and course integration; consolidate after library includes the same scripts.

**Copy-ready implementation prompt**

```text
Work only on src/pages/Scripts.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make approved scripts searchable and reachable from Training and the call workflow.
Decision: Consolidate entry point into Training; keep the script reader and unlock rules. Routes: /dashboard/scripts.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Unlocked scripts → Category/search → Selected script text.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Keep useScriptsUnlocked and sales_scripts. Fold navigation into Training context only after its access gate and script selection remain discoverable; do not unlock restricted content.
Acceptance: Locked, unavailable, empty and filtered results differ; long scripts and copy/reading controls remain usable.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/Scripts.tsx:216`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent className="p-8 text-center text-13 text-muted-foreground">
          <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Nothing matches that filter yet. Clear the search or switch categories — every closer keeps a script within reach.
        </CardContent></Card>
```

**Page-specific validation**

- Locked, unavailable, empty and filtered results differ; long scripts and copy/reading controls remain usable.
- Verify the preserved source behavior: Keep useScriptsUnlocked and sales_scripts. Fold navigation into Training context only after its access gate and script selection remain discoverable; do not unlock restricted content.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Agent handbook — `AgentHandbook`
<a id="page-agent-handbook"></a>

**Decision:** Consolidate discovery into Training; preserve full handbook content. **Source:** `src/pages/AgentHandbook.tsx` (268 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/handbook` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><AgentHandbook /></ProtectedRoute>}` |

**Observed behavior and source contract**

Make the existing guidance searchable and reduce duplicate navigation through Training context.

**Existing data/API calls:** No direct database/function call in this page; preserve its imported hook/component or static-content contract.

**Existing helpers/components:** `@/hooks/usePageTitle`.

**Baseline / current state:** Reference material belongs in existing Scripts & guides. Preserve content and useful script links.

**Copy-ready implementation prompt**

```text
Work only on src/pages/AgentHandbook.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Make the existing guidance searchable and reduce duplicate navigation through Training context.
Decision: Consolidate discovery into Training; preserve full handbook content. Routes: /dashboard/handbook.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Search and section list → Selected policy/guidance → Current workflow links.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain complete handbook sections and canonical Finances terminology. Static compensation examples are not the user’s actual payout schedule or a promise of payment.
Acceptance: Search exposes matching sections; all original guidance remains accessible; current links point to real workflows.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `Card` expression below is copied from `src/pages/AgentHandbook.tsx:230`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<Card><CardContent className="p-6 text-center text-13 text-muted-foreground">Nothing matches "{search}" yet — try a shorter phrase or browse the full handbook.</CardContent></Card>
```

**Page-specific validation**

- Search exposes matching sections; all original guidance remains accessible; current links point to real workflows.
- Verify the preserved source behavior: Retain complete handbook sections and canonical Finances terminology. Static compensation examples are not the user’s actual payout schedule or a promise of payment.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.

## Getting started — `GettingStarted`
<a id="page-getting-started"></a>

**Decision:** Keep. **Source:** `src/pages/GettingStarted.tsx` (654 lines in the inspected snapshot).

**Registered routes and access**

| Route | Existing access / mode | Source route element |
|---|---|---|
| `/dashboard/getting-started` | authenticated; wrappers: AuthenticatedShell, QueryShell | `{<ProtectedRoute><GettingStarted /></ProtectedRoute>}` |

**Observed behavior and source contract**

Show the next required step from account facts rather than a decorative progress checklist.

**Existing data/API calls:** from `system_settings`; from `agents`; rpc `api_my_ahl_exempt`; rpc `my_activation_state`; from `getting_started_progress`

**Existing helpers/components:** `@/hooks/useAuth`, `@/lib/phone`, `@/lib/contractingLinks`.

**Baseline / current state:** Activation checklist has live activation state and exemptions. It is not equivalent to training completion.

**Copy-ready implementation prompt**

```text
Work only on src/pages/GettingStarted.tsx and the smallest directly required tests/style seams. Read the existing page and its imported data hooks before editing.
Purpose: Show the next required step from account facts rather than a decorative progress checklist.
Decision: Keep. Routes: /dashboard/getting-started.
Audience: authenticated. Preserve every current route, page and server authorization boundary.
Prioritize the screen in this order: Verified activation state → Next required action → Supporting progress.
For authenticated workspaces use existing PageHeader action/view slots, Card/GlassCard, Tabs and semantic tokens. Public, token and auth journeys keep their own lean shell and existing route branches; never wrap the one-screen homepage in a second header/card. Keep red/charcoal styling, readable controls and large real financial figures where relevant; do not add decorative queries or fake activity.
Preserve: Retain my_activation_state, exemptions, system settings and getting_started_progress. Separate account facts from user-marked reading/task progress.
Acceptance: Unknown activation or identity does not look complete; exemptions and course/contract steps remain accurate; no automatic state advance.
Keep loading, failed, verified-empty, stale and permission-denied states distinct. Do not turn absent data into zero or success. Preserve keyboard focus, 44px primary targets, 332px no-horizontal-overflow and light/dark readability.
Use synthetic fixtures for UI checks. Do not submit live records, send messages, initiate calls, alter grants or publish during this task. Report what was actually changed and tested; leave conditional merges unexecuted until parity is demonstrated.
```

**Illustrative React/TypeScript section**

The `FactLine` expression below is copied from `src/pages/GettingStarted.tsx:389`. Keep its original lexical scope, variables, handlers and imports: a row inside a map stays inside that map; a guarded branch stays guarded. This is the exact section to prioritize/restyle using the shared contract, not a replacement for the complete page. Do not duplicate an existing header or add extra cards around an already complete card.

```tsx
// In the original lexical scope and authorized branch; retain existing imports/handlers.
<FactLine
                  label="Contracting"
                  done={Boolean(facts.contracting_done)}
                  detail={!facts.contracting_done && facts.contracting_profile_submitted ? "Profile in; carriers being confirmed" : undefined}
                />
```

**Page-specific validation**

- Unknown activation or identity does not look complete; exemptions and course/contract steps remain accurate; no automatic state advance.
- Verify the preserved source behavior: Retain my_activation_state, exemptions, system settings and getting_started_progress. Separate account facts from user-marked reading/task progress.
- No page-named focused suite was located by the import/name scan. Add a meaningful behavioral test only for the actual change; do not invent a green coverage claim.
- Shared checks: route/legacy redirect contracts, role preview/account-switch isolation where relevant, plus a focused responsive fixture using the actual component.
