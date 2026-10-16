-- Sold Calls shows SSN and bank details inline for the people allowed to book
-- (Sam's admin logins + Aisha, via can_view_sold_calls). One call returns every
-- packet's decrypted fields and writes one access-log row per packet read, so the
-- audit trail stays as complete as the old click-to-reveal flow.
create or replace function public.booking_packets_sensitive_all()
returns table(packet_id uuid, ssn text, bank_account text, bank_routing text)
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $fn$
#variable_conflict use_column
declare v_key text;
begin
  if not public.can_view_sold_calls() then
    raise exception 'booking_packets_sensitive_all: not authorized';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'agent_credentials_key' limit 1;
  insert into public.readymode_packet_access_log(packet_id, accessed_by, fields)
    select b.id, auth.uid(), array['ssn','bank_account','bank_routing']
      from public.readymode_booking_packets b
     where b.ssn_encrypted is not null or b.bank_account_encrypted is not null or b.bank_routing_encrypted is not null;
  return query
    select b.id,
      case when b.ssn_encrypted is null then null else pgp_sym_decrypt(b.ssn_encrypted, v_key) end,
      case when b.bank_account_encrypted is null then null else pgp_sym_decrypt(b.bank_account_encrypted, v_key) end,
      case when b.bank_routing_encrypted is null then null else pgp_sym_decrypt(b.bank_routing_encrypted, v_key) end
    from public.readymode_booking_packets b
    where b.ssn_encrypted is not null or b.bank_account_encrypted is not null or b.bank_routing_encrypted is not null;
end;
$fn$;

revoke all on function public.booking_packets_sensitive_all() from public, anon;
grant execute on function public.booking_packets_sensitive_all() to authenticated, service_role;
