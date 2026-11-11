-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 8 of 11: recruit pages reach the owner by email.
--
-- WHAT
--   fn_recruit_sla_pager: unchanged paging rules, plus step (b2): every owner who is not Sam and who got in-app pages
--   gets ONE email listing those recruits by first name (lane, state) with the recruiting-queue link. At most one
--   email per owner per hour; recruits paged while the hour is closed ride along in the next email. Forward-only:
--   only in-app pages created at or after the WP3 cutoff (wp3_recruit_sla_cutoff) and in the last 24 hours are
--   emailed, and only recruits still without a human contact. Business hours only (the pager already returns
--   outside 08:00-19:00 Phoenix).
--   fn_recruit_sla_digest: unchanged, plus a daily digest EMAIL to each non-Sam owner who has rows in the queue
--   (dedupe key per owner per Phoenix day): counts, and the first names of up to 10 recruits who applied since
--   go-live with no human contact. Pre-cutoff backlog appears as a count, never as a name list.
--   Both resolve the owner's address from auth.users, skip suspended owners, and send through the PKG2 outbox
--   (send-email, Reply-To info@kingofsales.net).
--
-- WHY
--   funnel_now 6.2 / shipped_vs_live 6.7: unlicensed recruits (87% of inflow) route to Aisha, whose only page is an
--   in-app notification; she last read that inbox on 11-02. DECISIONS N5: pages for Aisha also go by email to an
--   inbox she reads; licensed pages stay on Sam's phone (ntfy, unchanged).

create or replace function public.fn_recruit_sla_pager()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  v_local timestamp := now() at time zone 'America/Phoenix';
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  r record;
  v_owner uuid;
  v_mgr uuid;
  v_log bigint;
  v_nid uuid;
  v_title text;
  v_body text;
  v_eligible int;
  v_paged int := 0;
  v_inbox int := 0;
  v_escalated int := 0;
  v_reassigned int := 0;
  v_emailed int := 0;
  v_since timestamptz;
  v_names text[];
  v_n int;
  v_out uuid;
begin
  if v_cutoff = 'infinity'::timestamptz then
    return jsonb_build_object('skipped', 'no_cutoff_setting', 'at', now());
  end if;

  -- (a) Ownership repair, any hour: open recruits owned by someone who has not signed
  -- in for 7 days go back to the fallback (no page for pre-cutoff rows).
  for r in
    select a.id, a.recruiting_owner_user_id, a.license_status::text as lic, a.created_at
      from public.applications a
     where a.recruiting_owner_user_id is not null and a.recruiting_owner_user_id <> v_sam
       and coalesce(a.is_duplicate, false) = false
       and coalesce(a.record_type, 'application') = 'application'
       and a.do_not_contact_at is null and a.terminated_at is null and a.closed_at is null
       and a.created_at >= now() - interval '45 days'
       and (not public.fn_recruit_user_is_active(a.recruiting_owner_user_id)
            or (a.created_at >= v_cutoff and a.human_last_contact_at is null
                and a.created_at < now() - interval '72 hours'
                and coalesce(a.owner_alert_meta ->> 'reassigned_at', '') = ''))
     for update skip locked
  loop
    v_owner := public.fn_pick_recruit_owner(r.lic, r.recruiting_owner_user_id);
    update public.applications
       set recruiting_owner_user_id = v_owner,
           recruiting_owner_set_at = now(),
           recruiting_owner_set_by = null,
           owner_alerted_at = case when r.created_at >= v_cutoff and human_last_contact_at is null then null else owner_alerted_at end,
           owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('reassigned_at', now(), 'reassigned_from', r.recruiting_owner_user_id)
     where id = r.id;
    v_reassigned := v_reassigned + 1;
  end loop;

  -- Pages only inside 08:00-19:00 Phoenix.
  if extract(hour from v_local) < 8 or extract(hour from v_local) >= 19 then
    return jsonb_build_object('reassigned', v_reassigned, 'skipped', 'outside_phoenix_business_hours', 'at', now());
  end if;

  -- (b) First page for each NEW_UNTOUCHED recruit (15 business minutes, post-cutoff).
  select count(*) into v_eligible
    from public.fn_recruit_sla_open_untouched(v_cutoff) a
   where a.owner_alerted_at is null and public.fn_phx_business_minutes(a.created_at, now()) >= 15;

  if v_eligible > 5 then
    -- Storm guard: a burst (bulk import, replay) becomes ONE push, never N.
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
    values ('batch_page', v_sam, 'ntfy',
            public.fn_ntfy_relay(v_eligible || ' new recruits waiting',
              v_eligible || ' recruits applied with no human contact yet. Open the recruiting queue: ' || c_link,
              '4', 'telephone_receiver'),
            jsonb_build_object('eligible', v_eligible))
    returning id into v_log;
    update public.applications a
       set owner_alerted_at = now(),
           owner_alert_meta = coalesce(a.owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('log_id', v_log, 'channel', 'ntfy', 'batch', true, 'paged_at', now())
     where a.id in (select u.id from public.fn_recruit_sla_open_untouched(v_cutoff) u
                     where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15);
    v_paged := v_eligible;
  else
    for r in
      select u.id, u.first_name, u.state, u.license_status::text as lic, u.created_at,
             coalesce(u.recruiting_owner_user_id, v_sam) as owner
        from public.fn_recruit_sla_open_untouched(v_cutoff) u
       where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15
       order by u.created_at
    loop
      v_title := 'Call ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a new recruit')
                 || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
      v_body := 'Applied ' || greatest(1, round(extract(epoch from now() - r.created_at) / 60))::int
                || ' min ago. No human contact yet. Open the recruiting queue: ' || c_link;
      if r.owner = v_sam then
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
        values ('page', r.id, r.owner, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'telephone_receiver'))
        returning id into v_log;
        v_paged := v_paged + 1;
      else
        v_nid := public.fn_emit_inbox_notification(r.owner, 'recruit_sla_page', v_title, v_body,
                   '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
        values ('page', r.id, r.owner, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
        returning id into v_log;
        v_inbox := v_inbox + 1;
      end if;
      update public.applications
         set owner_alerted_at = now(),
             owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                                || jsonb_build_object('log_id', v_log, 'paged_user', r.owner, 'paged_at', now())
       where id = r.id;
    end loop;
  end if;

  -- (b2) PKG2: an owner who is not Sam also gets the page by EMAIL (N5: her in-app inbox was last read 11-02).
  -- One email per owner per hour at most; it lists every recruit paged in-app since that owner's last page email
  -- (forward-only: in-app pages at/after the WP3 cutoff, last 24h) who still has no human contact. First names only.
  for r in
    select l.owner_user_id as uid
      from public.recruit_sla_push_log l
     where l.kind = 'page' and l.channel = 'inbox'
       and l.owner_user_id is not null and l.owner_user_id <> v_sam
       and l.created_at >= greatest(v_cutoff, now() - interval '24 hours')
     group by l.owner_user_id
  loop
    continue when exists (select 1 from public.hire_lane_email_outbox o
                           where o.kind = 'recruit_page' and o.recipient_user_id = r.uid
                             and o.created_at > now() - interval '1 hour');
    continue when public.fn_user_is_suspended(r.uid) or public.fn_user_login_blocked(r.uid);
    v_since := greatest(v_cutoff, now() - interval '24 hours',
                        coalesce((select max(o.created_at) from public.hire_lane_email_outbox o
                                   where o.kind = 'recruit_page' and o.recipient_user_id = r.uid), '-infinity'::timestamptz));
    select array_agg(x.label order by x.paged_at), count(*)
      into v_names, v_n
      from (select distinct on (l.application_id)
                   coalesce(nullif(split_part(btrim(coalesce(a.first_name, '')), ' ', 1), ''), 'A recruit')
                   || ' (' || coalesce(a.license_status::text, 'unknown') || ', ' || coalesce(nullif(btrim(a.state), ''), '?') || ')' as label,
                   l.created_at as paged_at
              from public.recruit_sla_push_log l
              join public.applications a on a.id = l.application_id
             where l.kind = 'page' and l.channel = 'inbox' and l.owner_user_id = r.uid
               and l.created_at > v_since
               and a.human_last_contact_at is null
               and a.recruiting_owner_user_id = r.uid
             order by l.application_id, l.created_at) x;
    continue when coalesce(v_n, 0) = 0;
    v_title := case when v_n = 1 then 'Call ' || v_names[1] else v_n || ' new recruits to call' end;
    v_body := case when v_n = 1 then v_names[1] || ' applied and has no human contact yet.'
                   else array_to_string(v_names[1:10], ', ') || case when v_n > 10 then ' and ' || (v_n - 10) || ' more' else '' end
                        || ' applied and have no human contact yet.' end;
    v_out := public.fn_hire_lane_email_enqueue(
      'recruit_page',
      'recruit_page:' || r.uid::text || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI'),
      r.uid, null, v_title,
      v_body || E'\n\n' || 'Open the recruiting queue: ' || c_link,
      '<p>' || public.fn_pkg2_html_escape(v_body) || '</p><p><a href="' || c_link || '">Open the recruiting queue</a></p>',
      null, null, jsonb_build_object('recruits', v_n));
    if v_out is not null then v_emailed := v_emailed + 1; end if;
  end loop;

  -- (c) 2h escalation for recruits a non-Sam owner has not touched: the active
  -- va_manager's inbox, else Sam's phone. 24h is Sam's digest; 72h is (a) above.
  for r in
    select u.id, u.first_name, u.state, u.license_status::text as lic, u.recruiting_owner_user_id as owner
      from public.fn_recruit_sla_open_untouched(v_cutoff) u
     where u.owner_alerted_at < now() - interval '2 hours'
       and u.recruiting_owner_user_id is not null and u.recruiting_owner_user_id <> v_sam
       and coalesce(u.owner_alert_meta ->> 'escalated_at', '') = ''
  loop
    select ur.user_id into v_mgr from public.user_roles ur
     where ur.role = 'va_manager' and ur.user_id <> r.owner and public.fn_recruit_user_is_active(ur.user_id)
     order by ur.user_id limit 1;
    v_title := 'Still waiting 2h: ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a recruit')
               || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
    v_body := 'Owner ' || coalesce(public.fn_staff_first_name(r.owner), 'staff') || ' has not logged contact. Open: ' || c_link;
    if v_mgr is not null then
      v_nid := public.fn_emit_inbox_notification(v_mgr, 'recruit_sla_escalation', v_title, v_body,
                 '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
      values ('escalation', r.id, v_mgr, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
      returning id into v_log;
    else
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
      values ('escalation', r.id, v_sam, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'rotating_light'))
      returning id into v_log;
    end if;
    update public.applications
       set owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('escalated_at', now(), 'escalation_log_id', v_log)
     where id = r.id;
    v_escalated := v_escalated + 1;
  end loop;

  return jsonb_build_object('paged_ntfy', v_paged, 'paged_inbox', v_inbox, 'owner_emails', v_emailed, 'escalated', v_escalated,
                            'reassigned', v_reassigned, 'eligible', v_eligible, 'at', now());
end $$;

create or replace function public.fn_recruit_sla_digest()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  v_counts jsonb;
  v_last timestamptz;
  v_new_untouched int;
  v_backlog int;
  v_stalls int;
  v_total int;
  v_body text;
  v_log bigint;
  v_nid uuid;
  v_sent_inbox int := 0;
  v_sent_email int := 0;
  v_owner_total int;
  v_names text[];
  v_new_n int;
  v_backlog_n int;
  v_mail text;
  v_out uuid;
  r record;
begin
  if exists (select 1 from public.recruit_sla_push_log
              where kind = 'digest' and owner_user_id = v_sam and created_at > now() - interval '20 hours') then
    return jsonb_build_object('skipped', 'already_sent_today', 'at', now());
  end if;

  select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb), coalesce(sum(n), 0)::int
    into v_counts, v_total
    from (select sla_state, count(*) n from public.v_recruit_sla_queue group by 1) x;
  select count(*) filter (where post_deploy), count(*) filter (where not post_deploy)
    into v_new_untouched, v_backlog
    from public.v_recruit_sla_queue where sla_state = 'NEW_UNTOUCHED';
  v_last := greatest(v_cutoff, coalesce((select max(created_at) from public.recruit_sla_push_log
                                           where kind = 'digest' and owner_user_id = v_sam), v_cutoff));
  -- New stall crossings since the last digest, as a count. Never a per-row alert.
  select count(*) into v_stalls from public.next_step_progress
   where status = 'active' and is_stalled and stalled_at > v_last;

  v_body := 'New since go-live, no human contact: ' || v_new_untouched || E'\n'
         || 'Call ended, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0) || E'\n'
         || 'Callback due: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0) || E'\n'
         || 'Follow-up due: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0) || E'\n'
         || 'Licensed, never booked: ' || coalesce((v_counts ->> 'LICENSED_UNBOOKED')::int, 0) || E'\n'
         || 'Older untouched (before go-live, last 45 days): ' || v_backlog || E'\n'
         || 'New next-step stalls since last digest: ' || v_stalls || E'\n\n'
         || 'Open: ' || c_link;

  insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
  values ('digest', v_sam, 'ntfy',
          public.fn_ntfy_relay('Recruit queue: ' || v_total || ' need a human', v_body, '3', 'clipboard'),
          v_counts || jsonb_build_object('new_untouched_post_cutoff', v_new_untouched,
                                         'backlog_pre_cutoff', v_backlog, 'new_stalls', v_stalls, 'total', v_total))
  returning id into v_log;

  -- Other staff owners: their own counts in the app they work in. Owners come from
  -- the queue plus every active VA seat, so an active seat hears '0' rather than silence.
  for r in
    select o.uid from (
      select distinct q.owner_user_id as uid from public.v_recruit_sla_queue q where q.owner_user_id <> v_sam
      union
      select ur.user_id from public.user_roles ur
       where ur.role in ('va', 'va_manager') and public.fn_recruit_user_is_active(ur.user_id)
    ) o where o.uid is not null and o.uid <> v_sam
  loop
    select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb) into v_counts
      from (select sla_state, count(*) n from public.v_recruit_sla_queue where owner_user_id = r.uid group by 1) x;
    v_nid := public.fn_emit_inbox_notification(r.uid, 'recruit_sla_digest',
               'Your recruit queue today',
               'New, untouched: ' || coalesce((v_counts ->> 'NEW_UNTOUCHED')::int, 0)
               || ' · Call, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0)
               || ' · Callback: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0)
               || ' · Follow-up: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0),
               '/dashboard/recruiting', 'normal', v_counts);
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, notification_id, counts, settled_at, settle_note)
    values ('digest', r.uid, 'inbox', v_nid, v_counts, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end);
    v_sent_inbox := v_sent_inbox + 1;

    -- PKG2 (N5): the same digest by EMAIL, once per owner per Phoenix day, only to an owner who has rows in the
    -- queue and is not suspended. Names: first names of recruits who applied since go-live with no human contact
    -- (up to 10). The pre-go-live backlog is a count only.
    select coalesce(sum((value)::int), 0) into v_owner_total from jsonb_each_text(v_counts);
    continue when v_owner_total = 0 or public.fn_user_is_suspended(r.uid) or public.fn_user_login_blocked(r.uid);
    select count(*) filter (where q.post_deploy), count(*) filter (where not q.post_deploy)
      into v_new_n, v_backlog_n
      from public.v_recruit_sla_queue q
     where q.owner_user_id = r.uid and q.sla_state = 'NEW_UNTOUCHED';
    select coalesce(array_agg(z.nm order by z.created_at desc), '{}'::text[]) into v_names
      from (select q.created_at,
                   coalesce(nullif(split_part(btrim(coalesce(q.first_name, '')), ' ', 1), ''), 'A recruit')
                   || ' (' || coalesce(q.license_status, 'unknown') || ', ' || coalesce(nullif(btrim(q.state), ''), '?') || ')' as nm
              from public.v_recruit_sla_queue q
             where q.owner_user_id = r.uid and q.sla_state = 'NEW_UNTOUCHED' and q.post_deploy
             order by q.created_at desc
             limit 10) z;
    v_mail := 'Your recruit queue today: ' || v_owner_total || ' need a human.' || E'\n\n'
           || 'New since go-live, no human contact: ' || coalesce(v_new_n, 0)
           || case when cardinality(v_names) > 0 then ' (' || array_to_string(v_names, ', ') || ')' else '' end || E'\n'
           || 'Older untouched (before go-live): ' || coalesce(v_backlog_n, 0) || E'\n'
           || 'Call ended, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0) || E'\n'
           || 'Callback due: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0) || E'\n'
           || 'Follow-up due: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0) || E'\n\n'
           || 'Open the recruiting queue: ' || c_link;
    v_out := public.fn_hire_lane_email_enqueue(
      'recruit_digest',
      'recruit_digest:' || r.uid::text || ':' || to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD'),
      r.uid, null,
      'Your recruit queue today: ' || v_owner_total || ' need a human',
      v_mail,
      '<p>' || replace(public.fn_pkg2_html_escape(replace(v_mail, E'\n\nOpen the recruiting queue: ' || c_link, '')), E'\n', '<br>') || '</p>'
        || '<p><a href="' || c_link || '">Open the recruiting queue</a></p>',
      null, null, v_counts);
    if v_out is not null then v_sent_email := v_sent_email + 1; end if;
  end loop;

  return jsonb_build_object('digest_log_id', v_log, 'total', v_total, 'backlog_pre_cutoff', v_backlog,
                            'new_stalls', v_stalls, 'inbox_digests', v_sent_inbox, 'email_digests', v_sent_email, 'at', now());
end $$;
