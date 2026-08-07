-- Mirror of a migration applied live 2026-08-07 via Supabase MCP (recorded
-- remotely as 20260807060551_hh_phone_normalized_nanp). See 20260806214858
-- header for why these mirrors exist.
--
-- QA P0-1: "+1 (555) 123-4567" and "5551234567" must normalize identically.

alter table public.hh_applicants drop column phone_normalized;
alter table public.hh_applicants add column phone_normalized text generated always as (
  nullif(
    case
      when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) = 11
       and left(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 1) = '1'
      then substr(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 2)
      else regexp_replace(coalesce(phone, ''), '\D', '', 'g')
    end,
  '')
) stored;
create index hh_applicants_phone_idx on public.hh_applicants (phone_normalized) where phone_normalized is not null;
