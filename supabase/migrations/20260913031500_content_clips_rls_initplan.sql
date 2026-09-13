-- 20260913031500_content_clips_rls_initplan.sql
-- Sam, 2026-09-13: "launch board not working" — the Library sat on
-- "Loading your board…" past 15 s. Measured as an authenticated user:
-- selecting ONE page of ids took 1,083 ms, because both policies on
-- content_clips call a SECURITY DEFINER function per row (content_can_access()
-- queries content_access; has_role() queries user_roles) across a 6,985-row
-- seq scan, and the Library pages the whole table (7 requests, each rescanning
-- every row for the sort). Wrapping each predicate in a scalar subquery makes
-- Postgres evaluate it once per statement (InitPlan) instead of once per row.
-- Same policy semantics, same functions; only the evaluation count changes.
alter policy content_clips_admin_all on public.content_clips
  using ((select public.has_role(auth.uid(), 'admin'::app_role)) or (select public.has_role(auth.uid(), 'manager'::app_role)))
  with check ((select public.has_role(auth.uid(), 'admin'::app_role)) or (select public.has_role(auth.uid(), 'manager'::app_role)));
alter policy content_clips_invited_all on public.content_clips
  using ((select public.content_can_access()))
  with check ((select public.content_can_access()));
create index if not exists content_clips_live_modified_idx on public.content_clips (modified_at desc nulls last) where missing_at is null;
