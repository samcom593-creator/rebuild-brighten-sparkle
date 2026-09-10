-- MP-500 (2026-09-10): sweep the JSON-quoted-scalar class across EVERY text
-- column, not just the one column it was found in twice.
--
-- MP-499 armed a BEFORE trigger on public.system_settings and wrote down its
-- own limit: "SCOPE IS ONE COLUMN ... any text column reachable by hand-applied
-- SQL has the same exposure -- MP-400's cookie and these rows are two
-- instances, and MP-345's lesson is that a sweep stopping at the instance you
-- noticed IS the instance, not the class."
--
-- This is that sweep, and it REFUTED the premise. All 1,997 text/varchar
-- columns across all 401 public base tables, measured with the exact predicate
-- the trigger enforces (read out of pg_get_functiondef rather than re-derived,
-- so the sweep and the trigger cannot drift apart the way curl's --max-time
-- and fn_agentlink_reap_stuck did). Hits outside system_settings.value: ZERO.
--
-- So this ships as PREVENTION with a measured zero behind it. It is not
-- claimed to have recovered anything, and there is no dollar figure attached:
-- counting columns answers "where could this shape be", not "what is broken".
--
-- Graded by apex-doctor Check #67.
create or replace function public.fn_text_json_quoted_sweep()
returns table(rel text, col text, hits bigint)
language plpgsql
stable
as $$
declare
  t_rec record;
  c_rec record;
  any_hit boolean;
  n bigint;
begin
  -- Sweeps EVERY text/varchar column in every public base table for the exact
  -- shape fn_system_settings_reject_json_quoted() refuses:
  --   length(v) >= 2 AND left(v,1) = '"' AND right(v,1) = '"'
  --
  -- WHY IT IS DERIVED AND NOT A LIST (MP-500). The corruption arrives via
  -- hand-applied SQL that to_jsonb()s a value into a text column. It has hit
  -- system_settings.value twice (MP-400's AgentLink cookie, MP-498's public
  -- /seminar CTA). A maintained list of "columns to watch" would only ever
  -- contain the columns somebody already got burned by -- the instance, not
  -- the class. information_schema is re-read every call, so a table added
  -- tomorrow is covered without anybody remembering to add it.
  --
  -- TWO PHASE, because one count(*) per column is 1,997 scans and does not fit
  -- in the doctor's 20s bot_sql window. Phase 1 asks each TABLE one question
  -- (OR across its text columns, EXISTS so it stops at the first match);
  -- phase 2 drills into columns only for tables that answered yes. Clean is the
  -- overwhelmingly common case, so the drill-down almost never runs.
  --
  -- Returns COUNTS AND NAMES ONLY, never values: a column holding a corrupted
  -- token must be nameable in a health report without the report becoming a
  -- second place that token is written down. SECURITY INVOKER on purpose --
  -- this reads every table in public and must not hand that reach to a caller
  -- who does not already have it (MP-325/MP-326).
  --
  -- NOTE ON NAMES: every record variable is suffixed _rec and every query alias
  -- is >=2 chars. The first cut used a record variable named `c` alongside an
  -- `information_schema.columns c` alias; PL/pgSQL resolved the alias to the
  -- unassigned variable and the whole function raised 'record "c" is not
  -- assigned yet' -- which the calling jq rendered as rows:null, i.e. as NO
  -- HITS. An erroring sweep must not be able to look like a clean one.
  for t_rec in
    select ic.table_name as tn, string_agg(
             format('(length(%I) >= 2 and left(%I,1) = %L and right(%I,1) = %L)',
                    ic.column_name, ic.column_name, '"', ic.column_name, '"'),
             ' or ') as ors
    from information_schema.columns ic
    join pg_class pgc on pgc.relname = ic.table_name
    join pg_namespace pgn on pgn.oid = pgc.relnamespace and pgn.nspname = 'public'
    where ic.table_schema = 'public'
      and ic.data_type in ('text','character varying')
      and pgc.relkind = 'r'
    group by ic.table_name
  loop
    execute format('select exists(select 1 from public.%I where %s)', t_rec.tn, t_rec.ors)
      into any_hit;
    continue when not any_hit;

    for c_rec in
      select ic2.column_name as cn
      from information_schema.columns ic2
      where ic2.table_schema = 'public' and ic2.table_name = t_rec.tn
        and ic2.data_type in ('text','character varying')
    loop
      execute format(
        'select count(*) from public.%I where length(%I) >= 2 and left(%I,1) = %L and right(%I,1) = %L',
        t_rec.tn, c_rec.cn, c_rec.cn, '"', c_rec.cn, '"') into n;
      if n > 0 then
        rel := t_rec.tn; col := c_rec.cn; hits := n; return next;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace view public.v_text_json_quoted_verdict as
with frozen(k) as (
  -- The exact 8 keys MP-499 grandfathered when it armed
  -- fn_system_settings_reject_json_quoted(). NAMED, not counted: MP-356's
  -- lesson is that a count-only floor is fungible, so repairing one frozen row
  -- would silently create headroom to absorb a NEW corruption somewhere else
  -- and the guard would stay green through a real regression.
  values ('apex_bots_primary_host'),('insuracloud_api_base_url'),
         ('insuracloud_api_token'),('manychat_api_token'),
         ('telegram_bot_id'),('telegram_invite_url'),
         ('telegram_webhook_set_at'),('telegram_webhook_url')
),
sweep as (select rel, col, hits from public.fn_text_json_quoted_sweep()),
novel_cols as (
  select rel, col, hits from sweep
  where not (rel = 'system_settings' and col = 'value')
),
novel_keys as (
  select s.key from public.system_settings s
  where length(s.value) >= 2 and left(s.value,1) = '"' and right(s.value,1) = '"'
    and s.key not in (select k from frozen)
),
frozen_left as (
  select s.key from public.system_settings s
  where length(s.value) >= 2 and left(s.value,1) = '"' and right(s.value,1) = '"'
    and s.key in (select k from frozen)
)
select
  (select count(*) from novel_cols)::int                                as novel_column_count,
  coalesce((select string_agg(rel||'.'||col||' ('||hits||')', ', ' order by rel, col) from novel_cols), '')  as novel_columns,
  (select count(*) from novel_keys)::int                                as novel_key_count,
  coalesce((select string_agg(key, ', ' order by key) from novel_keys), '')                                  as novel_keys,
  (select count(*) from frozen_left)::int                               as frozen_still_quoted,
  case
    when (select count(*) from novel_cols) > 0 then 'critical_new_column'
    when (select count(*) from novel_keys) > 0 then 'warn_settings_novel_key'
    else 'ok'
  end                                                                   as verdict;
-- SCOPE SPLIT, deliberate (MP-500). public.system_settings.value is NOT graded
-- critical here: apex-doctor Check #66 already owns it, with a STRICTLY
-- STRONGER operand -- it also reads trg_system_settings_reject_json_quoted's
-- tgenabled, which this view cannot see. Two checks deriving one question two
-- ways is how curl's --max-time and fn_agentlink_reap_stuck drifted into 36
-- false pages a day (MP-291), so the authority is single. novel_keys is kept
-- and surfaces as a WARN only, on MP-289's precedent: the fault must survive
-- Check #66 failing to read its own view, without two criticals about one row.
-- What this view uniquely owns is the OTHER 1,996 text columns.
