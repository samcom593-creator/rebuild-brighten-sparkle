-- Client Pipeline headline numbers were derived in JS from a client-side fetch
-- of agentlink_clients, which PostgREST silently caps at 1000 rows — so the
-- page showed "1,000 clients / 965 sold" when the book holds 1,906 / 1,062.
-- This RLS-scoped aggregate returns the true counts server-side (security_invoker
-- so admin sees all, manager sees downline, agent sees own — same as the table).
create or replace view public.v_client_pipeline_stats
with (security_invoker = on) as
select
  count(*)::int                                                                   as total,
  count(*) filter (where pipeline_stage = 'SOLD')::int                            as sold,
  count(*) filter (where pipeline_stage is not null
                     and pipeline_stage not in ('SOLD','INACTIVE'))::int          as in_flight,
  count(*) filter (where pipeline_stage is null)::int                             as unsorted,
  count(*) filter (where created_at > now() - interval '7 days')::int             as new_7d,
  count(*) filter (where callback_date is not null
                     and callback_date <= (now() + interval '1 day')::date
                     and callback_date >  (now() - interval '7 days')::date)::int  as callbacks_due,
  count(*) filter (where do_not_call)::int                                        as dnc,
  count(*) filter (where hostile_language_detected)::int                          as hostile,
  count(*) filter (where pipeline_stage is distinct from 'SOLD')::int             as hasnt_bought,
  count(*) filter (where pipeline_stage is not null
                     and pipeline_stage not in ('SOLD','INACTIVE','LOST'))::int   as hasnt_bought_active,
  count(*) filter (where last_contact_date is null
                     and pipeline_stage is distinct from 'SOLD'
                     and pipeline_stage is distinct from 'LOST')::int             as never_contacted,
  count(*) filter (where last_contact_date is not null
                     and last_contact_date < (now() - interval '30 days')::date
                     and pipeline_stage is distinct from 'SOLD'
                     and pipeline_stage is distinct from 'LOST')::int             as cold_after_touch,
  count(*) filter (where pipeline_stage = 'NEW_INITIAL')::int                     as f_new,
  count(*) filter (where pipeline_stage in ('WORKING','PITCHED'))::int            as f_working,
  count(*) filter (where pipeline_stage = 'ALMOST_THERE')::int                    as f_almost
from public.agentlink_clients;

grant select on public.v_client_pipeline_stats to anon, authenticated;
