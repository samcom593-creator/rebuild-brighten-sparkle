-- wave-agent-documents — let an agent attach their own files.
--
-- MEASURED: there was no agent document store at all. storage.buckets holds
-- apex-deal-evidence (deal photos), call-recordings, and four public buckets for
-- avatars/awards/content. Nothing for the paperwork an insurance agent actually
-- has to hand in — license copy, E&O certificate, voided check, signed
-- contracting forms, ID. `deal_attachments` exists but is scoped to a deal.
--
-- Two ways in, because agents have their documents in two shapes: a FILE they
-- upload (usually a phone photo of a paper document) or a LINK to something
-- already in Drive/Dropbox. One row type handles both — storage_path xor
-- external_url — so the review queue is one list rather than two.
--
-- SECURITY, given this session closed three separate over-sharing leaks:
--   * bucket is PRIVATE. These are IDs and voided checks.
--   * an agent reads and writes only their own rows and only their own folder.
--   * a manager reads their DOWNLINE only, never the whole roster, matching how
--     deals/agentlink_book/carrier_policies are already scoped.
--   * the owner reads everything.
--   * storage policies key on the FIRST PATH SEGMENT being the owner's agent
--     id, so a crafted path cannot reach another agent's folder.

begin;

insert into storage.buckets (id, name, public)
values ('agent-documents', 'agent-documents', false)
on conflict (id) do nothing;

create table if not exists public.agent_documents (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  uploaded_by   uuid,
  kind          text not null default 'other',
  title         text,
  -- Exactly one of these is set. A row with neither is not a document, and a
  -- row with both hides which one the reviewer is supposed to open.
  storage_path  text,
  external_url  text,
  status        text not null default 'submitted',
  review_note   text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint agent_documents_one_source check (
    (storage_path is not null and external_url is null)
    or (storage_path is null and external_url is not null)
  ),
  constraint agent_documents_status_check check (
    status in ('submitted', 'approved', 'rejected', 'needs_replacement')
  ),
  constraint agent_documents_kind_check check (
    kind in ('license', 'eo_certificate', 'voided_check', 'id', 'contracting', 'other')
  )
);

create index if not exists agent_documents_agent_idx on public.agent_documents (agent_id, created_at desc);
create index if not exists agent_documents_status_idx on public.agent_documents (status) where status = 'submitted';

comment on table public.agent_documents is
  'Files an agent attaches to their own record — uploaded to the private '
  'agent-documents bucket, or linked from an external drive. See migration '
  '20260831060000.';

alter table public.agent_documents enable row level security;

-- Agent: their own rows only.
drop policy if exists agent_documents_own_read on public.agent_documents;
create policy agent_documents_own_read on public.agent_documents for select to authenticated
  using (agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid())));

drop policy if exists agent_documents_own_insert on public.agent_documents;
create policy agent_documents_own_insert on public.agent_documents for insert to authenticated
  with check (agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid())));

-- An agent may withdraw/replace their own submission, but must not be able to
-- mark it approved — that is the reviewer's call, so status is pinned here.
drop policy if exists agent_documents_own_update on public.agent_documents;
create policy agent_documents_own_update on public.agent_documents for update to authenticated
  using (
    agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid()))
    and status = 'submitted'
  )
  with check (
    agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid()))
    and status = 'submitted'
  );

-- Manager: downline only. Deliberately NOT is_agency_staff() and deliberately
-- not the whole roster.
drop policy if exists agent_documents_manager_read on public.agent_documents;
create policy agent_documents_manager_read on public.agent_documents for select to authenticated
  using (
    public.has_role((select auth.uid()), 'manager'::app_role)
    and agent_id in (select agent_id from public.my_downline_agent_ids())
  );

-- Owner: everything, including review.
drop policy if exists agent_documents_owner_all on public.agent_documents;
create policy agent_documents_owner_all on public.agent_documents for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ─── Storage policies ────────────────────────────────────────────────────────
-- Path contract: <agent_id>/<filename>. The first segment IS the owner, and
-- these policies compare it to the caller's own agent id, so a path like
-- "someone-elses-id/license.pdf" is rejected rather than merely discouraged.
drop policy if exists agent_documents_storage_own_read on storage.objects;
create policy agent_documents_storage_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'agent-documents'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.agents a where a.user_id = (select auth.uid())
    )
  );

drop policy if exists agent_documents_storage_own_write on storage.objects;
create policy agent_documents_storage_own_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'agent-documents'
    and (storage.foldername(name))[1] in (
      select a.id::text from public.agents a where a.user_id = (select auth.uid())
    )
  );

drop policy if exists agent_documents_storage_manager_read on storage.objects;
create policy agent_documents_storage_manager_read on storage.objects for select to authenticated
  using (
    bucket_id = 'agent-documents'
    and public.has_role((select auth.uid()), 'manager'::app_role)
    and (storage.foldername(name))[1] in (
      select agent_id::text from public.my_downline_agent_ids()
    )
  );

drop policy if exists agent_documents_storage_owner_all on storage.objects;
create policy agent_documents_storage_owner_all on storage.objects for all to authenticated
  using (bucket_id = 'agent-documents' and public.is_owner())
  with check (bucket_id = 'agent-documents' and public.is_owner());

commit;

-- GRANTs. RLS decides WHICH ROWS; it does not grant access to the table at
-- all. Without these every caller got "permission denied for table
-- agent_documents" regardless of how correct the policies were — caught by
-- probing as a real agent instead of trusting that the policies implied access.
begin;
grant select, insert, update on public.agent_documents to authenticated;
grant all on public.agent_documents to service_role;
commit;
