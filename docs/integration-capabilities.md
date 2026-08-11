# Integration Capabilities

Capability state is data, not optimistic UI copy. Values are `supported`, `not_configured`, or `unsupported`; health is `healthy`, `degraded`, `failed`, or `disabled`.

| Provider | Read | Write | Current safe behavior |
|---|---|---|---|
| Supabase | Required | Required | First-party readiness dependency |
| Resend email | N/A | Configured by secret | Provider receipt recorded; delivery unconfirmed |
| Carrier email-to-SMS | Carrier-dependent | Conditional | One verified gateway only; otherwise device fallback |
| Discord | Existing adapter | Existing adapter | Redacted deal event only |
| AgentLink/InsuraCloud | Mirror/read | Existing controlled outbox | Imported rows never echo back |
| Skool | Reference/manual | No verified general post API | `manual_action_required`; never scrape/fake success |
| Evidence scanner | N/A | Not configured | Private upload remains pending/manual review |
| Workbook comp sync | File input | Service role only | Website is read-only; signed importer remains pending |

Secrets are environment references, never table payloads. Vendor failures do not make the primary business transaction disappear.
