-- Release-grade assistant interview intake receipts.
-- A browser retry must converge on the same manual interview instead of
-- creating a second booking and sending a second confirmation.

alter table public.manual_interview_entries
  add column if not exists source_request_id uuid;

comment on column public.manual_interview_entries.source_request_id is
  'Client-generated idempotency key for token-gated assistant interview intake. Null for legacy/admin-created rows.';

create unique index if not exists manual_interview_entries_assistant_request_uniq
  on public.manual_interview_entries (assistant_token_id, source_request_id)
  where assistant_token_id is not null and source_request_id is not null;
