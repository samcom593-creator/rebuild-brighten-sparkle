# APEX Slack primary-app rollout receipts — 2026-08-26

## Outcome

Production rollout is complete except for one Slack-admin-only containment step: the two superseded public candidate channels still need to be archived or converted to private. The live health endpoint intentionally remains red on that exact condition.

- KJ Vaughns and seven active direct reports remain active, undeactivated, and in the existing hierarchy/production model.
- All eight are active Slack-only exclusions; none has an invite outbox row or verified Slack identity.
- Applicant auto-invites are disabled, the application confirmation no longer exposes a shared join link, and no applicant invite has delivered.
- Candidate traffic is routed to private, bot-joined `#apex-recruiting-staff` (`C0BSPC0P2AX`) and `#apex-licensing-staff` (`C0BSXH22GL9`).
- Sam is the first admin-verified identity: agent `7c3c5581-3544-437f-bfe2-91391afb217d` ↔ Slack `U0BSKUSDXE1`, exact email match, verified link `2d09cb00-87b4-42db-91c6-b5a2b16a2f6f`.
- All 16 remaining inviteable active hires received one idempotent email invitation; all 16 have provider message IDs and zero failures.

## Approved Slack exclusions

| Agent | Agent ID | Production state |
|---|---|---|
| KJ Vaughns | `431dff0d-7c82-4134-a85e-457e5226fc7f` | active; manager remains Sam |
| Alonzo Johnson | `45eebd82-7d41-438a-a7aa-45bcbe08d2bc` | active; manager remains KJ |
| Daniel Gonzalez | `c7ffeea3-0122-4f22-884e-54d8a3a645e5` | active; manager remains KJ |
| David Ladd | `d607c992-7625-4e41-81de-b06c0a5c8161` | active; manager remains KJ |
| Jaden Selvaraj | `3523dc25-61e0-4ce3-bb97-197bbf1a049a` | active; manager remains KJ |
| Marquay Vaughns | `021f1686-2560-4b05-9281-c3a66d23c1f2` | active; manager remains KJ |
| Pranav Kodali | `20344eff-2a14-4b9f-bae2-fabc87f55c07` | active; manager remains KJ |
| Xaviar Watts | `19e7f9d8-0277-43f9-a90c-3e326cca4403` | active; manager remains KJ |

## Hired-agent invitation receipts

| Hired agent | Resend provider message ID |
|---|---|
| Aisha Kebbeh | `6b11edc8-3ee6-49d6-81ec-3fb76f0055d4` |
| Christian Ramirez | `aacd6914-c427-4e1b-aa4c-165b6e8ef061` |
| Chukwudi Ifediora | `8d89abf0-6b82-4869-9670-c1a1bf3124ed` |
| Cyril Onyia | `155193e2-41f4-4bb1-a1fe-5190fbdace1b` |
| Demarkis Betts | `73a6387f-b9f9-4493-8080-6564008e13af` |
| Isaac Foster | `ad752307-4969-4d49-9b64-570816ef963c` |
| Isaiah Caldwell | `95a3754a-dfa8-4ccc-b09a-bc5f93a4c968` |
| Jerald Winborne | `f600827a-5dd6-477e-a878-5c34477d6aa5` |
| Jontay Taylor | `a6fe6ce3-3226-44bd-85d0-ae9531df0569` |
| La’Nyia Briggs | `92a02541-5d86-428d-84e2-431885108413` |
| Luiza Tacchi | `f931bc4c-bfb9-482f-a0bc-de0a8e6f6893` |
| Marcos Castellanos | `2f13753a-44d4-4bfc-8ddc-41966a91fcf4` |
| Michael Kayembe | `4f3130cc-e848-45be-95a8-30c97dd5dc5b` |
| Obiajulu Ifediora | `1f4bcc02-977b-4588-b181-a4a883d1280c` |
| Tre'va Tribble | `1db4bf3e-e0f0-4fbd-8e93-0fb43e32a30a` |
| Wendell Funderburg | `b9ca263c-8785-4290-bea8-c485363ffe61` |

Provider IDs are read from `public.v_slack_invite_receipts`, backed by `delivery_attempts` and `outbox_events`. The two rows initially handled by the stale dispatcher were retried only after the corrected hired-only dispatcher was live; both settled delivered on attempt two.

## Live proofs

- `numbers-reminder`: anonymous dry-run `401`; wrong-token forced call `401`; configured bot-token dry-run `200` with aggregate-only data (`20` licensed candidates, `16` due, no identity fields returned).
- Candidate destinations: `2/2` private, reachable, bot-joined; all `9/9` Slack routes healthy; `7/7` enabled destinations reachable.
- Invites: `16/16` delivered, `16/16` provider receipts, `0` failed/manual/dead-letter after reconciliation.
- Audience: `8` active exclusions, `0` excluded links, `0` excluded invite rows, `0` applicant invites delivered, `1` verified eligible identity.
- Identity rejection paths: wrong email `400`; excluded KJ claim `403`; duplicate Slack-user conflict `409`.
- Regression: Deno checks passed for five changed Edge Functions; `33/33` focused Vitest tests passed; production build passed.

## Remaining Slack-admin action

Archive or convert both superseded channels to private:

- `#apex-recruiting-growth` — `C0BSTVB98DA`
- `#licensing-academy-support` — `C0BS9F2V3M5`

Current live health is deliberately `HTTP 502`, `ok:false`, with the sole reason `legacy public candidate channels are not archived or private`. Re-run `slack-integration-health` after the Slack admin action; it is designed to become green only when both IDs report archived or private.
