import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type InteractiveKind = "button" | "link";
type InteractiveAncestor = { kind: InteractiveKind; tag: string };
type OpeningElement = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function collectTsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(filePath);
    return filePath.endsWith(".tsx") ? [filePath] : [];
  });
}

function hasAsChild(element: OpeningElement): boolean {
  return element.attributes.properties.some(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "asChild",
  );
}

function interactiveKind(element: OpeningElement): InteractiveKind | null {
  const tag = element.tagName.getText().split(".").at(-1);
  if (tag === "a" || tag === "Link" || tag === "NavLink") return "link";
  if (tag === "button") return "button";
  if ((tag === "Button" || tag === "GradientButton") && !hasAsChild(element)) return "button";
  return null;
}

function findNestedControls(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];

  function inspectOpening(element: OpeningElement, ancestors: InteractiveAncestor[]): InteractiveAncestor[] {
    const kind = interactiveKind(element);
    if (!kind) return ancestors;

    const tag = element.tagName.getText();
    for (const ancestor of ancestors) {
      if (ancestor.kind === kind) continue;
      const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
      violations.push(`${path.relative(process.cwd(), filePath)}:${line + 1} ${ancestor.tag} > ${tag}`);
    }
    return [...ancestors, { kind, tag }];
  }

  function visit(node: ts.Node, ancestors: InteractiveAncestor[] = []): void {
    if (ts.isJsxElement(node)) {
      const nextAncestors = inspectOpening(node.openingElement, ancestors);
      node.children.forEach((child) => visit(child, nextAncestors));
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      inspectOpening(node, ancestors);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, ancestors));
  }

  visit(sourceFile);
  return violations;
}

describe("interactive control semantics", () => {
  it("never nests links and buttons", () => {
    const violations = collectTsxFiles(path.join(process.cwd(), "src")).flatMap(findNestedControls);

    expect(violations).toEqual([]);
  });
});
