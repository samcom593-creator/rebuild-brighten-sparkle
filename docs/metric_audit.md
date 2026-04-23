# APEX Metric Audit

Every numeric widget on every page traced to its source query. Per master prompt Section 4.

**Legend:**
- ✅ wired to live data
- ⚠️ live data but constraint/edge case exists (documented)
- ❌ placeholder, needs fix
- 🗑️ removed (was inert)

Last audit run: 2026-04-23 (branch `fix/deal-status-sync`)

---

## /dashboard (generic agent dashboard)

| Widget | Status | Source | Notes |
|---|---|---|---|
| Weekly AOP | ⚠️ | `SUM(deals.annual_premium) WHERE agent_id=me AND effective_date >= date_trunc('week', now()) AND status IN ('submitted','active')` | Now accurate — previously showed mixed-status total |
| MTD ALP | ✅ | `SUM(deals.annual_premium) WHERE agent_id=me AND effective_date >= date_trunc('month', now())` | |
| Closing rate | ⚠️ | `(COUNT(deals active) / COUNT(applications)) × 100` cap at 100 | Raw >100 now writes to `agentlink_alerts` as data-quality signal |
| Haven't logged in 7d+ | ❌ TODO | Needs `auth.users.last_sign_in_at < now() - interval '7 days'` wired, tap → re-engagement flow | Inert today |
| Churn rate | ✅ | `agents.metadata.churn_90d_pct` refreshed by `churn_calc` cron nightly | Empty metadata = "awaiting first churn cycle" |
| Total earnings for month | ✅ | `SUM(commission_ledger.amount) WHERE agent_id=me AND status='paid' AND actual_paid_date BETWEEN month_start AND month_end` | Empty = "Awaiting first payout" (not a fake number) |
| Recruiting pipeline right rail | ✅ | `applications GROUP BY status` live query | Each stage count is live |
| Performance dashboard weekly competition | ❌ TODO | Must branch on profiles.role: admin = agency-wide, agent = personal | Currently all zeros |

## /dashboard/leaderboard

| Widget | Status | Source |
|---|---|---|
| Daily/Weekly/Monthly tabs | ✅ | `leaderboard_snapshots` latest per-period snapshot |
| Top 3 gold/silver/bronze | ✅ | `leaderboard_snapshots.rank` ≤ 3 |
| Avatars | ✅ | `profiles.avatar_url` join |

## /dashboard/rewards

| Widget | Status | Source |
|---|---|---|
| Reward cards grouped by period | ✅ | `agentlink_rewards` |
| Winner avatar + name | ✅ | agents → profiles join |

## /dashboard/my-commissions

| Widget | Status | Source |
|---|---|---|
| Pending / Paid / Clawed totals | ✅ | `commission_ledger GROUP BY status` |
| Ledger rows table | ✅ | `commission_ledger` joined to `deals` for client + carrier + product |
| Rate shown per deal | ✅ | `commission_ledger.rate_pct` + `rate_source` |
| Expected pay date | ✅ | `commission_ledger.expected_paid_date` |

## /dashboard/my-deals

| Widget | Status | Source |
|---|---|---|
| Deal list | ✅ | `deals WHERE agent_id=me ORDER BY effective_date DESC` with carrier join |
| Status badge | ✅ | `deals.status` — now accurate post-sync fix |
| Premium display | ✅ | `deals.annual_premium` / `monthly_premium` |
| **TODO**: tap row → detail + status history | ❌ | Not yet wired |

## /dashboard/agentlink-sync (admin)

| Widget | Status | Source |
|---|---|---|
| Cookie state | ✅ | `system_settings.agent_link_session_cookie` presence |
| Recent sync rows | ✅ | `agentlink_sync_log ORDER BY started_at DESC LIMIT 10` |
| Live/Not-configured badge | ✅ | derived from cookie presence |
| Run-now button | ✅ | calls `public.agentlink_live_pull()` |

## /setup (admin, new)

10 live checks — all pull from Supabase on render. See page for specifics.

## /dashboard/hierarchy (TeamHierarchy)

| Widget | Status | Notes |
|---|---|---|
| Tree rendering | ⚠️ | Uses real `agents.manager_id` — structure is correct. Master prompt flagged it; specific bugs not yet reproduced. Open issue for follow-up audit with real UI screenshots. |
| Downline totals | ✅ | `useMyDownline` hook computes recursively |
| Reassign action | ✅ | UPDATE agents.manager_id |

## Known-broken / explicitly removed

- VSL video on `/apply` → 🗑️ fully removed 2026-04-23
- Churn rate tile without drill-down → wired to real data (no more placeholder 20)
- Plaques / awards graphics → single `<Plaque />` component TODO; current output still manual
- ReadyMode Dialer integration → shell only, needs credentials

## Source-of-truth rules (enforce in review)

1. Every number must trace to a `supabase.from()` or `net.http_get()` call.
2. No inline numeric literals that render as "production data."
3. Empty states show "No data yet" / "Awaiting first payout" — never a fabricated fallback.
4. Every number has a tooltip showing source + last-updated timestamp (TODO across the board).
5. Every interactive number tap drills into source (TODO partial).

## Revenue integrity snapshot (live)

- Total deals: 738 · $966k all-time ALP
- Active: 118 deals · $137k
- Submitted: 526 · 343 of them >7d old (upstream `null` status — documented)
- Commission ledger: 100+ rows · $44,772.83 pending
- Agents without schedule: 0 (was 38)
- Orphan deals (no agent): 0
- Open blocker alerts: 0
