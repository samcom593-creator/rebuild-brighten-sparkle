# Agent Link ↔ APEX Data Mapping

Full field mapping between InsuraCloud / Agent Link API and the APEX
Supabase schema. This is the contract the `agentlink-import` edge function
and future Agent Link integrations adhere to.

## Endpoints currently wired

| Direction | Local fn | Agent Link endpoint | Status |
|---|---|---|---|
| APEX → Agent Link | `insuracloud-outbox` | `POST /api/v1/book-of-business`, `POST /api/csrf-token`, `POST /api/deals` | Working |
| Agent Link → APEX (book) | `agentlink-import` | `GET /api/v1/book-of-business` | Returns HTTP 500 — Agent Link upstream issue, see "Known issues" |
| Agent Link → APEX (earnings) | `insuracloud-sync` | `GET /business-analytics`, `/book-of-business`, `/team-analytics` | Wrong endpoint prefix — missing `/api/v1/` — returns SPA HTML |

Headers: `Authorization: Bearer <INSURACLOUD_API_TOKEN>`, `x-api-key: <INSURACLOUD_API_TOKEN>`, `Accept: application/json`.

## Field mapping — policy / deal

| Agent Link payload key | APEX `deals` column | Notes |
|---|---|---|
| `id` or `policy_number` | `external_deal_id` + `policy_number` | Upsert conflict key |
| `client_first_name` | `client_first_name` | |
| `client_last_name` | `client_last_name` | |
| `client_phone` | `client_phone` | |
| `client_dob` | `client_dob` | ISO date |
| `product_sold` / `product` | `product_sold` | |
| `carrier_id` (int) | `carrier_id` (uuid) | Resolve via `carriers.insuracloud_carrier_id` |
| `carrier_name` | `carrier_id` (uuid) | Fallback lookup by `LOWER(name)` |
| `monthly_premium` | `monthly_premium` | |
| `annual_premium` | `annual_premium` | Defaults to `monthly × 12` if missing |
| `face_amount` | `face_amount` | |
| `effective_date` | `effective_date` | |
| `policy_expiration_date` | `policy_expiration_date` | |
| `status` | `status` | |
| `pipeline_stage` | `pipeline_stage` | submitted / approved / paid / lapsed |
| (constant) | `source` | Always `agent_link` for inbound |

## Field mapping — agent earnings snapshot

| Agent Link payload key | APEX `insuracloud_snapshots` column |
|---|---|
| `today_earnings` | `today_earnings` |
| `mtd_earnings` | `mtd_earnings` |
| `ytd_earnings` | `ytd_earnings` |
| `direct_commissions` | `direct_commissions` |
| `override_commissions` | `override_commissions` |
| `forecast_90_day` | `forecast_90_day` |
| (full body) | `raw_payload` (jsonb) |

## ID reconciliation

- **Agents** — APEX `agents.insuracloud_user_id` stores the upstream numeric user id. Backfill nightly via `sync-insuracloud-ids`.
- **Carriers** — APEX `carriers.insuracloud_carrier_id` stores the numeric carrier id. Seeded at carrier creation; manually reconcilable via `/dashboard/integrations`.

## Known issues (as of 2026-04-21)

1. **`GET /api/v1/book-of-business` returning HTTP 500** for the shared default token across all 14 active agents. This is Agent Link's server-side crash, not an auth or request-shape issue (tokens returning 401 on wrong endpoints work as expected). Report to Agent Link / Replit support; no fix on our side.

2. **`insuracloud-sync` uses `/business-analytics` without `/api/v1/` prefix** → falls through to the SPA index.html and parses it as empty JSON, so every synced value is `$0`. The fix lives in `agentlink-import` which uses the correct prefix. Once deployment stabilises, either retire `insuracloud-sync` or patch it to the correct path.

3. **Plaque images** — historical WASM bug in `send-plaque-recognition` (`Resvg.initWasm()` fetches the landing page instead of the `.wasm` binary, causing `expected magic word` error). `send-plaque-batch` and `render-all-plaques` sidestep WASM entirely by using pure-string SVG templates.

## Pipeline stage sync rules

| Trigger | APEX pipeline_stage |
|---|---|
| Deal inserted (`status != 'draft'`) | `submitted` |
| InsuraCloud confirms receipt | `approved` |
| Commission paid | `paid` |
| Policy lapses | `lapsed` |

Transitions are expected to flow via the nightly `insuracloud-sync` once
its endpoint prefix is fixed.
