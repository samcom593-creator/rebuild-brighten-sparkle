# Test and Acceptance Matrix

| Area | Required evidence | Local status |
|---|---|---|
| Build | Vite production build | Passed 2026-08-11 |
| TypeScript | Error count does not exceed committed baseline | Passed: 228/229 |
| Lint | Changed React/TypeScript files | Passed |
| Edge functions | Deno type check for dispatcher and SMS adapter | Passed |
| Migrations | Unique versions and staged SQL apply | Version guard passed; staged apply pending |
| Unit suite | Repository Vitest run | Passed: 566 tests; 6 todo |
| RBAC/RLS | Allowed roles succeed; other authenticated/anonymous roles fail | Staging test pending |
| Add Agent | Exactly first, last, email, phone, PA; duplicate/invalid cases; no outbound side effect | Staging test pending |
| Contact visibility | Correct row phone/email visible; missing values truthful | Authenticated visual test pending |
| Call | Server-resolved target and audit row before device handoff | Staging test pending |
| SMS | Preview/edit/confirm, consent/DNC, idempotency, accepted/skipped/failed receipt | Dry-run staging pending; live send prohibited |
| Email | Preview/edit/confirm, unsubscribe, idempotency, provider receipt | Dry-run staging pending; live send prohibited |
| Dispositions | Called/voicemail/hired/passed are atomic and scoped | Staging test pending |
| Deal | Draft recovery, evidence constraints, review controls, duplicate submit, history/audit/outbox | Static contracts passed; staging test pending |
| Reliability | Claim/retry/dead-letter and receipt-without-resend recovery | Staging fault injection pending |
| Health | Liveness 200; readiness fails closed before migration and passes after | Staging pending |
| Responsive | 360×800, 390×844, 768×1024, 1366×768, 1440×900, 1920×1080 | Authenticated visual test pending |
| Production | Uptime, post-deploy smoke, rollback rehearsal | Owner authorization required |

“Pending” is a release blocker, not an implied pass. Local navigation reached the expected sign-in boundary without using supplied credentials or sending data.
