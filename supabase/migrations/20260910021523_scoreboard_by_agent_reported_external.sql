-- MP-CONTENT-3: the per-agent list under the scoreboard tiles reconciles to the tiles.
-- Vantage's reported production (external_daily_gap) was in team/imo totals and reconciliation.agencies
-- but absent from by_agent (no attributed seller), so the list summed short of the tile in every window
-- (2026-09-09 day: list $7,407 vs tile $15,325; MTD $38,636 vs $87,234). Appends one labeled row with
-- comp fields null. Applied via connector 2026-09-10; patches the live definition in place, idempotent.
do $patch$
declare def text; anchor text; replacement text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'scoped_production_scoreboard_uncached';
  anchor := '''by_agent'', (select value from by_agent),';
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'by_agent anchor not unique in scoped_production_scoreboard_uncached';
  end if;
  if position('reported, sellers unattributed' in def) > 0 then
    raise notice 'already patched'; return;
  end if;
  replacement := $r$'by_agent', (select value from by_agent) || case
      when v_gap_visible and coalesce((select external_policies from totals), 0) > 0 then jsonb_build_array(jsonb_build_object(
        'agent_id', '00000000-0000-0000-0000-00000000a008'::uuid,
        'name', 'Vantage Financial (reported, sellers unattributed)',
        'agency', 'Vantage Financial',
        'policies', (select external_policies from totals),
        'ap', round((select external_ap from totals), 2),
        'seller_pct', null,
        'seller_pct_provenance', 'external',
        'override_pct_for_viewer', case when v_is_admin
          then greatest(coalesce(v_viewer_pct, v_fallback) - coalesce((select pct from head), v_fallback), 0) else null end,
        'est_override', case when v_is_admin then round((select external_gap_at_head from earnings), 2) else null end,
        'is_self', false,
        'first_hop_id', v_vantage_head,
        'first_hop_name', 'KJ Vaughn',
        'first_hop_pct', coalesce((select pct from head), v_fallback),
        'first_hop_pct_provenance', coalesce((select provenance from head), 'unknown'),
        'last_sale_date', (select max(p.posted_date) from production p where p.origin = 'external_daily_gap'),
        'external', true))
      else '[]'::jsonb end,$r$;
  def := replace(def, anchor, replacement);
  execute def;
end $patch$;
