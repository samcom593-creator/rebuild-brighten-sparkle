# APEX training system map

This is the authoritative map for the recruiting-to-production training experience. It prevents new builders from adding another disconnected training page or mixing three different progress ledgers.

## One operating journey

```text
Application or Add Agent
        |
        +-- Unlicensed ---------------------------------------------------+
        |   Welcome -> Course -> Exam ready -> Exam scheduled -> Passed  |
        |                                                   -> Licensed --+
        |
        +-- Already licensed --------------------------------------------+
                                                                    |
Profile + EFT/E&O/documents -> Agreements -> Contracting -> Community
                                                                    |
Core training -> Certification -> Launch ready
                                                                    |
First appointment -> First application -> First sale -> 30/60/90 coaching
```

Contracting means the APEX intake, Google contracting spreadsheet, and private contracting-support Discord. It does not use an AgentLink invite or handoff.

## Role-based entry points

| User | Primary route | Purpose |
|---|---|---|
| Admin / manager / VA | `/dashboard/recruiting/training` | Master recruit pipeline, licensed/unlicensed journey, next action, risk, durable milestone controls |
| Agent | `/dashboard/recruiting/training/library?tab=path` | Required resources and personal core-course progress |
| Leader | `/dashboard/recruiting/training/library?tab=team` | Roster-scoped completion rollup and stalled-agent follow-up |
| Training staff | `/dashboard/recruiting/training/progress` | Detailed module progress by agent |
| Training staff | `/dashboard/recruiting/training/content` | Module/question administration |
| Agent | `/dashboard/recruiting/training/sales-course` | Core APEX sales course |
| Agent | `/dashboard/recruiting/training/annuities` | Annuity-specific learning |
| Staff | `/dashboard/prelicensing` | Day-to-day pre-licensing queue |
| Staff | `/dashboard/pre-licensing` | XCEL report view |
| Staff | `/dashboard/onboarding-ladder` | Contracting-to-first-sale operational ladder |

`ApexTrainingEntry` is the role router. `TrainingWorkspaceNav` is the shared navigation. Do not create a second training landing page.

## Progress ledgers: keep them separate

| Concern | Source of truth | Key behavior |
|---|---|---|
| Recruit lifecycle | `apex_agent_journeys`, `apex_agent_journey_steps` | Staff-confirmed operational milestones; written through `set_apex_journey_step` |
| Core course | `onboarding_modules`, `onboarding_questions`, `onboarding_progress` | Agent-scoped lessons, watched percent, quiz attempts, score, pass state |
| Resource-hub courses | `hub_course_progress` | Auth-user-scoped completion for content imported from the APEX resources API |
| Licensing | `applications.license_progress` plus licensing timestamps and XCEL tracker views | Unlicensed course/exam/license progression |
| Contracting | `contracting_intakes`, delivery jobs/receipts, `agent_carrier_comp`, `agent_contract_status_history` | Spreadsheet/Discord delivery plus per-carrier status and comp |
| Team training rollup | `apex_training_rollup()`, `apex_training_needs_nudge()` | Canonical-roster counts with role scope; never derive these from capped client arrays |

Do not convert a lesson pass into a lifecycle completion in client code. If an automatic bridge is desired, implement one explicit, audited database function with tests and idempotency.

## Licensed path

1. Welcome/contact and onboarding owner confirmed.
2. Profile and required documents complete: contact data, NPN/license, EFT readiness, E&O coverage, required uploads.
3. Required agreements signed.
4. Contracting intake delivered to the Google sheet and private contracting-support Discord; each required carrier has a status or next action.
5. Community access confirmed.
6. Required onboarding resources completed in order.
7. Core modules watched and quizzes passed.
8. Certification result recorded.
9. Launch checklist signed off.
10. First appointment, first application, and first sale recorded.
11. 30/60/90-day coaching milestones recorded.

## Unlicensed path

1. Welcome/contact and support owner confirmed.
2. Pre-license course access and first activity confirmed.
3. Course complete and exam readiness confirmed.
4. Exam date recorded.
5. Passing result recorded; a failed result stays visible with a retest action.
6. Issued state license verified.
7. Continue through the licensed path at profile/documents; do not create a second agent or journey.

## Required learning resources

1. Orientation: `https://youtu.be/Gm62pf3SywU`
2. Script walkthrough: `https://drive.google.com/file/d/1FZIMIdqDRf7HAox9egfVWpAvhterF2Vy/view?ts=6a8d0638`
3. Objection handling: `https://www.youtube.com/watch?v=jOtqBnnLsR0`
4. Producer training and library: `/dashboard/recruiting/training/library`
5. Official script: `https://docs.google.com/document/d/1OeDu_6TABfIJtVHrn1TrJUjWGzgehYttoMj7ttSebxI/edit?tab=t.0#heading=h.u8s4qkrx1od7`
6. Human onboarding help: Aisha, `978-804-7212`

These already render through `RequiredOnboardingResources`. Content edits should update that component or the external resource library, not hard-code another list elsewhere.

## UI contract

- Staff first see “who needs what next,” not a giant undifferentiated table.
- Agents first see their current step, progress, required resource, and one resume action.
- Every number names its scope and denominator.
- Loading, unavailable, no-access, and true-zero are distinct states.
- A stalled list excludes terminated, inactive, departed, and test accounts through the canonical roster.
- Completion controls persist and invalidate all dependent queries.
- Mobile has one primary action per card, usable at 390px without horizontal page overflow. Wide pipeline tables may scroll inside their own container.

## Acceptance test for any training change

1. Test one licensed and one unlicensed journey.
2. Test agent, manager, VA, and admin visibility.
3. Refresh after marking a milestone; it remains complete.
4. Verify progress is attributed to the correct agent/auth identity.
5. Verify a failed external resource read shows “unavailable,” never zero.
6. Verify terminated/inactive users do not appear in current-team nudges.
7. Run focused tests, typecheck, build, and route smoke.
