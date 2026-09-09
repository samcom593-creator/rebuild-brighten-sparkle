// href-anchor.mjs — MP-497
//
// Does an <a href={expr}> PROVABLY receive a value anchored to a scheme or a
// path root? A string with neither resolves RELATIVE to the current page, so a
// carrier website stored as `aflac.com` navigated to /dashboard/contracting/
// aflac.com — matching no route, served 200 by vercel.json (MP-295), rendered
// as the catch-all. MP-495 found that live and fixed the one page it rendered
// on; this is the oracle for the CLASS.
//
// WHAT THIS IS NOT: a type checker. It answers one question by CALL SHAPE, and
// where it cannot answer it says so rather than guessing. Every rule below was
// added because measuring without it produced a WRONG number on this repo:
//
//   nullish branches      `x ? url : null` is not a bad link — React omits the
//                         attribute. Demanding both branches be anchored
//                         condemned every helper in src/lib/phone.ts.
//   cycle guard release   the guard was held after the subtree returned, so the
//                         SECOND sibling reference to phoneHref() scored false.
//                         Held-not-released turned 5 good sites into findings.
//   launderers            externalHref() returns `parsed.href`, which no
//                         return-shape rule can prove. The sanitizer is never
//                         provable by the rule it enforces, so it is named.
//   call-site guards      `call.location?.startsWith("http") && <a href=...>`
//                         is a real guard and static return analysis cannot see
//                         it. Ignoring it reported DashboardToday as a defect.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const ROOT = REPO_ROOT;
const LAUNDERERS = new Set(["externalHref"]);
const ANCHOR = /^(https?:\/\/|mailto:|tel:|sms:|data:|blob:|\/|#|\?)/i;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc); else if (/\.(tsx|ts)$/.test(e.name)) acc.push(full);
  }
  return acc;
}
const cache = new Map();
function parse(f) {
  if (!cache.has(f)) cache.set(f, ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, /\.tsx$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  return cache.get(f);
}
function unwrap(n) {
  while (n && (ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression?.(n))) n = n.expression;
  return n;
}
function resolveModule(sf, spec) {
  let base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : path.resolve(path.dirname(sf.fileName), spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(base + ext)) return parse(base + ext);
  return null;
}
// every binding for `name`: local vars at ANY depth, function decls, and one import hop
function bindings(sf, name, depth = 0) {
  const out = [];
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) out.push({ node: n.initializer, sf });
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) out.push({ node: n, sf });
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  if (out.length || depth > 1) return out;
  let spec = null;
  sf.forEachChild((n) => {
    if (spec) return;
    if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings))
      for (const el of n.importClause.namedBindings.elements) if (el.name.text === name) spec = n.moduleSpecifier.text;
  });
  if (!spec) return [];
  const target = resolveModule(sf, spec);
  return target ? bindings(target, name, depth + 1) : [];
}
// all return expressions of a function-ish node
function returnsOf(fn) {
  const out = [];
  const body = fn.body;
  if (!body) return out;
  if (!ts.isBlock(body)) { out.push(body); return out; }
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return; // nested fn
    if (ts.isReturnStatement(n)) out.push(n.expression ?? null);
    n.forEachChild(visit);
  };
  body.forEachChild(visit);
  return out;
}
const NULLISH = new Set([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.UndefinedKeyword]);
function isNullish(e) {
  if (!e) return true;
  if (NULLISH.has(e.kind)) return true;
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text === "") return true;
  return false;
}

function anchored(expr, sf, depth = 0, seen = new Set()) {
  if (depth > 8 || !expr) return false;
  expr = unwrap(expr);
  if (!expr) return false;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return ANCHOR.test(expr.text);
  if (ts.isTemplateExpression(expr)) {
    if (ANCHOR.test(expr.head.text)) return true;
    if (expr.head.text === "" && expr.templateSpans.length) return anchored(expr.templateSpans[0].expression, sf, depth + 1, seen);
    return false;
  }
  // A branch that yields null/undefined/"" is NOT a bad link: React omits the
  // attribute and the caller renders its no-link state. Requiring every branch
  // to be anchored condemned every `x ? url : null` helper in the repo.
  if (ts.isConditionalExpression(expr)) {
    const bs = [expr.whenTrue, expr.whenFalse].filter((b) => !isNullish(b));
    return bs.length > 0 && bs.every((b) => anchored(b, sf, depth + 1, seen));
  }
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken) {
      const bs = [expr.left, expr.right].filter((b) => !isNullish(b));
      return bs.length > 0 && bs.every((b) => anchored(b, sf, depth + 1, seen));
    }
    if (k === ts.SyntaxKind.PlusToken) return anchored(expr.left, sf, depth + 1, seen);
    return false;
  }
  if (ts.isCallExpression(expr)) {
    let fn = expr.expression;
    if (ts.isPropertyAccessExpression(fn) && fn.name.text === "replace") return anchored(fn.expression, sf, depth + 1, seen);
    if (ts.isIdentifier(fn) && LAUNDERERS.has(fn.text)) return true;
    if (!ts.isIdentifier(fn)) return false;
    const key = `${sf.fileName}#${fn.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const bs = bindings(sf, fn.text);
    if (!bs.length) { seen.delete(key); return false; }
    const verdict = (() => {
    for (const b of bs) {
      const node = ts.isFunctionDeclaration(b.node) ? b.node : unwrap(b.node);
      if (!node || !(ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return false;
      const rets = returnsOf(node);
      if (!rets.length) return false;
      // every non-nullish return must be anchored; a null return means caller renders no link
      for (const r of rets) if (!isNullish(r) && !anchored(r, b.sf, depth + 1, seen)) return false;
    }
    return true;
    })();
    seen.delete(key);
    return verdict;
  }
  if (ts.isIdentifier(expr)) {
    const key = `${sf.fileName}#id#${expr.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const bs = bindings(sf, expr.text);
    if (!bs.length) { seen.delete(key); return false; }
    const verdict = bs.every((b) => anchored(b.node, b.sf, depth + 1, seen));
    seen.delete(key);
    return verdict;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const root = unwrap(expr.expression);
    if (ts.isIdentifier(root)) {
      for (const b of bindings(sf, root.text)) {
        const obj = unwrap(b.node);
        if (obj && ts.isObjectLiteralExpression(obj))
          for (const p of obj.properties)
            if (ts.isPropertyAssignment(p) && p.name.getText(b.sf).replace(/['"]/g, "") === expr.name.text)
              return anchored(p.initializer, b.sf, depth + 1, seen);
      }
    }
    return false;
  }
  return false;
}


// A property access whose field is snake_case has the SHAPE of a database row
// field. Shape is not origin — AgentOnboardingStepper builds `step.action_url`
// in the component — so this narrows the residue, it does not prove a leak.
export const DB_ROW_SHAPE = /^[A-Za-z_$][\w$]*(\?)?\.[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

export function scanHrefSites(roots) {
  const rows = [];
  for (const root of roots) {
    for (const f of walk(root)) {
      const sf = parse(f);
      const visit = (n) => {
        if (ts.isJsxAttribute(n) && n.name.getText(sf) === "href" && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
          const e = n.initializer.expression;
          let guarded = false;
          let anc = n.parent;
          for (let i = 0; i < 6 && anc; i++, anc = anc.parent) {
            const t = anc.getText(sf);
            if (t.length < 4000 && /startsWith\(\s*["'`]https?/.test(t)) { guarded = true; break; }
          }
          rows.push({
            file: path.relative(REPO_ROOT, f),
            line: sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1,
            expr: e.getText(sf).replace(/\s+/g, " ").slice(0, 100),
            safe: anchored(e, sf) === true || guarded,
          });
        }
        n.forEachChild(visit);
      };
      visit(sf);
    }
  }
  return rows;
}
export { walk, parse, anchored };
