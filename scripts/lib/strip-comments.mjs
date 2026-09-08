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
