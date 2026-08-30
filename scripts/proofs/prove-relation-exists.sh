#!/bin/bash
cd /Users/samjames/projects/rebuild-brighten-sparkle
G=scripts/check-relation-exists.mjs
FN=supabase/functions/notify-course-complete/index.ts
PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

run(){ node $G >/tmp/p.out 2>&1; echo $?; }

echo "== CONTROL: clean tree is green =="
[ "$(run)" = "0" ] && ok "clean tree exit 0" || no "clean tree should be green"
grep -q "0 new" /tmp/p.out && ok "control reports 0 new" || no "control missing '0 new'"

echo "== M1: restore the real bug (dead write in supabase/functions) =="
cp $FN /tmp/fn.bak
python3 - <<'PY'
p="supabase/functions/notify-course-complete/index.ts"
s=open(p).read()
a='    console.log(`Course completion processed for ${finalAgentName}`);'
assert s.count(a)==1
s=s.replace(a,'    await supabase.from("agent_onboarding").insert({ agent_id: agentId, stage: "x" });\n'+a)
open(p,"w").write(s)
PY
grep -q 'from("agent_onboarding")' $FN && ok "M1 mutation LANDED" || no "M1 mutation did NOT land"
[ "$(run)" = "1" ] && ok "M1 exit 1" || no "M1 should be red"
grep -q "agent_onboarding" /tmp/p.out && ok "M1 names agent_onboarding" || no "M1 did not name it"
grep -q "notify-course-complete" /tmp/p.out && ok "M1 proves supabase/functions scan load-bearing" || no "M1 missing file"
cp /tmp/fn.bak $FN

echo "== M2: cast/plain literal in an edge function naming a dead relation =="
cp supabase/functions/notify-course-complete/index.ts /tmp/eb2.bak
sed -i '' 's/\.from("agents")/.from("agents_DEAD" as any)/' supabase/functions/notify-course-complete/index.ts
grep -q 'agents_DEAD' supabase/functions/notify-course-complete/index.ts && ok "M2 mutation LANDED" || no "M2 mutation did NOT land"
[ "$(run)" = "1" ] && ok "M2 exit 1" || no "M2 should be red"
grep -q "agents_DEAD" /tmp/p.out && ok "M2 names the dead relation" || no "M2 missed the dead relation"
cp /tmp/eb2.bak supabase/functions/notify-course-complete/index.ts

echo "== M3: baseline entry that matches nothing (anti-rot) =="
cp $G /tmp/g.bak
sed -i '' 's|relation: "plaque_ig_post_queue"|relation: "plaque_ig_post_queue_GONE"|' $G
grep -q "plaque_ig_post_queue_GONE" $G && ok "M3 mutation LANDED" || no "M3 mutation did NOT land"
[ "$(run)" = "1" ] && ok "M3 exit 1" || no "M3 should be red"
grep -q "no longer match" /tmp/p.out && ok "M3 hits the anti-rot branch" || no "M3 wrong branch"
cp /tmp/g.bak $G

echo "== M4: emptied catalog must refuse, never grade 0-of-0 =="
cp scripts/data/relation-catalog.json /tmp/cat.bak
echo '{"relations":[]}' > scripts/data/relation-catalog.json
[ "$(python3 -c "import json;print(len(json.load(open('scripts/data/relation-catalog.json'))['relations']))")" = "0" ] && ok "M4 mutation LANDED" || no "M4 mutation did NOT land"
[ "$(run)" = "1" ] && ok "M4 exit 1" || no "M4 should refuse"
grep -q "refusing to grade" /tmp/p.out && ok "M4 refuses rather than passing" || no "M4 wrong branch"
cp /tmp/cat.bak scripts/data/relation-catalog.json

echo "== M5: a .schema() call must stop the run, not be mis-graded =="
cp supabase/functions/notify-course-complete/index.ts /tmp/eb2.bak
sed -i '' 's/^      \.from("agents")/      .schema("other").from("agents")/' supabase/functions/notify-course-complete/index.ts
grep -q '\.schema("other")' supabase/functions/notify-course-complete/index.ts && ok "M5 mutation LANDED" || no "M5 mutation did NOT land"
[ "$(run)" = "1" ] && ok "M5 exit 1" || no "M5 should refuse"
grep -q "calls .schema()" /tmp/p.out && ok "M5 refuses to guess at schema resolution" || no "M5 wrong branch"
cp /tmp/eb2.bak supabase/functions/notify-course-complete/index.ts

echo "== CONTROL 2: storage buckets must stay green (they are not relations) =="
[ "$(run)" = "0" ] && ok "restored tree green (storage.from buckets are not flagged as relations)" || { no "tree not restored"; cat /tmp/p.out; }

echo; echo "PASS=$PASS FAIL=$FAIL"; [ $FAIL -eq 0 ] || exit 1
