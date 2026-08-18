# APEX — PROVE EVERY FUNCTION WORKS
*Verification prompt. Paste at the top of a session whose job is to establish, with evidence, that the APEX platform actually works. v1 — 2026-08-18*

---

## 0. THE RULE THAT MAKES THIS PROMPT WORTH ANYTHING

**A prompt cannot guarantee software works. Only a failing test can.**

Your job is not to assert that functions work. Your job is to produce, for each
function, an artifact a skeptic can re-run. If you cannot produce that artifact,
the correct output is `UNPROVEN` — never `working`, never `looks good`, never
`should be fine`.

Three verdicts exist. There is no fourth.

| Verdict | Means |
|---|---|
| `PASS` | You executed a check, it succeeded, AND you proved the check can fail |
| `FAIL` | You executed a check and it failed. Record the exact output. |
| `UNPROVEN` | You could not execute a check. Say why. This is an acceptable answer. |

`UNPROVEN` is not failure. Reporting `PASS` on something you did not execute is.

---

## 1. THE INVENTORY YOU MUST COVER

Measured 2026-08-18 in `~/projects/rebuild-brighten-sparkle`:

| Surface | Count |
|---|---|
| Routes in `App.tsx` | 233 |
| Page components | 157 |
| Edge functions | 241 |
| Guard scripts (`scripts/check-*.mjs`) | 50 |
| Test files | 45 |
| DB tables | 335 (334 RLS-enabled) |
| Roles | admin, manager, agent, va_manager, va |

Re-measure these first. If your numbers differ from the table, the table is stale
— report the delta, do not silently adopt either number.

---

## 2. DO NOT REBUILD WHAT EXISTS

This repo already has the verification spine. Use it before writing anything new:

```bash
npm run verify:core            # 50 guards, wired into .husky/pre-commit
node scripts/route-smoke.mjs   # pings every public route on prod
```

Adding a 51st guard that duplicates guard #12 is waste. Extend, or explain why not.

---

## 3. THE SIX FAILURE MODES THAT PRODUCED FALSE PASSES HERE

Every one of these actually happened on 2026-08-17/18 and each produced a
confident, wrong "verified". Check yourself against this list before reporting.

**1. Same-line `grep` cannot read JSX.**
A JSX element spans lines. `grep -n 'size="icon".*aria-label'` misses attributes
on other lines of the same element. This inflated one count 93 vs 47, claimed 9
images lacked `alt` when 0 did, and flagged an already-accessible component.
→ Parse elements, or state the number is an upper bound.

**2. `grep -c` counts LINES, not occurrences.**
Minified JS is one line, so `grep -c` returns 1 no matter how many matches exist.
→ `grep -o … | wc -l`.

**3. A guard that scans raw source counts its own comments.**
A ratchet counted the string it documented, so every wave traded a real violation
for a phantom and the count never moved. → Strip comments before counting — but
do NOT blank string bodies, or you hide the very thing you are counting.

**4. `$?` after a pipe is the pipe's status.**
`node check.mjs | head -1; echo $?` reports `head`'s exit code. A failing guard
printed `exit=0`. → Redirect to a file, then read `$?`.

**5. A mutation test that never mutated.**
A `python -c` replace with an embedded `\n` silently matched nothing; the "RED"
case ran against an unmutated tree and passed. → Assert the mutation LANDED
(grep the file, check the count changed) BEFORE trusting the verdict.

**6. Verifying the wrong surface.**
Hours of UI work were verified with logged-out screenshots. `Index.tsx:73`
redirects authenticated users to `/dashboard`, so the owner structurally never
sees the landing page that was being "verified". → Verify as the ROLE that uses
the surface.

---

## 4. DEPLOY IS NOT LIVE. GREEN IS NOT LIVE.

- A successful `git push` proves nothing about production.
- `post-deploy-smoke.yml` sleeps **90 seconds** then hits prod. If Vercel takes
  longer, it smoke-tests the PREVIOUS deployment and reports success.
- A CI check named in a ruleset can be bypassed on direct pushes to `main`.

**To prove something is live:** fetch the production asset and find your change
in it, or render the page and read the value. Bundle hash changing is necessary,
not sufficient — pages are lazy-loaded into separate chunks.

```bash
curl -s https://apex-financial.org | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
# then fetch the chunk that owns your change and grep it
```

---

## 5. HOW TO PROVE EACH CLASS

### 5.1 Routes (233)
`route-smoke.mjs` covers PUBLIC routes. Authenticated routes need a session.

Mint one without a password:
```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"magiclink","email":"<user>"}'
```
The link is at `.action_link` (top level), NOT under `.properties`.

Drive it with Playwright (available at
`~/business-ops/discord-support-bot/node_modules/playwright`; the script must
live in that directory to resolve the module).

For each route record: HTTP status, final URL after redirects, whether the shell
rendered vs a real view, console errors, and **the role you were signed in as**.

A route is not PASS because it returned 200 — an SPA returns 200 for a route that
renders nothing.

**Wait for the data.** Screenshots at 7s showed `$0` and `0` on KPIs that read
correctly at 25s. A number you photographed mid-load is not a bug you found.

### 5.2 Edge functions (241)
Probe with a body that FAILS VALIDATION so nothing is sent, created, or charged.

```
500 + "module not found"  → dead at boot, handler never ran
400/401 with its own message → alive, validation reached
200 → alive
```

**Never probe blast/send functions with a valid payload.** `send-batch-blast`,
`send-bulk-notification-blast`, `send-winback-campaign` and similar will email
real people. Deploying is safe; invoking is not.

For those, read `function_edge_logs` instead:
```sql
select countIf(event_message like '%| 500 |%') as e500,
       countIf(event_message like '%| 200 |%') as ok, count(*) as total
from logs where source='function_edge_logs' group by ...
```

### 5.3 Database (335 tables)
Verify the WRITE path, not the presence of a column. `synced_at IS NULL` counts
rows lacking a timestamp — it does not mean work is stuck. Give every operand a
direction before it reaches a human.

RLS: prove a policy DENIES. A policy that has never refused anything is unproven.

### 5.4 UI states
For each critical page: loading, empty, error, permission-denied. Build the
failure state and look at it. `isLoading &&` existing in source is not proof it
renders correctly.

---

## 6. WHAT "GUARANTEE" ACTUALLY BUYS YOU

You cannot guarantee 233 routes × 5 roles × 2 themes. That is 2,330 states and it
is not a session's work. What you CAN do, in order of value:

1. **Make regressions impossible to merge** — a guard, proven to fail, wired into
   `verify:core` + pre-commit. This is worth more than any one-time sweep,
   because it holds after you leave.
2. **Prove the critical paths** end to end, as each role.
3. **Report the rest as `UNPROVEN` with counts**, so the gap is visible instead
   of implied.

Ranked critical paths (money and blocked-work first):
1. Login → dashboard, per role
2. Public application submit → row lands → notification fires
3. Deal submission → `agentlink_book` → dashboard KPI moves
4. Contracting link issue → intake row → export
5. VA queue: assign → work → submit → QA
6. Notification fan-out (email / Discord / ntfy / SMS) with per-channel receipts

---

## 7. REQUIRED OUTPUT

A table. One row per item. No prose verdicts.

```
| Surface | Item | Role | Verdict | Evidence (command + observed output) | Notes |
```

Then:
- `PASS` / `FAIL` / `UNPROVEN` counts that sum to the inventory
- Every `FAIL` with exact reproduction
- Every `UNPROVEN` with the specific reason
- Guards added, each with its proven-red output
- What is now impossible to regress, and what is still only spot-checked

**Banned in the report:** "should work", "looks good", "mostly", "verified" with
no command beside it, and any count you did not personally measure this session.

---

## 8. STOP CONDITIONS

Stop and report rather than pressing on if:
- an action would send real outbound to real recipients
- an action would delete or overwrite production data without a backup
- a fix requires weakening a security control (RLS, auth gate, branch protection)
- you find a data-exposure bug — report immediately, do not batch it

---

**Hold the Standard. Average is the disease.**
