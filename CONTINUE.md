# APEX Onboard — Repair Pass v4 — Status (2026-06-08)

## Shipped this run (8 priorities)

| P# | Title | Commit |
|----|-------|--------|
| P1 | Old Applicants (server views + paginated UI + Poke trigger) | `c9429b77` |
| P2 | Pre-licensing tracker (stale banner + view) | `43a7cd5b` |
| P3 | Referral attribution + MyReferralLinkCard + canonical doc | `72c7ea9b` |
| P4 | Leaderboards: recruiter credit + view + agent visible | `e9174b8f` |
| P5 | $50K+ Watchlist toggle + agents.next_action_text columns | `8abe52a0` |
| P7 | Lead Payments canonical lead_type_tier column | `c4048030` |
| P8 | Notifications Show archived toggle | `801d53c1` |
| P9 | Poke webhook receiver edge fn v1 (acks `ack:<kind>` replies) | pending |

## Deferred / partial

- **P6 (perf sweep)** — covering indexes for production + applications already
  shipped in prior session (idx_deals_leaderboard_covering, idx_applications_*).
  No further per-page perf rewrites this run.
- **P10 (visual polish)** — banned-language guard runs pre-commit and passes
  on every commit; no additional polish this run.
- **P11 (ManyChat)** — credential gate. Run
  `python3 ~/business-ops/manychat-lead-push/push_apex_leads.py` for dry-run.

## Carried-forward Sam-side blockers

1. **AgentLink reauth** — `~/business-ops/agentlink-reauth/grab_cookie.sh`
   reconciles 20-day production undercount
2. **XCEL Gmail OAuth seed** — relights `/dashboard/pre-licensing` data
3. **Poke API token** — drop at `~/.config/apex-creds/poke.token` to activate
   the 4 wire-ups (trigger already enqueues to poke_queue; pusher fn not built)

## Resume command

```
Open Claude Code at /Users/samjames/projects/rebuild-brighten-sparkle
Re-paste v4 prompt + "Continue from CONTINUE.md and git diff. Do not restart."
```

Next priority: Poke pusher edge fn that drains poke_queue → Poke API.
