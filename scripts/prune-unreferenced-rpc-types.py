#!/usr/bin/env python3
"""Prune RPC signatures src never references from src/integrations/supabase/types.ts.

WHY (2026-11-05, MP-IG-PAUSE)
  The regenerated types.ts carried 686 Functions (631 before). supabase-js types `rpc` as a
  generic over `keyof Database["public"]["Functions"]`, so every `vi.mocked(supabase.rpc)` in a
  test and every `ReturnType<typeof supabase.rpc>` cast instantiates conditional types across
  the WHOLE union. At 686 members the compiler gives up with TS2589 ("excessively deep") at
  the first such site it reaches, and the error moves to the next site when that one is fixed:
  the verify-core gate went from 71 to 72, then 73, on code that had not changed. Measured:
  with the union pruned to the 312 functions src actually names, the count is exactly the
  baseline 71 (the same three pre-existing TS2589 sites, all `.from()` chains).

WHAT IT KEEPS
  Every Functions entry whose name appears as an identifier anywhere under src/ (except this
  generated file). A function src does not name cannot be called through the typed client, and
  a call added later either names a kept function or fails typecheck loudly (TS2345), so the
  prune can never hide a missing signature. Tables, Views, Enums and CompositeTypes are untouched:
  the relation-grain and column-grain guards compare those against the live catalog.

USAGE
  python3 scripts/prune-unreferenced-rpc-types.py            # prune in place, print what changed
  python3 scripts/prune-unreferenced-rpc-types.py --check    # exit 1 if a prune would change the file
  Runs automatically at the end of scripts/refresh-supabase-types.sh.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TYPES = ROOT / "src" / "integrations" / "supabase" / "types.ts"
ENTRY_RE = re.compile(r"^      ([A-Za-z_][A-Za-z0-9_]*): \{", re.M)


def functions_span(text: str) -> tuple[int, int]:
    """Start/end offsets of the body of the FIRST `    Functions: {` block (schema public)."""
    m = re.search(r"^    Functions: \{\n", text, re.M)
    if not m:
        raise SystemExit("prune-unreferenced-rpc-types: no `    Functions: {` block found; file format changed")
    start = m.end()
    end = text.index("\n    }\n", start)
    return start, end


def referenced_identifiers() -> set[str]:
    ids: set[str] = set()
    for p in (ROOT / "src").rglob("*"):
        if p.suffix not in (".ts", ".tsx") or p.resolve() == TYPES.resolve():
            continue
        ids.update(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", p.read_text(errors="ignore")))
    return ids


def prune(text: str, ids: set[str]) -> tuple[str, list[str], int]:
    start, end = functions_span(text)
    block = text[start:end]
    entries = re.split(r"(?m)^(?=      [A-Za-z_][A-Za-z0-9_]*: \{)", block)
    kept, dropped = [], []
    for e in entries:
        m = ENTRY_RE.match(e)
        if not m:
            kept.append(e)  # leading whitespace / the empty-object case
            continue
        (kept if m.group(1) in ids else dropped).append(e if m.group(1) in ids else m.group(1))
    total = sum(1 for e in entries if ENTRY_RE.match(e))
    return text[:start] + "".join(kept) + text[end:], dropped, total


def main() -> int:
    check = "--check" in sys.argv
    text = TYPES.read_text()
    pruned, dropped, total = prune(text, referenced_identifiers())
    kept = total - len(dropped)
    if pruned == text:
        print(f"prune-unreferenced-rpc-types: nothing to prune ({kept} function signatures, all referenced by src)")
        return 0
    if check:
        print(f"prune-unreferenced-rpc-types: --check FAILED; {len(dropped)} of {total} function signatures are unreferenced by src "
              f"(run without --check, or bash scripts/refresh-supabase-types.sh)")
        return 1
    TYPES.write_text(pruned)
    print(f"prune-unreferenced-rpc-types: kept {kept} of {total} function signatures; pruned {len(dropped)} src never names")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
