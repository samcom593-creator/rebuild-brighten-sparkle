#!/usr/bin/env python3
"""
MP-478 — recover the source of a DEPLOYED Supabase edge function.

WHY THIS EXISTS
  scripts/data/deployed-function-orphans.json lists edge functions that are ACTIVE
  in prod with no source in this repo. Each is code that exists in exactly one place
  on earth: the Supabase edge runtime. Until MP-476 put a working Management
  credential on the machine, there was no way to read it back. This is that way.

WHAT YOU GET, AND WHAT YOU DO NOT
  The runtime stores the TRANSPILED module, so recovery is LOSSY in a specific,
  measured way. Diffed against check-stale-onboarding, whose real source IS in the
  repo (14032B repo vs 13682B recovered, 346 diff lines):
      PRESERVED : all comments, all string literals, identifiers, control flow, logic
      LOST      : TypeScript types -- `interface` blocks vanish entirely, `!`
                  non-null assertions are stripped, annotations erased
      CHANGED   : formatting is normalised to Deno's emit
  So the output is behaviourally-equivalent JavaScript, NOT the original file.
  Never present it as the original, and never deploy it over prod without a human
  reading it first -- for create-va-account / set-va-account that would be pushing a
  machine-recovered transpilation over a live auth-level ban/unban path.

FORMAT NOTE -- the bug this script was almost shipped with
  eszip v2.3 section lengths: options u32, header u32, npm u32, sources u32, maps u32.
  A first cut read sources_len as u64 and PASSED, because every archive it was tested
  on had npm_len == 0, so the u64 read spanned (npm_len<<32 | sources_len) and happened
  to equal the right number. It blew up on billing-portal-redirect, the first archive
  with npm dependencies. --selftest below reproduces exactly that fixture and asserts
  the u64 misread fails on it, so the lesson cannot silently regress.

USAGE
  export SUPABASE_MGMT_TOKEN=$(cat ~/.config/apex-creds/call-lab-deploy.token)
  ./scripts/recover-edge-function-source.py --slug billing-portal-redirect
  ./scripts/recover-edge-function-source.py --slug apex-ai-nudge --out /tmp/x.ts
  ./scripts/recover-edge-function-source.py --list-active
  ./scripts/recover-edge-function-source.py --selftest
"""
import argparse, hashlib, json, os, struct, sys, urllib.request

PROJECT_REF = "xrzweoneiieddzxogewk"
API = "https://api.supabase.com/v1/projects"


def parse_eszip(buf):
    """Return [(specifier, source_bytes, module_kind), ...] from an eszip v2 archive.

       magic(8) | u32 options_len | options
                | u32 header_len  | header
                | u32 npm_len     | npm snapshot
                | u32 sources_len | sources
                | u32 maps_len    | maps
       header entry: u32 spec_len | spec | u8 kind
         0 module:   u32 src_off | u32 src_len | u32 map_off | u32 map_len | u8 mod_kind
         1 redirect: u32 target_len | target
         2 npm:      u32 index into the npm snapshot
    """
    if not buf.startswith(b"ESZIP"):
        raise ValueError(f"not an eszip archive: {buf[:8]!r}")
    p = 8
    (olen,) = struct.unpack_from(">I", buf, p); p += 4 + olen
    (hlen,) = struct.unpack_from(">I", buf, p); p += 4
    header = buf[p:p + hlen]; p += hlen
    if len(header) != hlen:
        raise ValueError(f"header truncated: want {hlen}, got {len(header)}")
    (npmlen,) = struct.unpack_from(">I", buf, p); p += 4 + npmlen
    (slen,) = struct.unpack_from(">I", buf, p); p += 4
    sources = buf[p:p + slen]
    if len(sources) != slen:
        raise ValueError(f"sources truncated: want {slen}, got {len(sources)} (npm_len={npmlen})")

    mods, hp = [], 0
    while hp < len(header):
        (spec_len,) = struct.unpack_from(">I", header, hp); hp += 4
        spec = header[hp:hp + spec_len].decode("utf-8", "replace"); hp += spec_len
        kind = header[hp]; hp += 1
        if kind == 0:
            off, ln, _moff, _mln = struct.unpack_from(">IIII", header, hp); hp += 16
            mkind = header[hp]; hp += 1
            if off + ln > slen:
                raise ValueError(f"source range {off}+{ln} escapes sources ({slen}) for {spec}")
            mods.append((spec, sources[off:off + ln], mkind))
        elif kind == 1:
            (tlen,) = struct.unpack_from(">I", header, hp); hp += 4 + tlen
        elif kind == 2:
            hp += 4
        else:
            raise ValueError(f"unknown header entry kind {kind} for {spec}")
    # Load-bearing: this is what proves the field widths above are right. A wrong
    # width desynchronises the walk and lands mid-entry instead of on the boundary.
    if hp != len(header):
        raise ValueError(f"header not fully consumed: stopped at {hp} of {len(header)}")
    return mods


def entrypoint(mods):
    """The deployed user code: the single module with no URL scheme that is not one of
       the runtime's own ---NAME--- pseudo-modules. Deploy tooling varies the path --
       the CLI emits `<slug>/index.ts`, MCP deploys emit `source/index.ts` -- so it must
       never be guessed from the slug."""
    cand = [m for m in mods
            if "://" not in m[0] and not m[0].startswith("---") and not m[0].startswith("npm:")]
    if len(cand) != 1:
        raise ValueError(f"expected exactly 1 local module, found {len(cand)}: {[c[0] for c in cand]}")
    return cand[0]


def _get(url, token, binary=False):
    # The User-Agent is load-bearing. api.supabase.com returns 403 Forbidden to the
    # default "Python-urllib/3.x" UA on the very same URL + token that answers 200 to
    # curl. That 403 is indistinguishable from "this token lacks the privilege" and
    # would send the next reader off to rotate a perfectly good credential.
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "apex-recover-edge-function-source/1.0",
    })
    with urllib.request.urlopen(req, timeout=90) as r:
        body = r.read()
    return body if binary else json.loads(body)


def _build_fixture(npm_len):
    """Minimal one-module eszip. With npm_len>0 a u64 sources_len read is guaranteed
       wrong, which is the whole point of the regression case."""
    spec, src = b"source/index.ts", b"export const x = 1;\n"
    header = struct.pack(">I", len(spec)) + spec + bytes([0]) + \
        struct.pack(">IIII", 0, len(src), 0, 0) + bytes([0])
    return (b"ESZIP2.3" + struct.pack(">I", 4) + b"\x00\x00\x01\x00"
            + struct.pack(">I", len(header)) + header
            + struct.pack(">I", npm_len) + b"\x00" * npm_len
            + struct.pack(">I", len(src)) + src
            + struct.pack(">I", 0)), src


def selftest():
    fails = []

    def check(name, cond, detail=""):
        print(f"  {'PASS' if cond else 'FAIL'}  {name}{'  ' + detail if detail and not cond else ''}")
        if not cond:
            fails.append(name)

    print("eszip parser selftest")
    for npm_len in (0, 896):
        buf, src = _build_fixture(npm_len)
        try:
            got = entrypoint(parse_eszip(buf))[1]
            check(f"npm_len={npm_len}: source recovered exactly", got == src, f"got {got!r}")
        except Exception as e:
            check(f"npm_len={npm_len}: source recovered exactly", False, str(e))

    # The regression itself: prove a u64 sources_len IS wrong when npm_len != 0, and
    # prove it would have looked correct when npm_len == 0. Asserting the mutation
    # actually bites before believing the fix.
    def parse_u64(buf):
        p = 8
        (olen,) = struct.unpack_from(">I", buf, p); p += 4 + olen
        (hlen,) = struct.unpack_from(">I", buf, p); p += 4 + hlen
        (slen,) = struct.unpack_from(">Q", buf, p)
        return slen

    buf0, src = _build_fixture(0)
    check("u64 misread looks correct at npm_len=0 (why it survived)", parse_u64(buf0) == len(src))
    buf1, _ = _build_fixture(896)
    check("u64 misread is WRONG at npm_len=896 (the regression)", parse_u64(buf1) != len(src),
          f"u64 gave {parse_u64(buf1)}")

    # A truncated archive must raise, never return a short read as if it were source.
    try:
        parse_eszip(buf1[:-5])
        check("truncated archive raises instead of returning a short read", False)
    except ValueError:
        check("truncated archive raises instead of returning a short read", True)

    print(f"\n{'SELFTEST PASS' if not fails else 'SELFTEST FAIL: ' + ', '.join(fails)}")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug")
    ap.add_argument("--out")
    ap.add_argument("--project-ref", default=PROJECT_REF)
    ap.add_argument("--list-active", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()

    token = os.environ.get("SUPABASE_MGMT_TOKEN", "").strip()
    if not token:
        sys.exit("SUPABASE_MGMT_TOKEN is not set. "
                 "export SUPABASE_MGMT_TOKEN=$(cat ~/.config/apex-creds/call-lab-deploy.token)")

    if a.list_active:
        for f in _get(f"{API}/{a.project_ref}/functions", token):
            if f["status"] == "ACTIVE":
                print(f"{f['slug']:40s} v{f['version']:<5} verify_jwt={str(f.get('verify_jwt')).lower()}")
        return 0

    if not a.slug:
        sys.exit("--slug is required (or --list-active / --selftest)")

    meta = _get(f"{API}/{a.project_ref}/functions/{a.slug}", token)
    raw = _get(f"{API}/{a.project_ref}/functions/{a.slug}/body", token, binary=True)
    spec, src, _ = entrypoint(parse_eszip(raw))
    sys.stderr.write(f"{a.slug}: v{meta['version']} verify_jwt={meta.get('verify_jwt')} "
                     f"entrypoint={spec} bytes={len(src)} sha256={hashlib.sha256(src).hexdigest()[:16]}\n")
    if a.out:
        with open(a.out, "wb") as fh:
            fh.write(src)
    else:
        sys.stdout.buffer.write(src)
    return 0


if __name__ == "__main__":
    sys.exit(main())
