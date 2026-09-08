#!/usr/bin/env bash
# MP-472 — proof for check-recruiting-contact-actions.
#
# Every mutation asserts it LANDED before its verdict is believed: this harness
# caught its own author twice (an anchor that did not exist, and a synthetic
# shadow that TypeScript would have rejected), and a mutation that silently no-ops
# reports PASS while proving nothing.
set -u
cd "$(dirname "$0")/../.."
G=scripts/check-recruiting-contact-actions.mjs
AH=src/components/onboarding/ApplicantHome.tsx
W=src/pages/HiringPipeline.tsx
HL=src/components/hires/HireLaunchBoard.tsx
for f in "$G" "$AH" "$W" "$HL"; do cp "$f" "/tmp/mp472.$(basename "$f").bak"; done
restore(){ for f in "$G" "$AH" "$W" "$HL"; do cp "/tmp/mp472.$(basename "$f").bak" "$f"; done; }
trap restore EXIT
pass=0; fail=0
t(){ if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "  PASS $3"; else fail=$((fail+1)); echo "  FAIL $3 (exit $1, wanted $2)"; fi; }
landed(){ if [ "$1" = "0" ]; then echo "  [mutation landed]"; else echo "  [MUTATION DID NOT LAND — verdict below proves nothing]"; fi; }

echo "P0 — clean tree"
node "$G" >/dev/null 2>&1; t $? 0 "clean tree is green"

echo "M1 — the site marker is not an off switch"
python3 -c "
p='$AH'; s=open(p).read()
old=\"// contact-scheme-allow: inbound control on a non-operator surface — applicant reaching APEX's own number, native handoff is correct here\"
assert s.count(old)==1; open(p,'w').write(s.replace(old,'// contact-scheme-allow:'))"
grep -q "^// contact-scheme-allow:$" "$AH"; landed $?
node "$G" >/dev/null 2>&1; t $? 1 "marker with no prose reason FAILS"
restore

echo "M2 — the marker is what clears the exempted site"
python3 -c "
p='$AH'; s=open(p).read()
old=\"// contact-scheme-allow: inbound control on a non-operator surface — applicant reaching APEX's own number, native handoff is correct here\n\"
assert s.count(old)==1; open(p,'w').write(s.replace(old,''))"
! grep -q "contact-scheme-allow" "$AH"; landed $?
node "$G" >/dev/null 2>&1; t $? 1 "removing the marker restores the violation"
restore

echo "M3 — a raw scheme outside JSX on a watched operator surface"
python3 -c "
p='$W'; s=open(p).read()
open(p,'w').write(s.replace('export default','const dead = (r) => \`tel:\${r.phone}\`;\nexport default',1))"
grep -q 'const dead = (r) => `tel:' "$W"; landed $?
node "$G" >/dev/null 2>&1; t $? 1 "helper-returned raw href FAILS (was laundered by the 39,925-char slab)"
restore

echo "M4 — the scoping fix is load-bearing (real pre-fix HireLaunchBoard from git)"
git show HEAD:"$HL" > "$HL"
grep -q 'return digits.length >= 10 ? `tel:' "$HL"; landed $?
node "$G" >/dev/null 2>&1; t $? 1 "fixed scope + import test CATCH the shipped shadow"
python3 - <<'EOF'
p="scripts/check-recruiting-contact-actions.mjs"; s=open(p).read()
i=s.index("function enclosingTag(text, index) {")
j=s.index("\n}\n", i) + 3
old='''function enclosingTag(text, index) {
  let start = index;
  while (start > 0 && text[start] !== "<") start -= 1;
  let depth = 0;
  let end = index;
  while (end < text.length) {
    const c = text[end];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth <= 0) break;
    end += 1;
  }
  return text.slice(start, Math.min(end + 1, text.length));
}
'''
s = s[:i] + old + s[j:]
s = s.replace("const guarded = realHelper && /phoneHref\\(|smsHref\\(/.test(tag);",
              "const guarded = /phoneHref\\(|smsHref\\(/.test(tag);")
open(p,"w").write(s)
EOF
grep -q "The match must actually fall inside the tag" "$G"; [ $? -ne 0 ]; landed $?
node "$G" >/dev/null 2>&1; t $? 0 "the PRE-FIX guard reports that same shadow GREEN"
restore

echo "P1 — tree restored"
node "$G" >/dev/null 2>&1; t $? 0 "green again"
echo; echo "MP-472 proof: PASS=$pass FAIL=$fail"
[ "$fail" = "0" ]
