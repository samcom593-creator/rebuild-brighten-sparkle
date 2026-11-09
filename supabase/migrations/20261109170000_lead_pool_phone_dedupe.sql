-- MP-LEAD-MANAGER-9 (2026-11-09): Sam's drop returned 409 on
-- lead_bundle_items_one_live_bundle (UNIQUE phone10 WHERE removed_at IS NULL).
-- The assign already excluded phones live in another pack with the index's own
-- predicate — but it could still select TWO POOL ROWS SHARING A PHONE into one
-- insert (rewrite pool carries 1 such pair, winback 10; marketing/dialer are
-- clean), and a multi-row insert that collides with ITSELF throws 23505 and
-- rolls the whole pack back. The UI then showed only "Could not assign".
--
-- Fix at the operand, both readers of sellable_pool:
--   * lead_pool_assign ranks rows per phone10 under the caller's active sort
--     and inserts only rank 1, with ON CONFLICT DO NOTHING on the index as the
--     belt for a count->assign race (v_n reports ACTUAL inserted rows).
--   * lead_pool_counts counts DISTINCT phones the same way, so "Ready to drop"
--     equals what a drop can actually deliver.

create or replace function public.lead_pool_assign(
  p_source text, p_filters jsonb, p_limit integer,
  p_agent_user_id uuid, p_name text default null, p_note text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_agent text; v_bundle uuid; v_n int; v_name text;
  v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
  v_sort text := coalesce(p_filters->>'sort', 'tier');
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can drop leads into a portal.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A pack holds 1 to 5,000 leads.' using errcode = '22023';
  end if;
  select a.display_name into v_agent from public.agents a
  where a.user_id = p_agent_user_id and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
  order by (a.canonical_agent_id is null) desc, a.created_at limit 1;
  if v_agent is null then raise exception 'Pick a live agent with a portal login.' using errcode = '22023'; end if;

  v_name := coalesce(nullif(btrim(p_name), ''),
    v_agent || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' (' || p_source || ')');
  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (v_name, 'client_leads',
          coalesce(p_filters, '{}'::jsonb) || jsonb_build_object('pool', p_source, 'limit', p_limit),
          nullif(btrim(p_note), ''), auth.uid())
  returning id into v_bundle;

  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
     quality_tier, quality_reason, status, attrs)
  select v_bundle, e.lead_id, p_source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, 'new',
         e.flags || jsonb_build_object('lead_age_days', e.lead_age_days, 'under_9mo', e.under_9mo, 'pool', p_source)
  from (
    -- One row per phone: the unique index is phone-grain, so the selection must
    -- be too. rank 1 = the best row for that phone under the caller's sort.
    select q.*, row_number() over (
      partition by q.phone10
      order by
        case when v_sort = 'chargeback' then (case when q.under_9mo then 0 else 1 end) end asc nulls last,
        case when v_sort = 'oldest' then q.lead_age_days end desc,
        array_position(array['S','A','B','C','D'], q.tier), q.lead_age_days asc
    ) as rn
    from (
      select * from public.sellable_pool(p_source, p_filters) m
      where not (v_excl_dnc and coalesce((m.flags->>'dnc')::boolean, false))
        and not (v_excl_sold and m.already_sold) and not m.in_bundle
    ) q
  ) e
  where e.rn = 1
  order by
    case when v_sort = 'chargeback' then (case when e.under_9mo then 0 else 1 end) end asc nulls last,
    case when v_sort = 'oldest' then e.lead_age_days end desc,
    array_position(array['S','A','B','C','D'], e.tier), e.lead_age_days asc
  limit p_limit
  on conflict (phone10) where (removed_at is null) do nothing;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
  values (v_bundle, p_agent_user_id, auth.uid(), nullif(btrim(p_note), ''));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_agent_user_id, auth.uid(), 'granted',
          jsonb_build_object('agent', v_agent, 'items', v_n, 'pool', p_source));
  return jsonb_build_object('bundle_id', v_bundle, 'items', v_n, 'agent', v_agent);
end $function$;

create or replace function public.lead_pool_counts(
  p_source text, p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v jsonb; v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  with m as (select * from public.sellable_pool(p_source, p_filters)),
  e as (select * from m
        where not (v_excl_dnc and coalesce((flags->>'dnc')::boolean, false))
          and not (v_excl_sold and already_sold)
          and not in_bundle),
  -- Same phone-grain as the unique index and the assign: one row per phone,
  -- tier-best representative. "Ready to drop" must equal what a drop delivers.
  e1 as (select * from (
           select e.*, row_number() over (
             partition by phone10
             order by array_position(array['S','A','B','C','D'], tier), lead_age_days asc
           ) rn from e) r
         where rn = 1)
  select jsonb_build_object(
    'total', (select count(*)::int from e1),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*)::int n from e1 group by tier) g), '{}'::jsonb),
    'under_9mo', (select count(*)::int from e1 where under_9mo),
    'dnc_excluded', (select count(*)::int from m where coalesce((flags->>'dnc')::boolean, false)),
    'resold_excluded', (select count(*)::int from m where already_sold),
    'in_bundle_excluded', (select count(*)::int from m where in_bundle),
    'sample', coalesce((select jsonb_agg(row_to_json(t)) from (
        select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
               state, age, tier, tags, flags, lead_age_days, under_9mo
        from e1 order by array_position(array['S','A','B','C','D'], tier), lead_age_days desc limit 25) t), '[]'::jsonb)
  ) into v;
  return v;
end $function$;
