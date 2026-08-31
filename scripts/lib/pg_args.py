"""Parse one pg_get_function_arguments() signature into the shape the RPC guard grades.

SINGLE SOURCE ON PURPOSE (MP-350). Two consumers ask the same question about the
same string and must never disagree:

  scripts/refresh-rpc-catalog.sh   writes scripts/data/rpc-catalog.json
  apex-doctor Check #42            re-queries pg_proc weekly and diffs it

If each kept its own copy, a change to one would silently make the weekly drift
check grade a shape the committed catalog never had -- which is how curl's
--max-time and fn_agentlink_reap_stuck drifted into 36 false pages a day, and
what fn_alert_sms_fix_anchor() and Check #24/#25's shared launchd parser exist
to prevent. Importing this file is the whole point of it.
"""
import re


def parse(a):
    """(all_param_names, required_param_names, has_positional_only) for one signature.

    OUT params are not supplied by a caller. A param with a DEFAULT is optional.
    An unnamed param cannot be addressed by name at all, so it is recorded as
    such rather than silently dropped -- see UNNAMED handling in the checker."""
    if not a.strip():
        return [], [], False
    parts, depth, cur = [], 0, ""
    for ch in a:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur); cur = ""; continue
        cur += ch
    parts.append(cur)
    allp, req, unnamed = [], [], False
    for p in parts:
        p = p.strip()
        if not p:
            continue
        has_default = " DEFAULT " in p.upper()
        toks = p.split()
        mode = "IN"
        if toks and toks[0].upper() in ("IN", "OUT", "INOUT", "VARIADIC"):
            mode, toks = toks[0].upper(), toks[1:]
        if mode == "OUT" or not toks:
            continue
        name = toks[0]
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or len(toks) == 1:
            unnamed = True     # positional-only: `text` with no parameter name
            continue
        allp.append(name)
        if not has_default:
            req.append(name)
    return sorted(allp), sorted(req), unnamed


def signature(raw):
    """The parsed shape the checker grades, as a hashable key."""
    allp, req, unnamed = parse(raw or "")
    return (tuple(allp), tuple(req), unnamed)
