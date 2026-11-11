#!/bin/bash
# apex-doctor drop-in #54 — applicant lane (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12).
#
# INSTALL: this copy is staged in the website repo because the package worktree could not
# write outside itself. Install it as ~/business-ops/scripts/apex-doctor.d/54-applicant-lane.sh
# (chmod +x); the integrator registers it in apex-doctor.sh (APEX_DROPIN_EXPECTED).
#
# Reads ONE row from public.v_applicant_lane_pkg1_health (scalar subqueries over a
# SECURITY DEFINER function: one row in every state, it cannot go blank-green) and prints
# ONE verdict line. Graded operands are things the package controls, counted only for
# activity after fn_anchor_pkg1_cutoff(), so history from before the fix cannot pin it
# yellow. Standalone; bash 3.2 compatible (launchd runs /bin/bash 3.2). Always exits 0.
#
#   🔴 CRITICAL  structure regressed: the send gate or the claim function is gone, the
#                retry drain cron (next_step_retry_drain) is missing or inactive, the old
#                follow-up cron (apex-followup-emails-daily) is back, the sweep lost its
#                PKG1 gate, the dead "reply STOP" mailto is back in a PKG1 stage row, or the
#                applied / licensed_book_call / call_booked cadence changed.
#   🟡 WARN      a ladder email in 24h went out with no live Reply-To recorded; a retryable
#                or deferred row is more than 1h past its not_before (the drain is not
#                running); an applicant-stage email in 7d reached a login whose suspension
#                was already open; a recipient got 2+ automated applicant emails on one local
#                day (ladder + day-0 welcome); or a linked Telegram applicant is not opted out.
#   🟢 OK        none of the above, with the counts (sends, skips by reason, deferrals,
#                retries given up, re-applications made live, post-call and re-arm sends).
#   ⚪ UNKNOWN   the view could not be read (not applied yet, credentials, network). Never green.
#
# Not measured here: the day-0 welcome's Reply-To (set in submit-application code, not
# recorded per send); welcome.test.ts and src/tests/lib/applicantLanePkg1.test.ts hold it.
# LANE54_FIXTURE=<file with a bot-sql JSON response> replaces the fetch (for tests).
URL_FILE="$HOME/.config/apex-creds/bot-sql.url"; TOK_FILE="$HOME/.config/apex-creds/bot-sql.token"
say() { echo "$1"; exit 0; }
command -v python3 >/dev/null 2>&1 || say "⚪ #54 applicant lane UNKNOWN: python3 missing"
OUT=""
if [ -n "${LANE54_FIXTURE:-}" ]; then
  OUT=$(cat "$LANE54_FIXTURE" 2>/dev/null)
else
  [ -r "$URL_FILE" ] && [ -r "$TOK_FILE" ] || say "⚪ #54 applicant lane UNKNOWN: bot-sql credentials missing"
  URL=$(cat "$URL_FILE"); TOK=$(cat "$TOK_FILE")
  BODY='{"query":"select * from public.v_applicant_lane_pkg1_health"}'
  i=1
  while [ $i -le 3 ]; do
    OUT=$(curl -s -m 60 -X POST "$URL" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data-binary "$BODY" 2>/dev/null)
    if printf '%s' "$OUT" | grep -q '"ladder_email_no_reply_to_24h"'; then break; fi
    OUT=""; sleep $((i * 2)); i=$((i + 1))
  done
fi
[ -n "$OUT" ] || say "⚪ #54 applicant lane UNKNOWN: v_applicant_lane_pkg1_health unreadable after 3 attempts (migration 20261112000180 applied?)"
printf '%s' "$OUT" | python3 -c '
import json, sys
try:
    g = json.load(sys.stdin)["rows"][0]
    gate = g["gate_fn_present"] is True
    claim = g["claim_fn_present"] is True
    drain = g["drain_cron_active"] is True
    old_cron = g["followup_cron_present"] is True
    sweep = g["sweep_gate_present"] is True
    mailto = int(g["dead_mailto_pkg1_stages"])
    cadence = g["cadence_ok"] is True
    tg = int(g["telegram_linked_not_optout"])
    no_reply = int(g["ladder_email_no_reply_to_24h"])
    overdue = int(g["retry_overdue_1h"])
    pending = int(g["retry_pending"])
    susp = int(g["suspended_messaged_7d"])
    double = int(g["same_day_double_7d"])
    welcome = int(g["welcome_sent_24h"]); ladder = int(g["ladder_emails_24h"])
    skips = g.get("skips_7d") or {}
    if isinstance(skips, str):
        skips = json.loads(skips)
    deferred = int(g["deferred_7d"]); gave_up = int(g["gave_up_7d"])
    reapp = int(g["reapplications_live_since"])
    postcall = int(g["postcall_sent_since"]); rearm = int(g["rearm_sent_since"])
    other_mailto = int(g["dead_mailto_other_stages"])
except Exception as e:
    print("⚪ #54 applicant lane UNKNOWN: row did not parse (%s)" % type(e).__name__); sys.exit(0)
skip_txt = ", ".join("%s %s" % (k, v) for k, v in sorted(skips.items())) or "none"
ctx = ("24h: %d welcome, %d ladder emails | 7d: skips (%s), %d deferred, %d gave up after 3 tries, %d pending retry | "
       "since cutoff: %d re-applications live, %d post-call, %d re-arm sends | other stage rows still storing the dead mailto: %d (stripped at send)") % (
       welcome, ladder, skip_txt, deferred, gave_up, pending, reapp, postcall, rearm, other_mailto)
crit = []
if not gate: crit.append("fn_next_step_send_gate is missing (suspended, bounced and hired people are no longer screened)")
if not claim: crit.append("fn_next_step_claim is missing")
if not drain: crit.append("cron next_step_retry_drain is missing or inactive (rate-limited emails are lost again)")
if old_cron: crit.append("cron apex-followup-emails-daily is back (a second applicant drip)")
if not sweep: crit.append("fn_next_step_nudge_sweep lost its PKG1 gate (post-call and re-arm are no longer forward-only)")
if mailto > 0: crit.append("%d PKG1 stage row(s) carry the dead reply-STOP mailto again" % mailto)
if not cadence: crit.append("applied / licensed_book_call / call_booked cadence changed (expected hour:24,72,168 and hour:24)")
warn = []
if no_reply > 0: warn.append("%d ladder email(s) in 24h with no live Reply-To recorded (old dispatcher deployed?)" % no_reply)
if overdue > 0: warn.append("%d retryable/deferred row(s) more than 1h past due (drain not running)" % overdue)
if susp > 0: warn.append("%d applicant-stage email(s) in 7d reached a suspended login" % susp)
if double > 0: warn.append("%d recipient-day(s) in 7d with 2+ automated applicant emails" % double)
if tg > 0: warn.append("%d applicant(s) with a linked Telegram chat are not opted out" % tg)
if crit:
    print("🔴 #54 applicant lane CRITICAL: %s | %s" % ("; ".join(crit), ctx))
elif warn:
    print("🟡 #54 applicant lane WARN: %s | %s" % ("; ".join(warn), ctx))
else:
    print("🟢 #54 applicant lane OK: gate, claim, drain, one drip and reply path intact | %s" % ctx)
'
exit 0
