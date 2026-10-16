-- PL-SEC-VIEW-LOCKDOWN-2 (2026-10-16), tables half.
--
-- client_leads: every manager and VA manager read all 125,547 leads (46,012 with a date of
-- birth, 9,733 with a beneficiary, 1,670 with an existing policy number) through
-- client_leads_manager_read. Nothing in the app reads client_leads or any of the seven v_leads_*
-- views built on it (grep of src/ and supabase/functions/, 2026-10-16), so the policy served no
-- page. Admins keep full access (client_leads_admin_all) and a VA keeps the leads assigned to
-- them (client_leads_va_assigned / client_leads_va_update_assigned).
drop policy if exists client_leads_manager_read on public.client_leads;

-- ayro_book: the outside agency's book (policy numbers, carriers, premiums, agents) was readable
-- by every manager. It is production book data, which is Sam's and Aisha's only (book_readers):
-- the same rule as deals, agentlink_book and production_external_deals.
drop policy if exists ayro_book_admin_read on public.ayro_book;
create policy ayro_book_full_readers_read on public.ayro_book for select to authenticated
  using ((select public.api_is_full_reader()));
