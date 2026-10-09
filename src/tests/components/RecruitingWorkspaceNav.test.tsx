import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";

function renderNav(pathname: string) {
  render(<MemoryRouter initialEntries={[pathname]}><RecruitingWorkspaceNav /></MemoryRouter>);
}

describe("RecruitingWorkspaceNav", () => {
  it("links the recruiting journey and no retired destinations", () => {
    renderNav("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "Worklist" }).getAttribute("href")).toBe("/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("href")).toBe("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "Stages" }).getAttribute("href")).toBe("/dashboard/recruits");
    expect(screen.getByRole("link", { name: "Calendar" }).getAttribute("href")).toBe("/dashboard/calendar");
    expect(screen.getByRole("link", { name: "Galaxy Training" }).getAttribute("href")).toBe("/dashboard/recruiting/training");
    expect(screen.queryByRole("link", { name: "Interviews" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Follow-ups" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Hires" })).toBeNull();
  });

  it("marks only the current slice", () => {
    renderNav("/dashboard/recruiting/pipeline");
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Worklist" }).getAttribute("aria-current")).toBeNull();
  });
});
