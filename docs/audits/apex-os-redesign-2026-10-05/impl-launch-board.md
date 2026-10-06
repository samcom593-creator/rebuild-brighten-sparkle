# §11 Launch Board — implementation note (2026-10-06)

Branch `apex-os/launch-board`. Not pushed. Migration written and proven in a rolled-back transaction; NOT applied to prod.

## What was there (measured 2026-10-06, read-only)

| Surface | Route | Tables / storage | Live rows |
|---|---|---|---|
| Launch Board | `/dashboard/launch-board` (ContentAccessGate) | `content_cards`, `content_clips`, `content_shares`, `v_testimonial_classifier_health` | 29 cards (26 idea, 1 ready, 2 posted); 7,783 clips (7,418 live, 7,418 with a fresh direct download link, 7,521 thumbs, 5,356 previews, 0 attached to a card); 0 shares |
| Content (nav "Owner > Content") | `/dashboard/content` → **ContentQueue** | `content_queue`, `content_access`, private bucket `content-media` | 1 queue row (REWORK), 0 access rows, 1 media object |
| ContentLibrary.tsx | `/dashboard/content` (second declaration) | `content_library`, public bucket `content-library` | **0 rows**; bucket holds 142 objects, all `phone/*.mp4` = the phone-size copies `content_clips.phone_url` points at (142/142 linked) |

Findings:
- `/dashboard/content` was declared twice in App.tsx; the first (ContentQueue, 2026-09-09) shadowed the second, so ContentLibrary.tsx had been unreachable for ~4 weeks.
- Status vocabulary was `idea | recorded | ready | posted` (CHECK `content_cards_status_check`). "Post" opened a dialog whose "I posted it" button set `status='posted', posted_at=now()` with **no URL or evidence**. Both posted cards (2026-09-16, YouTube long-form) have no URL and no clip — they are shown as **Published (unconfirmed)** now, not rewritten.
- Copying a caption / downloading never wrote the card (verified by reading every handler) — kept that way and pinned by a test.
- No scheduler integration writes to `content_cards` (`cw_posts` = 0 rows; no Metricool/Postiz table). So every schedule a person sets is a **Manual plan**.
- Only `src/pages/LaunchBoard.tsx` writes `content_cards` (repo + business-ops grep).

## What changed

- `src/lib/contentWorkflow.ts` (new, pure): stages Idea → Record → Edit → Review → Ready → Scheduled → Published; legacy mapping `recorded → Edit`, `posted → Published` only with evidence else `Published (unconfirmed)`; unknown → Idea (never Published); publish-URL rule (https, known platform host incl. subdomains, a path after the host, no userinfo/port, look-alike hosts refused, destination mismatch warned); `scheduleLabel` (job only with a job ref, else Manual plan); `nextAction`; `todayQueue` (≤7, America/Phoenix, overdue > planned-time-passed > ready > review > due today > edit-with-footage > record > today's week slot); `fourQuestions`.
- `src/pages/LaunchBoard.tsx`: Today = four-question tiles + a ≤7-row prioritized table; Board = dense table (item, stage, destination, source media, owner, due, next action, one primary action) with stage filter chips; Week kept (stage-colored with tokens); Library kept intact (search incl. transcript/OCR, previews, testimonials, per-clip + bulk download, phone pull/share, share links, attach / new card from clip); **Queue** tab embeds the former Content page. Editor holds only execution fields (hook, shot list, source media + "Pick from Library", edit instructions, caption, CTA, destination, job, week slot, owner, deadline) and shows stage + next action; status is not editable there. Publish kit: copy caption / download / open clip (none change stage) + live-URL confirmation. Plan-time dialog writes `schedule_kind='manual'` and says so. Approve is admin-only (button hidden for others, trigger enforces). Loading uses `PageSkeleton`. Tab is in the URL (`?tab=`). If the migration is absent the page probes for it and shows a banner + disables stage moves instead of failing on every tap.
- `src/pages/ContentQueue.tsx`: `embedded` prop (no PageHeader, no self-link); invite text points to `/dashboard/launch-board?tab=queue`.
- `src/App.tsx`: exactly one `/dashboard/content` route → `<Navigate to="/dashboard/launch-board?tab=queue" replace />` (single hop; target is ProtectedRoute + ContentAccessGate); removed the shadowed ContentLibrary route and both now-unused lazy imports.
- `src/components/layout/agentCloudNavigation.ts`: removed Owner > Content (Launch Board covers it).
- `src/components/command/CommandPalette.tsx`: "Content Library" → "Launch Board · Content" at `/dashboard/launch-board`.
- `src/pages/ContentLibrary.tsx`: `// intentionally-orphan:` marker with the reason; file kept (no asset or table touched).

## Data model — `supabase/migrations/20261006150000_launch_board_workflow.sql`

Additive only. New columns on `content_cards`: `cta`, `owner`, `due_date`, `approved_by/at`, `scheduled_for`, `schedule_kind ('manual'|'job')`, `schedule_job_ref`, `published_url`, `publish_evidence ('provider'|'manual_confirmation')`, `published_confirmed_by/at`, `status_changed_at`. Status CHECK widened to `idea, record, edit, review, ready, scheduled, published, recorded, posted` (no row rewritten). Constraints: published ⇒ evidence + `content_publish_url_ok(url)`; scheduled ⇒ time + kind; job ⇒ ref. Trigger `content_cards_workflow_guard` (SECURITY DEFINER, `search_path=public`), for signed-in users: refuses new `posted` writes, maps `recorded → edit`, only `apex_is_admin()` can set `approved_at` (stamps approver), Ready/Scheduled/Published only from an approved card (or a legacy ready/posted one), `schedule_kind='job'` and `publish_evidence='provider'` only from the service role, stamps `published_confirmed_by/at`. RLS unchanged (existing admin/manager + `content_can_access()` policies).

## Evidence

- Rolled-back proof against prod (bot-sql, `begin; <file>; tests; rollback;`): 200 `ok:true`. Inside the txn, with a synthetic card and simulated JWTs: refused crew `posted`, Ready without approval, non-admin approval, published without URL, scheduled without time, person-claimed job, person-claimed provider evidence, non-platform / http / bare-domain URLs; accepted `recorded` (mapped to `edit`), admin approve → ready (approver stamped), manual plan → published with a live URL (trimmed, confirmer stamped). Legacy rows after: idea 26, posted 2, ready 1 — untouched. Harness red-check: an expectation flipped to a harmless edit returned `PROOF FAILED`. Post-check: 0 synthetic rows, 0 new columns/functions in prod.
- `npx vitest run src/tests/lib/contentWorkflow.test.ts src/tests/pages/launchBoardContract.test.ts` → 16 + 8 pass; mutation (posted always Published) → 5 failures, restored → green. Related existing tests (callLabWiring, nativeOperationalLiveContract, accountModeRouting, interviewPipelineContract, recruitingLinksContract) 26/26 pass.
- `npx tsc -b --noEmit --force` → 82 errors (baseline 82). `vite build` ok. 32 guards incl. relation-exists / types-relation-completeness / rpc-args all PASS.

## What remains

1. Apply the migration to prod (command center), then regenerate `types.ts` + catalogs (`enum-catalog` `content_cards.status` gains 7 values). Until then the deployed page shows the "migration not applied" banner and stage moves are disabled — the frontend must not ship before the migration, or ship knowing that banner appears.
2. The 2 legacy posted cards stay "Published (unconfirmed)" until someone pastes their live YouTube URLs (Add live URL). Not guessed.
3. No scheduler/provider integration exists; `schedule_kind='job'` and `publish_evidence='provider'` are reserved for a service-role writer.
4. Visual QA in a browser (light/dark, mobile) not done in this worktree (no browser automation by instruction).
5. ContentLibrary.tsx (upload + AI tag + award generator) is unrouted; decide keep-or-delete. `content_library` table and bucket are untouched.
