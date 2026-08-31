-- MP-340: stop mailing addresses that cannot exist.
--
-- Resend's own event log for the last 100 sends: 71 delivered, 24 SUPPRESSED,
-- 2 bounced. One of the two bounces went to "kaeden.vaughns@placeholder.apex" —
-- a synthetic address on a domain that does not resolve. Hard bounces are what
-- put real recipients onto a provider suppression list, so mailing placeholders
-- is not merely wasted: it degrades deliverability for everyone else on the
-- domain.
--
-- 8 profiles and 3 applications carry a placeholder address; 1 is attached to an
-- ACTIVE agent, so it is in the normal onboarding send path today.
--
-- This does not delete anything. A placeholder is a legitimate marker that a
-- real address was never collected — the roll call reports exactly that, and
-- only a human can supply the truth. It just marks them unsendable so no
-- automated path tries again.

begin;

create or replace function public.fn_email_is_sendable(p_email text)
returns boolean
language sql
immutable
as $function$
  select p_email is not null
     and btrim(p_email) <> ''
     and p_email like '%@%.%'
     and p_email not ilike '%placeholder%'
     and p_email not ilike '%@example.%'
     and p_email not ilike '%.apex'
     and p_email not ilike '%@test.%'
     -- Mistyped well-known providers. These bounce, and a bounce is what earns
     -- a suppression-list entry for the whole sending domain.
     and split_part(p_email, '@', 2) not in (
       'gmai.com','gmial.com','gmail.co','gmaill.com',
       'yaho.com','hotmial.com','outlok.com','iclou.com'
     );
$function$;

comment on function public.fn_email_is_sendable(text) is
  'MP-340: false for synthetic, malformed and mistyped-provider addresses. '
  'Mailing them produces hard bounces, and hard bounces are what put REAL '
  'recipients on the provider suppression list — measured at 24 suppressed of '
  'the last 100 sends.';

create or replace view public.v_unsendable_contacts
with (security_invoker = true) as
select a.id as agent_id,
       a.display_name,
       a.status::text as status,
       coalesce(p.email, ap.email) as email_on_file,
       case
         when coalesce(p.email, ap.email) is null then 'no address at all'
         when coalesce(p.email, ap.email) ilike '%placeholder%'
           or coalesce(p.email, ap.email) ilike '%.apex' then 'synthetic placeholder'
         else 'mistyped or malformed'
       end as reason
  from public.agents a
  left join public.profiles p on p.id = a.profile_id
  left join public.applications ap on ap.id = a.source_application_id
 where a.status = 'active'
   and coalesce(a.is_deactivated, false) = false
   and not public.fn_email_is_sendable(coalesce(p.email, ap.email));

comment on view public.v_unsendable_contacts is
  'MP-340: active agents no automated email can reach. Their manager has to '
  'supply a real address; nothing in code can invent one.';

grant select on public.v_unsendable_contacts to authenticated;

commit;
