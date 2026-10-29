# MP-309b — Money Inbox v2

The route is `/dashboard/money-inbox`. iMessage ingest lives on Sam's Mac at `~/business-ops/money-inbox`; its maintained source is now under `scripts/money-inbox/`. The browser reads `money_inbox_threads`, protected by canonical-Sam RLS. The new service-only `money-inbox-classify` function supplies the Haiku fallback from the server's Anthropic credential.

## Changes

- Normalize both Apple epoch seconds and nanoseconds, including subsecond accuracy, and rebuild stored inbound/outbound/excerpt timestamps from the read-only Messages database. Existing send timestamps remain audit timestamps; `delivered_at` comes from Messages `date_delivered`.
- Compact mobile cards, Phoenix relative/absolute dates, clean unsaved numbers, topic/source/unanswered/today filters, newest-inbound ordering, optional high-priority ordering, pagination, edit/call/snooze/done.
- Topic and priority stored at ingest. Join team, income, car rental and next steps get tier 1. Rules precede cached Haiku classification. Potentially intimate ambiguity fails closed if the classifier cannot answer.
- Private rows are denied by RLS even to Sam's browser. Browser column grants prevent changing classification, recipient, or delivery receipts. Original Messages data is read-only. Flagged handles/dates/generic reasons are backed up, with mode 0600, to `~/business-ops/session-state/private-flagged.csv`.
- Instagram/TikTok `inbox_messages` and canonical YouTube comments join the same feed. Original source timestamps are preserved; YouTube's ManyChat copies are excluded to avoid duplicates. Source freshness is explicit. Social sending is not connected to Money Inbox; those cards link to the original channel, and never queue an iMessage send.
- A persistent launchd Realtime listener dispatches durable approvals immediately. Scanning and drafting cannot block it. Conditional claim plus a local file lock prevents competing send workers. Reconnect reconciles pending approvals. UI updates optimistically and rolls back failures.
- Deterministic suggested next-step questions avoid spawning model subprocesses from the scheduled scanner. Existing approved/final text remains untouched.

## Evidence

Historical customer approvals, checked against actual `chat.db.date_delivered`: **110,530.872 ms** and **118,077.490 ms**. New Sam-only live verification: **3,132.707 ms**, including **668 ms** to claim. Small sample; not a production percentile or a guarantee. Earlier `sent_at`-only timings were not delivery evidence and were superseded by these measurements. Raw receipt metadata is local in `session-state/packets/mp309b-latency.json`.

14 focused Vitest tests and 3 Python ingest tests pass. Vite production build and metric-truth check pass. Authenticated mobile browser verified against the local route. Repository-wide TypeScript has existing unrelated errors; no touched production file errors.

## Operations

Install `scripts/money-inbox/package.json` dependencies under the Mac runtime directory and copy the maintained Python/MJS files there. The existing scan LaunchAgent remains on a two-minute cadence. `com.samjames.apex.money-inbox-sender` runs `sender.mjs` continuously with KeepAlive. Never run the old scan-and-send loop alongside the new sender. The database migration was applied through bot-sql and recorded in migration history.

The local Supabase PAT and local Anthropic OAuth token were invalid. The classifier is deployed through the repository's authorized GitHub workflow using its function-scoped credential. Final production deployment identifiers and verification results belong in the appended session receipt.
