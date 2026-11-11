-- recruit-channel-attribution (2026-11-10). The July inflow collapse (-69%) was lost channels,
-- not a broken site: Snapchat reposts of the IG bio link (43% of the drop), downline ManyChat
-- pages (KJ pid 2883485, Xaviar pid 5110567: 21%), downline ref links (18%), then in late August
-- Sam's own bio link + ManyChat DM link (pid 1696173) stopped producing clicks. Each went dark
-- silently for weeks because no view classified an application by channel: the ManyChat page id
-- only lives inside the base64 mcp_token in consent_source_url, the ref code inside ?ref=, and
-- the in-app browser inside consent_user_agent.
--
-- Read-only derivation (views + one parsing function): no column writes, so none of the ~50
-- triggers on applications fire, and every future application is classified automatically.
-- Admin-only: revoked from anon/authenticated; the doctor reads with the service role.

create or replace function public.fn_manychat_page_id(p_url text)
returns text language plpgsql immutable set search_path to 'public' as $fn$
declare
  v_tok text := substring(p_url from 'mcp_token=([A-Za-z0-9_-]+)\.');
begin
  if v_tok is null then return null; end if;
  return convert_from(decode(rpad(translate(v_tok, '-_', '+/'), ((length(v_tok) + 3) / 4) * 4, '='), 'base64'), 'UTF8')::jsonb ->> 'pid';
exception when others then
  return null;  -- a malformed token is "unknown page", never an error in a reporting view
end $fn$;

create or replace view public.v_application_channel with (security_invoker = true) as
with a as (
  select a.id as application_id,
         a.created_at,
         date_trunc('week', a.created_at at time zone 'America/Phoenix')::date as week,
         a.license_status::text as license_status,
         coalesce(a.consent_user_agent, '') as ua,
         public.fn_manychat_page_id(a.consent_source_url) as manychat_page_id,
         upper(substring(a.consent_source_url from '[?&]ref=([A-Za-z0-9_-]+)')) as ref_raw,
         lower(nullif(btrim(a.utm_source), '')) as utm_source
    from public.applications a
   where coalesce(a.record_type, 'application') = 'application'
     and coalesce(a.is_duplicate, false) = false
), r as (
  select a.*,
         ag.agent_code as ref_agent_code,
         ag.display_name as ref_owner,
         case
           when a.ua ilike '%Instagram%' then 'instagram_app'
           when a.ua ~* 'Snapchat' then 'snapchat_app'
           when a.ua ~* 'musical_ly|Bytedance|TikTok' then 'tiktok_app'
           when a.ua ~* 'FBAN|FBAV|FB_IAB' then 'facebook_app'
         end as in_app
    from a
    left join lateral (
      select g.agent_code, g.display_name from public.agents g
       where a.ref_raw is not null
         and (upper(g.agent_code) = a.ref_raw or upper(g.ref_slug) = a.ref_raw)
       order by (g.status::text = 'active') desc limit 1
    ) ag on true
)
select application_id, created_at, week, license_status, manychat_page_id,
       coalesce(ref_agent_code, ref_raw) as ref_code, ref_owner, in_app, utm_source,
       case
         -- Known ManyChat pages (owner verified 2026-11-10 against the ManyChat API).
         when manychat_page_id = '1696173' then 'manychat:sam'
         when manychat_page_id = '2883485' then 'manychat:KJV01'
         when manychat_page_id = '5110567' then 'manychat:XWATTS01'
         when manychat_page_id is not null then 'manychat:' || manychat_page_id
         -- Sam's own codes don't name a channel; a downline code does.
         when coalesce(ref_agent_code, ref_raw) is not null
              and coalesce(ref_agent_code, ref_raw) not in ('SJAMES01', 'SJAMES02')
              and coalesce(ref_raw, '') not like 'SAM%JAMES%' then 'ref:' || coalesce(ref_agent_code, ref_raw)
         when in_app is not null then in_app
         when utm_source is not null then 'utm:' || utm_source
         when ua ~* 'iPhone|Android' then 'mobile_web'
         when ua <> '' then 'desktop_web'
         else 'unknown'
       end as channel
  from r;

create or replace view public.v_recruit_channel_weekly with (security_invoker = true) as
select week, channel, count(*)::int as applications,
       count(*) filter (where license_status = 'licensed')::int as licensed
  from public.v_application_channel
 group by 1, 2;

-- A channel is dark when it averaged >= 2 applications a week over the 6 weeks before the
-- last 14 days and produced none in those 14 days. Fires once per channel episode while dark;
-- a channel that was already near zero is history, not news (it cannot fire on old deaths).
create or replace view public.v_recruit_channel_dark with (security_invoker = true) as
with c as (
  select channel,
         count(*) filter (where created_at >= now() - interval '56 days' and created_at < now() - interval '14 days') as baseline_6wk,
         count(*) filter (where created_at >= now() - interval '14 days') as last_14d,
         max(created_at) as last_application_at
    from public.v_application_channel
   group by channel
)
select channel, round(baseline_6wk / 6.0, 1) as baseline_per_week, last_14d,
       last_application_at, (now()::date - last_application_at::date) as days_since_last
  from c
 where baseline_6wk >= 12 and last_14d = 0;

revoke all on public.v_application_channel, public.v_recruit_channel_weekly, public.v_recruit_channel_dark from anon, authenticated;
revoke all on function public.fn_manychat_page_id(text) from public, anon;
