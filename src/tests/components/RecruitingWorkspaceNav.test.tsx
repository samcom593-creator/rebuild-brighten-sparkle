import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { RecruitingWorkspaceNav } from "@/components/recruiting/RecruitingWorkspaceNav";

function renderNav(pathname: string) {
  render(<MemoryRouter initialEntries={[pathname]}><RecruitingWorkspaceNav /></MemoryRouter>);
}

describe("RecruitingWorkspaceNav", () => {
  it("keeps every recruiting step under the canonical workspace", () => {
    renderNav("/dashboard/recruiting/interviews");
    expect(screen.getByRole("link", { name: "Applicants" }).getAttribute("href")).toBe("/dashboard/recruiting");
    expect(screen.getByRole("link", { name: "Interviews" }).getAttribute("href")).toBe("/dashboard/recruiting/interviews");
    expect(screen.getByRole("link", { name: "Follow-ups" }).getAttribute("href")).toBe("/dashboard/recruiting/follow-ups");
    expect(screen.getByRole("link", { name: "Hires" }).getAttribute("href")).toBe("/dashboard/recruiting/hires?status=hired");
    expect(screen.getByRole("link", { name: "APEX Training" }).getAttribute("href")).toBe("/dashboard/recruiting/training");
  });

  it("marks only the current slice", () => {
    renderNav("/dashboard/recruiting/follow-ups");
    expect(screen.getByRole("link", { name: "Follow-ups" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Applicants" }).getAttribute("aria-current")).toBeNull();
  });
});
