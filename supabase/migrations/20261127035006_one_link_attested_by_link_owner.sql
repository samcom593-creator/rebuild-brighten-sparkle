-- MP-ONE-LINK-ETHOS (2026-11-26). Sam: "as soon as they fill out the link, they pop up on that Ethos
-- spreadsheet." Myles Benavides filled the public one-link at 02:58Z and was held for manual review:
-- "npn_not_verified, license_not_verified, eo_not_verified". The gate's attested mode (MP-304) requires
-- evidence_mode='attested' AND attested_by AND attested_at. submit_downline_contracting wrote attested_by
-- = auth.uid(), which is NULL on the public service path, so every one-link submission was structurally
-- unable to pass the gate while the signed-in manager path passed. The link's owner is the attester by
-- design ("attested by the manager who owns the downline"); record them. E&O stays whatever was attested
-- (false on the public form -> column L FALSE, a review finding, never a blocker).
--
-- Applied live 2026-11-27 03:50Z through the Supabase MCP apply_migration (version = file name). Myles's
-- existing row was repaired by hand the same minute (attested_by = the link owner) and his delivery
-- re-queued; the dispatcher wrote 'New Agents'!A30:H30 at 03:51:03Z, read back verified.
do $do$
declare
  v_def text;
  v_old text := $f$'attested', v_uid, now(), true, v_eo, v_uid)$f$;
  v_new text := $f$'attested', coalesce(v_uid, (select a.user_id from public.agents a where a.id = v_actor)), now(), true, v_eo, v_uid)$f$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_downline_contracting';
  if v_def is null then raise exception 'submit_downline_contracting not found'; end if;
  if position(v_old in v_def) = 0 then raise exception 'attested_by fragment not found; function body changed, refusing to guess'; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'fragment must occur exactly once'; end if;
  execute replace(v_def, v_old, v_new);
end $do$;
