import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";

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
});
