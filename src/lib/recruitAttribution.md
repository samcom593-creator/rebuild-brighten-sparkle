# Recruit Attribution — Canonical Reference

Apex Onboard tracks four distinct identities per applicant. Confusing them is the source of
most recruiting credit / manager assignment disputes. Treat this as the single source of
truth; if existing code mixes them up, fix it on the spot.

## The four id fields on `applications`

### 1. `referral_recruiter_id` — CREDIT
**Who gets recruiting points.** Typically an agent (sometimes a manager). Surfaced on
recruiting leaderboards and the agent's personal dashboard "your recruits this month" tile.
Set by the referral-resolver edge fn when an applicant arrives via `/apply?ref=<code>` and
the resolved entity is in the `agent` role.

Added: 2026-06-08 (P3 migration `p3_referral_attribution`).

### 2. `referral_manager_id` — LEGACY MANAGER LINK
The manager whose invite link was used. Predates `referral_recruiter_id` and historically
doubled as recruiting credit when only managers had invite links. Phase out by gradually
moving all new attribution to `referral_recruiter_id` and treating this field as a fallback
for legacy rows. Do NOT remove — too many existing rows depend on it.

### 3. `assigned_agent_id` — WORKS IT
The CRM owner — who is responsible for working the applicant through the funnel. Typically
a manager. Set by the hiring-routing edge fn based on territory / capacity / specialization.
This is who appears in "your applicants" lists and gets nudge SMSes.

### 4. `hiring_manager_user_id` — DECIDES
The manager responsible for the final hire/no-hire decision. Often the same as
`assigned_agent_id` but not always — e.g. an applicant might be worked by a junior manager
but the hire decision goes to a senior manager who owns the territory.

## Resolution flow at `/apply?ref=<code>`

```
Applicant lands → referral-resolver edge fn looks up the invite_code:
  if resolved entity is in 'agent' role:
    set referral_recruiter_id = entity.id
    set referral_manager_id = entity's upline manager (if any)
  if resolved entity is in 'manager' role:
    set referral_manager_id = entity.id
    leave referral_recruiter_id NULL
  audit row written to agent_attribution_audit (always)
```

Then the hiring-routing edge fn fires and computes `assigned_agent_id` + `hiring_manager_user_id`
independently — those routing decisions are not affected by the referral chain.

## Queries

```sql
-- Who gets credit for a given application?
SELECT
  COALESCE(referral_recruiter_id, referral_manager_id) AS credited_to,
  CASE WHEN referral_recruiter_id IS NOT NULL THEN 'agent' ELSE 'manager' END AS credit_kind
FROM applications WHERE id = '<app_id>';

-- Agent's recruiting credit MTD
SELECT COUNT(*) FROM applications
WHERE referral_recruiter_id = '<agent_id>'
  AND created_at >= date_trunc('month', CURRENT_DATE);

-- Manager's assigned-workload MTD
SELECT COUNT(*) FROM applications
WHERE assigned_agent_id = '<manager_id>'
  AND created_at >= date_trunc('month', CURRENT_DATE);
```

## Rules

1. **Never overwrite `referral_recruiter_id` after creation.** The credit lives with whoever
   surfaced the lead first. If a misattribution is discovered, manually correct it AND write
   an `agent_attribution_audit` row explaining the correction.
2. **`assigned_agent_id` can change** as managers transfer ownership — that's normal CRM
   behavior and shouldn't affect recruiting credit.
3. **Audit every resolution.** The trigger / edge fn writes one row to
   `agent_attribution_audit` per `/apply?ref=` resolution.
4. **Pre-licensing tracker reads both** `referral_recruiter_id` and `referral_manager_id` via
   `v_pre_licensing_tracker.credited_recruiter` (LEFT JOIN preferring the recruiter id).
