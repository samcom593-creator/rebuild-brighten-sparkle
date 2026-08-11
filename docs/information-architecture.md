# APEX Information Architecture

## Navigation rule

Persistent desktop navigation contains at most ten role-relevant destinations. Mobile has one labelled `Actions` control, then the same navigation and quick actions in a sheet. Search and contextual links may expose deeper authorized tools without adding permanent sidebar clutter.

| Workspace | Primary questions | Canonical entry | Consolidates |
|---|---|---|---|
| Command Center | What requires action now? | `/dashboard` | role dashboards, alerts, shortcuts |
| Recruiting | Who is in the funnel and what is next? | `/dashboard/recruiting` | applications, headhunter, interview recovery, licensed/unlicensed queues, onboarding ladder |
| Call Center | Who should be called and what happened? | `/dashboard/call-center` | recruiting call queues/sessions/dispositions |
| Team | Who owns whom and who is active? | `/dashboard/team` | agent roster, hierarchy, access/status |
| Contracting | Which carrier requests block launch? | `/dashboard/contracting` | contracts, transfers, SureLC handoffs |
| Production | What was submitted, approved, placed, or reversed? | `/dashboard/production` | deal entry, deals, book mappings, ledger |
| Analytics | What reconciled operational trend needs action? | `/dashboard/analytics` | business analytics, leaderboard, scorecards |
| Community | What should the agency see and what delivered? | `/dashboard/community` | announcements, news, wins/deals, content delivery |
| Resources | What training/reference is available? | `/dashboard/resources` | course catalog, onboarding course, training hub |
| Admin | Is configuration, security, or integration health blocked? | `/dashboard/admin` | setup, system health, automation, audit |

Agents see Command Center, Contracting, Production, Analytics, Community, and Resources. Staff roles receive the workflow surfaces necessary for their assigned responsibilities. Admin alone receives Admin. Route authorization remains the enforcement layer; hiding a link is not permission.

## Global actions

- **Add Agent:** the five-field quick-add path. It creates one durable APEX toolkit identity/journey and does not imply application, license, appointment, invite, payment, or vendor success.
- **Submit Deal:** a five-step native flow with server drafts, private evidence, premium review, durable receipt, and independent delivery status.

## Legacy route policy

Legacy URLs are redirected, not deleted, until telemetry and reconciliation prove they are unused. Redirects preserve query strings and annotate navigation state with the migrated source. Legacy route components may remain temporarily for rollback and deep-link compatibility, but they are not persistent destinations.

## Page composition

Each workspace follows: one plain-language title, at most three actionable summary signals, primary queue/table, explicit filters/timezone, contextual detail drawer or page, and visible empty/error/freshness state. No browser-computed canonical totals. Tables paginate or virtualize and retain identity/action columns on narrow screens.

## Accessibility and responsive contract

- Visible form labels; icon-only controls require accessible names.
- Minimum 44×44 px interactive targets.
- Keyboard focus remains visible and dialogs trap/restore focus.
- Ordinary motion remains 120–200 ms and respects reduced motion.
- Validate 360×800, 390×844, 768×1024, 1366×768, 1440×900, and 1920×1080.
