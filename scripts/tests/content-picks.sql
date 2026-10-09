-- Behavioural proof for the Launch Board brief and dismissals (migration 20261009160000).
-- One transaction that ends in ROLLBACK: synthetic cards and dismissals are created, exercised under real role claims
-- (set local role authenticated + request.jwt.claims) and thrown away. No real card is read or changed.
-- Run:  python3 scripts/tests/run-content-picks.py     Expected: every row PASS.
begin;

create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public;

create or replace function pg_temp.as_user(uid uuid, stmt text, out ok boolean, out msg text, out state text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt;
    ok := true; msg := null; state := null;
  exception when others then
    ok := false; msg := sqlerrm; state := sqlstate;
  end;
  execute 'reset role';
end $$;

create or replace function pg_temp.check(t text, got text, want text) returns void language sql as
$$ insert into results(test, outcome, expected, pass) values (t, got, want, got is not distinct from want) $$;
grant execute on function pg_temp.check(text, text, text) to public;

do $$
declare
  v_admin uuid; v_nobody uuid := gen_random_uuid(); r record; n int;
begin
  select ur.user_id into v_admin from public.user_roles ur where ur.role = 'admin' limit 1;
  perform pg_temp.check('an admin exists for the role-based checks', (v_admin is not null)::text, 'true');

  -- 1. the brief defaults to an empty object, so every existing card is untouched
  insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner)
    values ('SYNTH plain', 'SH', 'short', 'REACH', '', '', 'idea', 0, '', 0, '', '', '', '');
  perform pg_temp.check('a card created without a brief gets an empty object', (select brief::text from public.content_cards where title = 'SYNTH plain'), '{}');

  -- 2. one live project per idea key
  insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner, brief)
    values ('SYNTH idea A', 'SH', 'short', 'REACH', '', '', 'idea', 0, '', 0, '', '', '', '', '{"idea_key":"synth:one"}');
  select * into r from pg_temp.as_user(v_admin, $q$
    insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner, brief)
    values ('SYNTH idea A again', 'SH', 'short', 'REACH', '', '', 'record', 0, '', 0, '', '', '', '', '{"idea_key":"synth:one"}') $q$);
  perform pg_temp.check('a second live card for the same idea key is refused', coalesce(r.state, 'accepted'), '23505');

  -- 3. an archived card does not block a new one, and a different key is fine
  update public.content_cards set archived_at = now() where title = 'SYNTH idea A';
  select * into r from pg_temp.as_user(v_admin, $q$
    insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner, brief)
    values ('SYNTH idea A live', 'SH', 'short', 'REACH', '', '', 'record', 0, '', 0, '', '', '', '', '{"idea_key":"synth:one"}') $q$);
  perform pg_temp.check('an archived card does not block a live card with the same key', coalesce(r.state, 'accepted'), 'accepted');
  select * into r from pg_temp.as_user(v_admin, $q$
    insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner, brief)
    values ('SYNTH idea B', 'SH', 'short', 'REACH', '', '', 'record', 0, '', 0, '', '', '', '', '{"idea_key":"synth:two"}') $q$);
  perform pg_temp.check('a different idea key is accepted', coalesce(r.state, 'accepted'), 'accepted');

  -- 4. restoring the archived card while a live one exists is refused, so the page must pick one
  select * into r from pg_temp.as_user(v_admin, $q$ update public.content_cards set archived_at = null where title = 'SYNTH idea A' $q$);
  perform pg_temp.check('un-archiving would create a second live card for the key and is refused', coalesce(r.state, 'accepted'), '23505');

  -- 5. cards with no idea_key never collide, however many there are
  insert into public.content_cards (title, brand, content_type, job, hook, caption, status, day, clip, sort, record_script, edit_prompt, cta, owner)
    select 'SYNTH many ' || g, 'SH', 'short', 'REACH', '', '', 'idea', 0, '', 0, '', '', '', '' from generate_series(1, 40) g;
  select count(*) into n from public.content_cards where title like 'SYNTH many %';
  perform pg_temp.check('forty cards without an idea key all insert', n::text, '40');

  -- 6. the brief must stay a small object
  select * into r from pg_temp.as_user(v_admin, $q$ update public.content_cards set brief = '[]'::jsonb where title = 'SYNTH plain' $q$);
  perform pg_temp.check('a brief that is not an object is refused', coalesce(r.state, 'accepted'), '23514');
  select * into r from pg_temp.as_user(v_admin, $q$ update public.content_cards set brief = jsonb_build_object('x', repeat('a', 20000)) where title = 'SYNTH plain' $q$);
  perform pg_temp.check('an oversized brief is refused', coalesce(r.state, 'accepted'), '23514');

  -- 7. dismissals: one row per idea, optional reason, bounded length, undo = delete that row only
  select * into r from pg_temp.as_user(v_admin, $q$ insert into public.content_idea_dismissals (idea_key, title, reason) values ('synth:d1', 'SYNTH dismissed', 'not my lane') $q$);
  perform pg_temp.check('an admin can dismiss an idea with a reason', coalesce(r.state, 'accepted'), 'accepted');
  select * into r from pg_temp.as_user(v_admin, $q$ insert into public.content_idea_dismissals (idea_key, title) values ('synth:d1', 'SYNTH dismissed') $q$);
  perform pg_temp.check('dismissing the same idea twice is refused, so a double tap cannot stack rows', coalesce(r.state, 'accepted'), '23505');
  select * into r from pg_temp.as_user(v_admin, $q$ insert into public.content_idea_dismissals (idea_key) values ('synth:d2') $q$);
  perform pg_temp.check('a reason is optional', coalesce(r.state, 'accepted'), 'accepted');
  select * into r from pg_temp.as_user(v_admin, $q$ insert into public.content_idea_dismissals (idea_key, reason) values ('synth:d3', repeat('x', 301)) $q$);
  perform pg_temp.check('a reason over 300 characters is refused', coalesce(r.state, 'accepted'), '23514');
  select * into r from pg_temp.as_user(v_admin, $q$ delete from public.content_idea_dismissals where idea_key = 'synth:d1' $q$);
  select count(*) into n from public.content_idea_dismissals where idea_key in ('synth:d1', 'synth:d2');
  perform pg_temp.check('Undo deletes exactly the one dismissal', n::text, '1');
  perform pg_temp.check('Undo never touches a card', (select count(*) from public.content_cards where title like 'SYNTH%')::text, '44');

  -- 8. access: a signed-in person who is neither admin nor invited sees and writes nothing
  select * into r from pg_temp.as_user(v_nobody, $q$ insert into public.content_idea_dismissals (idea_key) values ('synth:x') $q$);
  perform pg_temp.check('an uninvited user cannot dismiss', coalesce(r.state, 'accepted'), '42501');
  perform set_config('request.jwt.claims', json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.content_idea_dismissals;
  execute 'reset role';
  perform pg_temp.check('an uninvited user reads zero dismissals', n::text, '0');
  select * into r from pg_temp.as_user(v_nobody, $q$ update public.content_cards set brief = '{"idea_key":"hijack"}' where title = 'SYNTH plain' $q$);
  perform pg_temp.check('an uninvited user cannot change a card brief (the update matches zero rows)', (select brief::text from public.content_cards where title = 'SYNTH plain'), '{}');
  select * into r from pg_temp.as_user(null, $q$ select 1 $q$);

  -- 9. anonymous has no access to the dismissals table at all
  select * into r from pg_temp.as_user(v_nobody, $q$ set local role anon; select count(*) from public.content_idea_dismissals $q$);
  perform pg_temp.check('the anon role cannot read dismissals', coalesce(r.state, 'accepted'), '42501');
end $$;

select case when pass then 'PASS' else 'FAIL' end as verdict, test, outcome, expected from results order by n;
rollback;
