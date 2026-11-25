-- Only these reporting contracts; encrypted transport, no generic SQL input.
select jsonb_build_object(
  'producer_profile_detail',pg_get_functiondef(to_regprocedure('public.producer_profile_detail(uuid)')),
  'scoped_production_projection_uncached',pg_get_functiondef(to_regprocedure('public.scoped_production_projection_uncached()')),
  'agent_carrier_book',pg_get_functiondef(to_regprocedure('public.agent_carrier_book(uuid)')),
  'home_conversion_people_range',pg_get_functiondef(to_regprocedure('public.home_conversion_people_range(date,date)')),
  'home_conversion_people_range_uncached',pg_get_functiondef(to_regprocedure('public.home_conversion_people_range_uncached(date,date)')),
  'production_policy_cohort',case when to_regprocedure('public.production_policy_cohort(date,date,uuid)') is not null
    then pg_get_functiondef(to_regprocedure('public.production_policy_cohort(date,date,uuid)')) end
) as definitions
