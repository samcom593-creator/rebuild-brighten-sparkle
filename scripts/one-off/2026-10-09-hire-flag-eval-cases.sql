-- Re-run with bot-sql to prove the hire red-flag rules (supabase/migrations/20261009000000_hire_priority_flags.sql).
-- Expected: day 2 nothing red; day 3 and 4 Aflac + Ethos red only; day 5 all four; completed hire none; reparenting is an Ethos
-- red; AgentLink upline pending and incomplete profile are AgentLink reds; null days never flags.
select label, (e->>'aflac') aflac, (e->>'ethos') ethos, (e->>'first_contract') contract, (e->>'agentlink') agentlink, e->>'red_count' reds
from (values
 ('day2 nothing done',        public.hire_flag_eval(2,false,'not_on_sheet',false,null,0,0)),
 ('day3 nothing done',        public.hire_flag_eval(3,false,'not_on_sheet',false,null,0,0)),
 ('day4 nothing done',        public.hire_flag_eval(4,false,'not_on_sheet',false,null,0,0)),
 ('day5 nothing done',        public.hire_flag_eval(5,false,'not_on_sheet',false,null,0,0)),
 ('day9 all complete',        public.hire_flag_eval(9,true,'portal_created',true,953,0,0)),
 ('day9 ethos reparenting',   public.hire_flag_eval(9,true,'needs_reparenting',true,953,0,0)),
 ('day9 AL upline pending',   public.hire_flag_eval(9,true,'portal_created',true,953,0,1)),
 ('day9 AL profile incomplete',public.hire_flag_eval(9,true,'portal_created',true,953,2,0)),
 ('null days',                public.hire_flag_eval(null,false,null,false,null,null,null))
) t(label,e);
