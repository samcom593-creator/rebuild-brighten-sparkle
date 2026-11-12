import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";

// The Licensed tab is staff-only (admin, VA manager, VA). null = rendered outside an AuthProvider.
let auth: { isAdmin: boolean; isVaManager: boolean; isVa: boolean } | null = null;
vi.mock("@/hooks/useAuth", () => ({ useOptionalAuth: () => auth }));
beforeEach(() => { auth = null; });

function renderNav(pathname: string) {
  render(<MemoryRouter initialEntries={[pathname]}><RecruitingWorkspaceNav /></MemoryRouter>);
}

describe("RecruitingWorkspaceNav", () => {
  it("links the recruiting journey and no retired destinations", () => {
    renderNav("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "Call list" }).getAttribute("href")).toBe("/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("href")).toBe("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "New hires" }).getAttribute("href")).toBe("/dashboard/recruits");
    expect(screen.getByRole("link", { name: "Calendar" }).getAttribute("href")).toBe("/dashboard/calendar");
    expect(screen.getByRole("link", { name: "Galaxy Training" }).getAttribute("href")).toBe("/dashboard/recruiting/training");
    expect(screen.queryByRole("link", { name: "Interviews" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Follow-ups" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Hires" })).toBeNull();
  });

  it("marks only the current slice", () => {
    renderNav("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Call list" }).getAttribute("aria-current")).toBeNull();
  });

  it("colours only the open tab's icon, in its page's tone, under the gold underline, with 15px labels", () => {
    renderNav("/dashboard/recruiting/pipeline");
    const pipeline = screen.getByRole("link", { name: "Pipeline" });
    expect(pipeline.querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-cool/);
    expect(pipeline.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(pipeline.className).toMatch(/border-primary/);
    for (const name of ["Call list", "New hires", "Calendar", "Galaxy Training"]) {
      expect(screen.getByRole("link", { name }).querySelector("svg")?.getAttribute("class")).not.toMatch(/text-tone-/);
    }
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("text-[15px]");
    // Each tab keeps its own page's tone, so the open icon always matches the header it leads to.
    cleanup();
    renderNav("/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Call list" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-gold/);
    expect(screen.getByRole("link", { name: "Pipeline" }).querySelector("svg")?.getAttribute("class")).not.toMatch(/text-tone-/);
    cleanup();
    renderNav("/dashboard/recruits");
    expect(screen.getByRole("link", { name: "New hires" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-good/);
    cleanup();
    renderNav("/dashboard/calendar");
    expect(screen.getByRole("link", { name: "Calendar" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-warm/);
    cleanup();
    renderNav("/dashboard/recruiting/training");
    expect(screen.getByRole("link", { name: "Galaxy Training" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-royal/);
  });

  it("wraps onto a second row on a phone instead of scrolling sideways, and every tab is 44px tall", () => {
    renderNav("/dashboard/recruiting");
    const nav = screen.getByRole("navigation", { name: "Recruiting workspace" });
    const strip = nav.firstElementChild as HTMLElement;
    expect(strip.className).toContain("flex-wrap");
    // Sideways scrolling and the no-wrap width are sm-and-up only.
    expect(strip.className).not.toMatch(/(^|\s)min-w-max/);
    expect(nav.className).not.toMatch(/(^|\s)overflow-x-auto/);
    for (const link of screen.getAllByRole("link")) expect(link.className).toContain("min-h-11");
  });

  it("shows the Licensed tab to staff, right after the Call list and ahead of New hires", () => {
    auth = { isAdmin: true, isVaManager: false, isVa: false };
    renderNav("/dashboard/recruiting/licensed");
    const licensed = screen.getByRole("link", { name: "Licensed" });
    expect(licensed.getAttribute("href")).toBe("/dashboard/recruiting/licensed");
    expect(licensed.getAttribute("aria-current")).toBe("page");
    // The Call list is an exact match, so it is not also marked open on the Licensed tab.
    expect(screen.getByRole("link", { name: "Call list" }).getAttribute("aria-current")).toBeNull();
    const order = screen.getAllByRole("link").map((a) => a.getAttribute("aria-label"));
    expect(order.slice(0, 3)).toEqual(["Call list", "Licensed", "Pipeline"]);
    expect(order.indexOf("Licensed")).toBeLessThan(order.indexOf("New hires"));
    cleanup();
    auth = { isAdmin: false, isVaManager: false, isVa: true };
    renderNav("/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Licensed" })).toBeTruthy();
  });

  it("hides the Licensed tab from managers, recruiters and anyone without auth (its page is staff-only)", () => {
    auth = { isAdmin: false, isVaManager: false, isVa: false };
    renderNav("/dashboard/recruiting");
    expect(screen.queryByRole("link", { name: "Licensed" })).toBeNull();
    cleanup();
    auth = null;
    renderNav("/dashboard/recruiting");
    expect(screen.queryByRole("link", { name: "Licensed" })).toBeNull();
    expect(screen.getByRole("link", { name: "New hires" })).toBeTruthy();
  });
});
