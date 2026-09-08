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
function regexCanStartAt(text, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(text[p])) p--;
  if (p < 0) return true;
  if (RE_ALLOWED_BEFORE.has(text[p])) return true;
  return RE_KEYWORD_BEFORE.test(text.slice(Math.max(0, p - 11), p + 1));
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
    if (c === "/" && c2 !== undefined && !/\s/.test(c2) && regexCanStartAt(text, i)) {
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
      // An apostrophe welded into a word ("We'll", "don't") is JSX/prose text,
      // not a string delimiter. Treating it as one is the single most common
      // defect in the copies this file replaces. `a'b'` is not valid JS, so a
      // real opening quote is never both preceded and followed by a word char.
      if (c === "'" && isWordChar(text[i - 1]) && isWordChar(c2)) { i++; continue; }
      quote = c;
      i++;
      continue;
    }

    i++;
  }
  return out.join("");
}

export default stripComments;
