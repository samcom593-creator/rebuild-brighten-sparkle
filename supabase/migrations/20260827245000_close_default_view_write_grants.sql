-- Two newly-created auto-updatable views inherited ALL from public-schema
-- defaults, making authenticated accounts capable of writing through a
-- view-owner path. Remove the live grants and close the default that recreated
-- the class after the previous cleanup. New relations must grant only the
-- privileges their API contract actually needs.

revoke insert, update, delete, truncate, references, trigger
  on public.v_agents_full, public.v_hh_hires_not_in_apex
  from authenticated, anon;

alter default privileges for role postgres in schema public
  revoke all on tables from authenticated, anon;

comment on view public.v_agents_full is
  'Read-only authenticated agent directory. Write privileges are explicitly revoked; mutations must use scoped tables/RPCs.';

comment on view public.v_hh_hires_not_in_apex is
  'Read-only headhunter reconciliation view. Write privileges are explicitly revoked; mutations must use scoped tables/RPCs.';
