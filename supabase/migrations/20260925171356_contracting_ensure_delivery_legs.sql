-- Every contracting intake that carries an NPN must have all four delivery legs
-- (contracting_email, contracting_discord, contracting_workbook, ethos_sheet)
-- enqueued. submit_contracting_intake does this inline, but any OTHER path that
-- writes an intake row (admin leaderboard backfill, a future importer) bypassed
-- it and left the producer with only the slack notification and no Discord post
-- or Ethos row. This closes the class: an AFTER trigger re-runs the exact same
-- idempotent enqueue as submit_contracting_intake for every insert/npn/status
-- change, so the delivery legs can never again depend on which code path
-- created the intake. (contracting_email and contracting_workbook are filtered
-- out by the pre-existing outbox/delivery guard triggers as disabled
-- destinations, so in practice only contracting_discord + ethos_sheet legs
-- materialise — identical to what submit_contracting_intake produces today.)
create or replace function public.fn_ensure_contracting_delivery_legs(p_intake_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_intake public.contracting_intakes%rowtype;
  v_dest text;
  v_row integer;
  v_enqueued integer := 0;
  v_destinations constant text[] := array[
    'contracting_email', 'contracting_discord', 'contracting_workbook', 'ethos_sheet'
  ];
begin
  select * into v_intake from public.contracting_intakes where id = p_intake_id;
  if not found then
    return 0;
  end if;

  -- Pre-license rows (no NPN) are parked exactly as submit_contracting_intake
  -- parks them: an 'awaiting_license' delivery row per destination and NO
  -- outbox event, so nothing can be delivered and nothing reported delivered.
  -- The NPN-upgrade path releases them.
  if v_intake.npn is null then
    foreach v_dest in array v_destinations loop
      insert into public.contracting_intake_deliveries (intake_id, destination, state, last_error_redacted)
      values (
        v_intake.id, v_dest, 'awaiting_license',
        'Parked: no NPN yet. Queues automatically when the producer is licensed and submits their NPN.'
      )
      on conflict (intake_id, destination) do nothing;
    end loop;
    return 0;
  end if;

  foreach v_dest in array v_destinations loop
    -- An email collision held at needs_review must not be auto-upserted into the
    -- shared Ethos sheet: it parks at manual_review with no outbox job. This
    -- mirrors submit_contracting_intake's own guard so the two paths cannot
    -- disagree about which rows are safe to write.
    insert into public.contracting_intake_deliveries (intake_id, destination, state)
    values (
      v_intake.id,
      v_dest,
      case when v_dest = 'ethos_sheet' and v_intake.status = 'needs_review'
           then 'manual_review' else 'queued' end
    )
    on conflict (intake_id, destination) do nothing;

    if not (v_dest = 'ethos_sheet' and v_intake.status = 'needs_review') then
      insert into public.outbox_events (
        aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key
      ) values (
        'contracting_intake',
        v_intake.id,
        'contracting_intake_submitted',
        v_dest,
        jsonb_build_object('intake_id', v_intake.id, 'destination', v_dest),
        'contracting-' || v_intake.id::text || '-' || v_dest
      )
      on conflict (idempotency_key) do nothing;
      get diagnostics v_row = row_count;
      v_enqueued := v_enqueued + v_row;
    end if;
  end loop;

  return v_enqueued;
end;
$function$;

create or replace function public.trg_fn_ensure_contracting_legs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.fn_ensure_contracting_delivery_legs(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_ensure_contracting_legs on public.contracting_intakes;
create trigger trg_ensure_contracting_legs
after insert or update of npn, status on public.contracting_intakes
for each row execute function public.trg_fn_ensure_contracting_legs();
