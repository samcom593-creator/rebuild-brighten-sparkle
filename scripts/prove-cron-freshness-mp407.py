#!/usr/bin/env python3
"""MP-407 proof: the AgentLink freshness verdict in external-cron-backup.yml.

WHY THIS EXISTS
  On 2026-09-03 runs 33787407080 (~17:26Z) and 33787585735 (18:00:09Z) each sent
  Sam a priority-5 push reading "No successful AgentLink sync for 99999999s ...
  The book is stale." Measured afterwards against agentlink_sync_log, the book
  was 10,612s and 12,661s old at those instants -- both UNDER the 14,400s bound,
  so the gate's OWN rule said acquit both times. 99999999 is a sentinel meaning
  "I could not read the log", printed as though it were a duration.

  The read was a single unretried curl. bot-sql blips under load; apex-doctor has
  wrapped it in a 3x/0-2-4s retry since 2026-07-19 and that hardening never
  reached this workflow.

WHAT IS GRADED
  The REAL bash, extracted from the workflow by marker, not a paraphrase. The
  extraction asserts its own markers landed first -- a harness that silently
  slices nothing passes every fixture while proving none.
"""
import io, os, re, subprocess, sys, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, '.github/workflows/external-cron-backup.yml')

START = 'MP-407: RETRIED.'
END_MARK = 'InsuraCloud revival probe'

REQUIRED_MARKERS = [
    'for fr_delay in 0 2 4', 'fr_parsed=', '"number"',
    'freshness=""', 'UNKNOWN, NOT measured', 'The book is stale.',
    'ok_age" -le "$STALE_MAX', 'break',
]


def extract():
    raw = io.open(WF, encoding='utf-8').read().split('\n')
    s = e = None
    for i, l in enumerate(raw):
        if START in l and s is None:
            s = i
        if s is not None and END_MARK in l:
            e = i
            break
    if s is None or e is None:
        sys.exit('FATAL: could not locate freshness block (markers moved)')
    body = raw[s:e]
    ind = min(len(b) - len(b.lstrip()) for b in body if b.strip())
    txt = '\n'.join(b[ind:] if b.strip() else '' for b in body)
    missing = [m for m in REQUIRED_MARKERS if m not in txt]
    if missing:
        sys.exit('FATAL: slice is missing markers, refusing to grade: %s' % missing)
    if 'curl' not in txt:
        sys.exit('FATAL: slice contains no curl -- wrong range')
    return txt


def run_case(block, responses, mutate=None):
    """responses: list of stdout strings, one per curl attempt ('' == failure)."""
    if mutate:
        block = mutate(block)
    d = tempfile.mkdtemp()
    try:
        binp = os.path.join(d, 'bin')
        os.makedirs(binp)
        io.open(os.path.join(d, 'responses'), 'w').write('\x00'.join(responses))
        io.open(os.path.join(d, 'n'), 'w').write('0')
        curl = os.path.join(binp, 'curl')
        io.open(curl, 'w').write(
            '#!/bin/bash\n'
            'n=$(cat "%s/n"); echo $((n+1)) > "%s/n"\n'
            'python3 -c "\nimport io,sys\nr=io.open(\'%s/responses\').read().split(chr(0))\ni=int(sys.argv[1])\nsys.stdout.write(r[i] if i < len(r) else \'\')\n" "$n"\n'
            % (d, d, d))
        os.chmod(curl, 0o755)
        sl = os.path.join(binp, 'sleep')
        io.open(sl, 'w').write('#!/bin/bash\nexit 0\n')   # keep the proof fast
        os.chmod(sl, 0o755)
        script = (
            'set -u\n'
            'STALE_MAX=14400\nSTALE_DETAIL=""\n'
            'BOT_SQL=http://stub\nBOT_TOKEN=stub\n'
            'FAILED=("edge:agentlink-cookie-sync" "other-job")\n'
            # The slice carries the `fi` that closes the workflow's OWN
            # "did curl fail?" guard, which sits above the slice. Supplying the
            # matching opener keeps every real line under grading; trimming the
            # `fi` would delete workflow bash from the proof instead.
            'if true; then\n'
            + block + '\n'
            'echo "RESULT_FAILED=${FAILED[*]-}"\n'
            'echo "RESULT_DETAIL=$STALE_DETAIL"\n'
            'echo "RESULT_ATTEMPTS=$(cat %s/n)"\n' % d)
        sp = os.path.join(d, 's.sh')
        io.open(sp, 'w').write(script)
        env = dict(os.environ)
        env['PATH'] = binp + os.pathsep + env['PATH']
        r = subprocess.run(['bash', sp], capture_output=True, text=True, env=env, timeout=60)
        return r.stdout + r.stderr
    finally:
        shutil.rmtree(d, ignore_errors=True)


def ok_body(age, status='stuck'):
    return '{"ok":true,"rows":[{"ok_age":%s,"last_status":"%s"}]}' % (age, status)


BLOCK = extract()
print('extracted %d lines of real workflow bash, all %d markers present\n'
      % (len(BLOCK.split('\n')), len(REQUIRED_MARKERS)))

passes = fails = 0


def check(name, cond, detail=''):
    global passes, fails
    if cond:
        passes += 1
        print('  PASS  %s' % name)
    else:
        fails += 1
        print('  FAIL  %s  %s' % (name, detail))


# ---- F1: the exact production regression -------------------------------------
o = run_case(BLOCK, [ok_body(12661)])
check('F1 book 12661s (real value at 18:00:09Z page) -> ACQUIT',
      'edge:agentlink-cookie-sync' not in o.split('RESULT_FAILED=')[1] and 'the pipeline is moving' in o, o[-300:])
check('F1 emits no fabricated sentinel', '99999999' not in o, o[-300:])

# ---- F2: genuinely stale ------------------------------------------------------
o = run_case(BLOCK, [ok_body(20000)])
check('F2 book 20000s -> stays RED and says stale',
      'The book is stale.' in o and 'edge:agentlink-cookie-sync' in o.split('RESULT_FAILED=')[1], o[-300:])
check('F2 reports the MEASURED number', '20000s' in o, o[-300:])

# ---- F3: three failed reads ---------------------------------------------------
o = run_case(BLOCK, ['', '', ''])
check('F3 unreadable -> stays RED (fail-loud preserved)',
      'edge:agentlink-cookie-sync' in o.split('RESULT_FAILED=')[1], o[-300:])
check('F3 says UNKNOWN, not a duration', 'UNKNOWN, NOT measured' in o, o[-300:])
check('F3 never prints 99999999 as an age', '99999999' not in o, o[-300:])
check('F3 does NOT claim the book is stale', 'The book is stale.' not in o, o[-300:])

# ---- F4: retry is load-bearing ------------------------------------------------
o = run_case(BLOCK, ['', '', ok_body(12661)])
check('F4 two blips then success -> ACQUIT on 3rd attempt',
      'the pipeline is moving' in o and 'RESULT_ATTEMPTS=3' in o, o[-300:])

# ---- F5: garbled (non-numeric) age -------------------------------------------
o = run_case(BLOCK, ['{"ok":true,"rows":[{"ok_age":"banana","last_status":"stuck"}]}'] * 3)
check('F5 non-numeric age rejected as unreadable, not coerced into a measurement',
      'UNKNOWN, NOT measured' in o and 'banana' not in o.split('RESULT_DETAIL')[0].split('verdict')[-1], o[-300:])

# ---- M1: remove the retry -> F4 must break ------------------------------------
def m1(b):
    out = b.replace('for fr_delay in 0 2 4; do', 'for fr_delay in 0; do')
    assert out != b, 'M1 mutation did not land'
    return out

o = run_case(BLOCK, ['', '', ok_body(12661)], mutate=m1)
check('M1 single-attempt read turns a recoverable blip into a page (retry load-bearing)',
      'the pipeline is moving' not in o and 'RESULT_ATTEMPTS=1' in o, o[-300:])

# ---- M2: restore the sentinel -> reproduces the shipped defect ----------------
def m2(b):
    out = b.replace(
        'STALE_DETAIL="Could not read agentlink_sync_log after 3 attempts',
        'ok_age=99999999; STALE_DETAIL="No successful AgentLink sync for ${ok_age}s (bound ${STALE_MAX}s). The book is stale. XX')
    assert out != b, 'M2 mutation did not land'
    return out

o = run_case(BLOCK, ['', '', ''], mutate=m2)
check('M2 sentinel restored -> reproduces the false "99999999s / book is stale" page',
      '99999999' in o and 'The book is stale.' in o, o[-300:])

print('\n%d passed, %d failed' % (passes, fails))
sys.exit(1 if fails else 0)
