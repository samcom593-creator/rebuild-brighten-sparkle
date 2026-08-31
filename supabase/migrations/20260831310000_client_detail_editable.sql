-- MP-350: make every client section editable, not just two of eight.
--
-- Sam: "still can't edit it all inside the pipeline, every section should work."
--
-- MEASURED. ClientDetail renders eight tabs and had ZERO writes to
-- agentlink_clients — grep found no .update() and no client RPC other than
-- fn_client_pipeline_action, which only writes client_pipeline_overrides
-- (schedule + notes). So Schedule and Notes saved; Contact, Needs Analysis,
-- Financials, Policies, Beneficiaries and Referrals were read-only surfaces
-- displaying columns the table has stored all along. Six of eight tabs could
-- show a wrong phone number and offer no way to correct it.
--
-- ONE RPC WITH AN ALLOWLIST, not forty parameters. A jsonb patch keeps the
-- signature stable as sections grow, and the allowlist is the security boundary:
-- id, agent_id, insuracloud_* and raw_payload are NOT writable, so this cannot
-- be used to reassign a client to another agent or forge sync provenance by
-- passing an extra key. Anything not on the list is rejected BY NAME rather than
-- silently dropped — a patch that half-applies is worse than one that refuses.
--
-- Permission reuses fn_can_access_pipeline_client, the same gate the existing
-- action RPC uses, so "who can see this client" and "who can edit them" cannot
-- drift apart.

begin;

create or replace function public.fn_client_pipeline_update(
  p_client_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Every column a human may correct from the client screen. Deliberately
  -- excludes identity, ownership and sync-provenance columns.
  k_allowed constant text[] := array[
    -- contact
    'first_name','last_name','phone','email','street_address','city','state','zip_code',
    'date_of_birth','phone_type','preferred_contact_method','best_time_to_call','client_timezone',
    'do_not_call','do_not_email','do_not_text',
    -- needs analysis
    'is_smoker','height','weight','born_location','ssn_last4','medical_notes',
    'physician_name','physician_phone','physician_address','employer_occupation','employment_status',
    'retirement_age_goal','retirement_year','legacy_estate','objectives',
    -- financials
    'earned_income','pension_income','social_security_income','other_monthly_income',
    'total_monthly_income','mortgage_payment','rent_payment','transportation_expense',
    'utilities_expense','insurance_expense','other_monthly_expenses','total_monthly_expenses',
    'monthly_surplus','qualified_accounts','non_qualified_accounts','non_qualified_assets',
    'total_investable','retirement_savings_qualified','bank_name','bank_account_type',
    -- policy
    'pitch_carrier','pitch_price','product_sold','policy_number','face_amount',
    'policy_start_date','policy_review_date',
    -- beneficiary (the single-beneficiary fields on the client row)
    'beneficiary_first_name','beneficiary_last_name','beneficiary_count'
  ];
  v_key text;
  v_rejected text[] := '{}';
  v_applied text[] := '{}';
  v_sql text;
  v_sets text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.fn_can_access_pipeline_client(p_client_id) then
    raise exception 'Client not found or access denied' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to update';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = any(k_allowed) then
      v_applied := v_applied || v_key;
      -- Cast through the column's own type so a date stays a date and money
      -- stays numeric; quote_ident/quote_nullable keep the key and value safe.
      v_sets := v_sets || format(
        '%I = nullif(%L, '''')::text::%s',
        v_key,
        nullif(btrim(coalesce(p_patch ->> v_key, '')), ''),
        (select format_type(a.atttypid, a.atttypmod)
           from pg_attribute a
          where a.attrelid = 'public.agentlink_clients'::regclass
            and a.attname = v_key and a.attnum > 0)
      );
    else
      v_rejected := v_rejected || v_key;
    end if;
  end loop;

  -- Refuse the whole patch if any key is unknown. Silently dropping a field the
  -- caller believed they saved is the failure this codebase keeps finding.
  if array_length(v_rejected, 1) is not null then
    raise exception 'Not editable here: %', array_to_string(v_rejected, ', ')
      using errcode = '22023';
  end if;

  v_sql := format(
    'update public.agentlink_clients set %s, updated_at = now() where id = %L',
    array_to_string(v_sets, ', '), p_client_id
  );
  execute v_sql;

  insert into public.client_pipeline_activity(client_id, activity_type, body, created_by)
  values (
    p_client_id, 'client_updated',
    'Updated: ' || array_to_string(v_applied, ', '),
    auth.uid()
  );

  return jsonb_build_object('updated', to_jsonb(v_applied), 'count', coalesce(array_length(v_applied,1),0));
end;
$function$;

comment on function public.fn_client_pipeline_update(uuid, jsonb) is
  'MP-350: edit any client field the screen shows. jsonb patch against a strict '
  'column allowlist — identity, ownership and sync-provenance columns are not '
  'writable. An unknown key REJECTS the whole patch rather than half-applying. '
  'Gated by fn_can_access_pipeline_client, the same gate as viewing.';

revoke all on function public.fn_client_pipeline_update(uuid, jsonb) from public;
grant execute on function public.fn_client_pipeline_update(uuid, jsonb) to authenticated;

commit;
