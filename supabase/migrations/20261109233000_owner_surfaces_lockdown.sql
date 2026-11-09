-- MP-OWNER-LOCKDOWN (2026-11-09, EMERGENCY, continues 20261109230000): Sam —
-- "Sold calls should all be blocked off... staff accounts, easy resales, book
-- flips, books, sold calls, commissions, retention, anything under the owner
-- tab should be blocked NOW. Why would I want agents to have any of this info?"
-- The gate that was "still working" for agents: 8 AGENTS held the 'manager'
-- app_role (opens every allowManagers route + has_role('manager') DB branch),
-- and Obiajulu held a call_access_grants row. Aisha Kebbeh is Sam's staff lane
-- (book_readers + call grant) and KEEPS everything. Everyone stripped here is
-- an agent. Pre-images land in ops_preimage_snapshots for one-statement restore.

insert into public.ops_preimage_snapshots (reason, payload)
values ('MP-OWNER-LOCKDOWN 2026-11-09: manager-role rows + call_access_grants before strip',
  jsonb_build_object(
    'user_roles_manager', (select jsonb_agg(to_jsonb(r)) from public.user_roles r where r.role = 'manager'),
    'call_access_grants', (select jsonb_agg(to_jsonb(g)) from public.call_access_grants g)
  ));

-- Strip 'manager' from the 7 agents (explicit uid list — never "all but X").
delete from public.user_roles
where role = 'manager'
  and user_id in (
    '8232ab2c-2efb-4922-8e31-70b926acb3fe', -- Kyros Thorpe
    'eeeba599-eadc-4bbc-bed0-2ebdbe8a0dcb', -- Chudi Ifediora
    'c6756648-4a04-4d16-9a54-f9bfd3f4f216', -- Jacob Causer
    'e745ef41-af18-44a8-9d32-004e6ebcd658', -- Damenion Freeman
    '80010a1e-f368-4d01-b8de-f4af5b601a66', -- Obiajulu Ifediora
    '3149dd87-5602-4a61-9102-8dbd90257b2f', -- Brook Roberson
    '41818231-c1ff-44cd-bda2-fb40bd17f59e'  -- Cooper Ubert
  );

-- Sold calls: agents all blocked. Aisha's grant stays.
delete from public.call_access_grants
where user_id = '80010a1e-f368-4d01-b8de-f4af5b601a66'; -- Obiajulu Ifediora

-- Two SECURITY DEFINER relics with NO caller anywhere in src/ let any
-- authenticated user pull ANY agent's book including client names
-- (apex_agent_book's 'recent' list, producer_deep_dive's recent_deals).
-- No UI uses them; agents lose execute, service_role keeps it.
revoke execute on function public.apex_agent_book(uuid) from public, anon, authenticated;
revoke execute on function public.producer_deep_dive(integer) from public, anon, authenticated;
grant execute on function public.apex_agent_book(uuid) to service_role;
grant execute on function public.producer_deep_dive(integer) to service_role;
