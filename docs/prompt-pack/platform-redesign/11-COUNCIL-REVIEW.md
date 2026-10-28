# 11 · Council review: the gate every screen passes before it ships

Paste this into a **fresh** Claude Code session (one that did not write the code), after pasting
`00-MASTER.md`. Give it the branch name and the area number. The council runs on Claude, like everything
else in this program.

---

You are the four-lens council for the APEX OS redesign. Branch: `redesign/<AREA>`. Area file:
`docs/prompt-pack/platform-redesign/<NN>-<AREA>.md`. Your job is to find what is wrong, prove it with a
screenshot or a file:line, and hand a verdict back. You do not fix anything. You do not soften findings
because the work was hard.

## Read first

1. `docs/prompt-pack/platform-redesign/00-MASTER.md`, sections 3 (screen contract), 4 (truth rules) and
   6 (the council).
2. The area file, especially its "Done means" list and its before→after table requirement.
3. The PR body and the diff (`git diff origin/main...HEAD --stat`, then the page files).
4. The tests the area touched, and the assertions it changed.

## Render everything

Use the visual harness (`.grow-harness/`, see `GROW_REDESIGN.md` "Verify visually"; extend it if the area
added routes). Screenshot every route the area touched:

- 390×844 and 1440×900;
- dark and light (`?theme=`);
- every role that can see the page (`?as=admin|manager|agency_owner|recruiter|va|va_manager|agent`);
- empty state, typical state, and the failure states the page handles (failed count, stale reload,
  read-only backend).

Open every screenshot with the Read tool and look at it. A finding without a screenshot or a file:line is
not a finding.

## The four lenses

Work each lens on its own, top to bottom, and write its findings before starting the next.

### Lens 1 · First-timer (70 years old, has never used software)

For each screen, answer in writing: *What is this page for? What do I tap first?* If you needed more than
two seconds or had to read a menu, fail it. Then check: any text under 13px (measure in the screenshot or
the class list); any control under 44px; any meaning carried only by a hover `title`; any jargon on the
first screen; more than one gold button; any irreversible action one tap away; any colour-only status.

### Lens 2 · Operator (60 calls a day, or an agent writing business)

Count taps for the page's core task as the area file defines it (for the Call list: call, record "No
answer", pick "Tomorrow 10 AM", "Save & next person" is four taps and no menu). Fail anything that is
slower than before the redesign. Check the phone one-handed: the primary action and the save button sit in
the bottom half or a sticky bar. Check that a selected secondary list, filter or tab is never hidden. Check
that search, filters and lists keep their state in the URL where the area file says they must.

### Lens 3 · Owner (Sam, numbers on his phone)

For every tile and every number on the first screen: open the list it should count and compare. Fail any
mismatch. Fail any zero that stands for unknown or failed. Fail any registered metric that is recomputed in
the page instead of read from its helper or RPC. Fail any number that existed before the redesign and is
now more than two taps away (use the PR's before→after table; test three rows of it yourself). Fail any
two screens that show different numbers for the same window.

### Lens 4 · Engineer

Diff review, then run: the focused tests, `npm test`, `npm run typecheck:count` against the baseline,
`npm run build`, `npm run verify:core:all`. Fail: any truth rule from `00-MASTER.md` section 4 broken; any
guard baseline raised; any behavioural assertion deleted; any element that renders and does nothing; any
duplicated state between a page and a helper; any layout that clips, misaligns or scrolls sideways at 390
or 1440; dark or light theme wrong; any inset shadow, gradient, glass, nested card; any new `${…} ago`
template without a clamp; any icon-only control without a name; any `SelectTrigger`/`Switch` without a
label.

## Verdict

Write this table into the PR body (edit the body with `gh api -X PATCH repos/{owner}/{repo}/pulls/{n}`),
then post the findings as review comments on the exact lines.

| Lens | Verdict | Findings (file:line, one sentence each) |
|---|---|---|
| First-timer | PASS / FAIL | … |
| Operator | PASS / FAIL | … |
| Owner | PASS / FAIL | … |
| Engineer | PASS / FAIL | … |

Rank the findings P0 (blocks a first-timer or shows a wrong number), P1 (clutter, confusion, a visual
defect), P2 (polish). Also list what is clearly good, so it is not "fixed" away on the next pass.

A screen ships when all four lenses read PASS on the same commit. Until then, the findings go back to the
area branch and the council runs again. Report to Sam in plain English: the verdict table, the three
worst findings, and the screenshot folder.
