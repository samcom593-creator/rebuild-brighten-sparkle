/**
 * ONE comment-stripper for the repo's source-scanning guards.
 *
 * MP-474 measured 21 distinct private copies of this function across 23 guards.
 * 19 of them mis-lex an apostrophe in JSX prose text ("We'll", "don't") as an
 * opening string quote: the phantom string then runs to the next apostrophe --
 * often EOF -- so every comment inside that span survives and the guard fires on
 * its own prose. 3 of them do the opposite and strip a `//` inside a string
 * literal to end-of-line, DELETING real code after it on that line, which hides
 * a violation. That second direction is the dangerous one.
 *
 * Two rules this file exists to hold, both learned by measurement:
 *
 *  1. BLANK, never delete. Byte offsets are preserved so reported line numbers
 *     stay true and a caller may slice the original text by the same indices.
 *
 *  2. A lexer, never an AST walk. MP-474 first tried TypeScript's own comment
 *     ranges as the oracle. It passed 15/15 synthetic fixtures and was still
 *     wrong on real code: comments sitting BETWEEN links of a fluent chain
 *     (`.gt(...)` / comment / `.order(...)`) are attached to no node's leading
 *     trivia, so they survived -- and check-maybesingle-nonunique then accused
 *     telegram-webhook's raiseEscalation, which is correct, documented code
 *     carrying .limit(1). See the mid-chain fixture in the test file.
 */

const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

// MP-482: a regex literal is code, and its body may hold a quote. `/"/g` in an
// HTML-escape chain (.replace(/"/g, "&quot;")) desynchronised this lexer: with no
// regex rule the `"` inside the pattern opened a phantom string, so every comment
// downstream survived and the guard fired on its own prose -- the SAME failure the
// apostrophe rule above exists to prevent, entered through a different door.
// Measured before the fix: 56 files, 689 real comment lines left standing.
//
// `/` is ambiguous (divide vs regex), so this errs toward DIVIDE and is bounded
// twice over: a regex may only start where a value cannot already have ended, and
// the scan aborts at a newline because a regex literal cannot span one. A
// misjudged divide therefore skips nothing and can never swallow code -- the
// failure mode is falling back to today's behaviour, not a new blind spot.
// Deliberately NARROW, and the narrowing is load-bearing. The first cut of this
// set also held "<", ">", "~", "?", "{", "}", "+", "-", "*", "%" and "^", and it
// cost real code immediately: in InsuraCloudHealthAlert.tsx the `<` of a JSX
// CLOSING TAG (`</code>`) sits directly before a `/`, so `/` read as a regex
// start, the mis-scan desynchronised the lexer, and `href="https://replit.com/~"`
// lost everything from `//` to end of line -- the deletes-real-code direction this
// family exists to prevent, introduced by its own fix.
//
// Bisected, not assumed: each of those characters was re-added ALONE against the
// real file and only "<" reproduces it. The first draft of this comment blamed
// "~" because that is what the failing line looked like; the mutation proof said
// otherwise. JSX prose sits in code state, so no character that reads as prose
// punctuation may vote here -- only operators that cannot end a value.
const RE_ALLOWED_BEFORE = new Set(["(", ",", "=", ":", "[", "!", "&", "|", ";"]);
const RE_KEYWORD_BEFORE = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

// MP-487: `=>` is the single most common place a regex literal starts, and the
// bisect above excluded it. That bisect was sound and its conclusion was drawn one
// character too wide: it proved "<" reproduces the JSX-closing-tag damage, then
// dropped the whole candidate block including ">". A bare ">" must stay out -- it
// is the closing bracket of a JSX opening tag -- but the two-character sequence
// "=>" cannot be: JSX would need an unquoted attribute ending in "=" directly
// before the bracket, which does not parse. Measured inside the lexer's own state
// machine, not by text scan: 47 sites in src/, supabase/functions/ and scripts/
// where today's rule declines a regex that is unambiguously a regex, among them
// `(x) => /^["'`][^"'`$]*["'`]$/.test(x)` at check-enum-filter-literals.mjs:296,
// whose character class then opened a phantom string that ran 40 lines.
const arrowPrecedes = (text, p) => text[p] === ">" && text[p - 1] === "=";

// A closed set of URL schemes immediately left of `//`, anchored so only the
// characters touching the slashes can match. See the use site for why it is closed.
const URL_SCHEME_BEFORE = /(^|[^A-Za-z0-9_$])(https?|wss?|ftp|file):$/;

// End index (exclusive, flags included) of a regex literal starting at `i`, or -1.
function scanRegexLiteral(text, i, n) {
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const ch = text[j];
    if (ch === "\\") { j += 2; continue; }
    if (ch === "\n") return -1;            // regex literals never span a line
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      j++;
      while (j < n && /[a-z]/.test(text[j])) j++;   // flags
      return j;
    }
    j++;
  }
  return -1;
}

// True when a `/` at index i can only be starting a regex, never a division.
//
// MP-503: the lookback must run over the CODE-ONLY view, never the raw source.
// This walked back over whitespace in `text`, so a regex literal preceded by a
// comment landed on the comment's last PROSE character -- `e` of "// note" reads
// as an identifier, an identifier can end a value, so the `/` was called a
// division and a quote in the regex body opened a phantom string. Same failure
// family as MP-482 and MP-487, entered through the one door nobody had tried:
// a comment. It was latent from the day the regex rule shipped and cost nothing
// until check-dead-internal-links.mjs:118 became the repo's first regex-after-a-
// comment whose body carries a quote; main was then red for 7 consecutive runs.
//
// `out` has every comment already blanked to spaces and the lexer is single-pass,
// so every index below `i` is final. Reading it instead of `text` means the walk
// skips comments for free and lands on the real previous token. Strings are NOT
// blanked, which is correct: a string is a value, so `/` after one is division.
// A genuine divide keeps its answer -- `a /* n */ / b` still lands on `a`.
function regexCanStartAt(code, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(code[p])) p--;
  if (p < 0) return true;
  if (RE_ALLOWED_BEFORE.has(code[p])) return true;
  if (arrowPrecedes(code, p)) return true;
  let tail = "";
  for (let k = Math.max(0, p - 11); k <= p; k++) tail += code[k];
  return RE_KEYWORD_BEFORE.test(tail);
}

// True when a `'` in CODE state is prose, not a string delimiter.
//
// MP-474's rule -- word char on BOTH sides -- catches "We'll" and "don't" and
// declines every other prose apostrophe. Two shapes it lets through, both JSX text:
// a plural possessive (`other agents' rows`) where the right neighbour is a space,
// and a possessive after a JSX expression (`{manager.name}'s Team`) where the left
// neighbour is `}`. Each opened a phantom string that ran to the next apostrophe.
//
// Safe because neither shape can be an OPENING delimiter: valid JS has no value
// immediately left of a string literal, so `x'a'` does not parse. The closing quote
// of a real string has the same neighbours -- `'div',` -- but is consumed in QUOTE
// state and never reaches this function. A naive text scan conflates the two and
// reports 2,583 sites; inside the lexer the true counts are 2 and 1.
//
// The keyword guard is the one real hazard: `return'x'` and `case'a':` ARE valid JS
// with no space, and there the left neighbour is a word char while a string really
// does open. No such site exists in the repo today -- this holds the rule for code
// written tomorrow. Same list as RE_KEYWORD_BEFORE, so the two cannot drift.
function apostropheIsProse(text, i) {
  const prev = text[i - 1];
  const next = text[i + 1];
  if (isWordChar(prev)) {
    if (RE_KEYWORD_BEFORE.test(text.slice(Math.max(0, i - 12), i))) return false;
    return true;                       // We'll / don't / agents'
  }
  return prev === "}" && isWordChar(next);   // {manager.name}'s
}

export function stripComments(text) {
  const n = text.length;
  const out = text.split("");
  let i = 0;
  let quote = null;   // "'" | '"' | "`" while inside a string
  let tplDepth = 0;   // ${ } nesting inside a template literal

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };

  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];

    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (quote === "`" && c === "$" && c2 === "{") { tplDepth++; i += 2; continue; }
      if (quote === "`" && c === "}" && tplDepth > 0) { tplDepth--; i++; continue; }
      if (c === quote && tplDepth === 0) { quote = null; i++; continue; }
      i++;
      continue;
    }

    // Comments -- only ever recognised in code state, never inside a string.
    // ...except that JSX TEXT is code state to this lexer, and a bare URL in JSX
    // text carries a `//` that is not a comment. MP-487 found this with an oracle
    // pass asserting every blanked character sits inside a real comment: 191
    // characters across BotToken.tsx:160 and ReadyModeIntegration.tsx:527 were
    // being blanked to end of line. It is the DANGEROUS direction -- a guard reads
    // the rest of that line as absent, so a violation there is not reported. It
    // predates MP-487 (identical 191 under HEAD's lexer) and no wave had measured
    // it, because a blind spot produces no output to investigate, unlike the false
    // positives the phantom-string bugs produced.
    //
    // The scheme list is closed on purpose. Matching any `[a-z]+://` would let an
    // object key swallow a real comment (`{ key://note` has no space in it), and a
    // key literally named `https` before a comment is not a thing that happens.
    if (c === "/" && c2 === "/" && URL_SCHEME_BEFORE.test(text.slice(Math.max(0, i - 6), i))) {
      i += 2;
      continue;
    }
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
      continue;
    }

    // A regex literal is code: skip it whole so a quote in its body cannot open a
    // phantom string. Checked AFTER the comment rules, so `//` and `/*` still win.
    if (c === "/" && c2 !== undefined && !/\s/.test(c2) && regexCanStartAt(out, i)) {
      const end = scanRegexLiteral(text, i, n);
      // Every recognised regex is skipped, with no filter on its body. The first
      // cut only intervened when the body held a quote, on the theory that a quote
      // is the only thing that can desynchronise the lexer. It is not:
      // `/^https:\\/\\//i` (contracting-delivery.ts:88) carries a literal `//`, which
      // the comment rule then read as a line comment and blanked 105 characters of
      // real code to end of line. A narrower rule here is not a safer rule.
      if (end !== -1) { i = end; continue; }
    }

    if (c === "'" || c === '"' || c === "`") {
      // An apostrophe in prose ("We'll", "don't", "agents'", "{x.name}'s") is JSX
      // text, not a string delimiter. Treating it as one is the single most common
      // defect in the copies this file replaces. See apostropheIsProse.
      if (c === "'" && apostropheIsProse(text, i)) { i++; continue; }
      quote = c;
      i++;
      continue;
    }

    i++;
  }
  return out.join("");
}

export default stripComments;
