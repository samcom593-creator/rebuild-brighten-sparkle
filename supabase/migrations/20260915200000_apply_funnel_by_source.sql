-- MP-541: /apply conversion, split by the traffic source that produced the session.
--
-- WHY THIS EXISTS
-- MP-538 proved the /apply conversion decline is real (recent 28d vs baseline)
-- and left "why" open. MP-540 eliminated page speed (/apply p75 1,632ms).
-- This wave eliminated two more leads by measurement and found where the drop
-- actually lives:
--
--   * NOT device-specific. desktop 17.3% -> 8.7%, mobile 23.1% -> 14.9%.
--     Both fell by a similar factor, and recent desktop is n=23 with 2
--     conversions, which cannot carry a claim either way.
--   * NOT a deploy step-change. Weekly series slides gradually from 36.6%
--     (w/c 06-01) to ~13% (09-07). A code regression produces a step; this
--     does not have one.
--   * IT IS CONCENTRATED BY SOURCE. Meta/social 21.4% -> 5.8% while direct
--     held at 39.5% -> 28.8%. Meta/social is 44% of recent /apply traffic,
--     so it dominates the blended number that MP-538's check grades.
--
-- Nothing measured conversion by source before this. v_funnel_by_source is a
-- different question -- it grades applications AFTER they are submitted
-- (application -> ica_paid), so it cannot see people who never submitted.
--
-- WHAT IS DELIBERATELY *NOT* DONE HERE
-- single_pageview_sessions is REPORTED, never subtracted. A converted session
-- must emit a second page_view (/apply/success is its own URL), so a session
-- with exactly one page_view cannot convert by construction -- 0 of 878 such
-- sessions converted in 4.5 months, an exceptionless rate that is what a
-- structural impossibility looks like, not a behavioural one. It is tempting
-- to drop them from the denominator to get a "truer" rate. That would be
-- wrong: a real human who lands on /apply and leaves is a real conversion
-- failure and belongs in the denominator, and a prefetch that never had a
-- human behind it does not -- and both produce exactly one page_view. The
-- column cannot separate them, so this view refuses to, and publishes the
-- count so any consumer can see how much of its denominator is in that state.
-- Separating them needs an engagement event a prefetch cannot fake;
-- apply_field_first_input (MP-539) is that instrument and is days old.
--
-- NO VERDICT COLUMN, on purpose. Recent per-source n is 3-86 sessions with
-- 0-15 conversions. Any threshold over those counts flips on one applicant,
-- which is the flapping guard this codebase keeps having to retire.
create or replace view v_apply_funnel_by_source as
with pv as (
  select
    e.session_id,
    e.created_at,
    e.user_agent,
    e.url,
    e.properties->>'referrer' as ref,
    e.properties->>'search'   as qs,
    row_number() over (partition by e.session_id order by e.created_at) as rn
  from analytics_events e
  where e.event_name = 'navigation.page_view'
    and e.user_id is null
    and e.created_at >= greatest('2026-05-04'::timestamptz, now() - '182 days'::interval)
), sess as (
  select
    session_id,
    min(created_at) as first_seen,
    max(user_agent) as ua,
    count(*)        as pv_count,
    bool_or(url = '/apply')            as saw_apply,
    bool_or(url like '/apply/success%') as saw_success,
    max(ref) filter (where rn = 1) as first_ref,
    max(qs)  filter (where rn = 1) as first_qs
  from pv
  group by session_id
), tagged as (
  select
    first_seen, saw_success, pv_count,
    -- Same synthetic filter as v_apply_funnel_conversion. Kept identical on
    -- purpose: if the two views disagree about who is a robot, the split
    -- cannot be reconciled against the blended number it is meant to explain.
    coalesce(ua,'') ~* 'headless|bot|crawl|spider|playwright|puppeteer|curl|python|lighthouse' as synthetic,
    case
      when coalesce(first_ref,'') ~* 'instagram|facebook|fb\.'
        or coalesce(first_qs,'')  ~* 'utm_source=ig|fbclid'   then 'meta_social'
      when coalesce(first_qs,'')  ~* 'mcp_token'              then 'readymode_dialer'
      when coalesce(first_qs,'')  ~* 'ref='                   then 'recruiter_ref'
      when coalesce(first_ref,'') ~* 'google|bing'            then 'search'
      when coalesce(first_ref,'') = ''                        then 'direct'
      else 'other'
    end as source_class
  from sess
  where saw_apply
)
select
  source_class,
  case when first_seen >= now() - '28 days'::interval then 'recent_28d' else 'baseline' end as window_label,
  count(*)::int                                          as sessions,
  count(*) filter (where saw_success)::int               as conversions,
  round(100.0 * count(*) filter (where saw_success) / nullif(count(*),0), 1) as conv_pct,
  count(*) filter (where pv_count = 1)::int              as single_pageview_sessions,
  min(first_seen)                                        as first_session_at,
  max(first_seen)                                        as last_session_at
from tagged
where not synthetic
group by 1, 2
order by 1, 2;

comment on view v_apply_funnel_by_source is
  'MP-541. /apply session -> /apply/success conversion split by first-touch traffic source, recent 28d vs baseline. Explains the MP-538 decline: it is concentrated in meta_social (21.4%% -> 5.8%%), not device-specific and not a deploy step-change. single_pageview_sessions is reported, never subtracted -- such a session cannot convert by construction, but real bounces and prefetches are indistinguishable at that grain. No verdict column: per-source recent n is too small to threshold without flapping.';
