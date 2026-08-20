# Recruiting workspace contract

`/dashboard/recruiting` is the only persistent recruiting destination. Its URL-addressable flow is:

| Step | Canonical route | Source of truth | Primary receipt |
|---|---|---|---|
| Applicants | `/dashboard/recruiting` | `applications` where `record_type = 'application'` | applicant activity / field timestamps |
| Interviews | `/dashboard/recruiting/interviews` | `hh_applicants` through `interviews-pipeline` | versioned row + append-only `hh_activity` |
| Follow-ups | `/dashboard/recruiting/follow-ups` | `v_interview_pipeline` / `interview_events` | `cc_dispose_interview` outcome |
| Hires | `/dashboard/recruiting/hires?status=hired` | hired applications | `promote_applicant_to_agent` |
| APEX Training | `/dashboard/recruiting/training` | `apex_agent_journeys` / `apex_agent_journey_steps` | persisted milestone receipt |

Legacy `/dashboard/interviews`, `/dashboard/interview-recovery`, `/dashboard/recruit`, and `/recruit` URLs preserve their query string and redirect into this workspace. Interviews is not a separate sidebar item and no APEX screen links to the separately branded Headhunter origin.

`/admin/apex-toolkit` now redirects to the APEX Training slice. The master recruit pipeline continues past licensing through APEX Training, certification, launch readiness, and first sale; post-license completion is never inferred from an application status and requires a durable journey-step receipt.

## Google Voice recovery

Desktop recruiting call and text actions use the shared Google Voice links; touch devices keep native `tel:` / `sms:` behavior. The VA command center exposes an account-switch recovery action for Google's `Upgrade not available` state. Account eligibility remains Google's authority: APEX does not claim it provisioned Voice, and the recovery opens Google's chooser so the operator can select an eligible work account.

## Interview authorization

- APEX admin maps to interview executive behavior.
- APEX manager maps to recruiter behavior and may record outcomes.
- APEX VA / VA manager maps to VA behavior, requires an active email match in `hh_users`, reads only rows owned by that `hh_users.id`, and may only confirm, no-show, reschedule, or cancel before a recruiter decision.
- Every write uses an action allowlist, validates the current stage, requires the row's current `version`, and reports whether the append-only activity receipt persisted.

## Temporary compatibility boundary

The legacy Headhunter deployment remains a backend/data-administration fallback while duplicate merge, imports, exports, bulk assignment, and user provisioning are ported. It is not a user-facing APEX destination. The native workspace owns the daily loop: appointment → confirm → outcome → follow-up/hire → explicit onboarding promotion. `hh_*` remains the authoritative interview data contract during this cutover; do not create a second interview table.
