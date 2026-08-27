import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrainingWorkspaceNav } from "@/components/training/TrainingWorkspaceNav";

const auth = {
  isAdmin: false,
  isManager: false,
  isVaManager: false,
  isVa: false,
  isRecruiter: false,
  accountMode: null,
  effectiveMode: "agent" as const,
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

function renderNav(pathname = "/dashboard/recruiting/training/library") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <TrainingWorkspaceNav />
    </MemoryRouter>,
  );
}

describe("TrainingWorkspaceNav", () => {
  beforeEach(() => Object.assign(auth, {
    isAdmin: false,
    isManager: false,
    isVaManager: false,
    isVa: false,
    isRecruiter: false,
    accountMode: null,
    effectiveMode: "agent" as const,
  }));

  it("gives agents every learning section without staff controls", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "Learning hub" })).toHaveAttribute(
      "href",
      "/dashboard/recruiting/training/library",
    );
    expect(screen.getByRole("link", { name: "Field course" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Annuities" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team progress" })).not.toBeInTheDocument();
  });

  it("gives training staff the AgentCloud operating sections", () => {
    auth.isVa = true;
    renderNav("/dashboard/recruiting/training/progress");
    expect(screen.getByRole("link", { name: "Recruit progress" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team progress" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Course content" })).toBeInTheDocument();
  });
});
