import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("APEX phone app contract", () => {
  it("launches as a standalone APEX OS app", () => {
    const manifest = JSON.parse(source("public/manifest.webmanifest"));
    expect(manifest.name).toBe("APEX Financial OS");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toContain("/dashboard");
  });

  it("keeps the worker active and provides a revisioned offline HTML shell", () => {
    const vite = source("vite.config.ts");
    expect(vite).toContain("selfDestroying: false");
    expect(vite).toContain('navigateFallback: "/index.html"');
    expect(vite).toContain('          "index.html",');
  });

  it("mounts role-aware mobile navigation across the authenticated OS", () => {
    const shell = source("src/components/layout/SidebarLayout.tsx");
    const nav = source("src/components/layout/MobileBottomNav.tsx");
    expect(shell).toContain("<MobileBottomNav />");
    // MP-332: the bottom nav keys on the resolved account mode (admin >
    // account_mode > roles), so VA staff, recruiters and agency owners each get
    // their own item set instead of falling through to the agent tabs.
    expect(nav).toContain('effectiveMode === "va" || effectiveMode === "va_manager"');
    expect(nav).toContain('effectiveMode === "recruiter" ? recruiterNavItems');
    expect(nav).toContain('aria-label="Primary mobile navigation"');
  });

  it("lets signed-in users reach the installer instead of redirecting away", () => {
    const install = source("src/pages/Install.tsx");
    expect(install).toContain("setIsAuthenticated(Boolean(session))");
    expect(install).toContain("Install your agency operating system");
  });
});
