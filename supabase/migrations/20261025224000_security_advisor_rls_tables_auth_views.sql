-- Security advisor (2026-10-17 email, re-read 2026-10-25): two tables with RLS off and two auth.users-backed
-- views readable by every login. Nothing in src/ reads any of the four; apex-doctor and pg_cron read them
-- as postgres/service, which RLS and these revokes do not touch.
alter table public.pg_cron_timeout_samples enable row level security;
alter table public.truth_refresh_state enable row level security;
revoke all on public.v_departed_logins_to_revoke from anon, authenticated;
revoke all on public.v_agent_access_violations from anon, authenticated;
