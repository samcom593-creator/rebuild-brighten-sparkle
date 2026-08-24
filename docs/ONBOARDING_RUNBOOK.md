# APEX — Onboarding, Head to Toe

*Measured live 2026-08-18; contracting re-measured and rebuilt 2026-08-24.*

---

## The 7 stages, and who does each

| # | Stage | Who acts | Automated? | Live count |
|---|---|---|---|---|
| 1 | Application lands | nobody — it fires itself | **Yes, heavily** | 792 open |
| 2 | First contact | **VA / you** | No | **415 never contacted** |
| 3 | Interview | recruiter, in Headhunter | Partly | 244 events |
| 4 | Licensing | applicant, tracked by system | Partly | 614 unlicensed / 133 licensed / 45 pending |
| 5 | Contracting | producer + contracting support | **Live flow; Google credential pending** | spreadsheet → private Discord |
| 6 | Agent created | Add Agent button | Yes | 167 agents / 55 active |
| 7 | Community | Skool invite | No | 8 members |

---

## Stage 1 — Application lands (fully automatic)

Person submits at `apex-financial.org/apply`. A row lands in `applications` and
**45 database triggers fire on insert/update**, including:

- `trg_application_discord` — posts the applicant to Discord
- `trg_auto_assign_application` + `z_default_application_manager_to_sam` — assigns an owner (defaults to you)
- `trg_applications_auto_route` — routes by licensed/unlicensed
- `trg_applications_flag_duplicates` — dedupe flag
- `trg_auto_nipr_verify` — license verification attempt
- `trg_applicant_first_dm` / `trg_telegram_autolink_application` — first outreach
- `trg_next_step_applications_insert` — enters the 19-stage Next Step engine
- `trg_apps_auto_seminar_register` — seminar signup
- `trg_high_value_applicant_alert` — pings you on a strong applicant

**You do nothing here. This part works.**

---

## Stage 2 — First contact ← THIS IS WHERE IT BREAKS

**658 of 792 open applicants (83%) are still status `new`. 415 have never been contacted at all.**

Age of that pile:

| Age | Count |
|---|---|
| 0–7 days | 5 |
| 7–30 days | 72 |
| 30–90 days | 270 |
| **90+ days** | **311** |

Only 5 are fresh. The rest are backlog. No amount of automation upstream fixes
this — it is a staffing/queue problem, not a software problem.

**How a VA works it today:** `/dashboard` → **Recruiting** → open an applicant →
Call / Text / Email buttons. Those now route through Google Voice on desktop
(they were dead `tel:` links until 2026-08-16, which is why "the buttons don't
work for her").

If Google shows **Upgrade not available**, open the VA command center and use
**Switch Google account** in the Google Voice readiness card. APEX cannot
override Google's account-eligibility decision; the recovery deliberately
opens Google's chooser instead of leaving the operator trapped on the
ineligible default Gmail account.

**Queue to work:** `/dashboard/stale-recovery` and the `UNLICENSED RECOVERY` tile
(990 ghosted 30d+ with no VA owner).

---

## Stage 3 — Interview

`/dashboard/recruiting/interviews` is the native interview queue. It keeps the
proven `hh_*` data contract, but the user stays inside APEX for confirmation,
outcomes, reschedules, hires, and the explicit onboarding handoff. Old
`/dashboard/interviews` bookmarks redirect here with their query string.

---

## Stage 4 — Licensing

Tracked on the application. Automatic transitions that already work:

- `trg_application_paid_auto_enroll_license` — course enrollment when they pay
- `trg_auto_kickoff_new_licensee` — kickoff when they pass
- `trg_auto_advance_licensed_to_contracting` — moves them to contracting
- `trg_bot_alert_newly_licensed` / `trg_notify_sam_licensing` — alerts you

**Watch:** `LICENSE PUSH` tile (638 ready for a licensing push).

---

## Stage 5 — Contracting

The workflow is now connected head to toe:

- Share `apex-financial.org/start-contracting`.
- A valid submission becomes one durable `contracting_intakes` row.
- Exactly two jobs are queued: the contracting spreadsheet and the private
  contracting Discord. There is no AgentLink invite or handoff.
- Staff monitor both provider receipts at `/dashboard/contracting`.
- The spreadsheet write is read back from Google before it reports Delivered;
  Discord reports Delivered only after the webhook response.

The admin monitor also exports the spreadsheet's A–I column order
(First, Last, NPN, Agent Number, Phone, Email, blank, Advance, Organization) so a
row pastes in without retyping.

**Remaining external credential:** direct spreadsheet writes need a Google service
account JSON in the Edge Function secret `GOOGLE_SERVICE_ACCOUNT_JSON`, and that
service account must be Editor on the Agents sheet. Until that credential is
provided, the delivery receipt says `not_configured`; it never shows fake green.
Until then, the admin CSV export is the honest fallback and Discord still has
its own independent receipt.

---

## Stage 6 — Agent created

`/dashboard` → **Add Agent** (sidebar) → first/last/email/phone/NPN.

Fires `add-agent`, which creates the agent row and posts to the contracting
channel when configured. `welcome-new-agent` then sends the course + Discord
invite. That function was **dead at boot until 2026-08-14** — no new agent got a
welcome email before that date.

Also live: a trigger auto-sends course + Discord emails when an agent flips to
`onboarding_stage='live'` or `status='active'` with `license_status='licensed'`.

---

## Stage 7 — Community

Skool (`skool.com/apex-financial-group`). Manual invite — Skool has no API.

**8 members are loaded**, and `ACTIVE AGENTS` on your dashboard now reads that
number rather than the 42 contract flags.

Three Skool members have **no record anywhere in APEX**: Lorenzo Farfan,
Jontay T, Billy Kalonji. They are in the community but never entered the
pipeline.

---

## Onboarding ONE person, end to end (the click path)

1. They apply at `apex-financial.org/apply` — or you use **Add Agent** to skip ahead.
2. Automatic: Discord post, owner assignment, routing, dedupe, NIPR attempt, first DM, Next Step entry.
3. **You/VA:** `/dashboard` → Recruiting → open them → Call / Text / Email.
4. Book the interview → runs in Headhunter.
5. Licensed? → licensing auto-advances them to contracting.
6. Share `/start-contracting` → monitor `/dashboard/contracting` → verify spreadsheet and Discord receipts. Use Export Spreadsheet only while the Google credential is absent.
7. **Add Agent** → creates the agent, sends course + Discord invite.
8. `/dashboard/recruiting/training` → complete APEX Training → Certification →
   Launch Ready → First Sale. Each milestone writes a durable journey receipt.
9. Invite to Skool → they count as an active agent.

---

## Remaining external dependencies

| Blocker | Unlocks | Needs |
|---|---|---|
| Google service-account JSON | direct writes to the Ethos sheet | JSON + share the sheet with it |
| Skool member export | keeps the active-agent count current | Skool → Members → Export CSV |

---

## The real bottleneck, stated plainly

The machine is built. 45 triggers fire on every application, licensing advances
itself, agent creation sends its own emails.

**415 people have never been contacted and 311 have been waiting 90+ days.**
That is not a missing feature. It is a queue nobody is working.
