import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WIB 2026-10-06: QueryShell wraps every non-landing route (/apply, /join,
// /login). When it rendered the lazy <AgentProfileDrawer /> unconditionally,
// lazy() fetched the admin drawer + ~20 admin chunks on every public visit
// (/apply: 62 -> 34 scripts once gated). The drawer may only be rendered by
// AgentProfileDrawerHost, which mounts it on the first openAgent().
// Comments stripped: App.tsx:41 says "the global <AgentProfileDrawer /> mounts
// in QueryShell" in prose, and a raw-source count would read that as a render.
const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function body(fnName: string): string {
  const start = app.indexOf(`function ${fnName}(`);
  expect(start, `${fnName} not found in App.tsx`).toBeGreaterThan(-1);
  const next = app.indexOf("\nfunction ", start + 1);
  const end = app.indexOf("\nconst ", start + 1);
  const stops = [next, end].filter((i) => i > -1);
  return app.slice(start, stops.length ? Math.min(...stops) : undefined);
}

describe("AgentProfileDrawer mount gate", () => {
  it("renders the drawer only inside AgentProfileDrawerHost", () => {
    const renders = app.match(/<AgentProfileDrawer\s*\/>/g) ?? [];
    expect(renders).toHaveLength(1);
    expect(body("AgentProfileDrawerHost")).toMatch(/<AgentProfileDrawer\s*\/>/);
  });

  it("host returns null until the store has asked for an agent", () => {
    const host = body("AgentProfileDrawerHost");
    expect(host).toMatch(/useAgentProfileDrawer\(/);
    expect(host).toMatch(/if \(!armed && !requested\) return null;/);
  });

  it("QueryShell mounts the host, not the drawer", () => {
    const shell = body("QueryShell");
    expect(shell).toMatch(/<AgentProfileDrawerHost\s*\/>/);
    expect(shell).not.toMatch(/<AgentProfileDrawer\s*\/>/);
  });
});
