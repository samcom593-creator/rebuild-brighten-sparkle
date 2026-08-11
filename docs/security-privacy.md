# Security and Privacy

## Enforcement

- Authentication and authorization are server-side. Hidden navigation is not access control.
- Security-definer RPCs fix `search_path`, derive `auth.uid()`, and resolve contact recipients from record IDs.
- Service-role keys remain server-only; `VITE_` variables are public by definition.
- New canonical, deal, outbox, contact, and compensation tables use RLS and least-privilege grants.

## Contact safeguards

- Browser input cannot choose a different recipient than the authorized record.
- Calls are logged before the device handoff.
- SMS validates phone, phone-bad state, recorded application consent, carrier, length, and opt-out state.
- Email validates address and the unsubscribe ledger immediately before provider submission.
- Idempotency keys and provider receipts prevent blind duplicate retries.
- “Provider accepted” never means “delivered.” Fallback launch never means “sent.”

## PII

Client name, phone, DOB, policy/application number, beneficiaries, and evidence never enter community/Discord/Skool payloads. Outbox payloads carry internal IDs and redacted classifications; provider workers resolve the minimum required data server-side. Logs and errors redact email/phone and never include secrets or message bodies.

## Files and compensation

Evidence is private, MIME/size constrained, owner/admin scoped, and not treated as clean before scanning/manual review. Compensation mutations come only from the controlled service-role import with version, hash, approval, effective date, and audit trail.

## Release gate

Staging must test anonymous, allowed, unrelated manager/agent, VA, and admin cases. Any cross-scope read/write, duplicate send, PII leak, or missing opt-out check blocks release.
