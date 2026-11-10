-- MP-LICENSING-PROOF (2026-11-10)
-- Sam: "if they're unlicensed they are prompted to buy the course and submit a
-- screenshot to book a licensing call." The screenshot (proof they bought the XCEL
-- course) is stored here; submitting it unlocks the licensing-call booking on the
-- post-apply page. Applicants are usually anon on /status/:id, so writes go only
-- through the submit-licensing-proof edge function (service role) — never direct.

create table if not exists public.licensing_course_proofs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid,
  screenshot_path text not null,
  file_size integer,
  content_type text,
  status text not null default 'submitted',   -- submitted | verified | rejected
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  note text
);
create index if not exists lcp_application_idx on public.licensing_course_proofs(application_id, submitted_at desc);

alter table public.licensing_course_proofs enable row level security;
-- Admins/managers read; nobody writes directly (the edge function uses service role).
drop policy if exists lcp_admin_read on public.licensing_course_proofs;
create policy lcp_admin_read on public.licensing_course_proofs for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role) or public.has_role(auth.uid(), 'va_manager'::app_role));

-- Private bucket for the screenshots. Not public — only the edge function (service
-- role) writes, and staff read through signed URLs.
insert into storage.buckets (id, name, public)
  values ('licensing-proofs', 'licensing-proofs', false)
  on conflict (id) do nothing;

-- Whether this applicant has a proof on file — anon-safe, SECURITY DEFINER, used by
-- the post-apply page to decide if the licensing-call CTA is unlocked. Returns only a
-- boolean + timestamp, never the image path, so it leaks nothing.
create or replace function public.has_licensing_proof(p_application_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'submitted', exists (select 1 from public.licensing_course_proofs where application_id = p_application_id),
    'submitted_at', (select max(submitted_at) from public.licensing_course_proofs where application_id = p_application_id)
  );
$$;
revoke all on function public.has_licensing_proof(uuid) from public;
grant execute on function public.has_licensing_proof(uuid) to anon, authenticated, service_role;
