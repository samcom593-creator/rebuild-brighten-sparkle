#!/usr/bin/env node
/**
 * check-telemetry-url-emit-time — MP-513 (2026-09-11)
 *
 * WHAT HAPPENED. Both writers into public.analytics_events set the row's `url`
 * by reading window.location.pathname inside flush(). Neither flush runs when
 * the event happens: track()'s is debounced (scheduleFlush() clears and
 * restarts a 5s timer on EVERY event, so a busy form postpones the drain
 * indefinitely) and webVitals' is a fixed 5s window. Both therefore drain
 * AFTER the user has navigated, and stamped every row in the batch with
 * whichever page they had reached by then.
 *
 * THE SIZE, measured rather than reasoned about. navigation.page_view is the
 * only event class that records its own path at emit time, in properties.path,
 * so the same row carries both operands and the disagreement is directly
 * countable: 9,532 of 36,048 page_views (26.44%) had a `url` contradicting
 * their own path. The worst pairs are rapid authenticated SPA clicking
 * (/dashboard swallowing 182 "/" page_views, 84 recruiting, 67 /login).
 *
 * WHAT IT DID NOT DO, stated because the loud version was available and is
 * wrong: v_apply_funnel_conversion (Check #75) counts distinct sessions with a
 * page_view at url='/apply'. On the live 28d window that is 193 by url against
 * 201 by true path -- a 4.0% undercount, which moves conversion 10.9% -> 10.4%
 * and does NOT change the view's 'degraded' verdict. This is a corrupted
 * dimension, not a wrong headline, and the reason to fix it is that funnel
 * localisation is the next thing to be built on top of it.
 *
 * UNRECOVERABLE FOR EVERY OTHER CLASS. Only page_view duplicates the truth into
 * properties. interaction and performance rows carry no emit-time path, so the
 * historical rows cannot be repaired -- apply_submitted is filed against
 * /apply/success/unlicensed with nothing to recover it from. Backfilling a
 * guess would be this ledger's 465 fake-success rows. Fixed forward only.
 *
 * CONTRACT A — no writer may derive `url` from window.location inside its
 *   analytics_events insert payload. That read is, by construction, happening
 *   at drain time; if the page is not captured when the event is made, it is
 *   not recoverable later.
 *
 * CONTRACT B — track()'s queue.push must carry a `url` key. Contract A alone is
 *   satisfiable by deleting the url entirely: flush() falls back to `?? null`
 *   and the column silently goes dark instead of going wrong. A guard that
 *   accepts the darker failure as a pass is not a guard.
 *
 * Stripped source only (MP-277): "window.location" appears in this repo's
 * comments, and a comment must not be able to fail -- or satisfy -- a contract.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRITERS = ["src/shared/telemetry/track.ts", "src/shared/lib/webVitals.ts"];
const TABLE = "analytics_events";

/**
 * MP-514 widened this: the payload may now be built by a named row-builder and
 * passed as `.insert(buildRows(batch))`, because the terminal (unload) writer
 * has to construct its rows SYNCHRONOUSLY and therefore cannot inline them
 * inside the async flush. When the .insert( argument is a bare call, resolve
 * that function in the same file and scan ITS body instead.
 *
 * This is a widening, not a weakening: the resolved body is checked against the
 * identical contract, and an argument that looks like delegation but cannot be
 * resolved is a FAILURE, not a pass. MP-513's own "matched nothing must not
 * report a pass" rule is what caught this refactor in the first place.
 */
function resolveDelegatedPayload(src, argBody) {
  const call = argBody.match(/^\.insert\(\s*([A-Za-z_$][\w$]*)\s*\(/);
  if (!call) return null;
  const name = call[1];
  const at = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (at === -1) return { name, body: null };
  let depth = 0, start = -1, end = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (start === -1 || end === -1) return { name, body: null };
  return { name, body: src.slice(start, end + 1) };
}

/** Return the source slice of each `.insert(` argument list, paren-matched. */
function insertPayloads(src) {
  const out = [];
  let idx = 0;
  for (;;) {
    const at = src.indexOf(".insert(", idx);
    if (at === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = at + ".insert".length; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) { out.push({ start: at, body: src.slice(at), unterminated: true }); break; }
    out.push({ start: at, body: src.slice(at, end + 1), unterminated: false });
    idx = end + 1;
  }
  return out;
}

const failures = [];
let checkedPayloads = 0;

for (const rel of WRITERS) {
  const abs = resolve(ROOT, rel);
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    failures.push(`${rel}: writer file is missing. If it moved, update WRITERS in this guard — a writer that cannot be found is not a writer that is safe.`);
    continue;
  }
  const src = stripComments(raw);

  if (!src.includes(TABLE)) {
    failures.push(`${rel}: no reference to ${TABLE} in stripped source. This guard is pointed at the wrong file, or the writer was renamed; either way the contract is no longer being enforced where it matters.`);
    continue;
  }

  // CONTRACT A
  for (let payload of insertPayloads(src)) {
    // MP-514: follow one level of delegation before deciding this payload is
    // uninteresting, or `.insert(buildRows(batch))` silently scans nothing.
    const delegated = resolveDelegatedPayload(src, payload.body);
    if (delegated) {
      if (delegated.body === null) {
        failures.push(`${rel}: .insert() delegates to ${delegated.name}(), which this guard could not resolve in the same file. Refusing to report a pass on a payload it could not read.`);
        continue;
      }
      payload = { ...payload, body: delegated.body };
    }
    if (!payload.body.includes("url")) continue;
    checkedPayloads++;
    if (payload.unterminated) {
      failures.push(`${rel}: could not paren-match an .insert( call; refusing to report a pass on source this guard could not read.`);
      continue;
    }
    if (/window\s*\.\s*location/.test(payload.body)) {
      failures.push(
        `${rel}: the analytics_events insert payload derives \`url\` from window.location. ` +
        `That read happens at flush time, after the user has navigated — it is what filed 26.44% of page_views against the wrong page. ` +
        `Capture the path where the event is created and carry it on the queued entry.`
      );
    }
  }

  // CONTRACT B (track.ts only: it is the writer with a queue push)
  if (rel.endsWith("track.ts")) {
    const push = src.match(/queue\s*\.\s*push\s*\(([\s\S]*?)\)\s*;/);
    if (!push) {
      failures.push(`${rel}: could not find queue.push(...). Contract B cannot be evaluated, so this is a failure, not a pass.`);
    } else if (!/\burl\s*:/.test(push[1])) {
      failures.push(
        `${rel}: queue.push() does not set \`url\`. flush() falls back to \`evt.url ?? null\`, so every telemetry row would be written with a NULL page — ` +
        `the column goes dark rather than wrong, which is the worse failure and the one Contract A alone would pass.`
      );
    }
  }
}

if (checkedPayloads === 0) {
  failures.push("no analytics_events insert payload carrying a `url` was found in any writer — the guard matched nothing and must not report a pass.");
}

if (failures.length) {
  console.error("check-telemetry-url-emit-time FAILED\n");
  for (const f of failures) console.error("  - " + f);
  console.error(`\n${failures.length} violation(s). A telemetry row's page must be captured when the event happens.`);
  process.exit(1);
}

console.log(`check-telemetry-url-emit-time PASS — ${WRITERS.length} writer(s), ${checkedPayloads} insert payload(s); url captured at emit time, queue push carries it.`);
