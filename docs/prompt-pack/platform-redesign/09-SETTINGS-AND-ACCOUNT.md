# 09 · Settings, profile, notifications, support desk, install

Paste after `00-MASTER.md`. Branch `redesign/settings-account`. Worktree `../rbs-settings`.

## Goal

Low traffic, high trust: the places people change their password, their notifications and their profile
must be the calmest screens in the app, with every control labelled and nothing that can be done by
accident.

## Read first

- Pages: `src/pages/Settings.tsx` (one component behind `/dashboard/settings`, `/settings/agency` (admin),
  `/settings/notifications`, `/settings/security`, `/settings/billing` (admin), `/settings/nova-pro`),
  `src/pages/ProducerProfile.tsx` (`/dashboard/profile`), `src/pages/HelpCenter.tsx` (`/dashboard/help`,
  `?tab=desk` is the support desk the sidebar links), `src/pages/Install.tsx` (`/install`, shared with area
  02), `src/pages/NotificationHub.tsx` (find its route in `ROUTE_BOARD.md`; it carries five unnamed selects),
  the `AGENT_CLOUD_ACCOUNT_NAV` group in `agentCloudNavigation.ts`.
- `docs/security-privacy.md`, `docs/multi_device.md`, `docs/siri_shortcut_setup.md`.
- Guards: `check:credential-minting`, `check:enumeration-oracle`, `check:uncredentialed-pii-response`,
  `check:control-labels`, `check:icon-button-labels`, `check:blocking-modal`, `check:external-link-noopener`.

## Scope

The pages above, their components under `src/components/settings/**`, tests, `ROUTE_BOARD.md`, the shipped
log. No auth flow changes; no billing provider calls from tests or the harness (never a real charge).

## Guardrails

- Security: password and session actions are two-step with the consequence in words ("This signs out your
  other devices"). No enumeration of emails; error messages the same for found and not found.
- Billing (admin): read-only display plus links to the provider; nothing that charges from this UI without
  the provider's own confirmation page.
- Notifications: every toggle labelled by what it sends and when ("Text me when a recruit books"), with the
  channel named; a test send only through the existing mocked transport in the harness.
- Profile: the public pieces (the agent's landing page, calling card) preview before they publish.

## Required work

1. **Settings.** One left list (desktop) or one top list (phone) of sections; each section one card of
   labelled rows: label 16px, value or control on the right at 44px. Save per section with a visible
   "Saved" state. Destructive rows at the bottom in a "Danger" fold, two-step.
2. **Notifications hub.** Tiles: Unread, Today, Needs action, Muted. One list with a status pill; mark
   read and mute as row actions; preferences behind one Filters-style popover with labelled controls (the
   five unnamed selects get names; the ratchet falls).
3. **Producer profile.** Name, photo, phone, licence, states, public link, in that order, each row
   editable in place; a preview card of what the public sees.
4. **Support desk.** One form (what happened, where, screenshot) and the list of past requests with status
   pills. The chat widget, if any, stays behind one button.
5. **Install.** Shared with area 02; here only confirm the signed-in variant shows the same one-button page.
6. **Measure.** Unnamed controls before/after (must fall), taps to change a password, taps to mute a
   notification.

## Verification

- Focused tests, `npm test`, `npm run typecheck:count` ≤ baseline, `npm run build`, `npm run verify:core:all`.
- Harness screenshots at 390 and 1440, dark and light, as agent and admin: each section, the danger fold
  open with its confirm, the notifications hub empty and full, the profile preview.
- Council passes; the First-timer lens checks every label; the Engineer lens checks the security guards.

## Done means

- [ ] Every control on these pages has a visible label; the control-labels ratchet fell.
- [ ] Every destructive or security action is two-step with the consequence in words.
- [ ] Notifications hub meets the contract; profile previews before publishing.
- [ ] Before→after table, screenshots, shipped-log entry, `SHIPPED_TOTAL` matches.

## Acceptance output

1. Files changed.  2. Verification performed.  3. Council verdict.  4. Screenshots.  5. Follow-ups.
