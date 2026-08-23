-- Invite links: make the roles the UI offers actually storable.
--
-- invite_tokens_target_role_check allowed only
--   agent / hired_unlicensed / hired_licensed / manager_candidate / referral_prospect
-- while fn_apply_invite_target_role (the AFTER UPDATE trigger that grants the
-- app_role once a recruit signs up) branches on
--   hired_manager / manager / agency_owner / staff
--
-- Those two disagreed, so every one of the trigger's manager-, owner- and
-- staff-shaped arms was unreachable code: the INSERT died on the CHECK before a
-- row with that target_role could ever exist. Proven live 2026-08-23 — minting
-- a Manager, Agency Owner or Staff invite returned 23514 and no link was
-- created. Three of the four "Invite As" options on the page were dead.
--
-- manager_candidate is deliberately NOT mapped to the manager role: it marks a
-- recruiting-funnel candidate, not someone who has been granted manager rights.
alter table public.invite_tokens
  drop constraint if exists invite_tokens_target_role_check;

alter table public.invite_tokens
  add constraint invite_tokens_target_role_check
  check (target_role = any (array[
    'agent','hired_unlicensed','hired_licensed',
    'manager_candidate','referral_prospect',
    'hired_manager','manager','agency_owner','staff'
  ]));
