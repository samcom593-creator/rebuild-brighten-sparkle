-- Keep referral attribution and eligibility unchanged while generated links use
-- the current public site. This edits two exact URL literals, not stored records.
begin;

do $migration$
declare
  target record;
  before_definition text;
  expected_definition text;
  after_definition text;
  old_count integer;
  new_count integer;
  before_acl aclitem[];
  before_owner oid;
begin
  for target in
    select * from (values
      ('public.my_recruiting_link()', '''https://apex-financial.org/apply?ref=''', '''https://galaxyfinancial.org/apply?ref='''),
      ('public.my_referral_status()', '''https://apex-financial.org/r/''', '''https://galaxyfinancial.org/r/''')
    ) as links(signature, old_literal, new_literal)
  loop
    select pg_get_functiondef(p.oid), p.proacl, p.proowner
      into strict before_definition, before_acl, before_owner
      from pg_proc p where p.oid = target.signature::regprocedure;
    old_count := (length(before_definition)-length(replace(before_definition,target.old_literal,'')))/length(target.old_literal);
    new_count := (length(before_definition)-length(replace(before_definition,target.new_literal,'')))/length(target.new_literal);

    if old_count=1 and new_count=0 then
      expected_definition := replace(before_definition,target.old_literal,target.new_literal);
      execute expected_definition;
    elsif old_count=0 and new_count=1 then
      expected_definition := before_definition;
    else
      raise exception 'Unexpected URL literal in %; referral link origin was not changed.', target.signature;
    end if;

    select pg_get_functiondef(p.oid) into strict after_definition
      from pg_proc p where p.oid = target.signature::regprocedure;
    if after_definition is distinct from expected_definition or exists (
      select 1 from pg_proc p where p.oid = target.signature::regprocedure
        and (p.proacl is distinct from before_acl or p.proowner is distinct from before_owner)
    ) then
      raise exception 'Referral definition or privileges changed unexpectedly for %.', target.signature;
    end if;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
