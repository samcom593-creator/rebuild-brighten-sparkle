# APEX — Full Platform Route Matrix (preflight, re-measured 2026-08-19)

Live counts this commit: **234 routes**, **175 page files**, **243 edge functions**,
5 roles (admin, manager, agent, va_manager, va), 335 DB tables.

Status vocabulary: NEW-LANG (rebuilt to the Agent-Cloud-level language) ·
CHROME-ONLY (new shell/tokens, legacy body) · LEGACY · UNPROVEN.

| Route family | Owner routes (sample) | Roles | Layout family target | Status |
|---|---|---|---|---|
| Command Center | /dashboard | admin/mgr | Home (KPI+toolbar+queue+AI briefing) | **NEW-LANG v1** (tonight; density/finish below bar) |
| Recruiting | /dashboard/recruiting, /dashboard/recruiting/hires | admin/mgr/va | Pipeline+Queue | **NEW-LANG v1** |
| Interviews | /dashboard/recruiting/interviews, /follow-ups | admin/mgr/va | Native recruiting queue | **NEW-LANG v1** (versioned actions + receipts) |
| Call Center | /dashboard/call-center | admin/mgr/va | Queue (template) | CHROME-ONLY |
| Team | /dashboard/team, hierarchy | admin/mgr | Directory+Detail | CHROME-ONLY |
| Contracting | /dashboard/contracting, /start-contracting | admin/mgr/agent | Contracting Ops | CHROME-ONLY (backend proven) |
| Production | /dashboard/production, book | admin/mgr | Reports | CHROME-ONLY |
| Analytics/Reports | /dashboard/analytics | admin | Reports | CHROME-ONLY |
| Finance | /dashboard/finances | admin | Finance | CHROME-ONLY |
| Community/Resources | community, resources, courses | all | Tools | CHROME-ONLY |
| Admin/Settings | /admin/*, settings | admin | Settings | CHROME-ONLY |
| Agent portal | /agent/*, onboarding | agent | Agent Home + Stepper | LEGACY |
| Public | /, /apply, /start-contracting, /login | public | Marketing/Funnel | LEGACY (deliberate) |

Full per-route expansion is generated, not hand-typed — see parity matrix for
the program that fills this in per phase.
