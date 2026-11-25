# Galaxy release completion — 2026-11-24 (America/Phoenix)

## Decision and authorized scope

Resume the owner-approved unpublished 151-file release from local revision
`9e6429f6` and complete its publication, including the added issued/paid and
placement request. Do not repeat the already deployed producer migrations.

The restored release starts from current main
`f0f9d34d1fcd7eaf6eb9da339134a4f223649187`. Its source tree exactly matches the
prior local base `86d2772b` (tree `2e0aaab3ee9d847114a91a5e08b68a65787505cc`).
This preserves the current two-path homepage, red theme, production boards,
awards, account-specific demonstration access, and audience-specific videos.

## Release behavior

- Consolidates Finances around commission payments and the authorized carrier
  policy book, with separate management views, policy detail, recorded payout
  percentages, payment dates, coverage, and source status.
- Consolidates repetitive routes/navigation while preserving deep-link context,
  role boundaries, contracting receipts, training discovery, and award history.
- Keeps private owner pages server-checked; isolates account changes and adds
  account-owned task creation and fixed-bucket authorized recording URL signers.
- Accepts the existing SQL-supported Vantage gap payout component in the
  Management overview while still rejecting unknown component values.
- Repairs password-recovery initialization when a recovery auth event arrives
  before the startup session read completes.
- Adds native video error/retry actions, bounded YouTube API/player failure
  handling, and fresh lesson playback state after module/media changes.
- Removes the query-provider dependency from the public video route and retires
  broad Supabase service-worker caching. API/auth/media requests use normal
  browser network handling; old `supabase-rest` cache data is removed on worker
  activation. Content-hashed application assets remain cached.

## Issued/paid and placement definitions

Carrier portal issued AP and in-force issued AP are reported separately from
the personal policy-row totals. The Ethos portal response represents the latest
all-time matched-NPN report and can include its downline; the response does not
provide the portal snapshot date.

Current premium-paying AP includes only Ethos policies with active coverage and
literal `PREMIUM_PAYING` status. It is a status-based annual-premium subtotal,
not a dated cash receipt. Generic Active/Issued/In force, renewal processing,
other carriers, missing premiums, and contradictory coverage never establish a
verified issued-and-paid total.

The current sources do not supply verified premium-payment receipts and a
matching submission cohort. Live issued-and-paid AP and placement therefore
remain unavailable rather than inferred from submitted production, commission
payments, retention, or first-observed snapshot timestamps.

The existing authorized demonstration editor supports optional issued/paid AP
and policy counts. Placement is calculated only from those explicit local demo
inputs and the same account/date/scope demonstration policy count. Blank values
remain unknown, a zero denominator has no rate, and issued/paid figures cannot
exceed their displayed cohort totals. Demonstration values are marked and
hidden in Present mode; no production rows or query-cache facts are rewritten.

## Verification and limits

The focused backend/permission review passed 241 tests. The recovery race was
reproduced before the fix; all 28 auth-hook tests passed afterward. Playback
and cache-isolation checks passed 38 focused tests. Finance source-fact checks
passed 48 tests. The additional demonstration-editor, goal, and scoreboard
coverage passed 97 tests, including nine new issued/paid and placement cases.

Both existing public recruiting videos were played in the live browser, with
advancing playback time and no media error. The private Finances route required
sign-in, so no authenticated production-recording or carrier-receipt result is
claimed. Local browser preview was inaccessible; its temporary fixture was
removed from the release.

The local Deno runtime could not fetch `deno.land` dependencies. The complete
GitHub verification workflow remains the authoritative Deno gate; this local
infrastructure limit must not be reported as a passing check. Required release
checks and the production deployment must succeed on the actual published
revision before this release is reported live.
